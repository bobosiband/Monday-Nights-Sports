# ADR 0004 — Standings computed per (season, sport) in TypeScript

**Status:** Accepted, 2026-07-26.
**Related:** `_shared/standings.ts`, `functions/standings/`.

## Context

A season spans multiple sports (soccer + netball on the same Monday
night). Sports differ in scoring (soccer's single goals vs basketball's
1/2/3), period structure, and standings rules (soccer's 3/1/0 vs
netball's 2/1/0 in the seeded config). The plan doc §4 already called
this out: "standings is TypeScript business logic, not one big SQL
query".

Options considered:

1. **One SQL view per season** — a monstrous CTE with `case`s per
   config key.
2. **One SQL query per season, aggregated in the app** — smaller SQL,
   but standings rules still leak into it (points, tiebreakers).
3. **A pure TypeScript library** — `computeStandings(fixtures, config)`
   — with the API fetching completed results + configs and running
   the library once per sport.

## Decision

**Option 3.** Group finished fixtures by sport, run
`computeStandings` once per group with that sport's config. Return
`{ standings_by_sport: { soccer: [...], netball: [...] } }`.

## Consequences

- **One place** for standings rules. `_shared/standings.ts` is pure
  (no DB, no side effects) so every rule has an obvious unit test.
- **Sport-agnostic API.** Adding a new sport is a `sport_configs`
  row, no code change. The endpoint responds with a new key in
  `standings_by_sport` automatically.
- **Standings always come from `results` snapshots**, never from
  re-folding `match_events`. Two reasons: (a) the results row is what
  the organiser confirmed at finalize, so it's the source of truth
  for the archive; (b) re-folding on every standings read scales
  poorly and would double-write the derivation logic.
- **Deterministic sort.** The library's final tiebreaker is
  alphabetical by team name, so the same inputs always produce the
  same ordering. Useful for snapshot tests and for a viewer who
  refreshes the page.
- **Unknown tiebreaker names degrade gracefully** — an organiser typo
  in `standings.tiebreakers` doesn't crash the endpoint, it just
  falls through to the next tiebreaker.

## Rejected alternatives

- **The all-SQL view.** Composing points and tiebreakers per-sport in
  SQL is ugly and hard to unit-test. It also can't easily support the
  "unknown tiebreaker name is skipped" behaviour without lots of
  `case` boilerplate.
