# Sprint 1 — Backend Foundation

Running log of what shipped in Sprint 1 and how to exercise each service. Every
section maps to one commit.

> New here? Start at [`overview.md`](overview.md), then read
> [`scoring-viewing-backend-plan.md`](scoring-viewing-backend-plan.md) for
> what's being built next.

## Goal

A deployed backend skeleton where an organiser can authenticate, create a
season, and add teams. A public fixtures endpoint serves the draw of any
published event as HTML, plain text, or JSON.

> Player management deferred to Sprint 4 (optional scorer attribution only).

## What shipped

| Task | Commit                                                          | Delivers                                                                                                    |
| ---- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| S1.1 | `chore: scaffold repo structure, tooling, and shared utilities` | Folder layout, `.gitignore`, `config.toml`, `_shared/` helpers, initial schema + fixtures function in place |
| S1.2 | `feat(db): add core schema and seed data`                       | Verified migration + `supabase/seed.sql` with a demo season                                                 |
| S1.3 | `feat(auth): add organiser authentication guard`                | Real `_shared/auth.ts` — verifies Supabase Auth JWT                                                         |
| S1.4 | `feat(seasons): add season management service`                  | `functions/seasons` (create / list / update / archive / set-active)                                         |
| S1.5 | `feat(teams): add team management service`                      | `functions/teams` (add / rename / remove / bulk-add)                                                        |

## Running everything

```bash
supabase start          # boot Postgres, Auth, Storage locally (needs Docker)
supabase db reset       # apply migration 0001 + seed.sql
supabase functions serve
```

`supabase status` prints the API URL, anon key, and service-role key you need
for the curl examples below. Substitute them into `$URL`, `$ANON`, and `$TOKEN`
(organiser JWT) as needed.

## Obtaining an organiser JWT

The write services (`seasons`, `teams`) require a valid Supabase Auth JWT in the
`Authorization: Bearer <token>` header. `requireOrganiser` in `_shared/auth.ts`
validates the token against Supabase Auth and returns the user record on success
or a `Response` (401) that the service returns unchanged.

For local development:

1. Create an organiser user. The simplest path is the Studio auth pane
   (`http://127.0.0.1:54323/project/default/auth/users` → _Add user_). To do it
   purely from the CLI, hit the local auth signup endpoint with the anon key
   from `supabase status`:
   ```bash
   curl -X POST "$URL/auth/v1/signup" \
     -H "apikey: $ANON" \
     -H "content-type: application/json" \
     -d '{"email":"organiser@example.com","password":"sup3rsecret"}'
   ```
2. Exchange those credentials for an access token:
   ```bash
   curl -X POST "$URL/auth/v1/token?grant_type=password" \
     -H "apikey: $ANON" \
     -H "content-type: application/json" \
     -d '{"email":"organiser@example.com","password":"sup3rsecret"}'
   ```
3. The response's `access_token` field is what you pass as `$TOKEN` in the
   examples below.

In production the organiser signs in via magic link (Supabase Auth) and the
frontend forwards the resulting session token.

## Services

### `fixtures-public` — public draw delivery

No auth required. RLS enforces "published events only" on the underlying tables,
so unpublished events return 404 automatically.

```bash
# HTML (default) — the URL you paste into the group chat
curl "$URL/functions/v1/fixtures-public?event=<event-id>"

# Plain text — chat-friendly
curl "$URL/functions/v1/fixtures-public?event=<event-id>&format=text"

# JSON — for integrators / debugging
curl "$URL/functions/v1/fixtures-public?event=<event-id>&format=json"
```

### `seasons` — organiser season management

All routes require `Authorization: Bearer $TOKEN`. Documented in more detail in
Task 4's section below.

### `teams` — organiser team management

All routes require `Authorization: Bearer $TOKEN`. Documented in more detail in
Task 5's section below.

## Task detail

### Task 1 — Scaffold

- Repository layout matches `README.md`.
- `.gitignore` covers Node, Deno, Supabase temp state, env files, OS cruft.
- `supabase/config.toml` sets the local ports, marks the three functions with
  `verify_jwt = false` (our own guard handles it).
- `_shared/supabase-client.ts` — service-role client factory.
- `_shared/cors.ts` — shared CORS headers, preflight helper, JSON helper.
- `_shared/auth.ts` — placeholder (real body arrives in Task 3).

### Task 2 — Schema + seed

- `supabase db reset` applies `0001_core_schema.sql` and `seed.sql`.
- Seed data: one demo season, six teams, one published event with slots +
  fixtures spanning multiple sports. No player rows — player management is
  deferred to Sprint 4.

### Task 3 — Auth guard

- `requireOrganiser(request)` validates the bearer token against Supabase Auth
  and returns the user record on success or a 401 `Response` the caller can
  return unchanged.

### Task 4 — Seasons

Routes (all authenticated):

| Method | Path                    | Purpose                       |
| ------ | ----------------------- | ----------------------------- |
| POST   | `/seasons`              | Create a season               |
| GET    | `/seasons`              | List seasons (organiser view) |
| GET    | `/seasons/:id`          | Get one season                |
| PATCH  | `/seasons/:id`          | Update fields                 |
| POST   | `/seasons/:id/archive`  | Archive (soft delete)         |
| POST   | `/seasons/:id/activate` | Mark as the active season     |

### Task 5 — Teams

Routes (all authenticated):

| Method | Path                 | Purpose                           |
| ------ | -------------------- | --------------------------------- |
| POST   | `/teams`             | Create a team in a season         |
| GET    | `/teams?season=<id>` | List teams for a season           |
| PATCH  | `/teams/:id`         | Rename a team                     |
| DELETE | `/teams/:id`         | Remove a team                     |
| POST   | `/teams/bulk`        | Bulk-add teams from a pasted list |

## Out of scope (Sprint 2 or later)

- Draw generator (Sprint 2).
- Score entry, results, standings (Sprint 3).
- Live scoring / event feed (Sprint 4).
