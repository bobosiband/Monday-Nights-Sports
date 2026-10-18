# standings

Public standings endpoint. Computes tables in TypeScript from the `results`
snapshots (never by re-folding `match_events`) so the same numbers a viewer sees
also match what an organiser confirmed at finalize time.

Per `docs/decisions/0004-standings-per-sport.md`, a season spans multiple sports
and each sport has its own config, scoring rules and table. This endpoint runs
the rules once per sport with that sport's config.

## Routes

| Method    | Path                                    | Response                          |
| --------- | --------------------------------------- | --------------------------------- |
| `OPTIONS` | any                                     | 204 CORS preflight.               |
| `GET`     | `/standings?season=<uuid>`              | `{ season, standings_by_sport }`. |
| `GET`     | `/standings?season=<uuid>&sport=<name>` | `{ season, sport, standings }`.   |
| other     | any                                     | 405 JSON.                         |

## Who may call it

Anyone.

## Rules it owns (ADR 0007)

- Points table rules: configurable points for win/draw/loss and a configurable
  list of tiebreakers. Defaults to 3/1/0 and `points, goal_diff, goals_for` when
  the sport config is missing or empty.
- Unknown tiebreaker names are skipped rather than treated as an error.
- Final tiebreaker is alphabetical by team name, so the output is deterministic.
- Byes (`away_team_id: null`) contribute nothing to either side; a team with
  only byes never appears in the table.
- Archived seasons return 404; this endpoint only serves live seasons.
- The service carries its own `StandingsConfig` type that mirrors only the two
  sub-fields it reads from the sport config. It does not import `SportConfig`
  from scoring.

## Environment variables

| Var                         | Purpose                            |
| --------------------------- | ---------------------------------- |
| `SUPABASE_URL`              | Base URL for the Supabase project. |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key.                  |

## Running the tests

```bash
deno test --allow-net --allow-env tests/standings/
```

The suite exercises `PointsTableRules.computeTable` directly: no Supabase or DB
needed.
