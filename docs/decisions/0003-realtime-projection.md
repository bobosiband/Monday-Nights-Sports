# ADR 0003 — Realtime = per-fixture summary projection

**Status:** Accepted, 2026-07-26. **Related:** migration 0004
(`fixture_live_state`), `docs/realtime.md`.

## Context

Viewers watching a fixture want the score to update within a couple of seconds
without polling. Three shapes considered:

1. **Postgres Changes on `match_events`.** Broadcast every insert; the client
   derives the score locally.
2. **Custom broadcast** (Supabase Realtime channel `broadcast:...`) — the
   scoring service publishes a hand-crafted event after every write.
3. **A per-fixture summary projection table on the standard Realtime
   publication.** One row per fixture, upserted after every accepted scoring
   write; the client subscribes to row changes.

## Decision

**Option 3 — `fixture_live_state`, added to `supabase_realtime`.**

- One row per fixture: home_score, away_score, fouls, current_period, status,
  last_event_at, updated_at.
- The scoring service upserts the row via `derive.ts::respondDerived` /
  `writeLiveState` on every accepted write. The upsert is non-fatal — a failure
  logs and continues; the event log is authoritative and
  `scripts/rebuild-live-state.sql` can regenerate the table from scratch.
- Publication:
  `alter publication supabase_realtime add table
  public.fixture_live_state`.
  RLS on the table gates the anon role to published events only, so Realtime's
  row-level filtering is honoured.

## Consequences

- **Broadcast a summary, not raw events.** Public viewers never see the
  card/timeout/note noise, and bandwidth per fixture is minimal — one row, a
  couple of hundred bytes, once per scoring intent.
- **Client protocol is boring.** Standard Postgres Changes subscription on one
  table with one filter. Documented in `docs/realtime.md` so a frontend engineer
  doesn't need to reverse-engineer it from the Edge Function code.
- **Cache-not-truth.** The projection is disposable. Any drift heals on the next
  scoring write to that fixture, and the SQL rebuild script closes the whole
  table in one command.
- **Trigger surface stays small.** No DB triggers publishing events; the
  projection is written from the same TypeScript that answers the API response.
  One place to reason about score derivation.

## Rejected alternatives

- **Postgres Changes on `match_events`.** Would leak internal event shape to
  public clients, force every viewer to run our derivation logic (drift risk),
  and burn bandwidth on non-score events. Undo (soft-void) would need special
  handling on the client because it changes an existing row rather than adding
  one, which is exactly the kind of state a projection is supposed to hide.
- **Custom broadcast.** No RLS on broadcast channels; we'd have to invent our
  own subscription auth. The projection uses the RLS story we already have for
  other tables.
