# Monday Night Sports

**Start here → [`docs/overview.md`](docs/overview.md).**

Supabase-native backend for a weekly college sports competition. Multiple
sports run across four evening slots each Monday; this repo hosts the
API/services that manage seasons, teams, fixtures, results, and (later)
live scoring. The frontend team picks their stack separately — everything
here is a self-contained API/service they can consume.

## Stack

- **Postgres** (via Supabase) — source of truth, with row-level security for
  the public/organiser split.
- **Supabase Edge Functions** (Deno + TypeScript) — one microservice per
  folder under `supabase/functions/`. Shared code lives in `_shared/`
  (Supabase does not deploy underscore-prefixed folders as functions).
- **Supabase Auth** — organiser sign-in; write endpoints require a valid JWT.

## Repository layout

```
monday-night-sports/
├── docs/
│   └── sprint-1.md                     # running log — what shipped, how to run it
└── supabase/
    ├── config.toml                     # local dev config (safe to commit)
    ├── migrations/
    │   └── 0001_core_schema.sql
    ├── seed.sql                        # demo season for local dev
    └── functions/
        ├── _shared/                    # not deployed as a function
        │   ├── auth.ts                 # organiser JWT guard
        │   ├── cors.ts                 # CORS helpers
        │   └── supabase-client.ts      # service-role client factory
        ├── fixtures-public/            # public draw delivery (HTML / text / JSON)
        ├── seasons/                    # organiser: season management
        └── teams/                      # organiser: team management
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

Environment variables the functions read (auto-injected by the platform, only
needed manually if you run functions outside `supabase functions serve`):

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## Deploying

```bash
supabase link --project-ref <your-project-ref>
supabase db push
supabase functions deploy fixtures-public
supabase functions deploy seasons
supabase functions deploy teams
```

## Sprint status

See [`docs/sprint-1.md`](docs/sprint-1.md) for what ships in Sprint 1 and how
to exercise each service.

## Licence

MIT.
