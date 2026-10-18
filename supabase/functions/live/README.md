# live

Public live-score endpoint. No authentication: RLS on `fixture_live_state`
restricts reads to published events. Reads the realtime projection first, falls
back to a zeroed summary derived from the fixture row when no projection exists
yet (fixture never scored).

Each JSON response includes a `realtime` object naming the Supabase Realtime
channel/filter a client should subscribe to. See `docs/realtime.md` for the full
protocol.

## Routes

| Method    | Path                 | Response                               |
| --------- | -------------------- | -------------------------------------- |
| `OPTIONS` | any                  | 204 CORS preflight.                    |
| `GET`     | `/live/:fixtureId`   | 200 with one fixture's live summary.   |
| `GET`     | `/live?event=<uuid>` | 200 with `{ event, fixtures: [...] }`. |
| other     | any                  | 405 JSON.                              |

## Who may call it

Anyone.

## Rules it owns

- Publication is enforced inside the fixture lookup, not just by RLS, so the
  service-role client cannot leak unpublished events through this endpoint.
- When no `fixture_live_state` row exists for a fixture, the summary is zeroed
  and status is taken from the fixture row directly.
- The realtime subscription hint on every response is the contract clients rely
  on; do not change its shape without updating `docs/realtime.md`.

## Environment variables

| Var                         | Purpose                            |
| --------------------------- | ---------------------------------- |
| `SUPABASE_URL`              | Base URL for the Supabase project. |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key.                  |

## Running the tests

The live service currently has no unit tests. Its behaviour is covered by
`tests/integration/` when run with `INTEGRATION=1`.
