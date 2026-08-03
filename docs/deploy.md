# Deploying to a hosted Supabase project

Everything you need to get the backend running on a real Supabase project and
redeploy it per change. This is the "how", not the "did I remember everything" —
cross-reference
[`production-deploy-checklist.md`](production-deploy-checklist.md) for the
pre-flight verification that goes with a first-time deploy.

---

## Prerequisites

- A Supabase account and a project you can push to.
- The Supabase CLI (≥ 2.109) on PATH; verify with `supabase --version`.
- `psql` (from `postgresql-client`) for the seeding step.
- `curl` and `jq` for the smoke script.
- `supabase login` completed once — this pops a browser and stores a token. The
  CLI can't do it for you.

The scripts read a couple of env vars; see [`.env.example`](../.env.example) for
the full list.

---

## First-time deploy, start to finish

Three human-only steps in the workflow below (creating the project,
`supabase
login`, creating the organiser user) — each is called out explicitly.

### 1. Create the project (human)

1. supabase.com → New project.
2. Region **ap-southeast-2 (Sydney)** — the users and the venue are in Sydney.
3. Save the database password immediately; it cannot be retrieved later.
4. Copy the project ref from the dashboard URL (the sub-domain in
   `https://<ref>.supabase.co`).
5. `supabase login` in a terminal (opens a browser).

### 2. Deploy

```bash
PROJECT_REF=<ref> ./scripts/deploy.sh
```

That single script does everything a machine can do:

- `scripts/sync-openapi.sh` — regenerates `api-docs/openapi.ts` from
  `docs/openapi.yaml`.
- `supabase link --project-ref <ref>` — associates the working tree with the
  hosted project.
- `supabase db push` — applies every migration under `supabase/migrations/` not
  already on the remote. **Idempotent.** If it errors, stop; fix forward with a
  new numbered migration, never edit an applied one.
- `supabase functions deploy <name>` for each function in the script's
  `FUNCTIONS` array. Redeploys are a no-op if the bundle hasn't changed.

If the hosted project's public endpoints come back 401 after deploy, your CLI
version is old enough that it ignores `verify_jwt = false` in `config.toml`.
Re-run with the escape hatch:

```bash
PROJECT_REF=<ref> NO_VERIFY_JWT=1 ./scripts/deploy.sh
```

### 3. Seed the hosted database

`supabase db push` does **not** run `supabase/seed.sql` — that path only fires
under `supabase db reset`, which doesn't exist for hosted projects.

Grab the connection string from **Project Settings → Database → Connection
string (URI)** (contains the DB password — don't commit or paste it into chat),
then:

```bash
DATABASE_URL='postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres' \
  ./scripts/seed-remote.sh
```

Verify a fixture is on the remote before moving on:

```bash
psql "$DATABASE_URL" -c "select id, sport, status from fixtures order by id;"
```

You should see `f0111111-1111-1111-1111-111111111111` (the seeded soccer
fixture) with status `scheduled`.

### 4. Set / audit secrets

The Edge Functions platform injects `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` automatically — do **not** set them via
`supabase secrets set`. Confirm nothing unexpected is present:

```bash
supabase secrets list
```

There should be **no** `SCORING_DEV_STUB` or similar dev-mode flag on the hosted
project. If there is, unset it and say so loudly to the team.

### 5. Create the organiser user (human)

Hosted Studio → **Authentication** → **Users** → **Add user**, with auto-confirm
ticked.

Why the checkbox matters: hosted projects have email confirmation on by default,
so a plain `/auth/v1/signup` call leaves an unconfirmed user. Every organiser
route then returns 401 with a misleading "invalid token" message. Auto-confirm
sidesteps that.

Exchange the credentials for a token via the password grant (see the snippet in
[`sprint-1.md`](sprint-1.md)) against the hosted URL and confirm `GET /seasons`
with that token returns 200.

### 6. Smoke test

```bash
BASE_URL=https://<ref>.supabase.co/functions/v1 \
  ORGANISER_JWT=<from step 5> \
  SUPABASE_ANON_KEY=<from dashboard: Project Settings → API> \
  ./scripts/smoke-remote.sh
```

The script mutates data — it drives the seeded fixture to `complete`. Only run
it against scratch/demo projects, never real match data.

Then open `https://<ref>.supabase.co/functions/v1/api-docs` in a browser and
confirm Swagger UI renders. That's the page to show a client if the demo UI
isn't ready.

### 7. Verify the scoring guard is closed

With no dev-stub env on the hosted project, a junk bearer token must be rejected
by the scoring guard:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  -H 'authorization: Bearer junk' \
  https://<ref>.supabase.co/functions/v1/scoring/f0111111-1111-1111-1111-111111111111/start
```

Must print **401**. If it prints 200 or 2xx, stop everything and audit
`supabase/functions/scoring/guard.ts` before touching anything else — a bypassed
guard is the failure mode the whole match-code design exists to prevent.

---

## Redeploying per change

```bash
PROJECT_REF=<ref> ./scripts/deploy.sh
```

Same command. Migrations that already ran on the remote are skipped; functions
whose bundles didn't change are no-ops. This is the whole workflow — no
cherry-picking of function names.

---

## Troubleshooting

### Public endpoint returns 401

Older Supabase CLIs ignore `verify_jwt = false` in `config.toml`. Re-run the
deploy with `NO_VERIFY_JWT=1` to append `--no-verify-jwt` to every function
deploy:

```bash
PROJECT_REF=<ref> NO_VERIFY_JWT=1 ./scripts/deploy.sh
```

### `db push` failed mid-way

Do **not** edit a migration that already ran on the remote — you'll get the
"migration already applied but has a different hash" wedge and the next push
will refuse to move. Instead, add a new numbered migration under
`supabase/migrations/` that fixes forward (e.g. an `alter table` that undoes
whatever the broken one did).

### Free-tier project pauses after ~7 days idle

The first request after a pause takes 30+ seconds while the project spins back
up. Wake it the morning of any demo, not five minutes before.

### Organiser routes 401 with a valid-looking token

The user probably isn't confirmed. On the hosted Studio, edit the user and tick
"confirm email", or delete + recreate with auto-confirm.

### `permission denied for table …`

You're missing the DML grants that `0003_grants.sql` provides. Read that file's
header comment — it explains the specific bug this migration fixes and why
re-running migrations doesn't re-run it if it was already applied partially.

### `supabase link` complains about anon key

Newer CLIs prompt for the anon key on first link. Copy it from the dashboard
(Project Settings → API) and paste it. Once linked, the ref is remembered in
`supabase/.temp/`.

---

## Related docs

- [`.env.example`](../.env.example) — every variable the scripts read.
- [`production-deploy-checklist.md`](production-deploy-checklist.md) — the
  what-to-verify counterpart to this what-to-do.
- [`local-setup.md`](local-setup.md) — mirror of these steps for the local
  stack.
- [`decisions/0002-operator-access-model-v2.md`](decisions/0002-operator-access-model-v2.md)
  — why the scoring guard is a DB lookup, not a JWT check.
