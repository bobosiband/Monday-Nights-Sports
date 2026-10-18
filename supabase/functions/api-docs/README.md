# api-docs

Serves the OpenAPI 3.1 spec for the whole backend, and redirects any browser
hitting `/api-docs` to a hosted Swagger UI pre-loaded with that spec.

## Routes

| Method    | Path                     | Purpose                                               |
| --------- | ------------------------ | ----------------------------------------------------- |
| `GET`     | `/api-docs`              | 302 to Swagger UI with `?url=` pointing at our spec.  |
| `GET`     | `/api-docs/openapi.yaml` | Raw OpenAPI 3.1 document, `text/yaml; charset=utf-8`. |
| `OPTIONS` | any                      | 204 CORS preflight.                                   |
| other     | any                      | 405 JSON `{ "error": "Method not allowed" }`.         |

Everything is public: no bearer token, no match code, no RLS gate.

## Who may call it

Anyone with a browser. Primarily our own frontend engineers reading the API
contract, and anyone a reference link is shared with.

## Rules it owns

- The redirect target is a hosted Swagger UI; this service only serves the spec
  and the redirect.
- The spec body is baked into the function bundle via a generated TypeScript
  module. The source of truth is `docs/openapi.yaml`; regenerate the bundled
  copy with `scripts/sync-openapi.sh` after editing. CI (`openapi-sync` job)
  fails when the two drift.
- The hosted Supabase gateway rewrites any HTML-sniffed response, so the service
  must never return HTML directly. The 302 is the workaround.

## Environment variables

None. The service reads no environment variables at runtime.

## Running the tests

```bash
deno test --allow-net --allow-env tests/api-docs/
```

No Supabase or database needed; the tests exercise the router directly.
