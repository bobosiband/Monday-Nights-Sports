# sport-configs

Organiser-only CRUD for `sport_configs`. Lets an organiser configure a sport
(score increments, period structure, standings rules) without a migration.
Validation is deliberately strict: a bad config accepted here would corrupt both
the scoring screen (through `scoring/domain/ScoreCalculator`) and the standings
table (through `standings/domain/StandingsCalculator`).

## Routes

Every route requires `Authorization: Bearer <jwt>`.

| Method    | Path                           | Purpose                         |
| --------- | ------------------------------ | ------------------------------- |
| `OPTIONS` | any                            | 204 CORS preflight.             |
| `GET`     | `/sport-configs?season=<uuid>` | List configs in a season.       |
| `POST`    | `/sport-configs`               | Upsert on `(season_id, sport)`. |
| `PATCH`   | `/sport-configs/:id`           | Partial update.                 |
| `DELETE`  | `/sport-configs/:id`           | Remove a config.                |

## Who may call it

Any authenticated organiser (any Supabase Auth user).

## Rules it owns

- Top-level `config` must be a JSON object; nulls, arrays and scalars are
  rejected with a specific error message.
- `periods.count` must be a positive integer. `periods.minutes` is optional but
  positive-integer when present. `periods.direction` is `"up"` or `"down"` when
  present.
- `score_increments` is a non-empty array of positive integers.
- `track_fouls` is a boolean when present.
- `standings.points` has `win`, `draw`, `loss` each a non-negative integer. Zero
  is accepted (some sports deliberately award 0 points for a loss).
- `standings.tiebreakers` must be an array of strings. The string values
  themselves are not gated; the standings calculator tolerates unknown names by
  skipping them.
- Permissive where absent: a missing key falls back to the downstream
  calculator's default. We only fail actively-wrong values.

## Environment variables

| Var                         | Purpose                                 |
| --------------------------- | --------------------------------------- |
| `SUPABASE_URL`              | Base URL for the Supabase project.      |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key; writes gated by auth. |

Both are injected automatically by the Supabase CLI locally and by Supabase on
the hosted project.

## Running the tests

```bash
deno test --allow-net --allow-env tests/sport-configs/
```

The suite exercises `validateConfig` directly: no Supabase or DB needed.
