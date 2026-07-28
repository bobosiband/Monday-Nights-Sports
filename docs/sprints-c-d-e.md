# Sprints C, D & E — Operator access, live viewing, standings & archive

Running log for the C/D/E chunk. Every row maps roughly to a commit;
the "how to exercise" section at the end walks the full arc.

> New here? Start at [`overview.md`](overview.md), then read
> [`scoring-viewing-backend-plan.md`](scoring-viewing-backend-plan.md).
> For running the stack, [`local-setup.md`](local-setup.md).

## Goal

Close the loop from organiser-mints-code → operator scores → viewer
watches live → results and standings appear in the archive.

## Decisions recorded

| # | ADR | What it decides |
|---|---|---|
| 0001 | [operator-access-model](decisions/0001-operator-access-model.md) | **Superseded** — original JWT + revocation-list model |
| 0002 | [operator-access-model-v2](decisions/0002-operator-access-model-v2.md) | Opaque code + `match_access` (hashed) |
| 0003 | [realtime-projection](decisions/0003-realtime-projection.md) | `fixture_live_state` + `supabase_realtime` publication |
| 0004 | [standings-per-sport](decisions/0004-standings-per-sport.md) | `computeStandings` in TS, run per (season, sport) |
| 0005 | [deferred-attribution-and-shootouts](decisions/0005-deferred-attribution-and-shootouts.md) | Player attribution + shootouts deferred; data hooks preserved |

## What shipped

| Task | Delivers |
|------|----------|
| T1 | `0004_operator_access_and_live.sql` — `match_access` (hashed) + `fixture_live_state` + RLS + realtime publication + grants + seeded dev code |
| T2 | `_shared/match-token.ts` — pure code generator / normaliser / SHA-256 hasher / bearer extractor + unit tests |
| T3 | `match-access` function — mint / revoke (idempotent) / list; raw code returned exactly once |
| T4 | `scoring/guard.ts` — real hash-lookup verification, 401/403 semantics, `last_used_at` fire-and-forget update |
| T5 | Realtime projection writes — every scoring intent upserts `fixture_live_state`; non-fatal, plus `scripts/rebuild-live-state.sql` |
| T6 | `live` function — `GET /live/:id` and `GET /live?event=`; fixture-only fallback; realtime hints in payload; `docs/realtime.md` protocol doc |
| T7 | LIVE badge in `fixtures-public` — HTML / text / JSON all surface `status` and current score; pure renderers with unit tests |
| T8 | `_shared/standings.ts` — pure `computeStandings(fixtures, config)` + full unit tests |
| T9 | `standings` function — real `?season=` and `?sport=` responses, grouped by sport from `results` snapshots |
| T10 | `results-public` function — `?season=&limit=&before=` archive + `?event=` single view |
| T11 | `sport-configs` function — CRUD with strict config validation |
| T12 | Config wiring, `openapi.yaml` v0.4.0, `scripts/smoke-live.sh`, doc refresh |

## Running the smoke script

The end-to-end walk lives in `scripts/smoke-live.sh`. It mints a code,
drives the scoring routes, checks `/live` and `/standings`, revokes the
code, and confirms the revoked code can no longer write.

```bash
# 1. Boot the stack + apply migrations (only once per session)
supabase start
supabase db reset

# 2. Grab an organiser JWT — see docs/sprint-1.md "Obtaining an organiser JWT"
export ORGANISER_JWT=...            # required
export SUPABASE_ANON_KEY=$(supabase status -o json | jq -r .API.ANON_KEY)

# 3. Run the smoke test
./scripts/smoke-live.sh
```

Every step prints `PASS` or `FAIL` and the final line summarises. On a
Windows box, run the same steps in WSL2, or read the "Windows PowerShell"
section in [`local-setup.md`](local-setup.md) — the equivalents are
copy-pasteable.

## Services (quick reference)

### `match-access` — organiser

```bash
# Mint a code (raw code returned ONCE)
curl -X POST -H "authorization: Bearer $ORGANISER_JWT" \
  -H "content-type: application/json" \
  -d "{\"fixture_id\":\"$FIXTURE\",\"ttl_minutes\":60,\"label\":\"Sam\"}" \
  "$BASE/match-access"

# List codes for a fixture (no code / no hash ever returned)
curl -H "authorization: Bearer $ORGANISER_JWT" \
  "$BASE/match-access?fixture=$FIXTURE"

# Revoke (idempotent)
curl -X POST -H "authorization: Bearer $ORGANISER_JWT" \
  "$BASE/match-access/$CODE_ID/revoke"
```

### `scoring` — operator (match-code bearer)

Uses the raw code from the mint response as `Authorization: Bearer <code>`.
See [`local-setup.md`](local-setup.md) for the full walk-through.

### `live` — public

```bash
curl "$BASE/live/$FIXTURE"                     # one fixture
curl "$BASE/live?event=$EVENT_ID"              # all fixtures in an event
```

Each response includes a `realtime` object naming the Supabase Realtime
channel/filter/table a browser client should subscribe to; see
[`docs/realtime.md`](realtime.md).

### `standings` — public

```bash
curl "$BASE/standings?season=$SEASON"                # all sports
curl "$BASE/standings?season=$SEASON&sport=soccer"   # single sport
```

### `results-public` — public

```bash
curl "$BASE/results-public?season=$SEASON&limit=20"
curl "$BASE/results-public?event=$EVENT_ID"
```

### `sport-configs` — organiser

```bash
curl -H "authorization: Bearer $ORGANISER_JWT" \
  "$BASE/sport-configs?season=$SEASON"

curl -X POST -H "authorization: Bearer $ORGANISER_JWT" \
  -H "content-type: application/json" \
  -d '{"season_id":"'"$SEASON"'","sport":"basketball",
       "config":{"score_increments":[1,2,3],"track_fouls":true,
                 "standings":{"points":{"win":2,"draw":1,"loss":0},
                              "tiebreakers":["points","goal_diff","goals_for"]}}}' \
  "$BASE/sport-configs"
```

## Tests

Every pure module has a suite under `supabase/functions/_tests/`.

```bash
deno test --allow-net --allow-env supabase/functions/_tests/
```

Coverage added in this sprint:

- `_tests/shared/match-token.test.ts` — code generator, normaliser, hasher, bearer extractor.
- `_tests/shared/standings.test.ts` — points / tiebreakers / byes / unknown-tiebreaker robustness.
- `_tests/scoring/guard.test.ts` — 401 / 403 flows on the real hash lookup.
- `_tests/fixtures-public/render.test.ts` — LIVE badge + score rendering across HTML / text / JSON.

Existing Sprint 1/B tests still pass.

## What did NOT ship (and where it's tracked)

- **Draw builder** (organiser CRUD for `events` / `slots` / `fixtures`
  + a `publish` action). Called out in
  [`scoring-viewing-backend-plan.md`](scoring-viewing-backend-plan.md#next-sprint--events-service)
  as the next sprint. Right now that data only exists via `seed.sql`.
- **Scorer attribution surfacing.** `match_events.player_id` is
  captured but no read path exposes it — see
  [ADR 0005](decisions/0005-deferred-attribution-and-shootouts.md).
- **Penalty shootouts.** `results.decided_by='penalties'` accepted;
  per-shot event modelling deferred — same ADR.

## Issue tracker sync

If you have `gh` available, close the corresponding stories in the
`scripts/regenerate-tracking.sh` issue set. Otherwise, list the issue
numbers here after review:

- [ ] #36 operator-access model decided → superseded by ADR 0002
- [ ] #37 match-access mint/revoke routes
- [ ] #38 scoring guard uses real match-code verification
- [ ] #39 realtime projection (`fixture_live_state`)
- [ ] #40 `GET /live/:fixture` public
- [ ] #41 LIVE badge in `fixtures-public`
- [ ] #42 `sport-configs` CRUD
- [ ] #43 standings library + tests
- [ ] #44 `GET /standings?season=` public
- [ ] #45 `results-public` archive
