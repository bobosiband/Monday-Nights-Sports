# ADR 0005 — Deferring player attribution and penalty shootouts

**Status:** Accepted, 2026-07-26.

## Context

Two features surfaced during Sprint C planning that the build prompt
explicitly deferred:

1. **Player attribution on `match_events`.** The `players` table
   exists; `match_events.player_id` is accepted and stored; nothing
   surfaces it in any read path.
2. **Penalty shootouts.** `results.decided_by` already accepts
   `'penalties'`; there's no event modelling for the shots themselves.

## Decision

**Keep both deferred through Sprints C/D/E. Persist just enough to
add them later without a migration or a data backfill.**

Player attribution:
- The write path continues to accept `player_id` on `record` events.
- The public read paths (`live`, `fixtures-public`, `results-public`)
  do NOT expose it. Adding a "scorers" section to the summary is a
  future story; the data is already flowing into the DB, so no
  backfill needed when it lands.

Penalty shootouts:
- `finalize` continues to accept `decided_by: 'penalties'` as a bare
  marker on the result. The shootout itself is out of scope.
- When we add it, the natural shape is a new event type
  (`'penalty_kick'`) with a per-attempt payload — no schema change,
  just a new value in the type-check constraint on `match_events`.

## Consequences

- **Zero forward-loss.** Every fixture scored in Sprint C/D/E already
  carries the data needed to backfill scorer attribution later. Same
  for the `decided_by='penalties'` marker.
- **Read APIs stay focused.** Public payloads only carry fields users
  can actually see today. Adding new keys later is additive.
- **Operator scoring screen unchanged.** No new intents to teach a
  sideline volunteer during a Monday-night rollout.

## Rejected alternatives

- **Ship attribution in Sprint C.** Needs a scorer picker on the
  scoring screen, which is a frontend concern and this sprint is
  backend-only.
- **Model shootouts now.** Would delay the standings + archive
  services with no immediate user benefit — no one has asked for
  per-shot penalty history.
