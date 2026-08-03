# Production deploy checklist

Walk this top-to-bottom before pushing schema or Edge Functions to a hosted
Supabase project. Everything below is one-shot verifiable — either the check
passes and you move on, or you fix the underlying issue and re-check. Do not
skip a step because "it was fine last time"; each item guards a different
failure mode.

Owner: whoever is running the deploy. Cross-reference:
[`local-setup.md`](local-setup.md) for the local equivalents of each command,
[`overview.md`](overview.md) for what the system does end-to-end.

---

## 1. No dev-stub token path anywhere in the scoring guard

The scoring guard is the only thing standing between an arbitrary POST and a
`match_events` insert. Verify nothing has crept back in that short-circuits it:

```bash
# Should print nothing.
grep -RIn "SCORING_DEV_TOKENS\|dev.token\|dev pass\|bypass" \
  supabase/functions/scoring/
```

Also spot-check `supabase/functions/scoring/guard.ts`: `verifyMatchToken` must
be the sole entry, `lookup` must default to `defaultLookup`, and `defaultLookup`
must hit `match_access` — no in-memory table, no env allowlist.

The seeded `DEVCODE1` in `supabase/seed.sql` is a **local-dev convenience
only**. It is inserted by `supabase db reset` (which runs against a container,
not a hosted project) and is not part of any migration. If you run
`supabase db push` against a hosted project the seed does not travel — verify:

```bash
grep -n "DEVCODE" supabase/migrations/*.sql   # should print nothing
```

## 2. `verify_jwt` per Edge Function is correct

`supabase/config.toml` sets `verify_jwt` per function. **Every function in this
repo sets `verify_jwt = false`** — because the auth surface is handled inside
the function (organiser guard, match-code guard, or "public, no auth"). The
intended surface per function:

| Function          | Auth surface                      | `verify_jwt` |
| ----------------- | --------------------------------- | ------------ |
| `fixtures-public` | Public read (RLS-gated)           | `false`      |
| `live`            | Public read (RLS-gated)           | `false`      |
| `results-public`  | Public read (RLS-gated)           | `false`      |
| `standings`       | Public read (RLS-gated)           | `false`      |
| `api-docs`        | Public Swagger UI                 | `false`      |
| `seasons`         | Organiser JWT (in-function guard) | `false`      |
| `teams`           | Organiser JWT (in-function guard) | `false`      |
| `sport-configs`   | Organiser JWT (in-function guard) | `false`      |
| `match-access`    | Organiser JWT (in-function guard) | `false`      |
| `scoring`         | Match code (in-function guard)    | `false`      |

Verify the table matches config:

```bash
grep -E "^\[functions\.|^verify_jwt" supabase/config.toml
```

If a new function is added, add a row here in the same PR — a mismatch between
the intended surface and `verify_jwt` is how a "public" endpoint accidentally
becomes JWT-required, and vice versa.

## 3. RLS enabled on every table

RLS is our second line of defence — even if a service-role client leaks or a
function is misconfigured, RLS keeps unpublished data invisible. Every table in
`public` schema must have RLS enabled. Check against the hosted DB:

```sql
select tablename,
       (case when rowsecurity then 'ON' else 'OFF' end) as rls
from   pg_tables
where  schemaname = 'public'
order  by tablename;
```

Expected list (as of Sprint E):

- `events`
- `fixture_live_state`
- `fixtures`
- `match_access`
- `match_events`
- `players`
- `results`
- `seasons`
- `slots`
- `sport_configs`
- `teams`

Every row must show `ON`. If a new table is added in a migration, that migration
must also `alter table ... enable row level security` in the same file —
pattern-match the shape in `0001_core_schema.sql`.

## 4. Realtime channel authorisation reviewed

The only table published to Supabase Realtime is `public.fixture_live_state`.
Everything the scoring service writes funnels through the projection upsert, so
no raw `match_events` rows are ever broadcast (see
[ADR 0003](decisions/0003-realtime-projection.md) and
[`docs/realtime.md`](realtime.md)).

Verify against the hosted DB:

```sql
select pubname, schemaname, tablename
from   pg_publication_tables
where  pubname = 'supabase_realtime'
order  by tablename;
```

Only `public.fixture_live_state` should appear. If anything else is present
(especially `public.match_events`), the migration was mis-applied — investigate
before deploying.

RLS on `fixture_live_state` must restrict SELECT to rows whose fixture belongs
to a _published_ event. Sanity check by hitting `/live` as an anon user against
a fixture whose event has `is_published=false`; it must 404, not return a row.

## 5. `api-docs` redeployed after every spec change

The Swagger UI reads a bundled `openapi.ts` module (not the sibling YAML at
runtime — Supabase's edge runtime doesn't copy static assets). So editing
`docs/openapi.yaml` **and forgetting to re-sync** ships a stale spec.

```bash
./scripts/sync-openapi.sh                     # bakes YAML → openapi.ts
supabase functions deploy api-docs             # ships the fresh module
```

Verify after deploy:

```bash
curl -s "https://<ref>.functions.supabase.co/api-docs/openapi.yaml" \
  | head -3
```

The `info.version` at the top should match `docs/openapi.yaml`. If it doesn't,
run the two-command sequence again.

## 6. Post-deploy smoke test

Once everything is deployed, run the smoke script against the hosted URL (edit
`BASE` in `scripts/smoke-live.sh` or set the env var if you add one):

```bash
export ORGANISER_JWT=<hosted-project organiser JWT>
export SUPABASE_ANON_KEY=<hosted-project anon key>
./scripts/smoke-live.sh
```

Every step must print `PASS`. A `FAIL` on the revoke → 401 step is the canary
for the guard change in item 1 — investigate immediately.
