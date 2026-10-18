# results-public

Public archive of past events plus their results. Reads only from the `results`
snapshots and never re-folds `match_events`.

## Routes

| Method    | Path                                           | Response                  |
| --------- | ---------------------------------------------- | ------------------------- |
| `OPTIONS` | any                                            | 204 CORS preflight.       |
| `GET`     | `/results-public?event=<uuid>`                 | One event's archive.      |
| `GET`     | `/results-public?season=<uuid>&limit=&before=` | Paginated season archive. |
| other     | any                                            | 405 JSON.                 |

## Who may call it

Anyone.

## Rules it owns

- `limit` defaults to 10, maxes at 50; anything larger is clamped silently.
- `before` is a `YYYY-MM-DD` cursor; only events strictly older are returned.
  The response emits `next_before` from the earliest `event_date` on the page,
  so the client never has to compute the cursor.
- Fixtures without a result row are pruned from the response; an unfinalised
  game does not belong in the archive.
- Publication is enforced by RLS, not by application-level checks.

## Environment variables

| Var                         | Purpose                               |
| --------------------------- | ------------------------------------- |
| `SUPABASE_URL`              | Base URL for the Supabase project.    |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key; reads gated by RLS. |

## Running the tests

The results-public service currently has no unit tests. Its behaviour is covered
end-to-end by `tests/integration/` when run with `INTEGRATION=1`.
