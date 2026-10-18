# teams

Organiser-only management of teams within a season. Player management is
deferred (see ADR 0005); the `players` table stays in the schema as a dormant
hook.

## Routes

Every route requires `Authorization: Bearer <jwt>`.

| Method    | Path                   | Purpose                                     |
| --------- | ---------------------- | ------------------------------------------- |
| `OPTIONS` | any                    | 204 CORS preflight.                         |
| `GET`     | `/teams?season=<uuid>` | List teams in a season, alphabetical.       |
| `POST`    | `/teams`               | Create one team in a season.                |
| `POST`    | `/teams/bulk`          | Bulk-add teams from a pasted list of names. |
| `PATCH`   | `/teams/:id`           | Rename a team.                              |
| `DELETE`  | `/teams/:id`           | Delete a team.                              |

## Who may call it

Any authenticated organiser (any Supabase Auth user).

## Rules it owns

- Team names are unique within a season (case-insensitive). Collisions return
  409 with a readable message rather than the raw unique-constraint error from
  Postgres.
- The bulk-add path dedupes case-insensitively within the input, then again
  against existing names in the season, and echoes the dropped names back under
  `skipped_duplicates_in_input` and `skipped_existing_in_season`.
- Deletes are hard: the row is removed. There is no soft-delete for teams.

## Environment variables

| Var                         | Purpose                                 |
| --------------------------- | --------------------------------------- |
| `SUPABASE_URL`              | Base URL for the Supabase project.      |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key; writes gated by auth. |

Both are injected automatically by the Supabase CLI locally and by Supabase on
the hosted project.

## Running the tests

The teams service currently has no unit tests. Its behaviour is covered
end-to-end by `tests/integration/` when run with `INTEGRATION=1`.
