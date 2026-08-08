# ADR 0006 — Draw generation model

**Status:** Accepted, 2026-08-08. **Tracker:** filed alongside Sprint F (events
service). Supersedes nothing.

## Context

Sprints 1 / C / D / E built:

- Read/write APIs for seasons, teams, sport-configs.
- The whole scoring / live-viewing / standings / archive stack.
- A pure round-robin generator in `_shared/round-robin.ts` with unit tests and
  **zero callers** — it was written for the service that hadn't been built yet.

But the organiser had no HTTP way to create an `event`, a `slot`, or a
`fixture`. Every downstream piece was reachable only from data seeded by
hand-writing SQL into a local database. The frontend team could not have demoed
the flow described at the top of `docs/overview.md`.

Sprint F adds an `events` service that closes the loop. Two design points needed
a durable record: **how do generated round-robin pairings map to slots**, and
**what makes a draw safe to publish**.

## Decision

### 1. Rounds map to slots, with wrap

`POST /events/:id/generate` accepts `{ sport, team_ids[], slot_ids[] }`, calls
`generateRoundRobin(team_ids)`, then in `spread.ts` maps each round-robin round
onto the caller-provided slot list:

    round r  →  slots[(r - 1) mod slots.length]

For 4 teams (3 rounds) on 4 slots:

- Round 1's 2 fixtures land in slot 1
- Round 2's 2 fixtures land in slot 2
- Round 3's 2 fixtures land in slot 3
- Slot 4 stays empty

For 6 teams (5 rounds) on 3 slots:

- Rounds 1, 2, 3 land in slots 1, 2, 3
- Round 4 wraps to slot 1; round 5 wraps to slot 2

The reason is that a round-robin round is definitionally a set of matches where
each team appears at most once — exactly the games that can play in parallel
across pitches at one time. Slotting by round matches how Monday nights actually
run: "at 6pm we have three games going." A pairing-level distribution (deal one
fixture per slot) would spread the same round across time, which is the wrong
story for the sport.

### 2. `?dry_run=true` is a first-class mode, not a follow-up

The generate route accepts `?dry_run=true` and returns the proposed fixture list
without touching the database. Same code path builds the preview as the insert —
`spread.ts` is pure, so it runs identically in either mode.

An organiser who can't see the draw before it lands doesn't trust it. Trust
matters here because publishing is a one-shot: unpublish exists but during a
demo, on a phone, the organiser wants confidence before the green button.

### 3. Publish is the validation gate

RLS on the events / slots / fixtures / results tables gates public reads on
`events.is_published = true`. So the moment `publish` flips the bit, every row
under that event becomes visible to `anon` — and any hole in the draw shows up
as a broken public page.

We chose to enforce that at the publish route, not at every write:

- **Individual write routes** stay permissive. An organiser may legitimately
  have a half-built draw sitting for a while (Wednesday planning, Thursday
  tweak, Friday publish). Rejecting partial state on every insert would force
  organisers to build the draw in a rigid order.
- **`POST /events/:id/publish`** runs `validatePublish` over the whole event. It
  refuses (409, with a specific reason string) when:
  - the event has zero fixtures
  - any fixture is missing a slot, or points at a slot that has been deleted
    from this event
  - any home team is missing, or not in the season's teams
  - any away team (if not null) is not in the season's teams
  - any sport is not in `seasons.sports`
  - any fixture has the same team on both sides

Byes (`away_team_id: null`) are legal and expected — the schema deliberately
allows them and the round-robin generator produces them for odd team counts.

Cancelled fixtures are legal — they render struck-through on the public page,
but they aren't holes.

### 4. Unpublish refuses to silently hide in-flight matches

`POST /events/:id/unpublish` refuses (409) when any fixture on the event is
`live` or `complete`, unless the body includes `{ "force": true }`.

Yanking a live game out from under students who are watching the score tick
would end in "why did the score stop updating?" support calls. The `force` flag
is the escape hatch, and forces the caller to have thought about it.

### 5. Destructive routes check downstream state

Route-level cheap pre-checks give 409s with a specific reason instead of raw
DB-error surfaces:

- `DELETE /events/:id/fixtures/:fid` refuses when the fixture has any
  `match_events` (cascade would silently orphan the audit trail — cancel the
  fixture instead).
- `DELETE /events/:id/slots/:slotId` refuses when any fixture points at the slot
  (the FK is `on delete restrict` anyway; the pre-check is for the readable
  error).
- `DELETE /events/:id` refuses when the event is published, and
  `PATCH /events/:id` refuses to change a published event's date.

## Consequences

- **Draw is reachable end-to-end.** From a fresh empty database the organiser
  can now build a full Monday night without SQL: season → teams → event → slots
  → generate → publish. The `smoke-live.sh` extension in follow-up work
  exercises exactly this.
- **`_shared/round-robin.ts` finally has a caller.** No behavioural change to
  the generator itself; `spread.ts` is the only thing that consumes it.
- **Publishing surfaces problems on the write path**, not on the public read
  path. Whatever error you're going to get, you get it before students do.
- **Unpublish is safe by default**, escape hatch by opt-in. Organisers don't
  need to think about live-match implications on every unpublish.
- **Draw generation stays deterministic.** Same input in the same order produces
  the same fixture list, so the dry-run preview matches the insert exactly.
  Randomised seeding is the caller's responsibility (shuffle `team_ids` upstream
  if you want it).

## Rejected alternatives

- **Deal pairings one-per-slot in order.** Would spread a single round-robin
  round across multiple slots, which contradicts the "everyone plays once per
  round" invariant that makes rounds a useful concept in the first place.
- **Auto-shuffle team seeding inside `/generate`.** Would break determinism and
  make the dry-run preview meaningless. Callers who want randomness can shuffle
  their `team_ids` array.
- **Reject publish only when the event has zero fixtures.** Cheapest possible
  check, but misses every structural hole (dangling slot ids, cross-season team
  references, misdeclared sport) that RLS would then expose to the public.
- **Validate structural correctness on every write.** Would force organisers to
  build the draw in a fixed order and reject partial progress. Publish-as-gate
  matches how the organiser actually works.
- **Cascade unpublish through live matches without a flag.** Would let a
  mis-click erase the students' view of an in-progress match with no warning.
  `force` costs one extra body field.
- **Support multi-round-robin or knockout formats.** Explicitly out of scope for
  Sprint F. The route body's `sport` field is per-call so future formats can be
  added as sibling actions (`/events/:id/generate-knockout`, say) without
  changing this one.

## Follow-ups

- Player attribution on the draw side (e.g. "who's captaining team X today")
  stays deferred — see ADR 0005.
- Multi-round-robin scheduling with balanced home/away — future story; the
  generator's home/away imbalance is noted in its docstring.
- Pitch-aware distribution — right now `slots.pitch` is free-text metadata; a
  future refactor could let generate optimise across concurrent pitches. Not
  needed for Sprint F.
