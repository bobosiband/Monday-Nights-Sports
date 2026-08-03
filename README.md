# Monday Night Sports

**Start here → [`docs/overview.md`](docs/overview.md).** **Setting up on your
machine → [`docs/local-setup.md`](docs/local-setup.md).** **Interactive API docs
(Swagger UI) → run the stack, then
<http://127.0.0.1:54321/functions/v1/api-docs>.**

Supabase-native backend for a weekly college sports competition. Multiple sports
run across four evening slots each Monday; this repo hosts the API/services that
manage seasons, teams, fixtures, results, and (later) live scoring. The frontend
team picks their stack separately — everything here is a self-contained
API/service they can consume.

## Stack

- **Postgres** (via Supabase) — source of truth, with row-level security for the
  public/organiser split.
- **Supabase Edge Functions** (Deno + TypeScript) — one microservice per folder
  under `supabase/functions/`. Shared code lives in `_shared/` (Supabase does
  not deploy underscore-prefixed folders as functions).
- **Supabase Auth** — organiser sign-in; write endpoints require a valid JWT.

## Repository layout

```
monday-night-sports/
├── docs/
│   ├── overview.md                     # start here — what this system does
│   ├── scoring-viewing-backend-plan.md # live design doc for the scoring stack
│   ├── local-setup.md                  # everything you need to run it locally
│   ├── realtime.md                     # Supabase Realtime client protocol
│   ├── openapi.yaml                    # source-of-truth API spec (Swagger UI)
│   ├── sprint-1.md                     # Sprint 1 running log
│   ├── sprints-c-d-e.md                # Sprints C/D/E running log
│   └── decisions/                      # ADRs (0001-0005)
├── scripts/
│   ├── deploy.sh                       # one-command hosted deploy
│   ├── seed-remote.sh                  # psql wrapper for hosted seeding
│   ├── smoke-remote.sh                 # smoke walkthrough against any base URL
│   ├── smoke-live.sh                   # local smoke walkthrough
│   ├── rebuild-live-state.sql          # rebuild the realtime projection
│   ├── sync-openapi.sh                 # embed openapi.yaml into api-docs
│   └── regenerate-tracking.sh          # regenerate GitHub milestones/stories
└── supabase/
    ├── config.toml                     # local dev config (safe to commit)
    ├── migrations/
    │   ├── 0001_core_schema.sql
    │   ├── 0002_scoring_core.sql
    │   ├── 0003_grants.sql
    │   └── 0004_operator_access_and_live.sql
    ├── seed.sql                        # demo season + dev operator code
    └── functions/
        ├── _shared/                    # not deployed as a function
        │   ├── auth.ts                 # organiser JWT guard
        │   ├── cors.ts                 # CORS helpers
        │   ├── match-token.ts          # opaque operator-code primitive
        │   ├── score.ts                # pure score-derivation fold
        │   ├── standings.ts            # pure standings computation
        │   ├── supabase-client.ts      # service-role client factory
        │   └── validate.ts             # shared input validators
        ├── api-docs/                   # Swagger UI + embedded OpenAPI
        ├── fixtures-public/            # public draw (HTML / text / JSON, LIVE badge)
        ├── live/                       # public live-score endpoint
        ├── match-access/               # organiser: mint / revoke operator codes
        ├── results-public/             # public archive of past events
        ├── scoring/                    # match-code-guarded scoring writes
        ├── seasons/                    # organiser: season management
        ├── sport-configs/              # organiser: per-sport config CRUD
        ├── standings/                  # public standings (per season, per sport)
        ├── teams/                      # organiser: team management
        └── _tests/                     # deno test suite (unit + integration)
```

## Prerequisites

- [Supabase CLI](https://supabase.com/docs/guides/cli)
- Docker (required by `supabase start` for the local stack)
- A Supabase project (local or hosted)

## Running locally

```bash
# 1. Boot the local Supabase stack (Postgres, Auth, Storage, ...)
supabase start

# 2. Apply migrations + seed data
supabase db reset

# 3. Serve functions with hot-reload
supabase functions serve
```

Environment variables the functions read:

| Var                         | Purpose                                          | Auto-set by CLI? |
| --------------------------- | ------------------------------------------------ | ---------------- |
| `SUPABASE_URL`              | Postgres + Auth base URL                         | ✅ yes           |
| `SUPABASE_SERVICE_ROLE_KEY` | Bypass-RLS DB client used by every Edge Function | ✅ yes           |

Match codes are opaque hashed values in the `match_access` table (see
[`docs/decisions/0002-operator-access-model-v2.md`](docs/decisions/0002-operator-access-model-v2.md)),
so there is no shared secret to configure. Every code lives in the DB and can be
revoked instantly.

## Deploying

Deploy is one command:

```bash
PROJECT_REF=<your-project-ref> ./scripts/deploy.sh
```

That syncs the OpenAPI blob, applies pending migrations, and redeploys every
function. Full first-time walkthrough (seeding, secrets, organiser user, smoke
test, guard verification) is in [`docs/deploy.md`](docs/deploy.md);
[`docs/production-deploy-checklist.md`](docs/production-deploy-checklist.md) is
the verification checklist that goes with it.

## Sprint status

- Sprint 1 (foundation): [`docs/sprint-1.md`](docs/sprint-1.md).
- Sprints C, D & E (operator access, live viewing, standings & archive):
  [`docs/sprints-c-d-e.md`](docs/sprints-c-d-e.md).

## Licence

MIT.
