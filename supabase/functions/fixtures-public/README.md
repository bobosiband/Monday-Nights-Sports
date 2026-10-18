# fixtures-public

Public delivery of a published event's draw. No authentication required: this is
the URL that gets dropped into the group chat.

RLS on the underlying tables restricts reads to published events, so an
unpublished (or missing) event id returns 404 even with a valid client.

## Routes

| Method    | Path                                        | Response                     |
| --------- | ------------------------------------------- | ---------------------------- |
| `OPTIONS` | any                                         | 204 CORS preflight.          |
| `GET`     | `/fixtures-public?event=<uuid>`             | HTML (default).              |
| `GET`     | `/fixtures-public?event=<uuid>&format=text` | Plain text (chat-friendly).  |
| `GET`     | `/fixtures-public?event=<uuid>&format=json` | JSON (debug or integrators). |
| other     | any                                         | 405 JSON.                    |

## Who may call it

Anyone: students, organisers, anyone the share link reaches.

## Rules it owns

- RLS gates every joined table on `events.is_published = true`. The service does
  not re-check publication state; a null event from the lookup means "not
  published or not found" and returns a single 404 for both.
- Per-fixture score precedence: a locked-in `results` row wins over the
  in-flight `fixture_live_state` cache. A fixture that is `scheduled` or
  `cancelled` has `score: null`.
- The LIVE badge is high-contrast and has a text label. Do not change to a
  colour-only indicator without an `aria-label`.
- The pulse animation on the live badge is suppressed when the client requests
  `prefers-reduced-motion`.

## Environment variables

| Var                         | Purpose                               |
| --------------------------- | ------------------------------------- |
| `SUPABASE_URL`              | Base URL for the Supabase project.    |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key; reads gated by RLS. |

## Running the tests

```bash
deno test --allow-net --allow-env tests/fixtures-public/
```

The suite exercises the renderers directly: no Supabase or DB needed.
