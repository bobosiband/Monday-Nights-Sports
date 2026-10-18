# seasons

Organiser-only management of seasons. A season spans multiple sports on the same
night (soccer plus netball on a Monday, for example), has start and end dates,
carries the list of sports it covers, and optionally flags itself as the one
`is_active` season.

## Routes

Every route requires `Authorization: Bearer <jwt>` (Supabase Auth). There is no
public read path on this service; `fixtures-public` and friends read through RLS
directly.

| Method    | Path                    | Purpose                                |
| --------- | ----------------------- | -------------------------------------- |
| `OPTIONS` | any                     | 204 CORS preflight.                    |
| `GET`     | `/seasons`              | List seasons, newest start date first. |
| `POST`    | `/seasons`              | Create a season.                       |
| `GET`     | `/seasons/:id`          | Read one season.                       |
| `PATCH`   | `/seasons/:id`          | Update some fields on a season.        |
| `POST`    | `/seasons/:id/activate` | Mark this season active.               |
| `POST`    | `/seasons/:id/archive`  | Soft-delete; clears `is_active`.       |

## Who may call it

Any authenticated organiser (any Supabase Auth user). There is no role check on
top of authentication; a role-aware guard can be layered later without changing
route shapes.

## Rules it owns

- Only one season may be active at a time; activating a season unsets
  `is_active` on every other row.
- An archived season cannot be activated; the handler returns 400.
- `ends_on` must be on or after `starts_on`.
- `sports` must be a non-empty array of non-empty strings.
- `starts_on` and `ends_on` must be YYYY-MM-DD. The Postgres `date` type accepts
  more, but the API deliberately does not.

## Environment variables

| Var                         | Purpose                                                               |
| --------------------------- | --------------------------------------------------------------------- |
| `SUPABASE_URL`              | Base URL for the Supabase project.                                    |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key, bypasses RLS. Writes gated by `OrganiserAuthGuard`. |

Both are injected automatically by the Supabase CLI locally and by Supabase on
the hosted project.

## Running the tests

The seasons service currently has no unit tests. Its behaviour is covered
end-to-end by `tests/integration/` when run with `INTEGRATION=1` against a live
local stack.
