# Scoring & Viewing Backend — Design & Instructions

**Project:** Monday Night Sports (COSA — UNSW college sports)
**Scope of this doc:** the *live scoring* and *results viewing* backend. This is
the slice we build next, before any frontend work, because the event organisers
need working tooling before they'll agree to feed us data.
**Stack:** Supabase (Postgres + RLS + Auth + Realtime) with Deno/TypeScript Edge
Functions. Frontend is chosen separately later; everything here is a
self-contained API.

---

## 0. Read this first: the plan/codebase mismatch

`planning/planning.md` describes a **different architecture** than the one that
actually shipped:

| planning.md says | codebase actually has |
|---|---|
| Generic Node server, `npm run dev`, `GET /health` | Supabase Edge Functions (Deno), `supabase functions serve` |
| Hand-rolled JWT + bcrypt passwords | Supabase Auth (magic link), JWT verified by Supabase |
| `College`, `CollegeAccount` entities | `seasons`, `teams`, `events`, `slots`, `fixtures`, `results` |
| `MatchEvent`, `SportConfig` (described, not built) | not yet built |
| SSE/WebSockets for real-time | Supabase Realtime available, not yet used |

**Action:** treat `planning.md` as *aspirational product notes*, not the build
spec. When we regenerate sprints/epics/stories, they must describe the **Supabase
reality** plus the additions below. Reconcile or archive `planning.md` so future
contributors aren't misled. (There's also a stray `decisions/hey.md` — review and
remove during cleanup.)

---

## 1. Current state (Sprint 1, already shipped)

- **Schema:** `seasons`, `teams`, `players` (dormant), `events`, `slots`,
  `fixtures`, `results`. RLS = public read on *published* data, authenticated
  write.
- **Edge functions:** `fixtures-public` (HTML/text/JSON draw), `seasons`,
  `teams`. Shared `_shared/{auth,cors,supabase-client}.ts`.
- **Auth:** "organiser" == any authenticated Supabase user (role table can be
  layered later).

### What's missing for scoring + live viewing
- No append-only match event log → no incremental scoring, no undo.
- `results` stores only a final score → no period breakdown, no live derivation.
- No sport configuration → scoring increments / periods / fouls are sport-specific.
- No fouls / cards / timeouts model.
- No score-operator access path (sideline volunteers, refs).
- No real-time distribution to viewers.
- No standings.

---

## 2. Design principles

1. **Event-sourced live score, snapshotted final result.** During a match, the
   score is *derived* by folding an append-only `match_events` log. On finalize,
   we write a `results` snapshot so standings/archive reads never re-fold the log.
   (Reconciles planning.md's "derive, don't duplicate" with the existing
   `results` table.)
2. **Realtime over Supabase, not hand-rolled.** Viewers subscribe to a per-fixture
   channel. Skip the SSE/WebSocket build entirely.
3. **Least-privilege operators.** A sideline scorer gets a short-lived token
   scoped to a single fixture — never a full account.
4. **Everything-is-an-event.** Goals, points, fouls, cards, timeouts,
   period start/end are all `match_events` rows with a `type`. New sports and new
   event kinds need no schema change.
5. **Client-authoritative clock.** The match timer runs on the operator's device;
   each event records the match clock. The server never owns the clock (survives
   wifi drops).
6. **Idempotent, offline-safe writes.** Client supplies each event's UUID; inserts
   are idempotent so a retried offline queue can't double-count.
7. **Config-driven semantics.** A `sport_configs` row per season+sport defines
   valid score increments, periods, foul tracking, and standings rules. Scoring
   and standings both read it.

---

## 3. Data model additions

Sketches, not final DDL — exact columns finalised in the schema story.

### `sport_configs`
Per season + sport. `config` is JSONB, e.g.:
```jsonc
{
  "periods": { "count": 2, "minutes": 20, "direction": "up" },
  "score_increments": [1],          // basketball: [1, 2, 3]
  "track_fouls": true,
  "standings": {
    "points": { "win": 3, "draw": 1, "loss": 0 },
    "tiebreakers": ["points", "goal_diff", "goals_for"]
  }
}
```
Columns: `id`, `season_id`, `sport`, `config jsonb`, `created_at`, `updated_at`.
Unique on `(season_id, sport)`.

### `match_events` (append-only)
The heart of live scoring.
- `id uuid` — **client-suppliable** for idempotency (`on conflict (id) do nothing`).
- `fixture_id` → fixtures.
- `type text` — `'score' | 'foul' | 'card' | 'timeout' | 'period_start' | 'period_end' | 'note'`.
- `team_id uuid null` — which team the event is attributed to.
- `player_id uuid null` — optional scorer attribution (players table already exists).
- `value int null` — e.g. score increment (1/2/3); card severity; etc.
- `period int null`, `match_clock_ms int null`.
- `voided_at timestamptz null`, `voided_by uuid null` — **undo = soft-void**, never delete (audit trail).
- `created_by uuid null` (operator), `created_at timestamptz`.
Index on `(fixture_id, created_at)`.

**Score derivation:** sum `value` of non-voided `type='score'` events per team.
Fouls = count of non-voided `type='foul'` per team. Current period = latest
`period_start` without a matching `period_end`.

### `match_access` (operator PINs / scoped tokens)
- `id`, `fixture_id`, `token_hash` (or `pin_hash`), `expires_at`,
  `created_by`, `revoked_at null`, `created_at`.
Organiser mints; scoring service validates and binds writes to that fixture only.
(Alternative: a signed short JWT with a `fixtureId` claim — same effect, no table.
Pick one in the operator-access story.)

### Extend `results`
Add `periods jsonb null` (period-by-period breakdown) and
`decided_by text default 'normal'` (`'normal' | 'penalties' | 'forfeit'`).
Keep `home_score`/`away_score` as the authoritative final snapshot.

---

## 4. Services (new / changed Edge Functions)

| Function | Auth | Routes (sketch) |
|---|---|---|
| `sport-configs` | organiser | CRUD sport config per season+sport |
| `match-access` | organiser | `POST /match-access` mint PIN for a fixture; `POST /match-access/:id/revoke` |
| `scoring` | **match token** | `POST /scoring/:fixtureId/start`, `/events` (record), `/undo`, `/period`, `/finalize` |
| `live` (or extend `fixtures-public`) | public | `GET /live/:fixtureId` current derived score; Realtime channel naming |
| `standings` | public | `GET /standings?season=<id>` derived table |
| `results-public` | public | past events + results archive |

Notes:
- `scoring` **must** bind every write to the fixture in the token — never trust a
  client-sent `fixture_id` alone.
- On `finalize`: derive final score + period breakdown from events, upsert
  `results`, set `fixtures.status = 'complete'`.
- On first event: set `fixtures.status = 'live'`.
- Standings is **TypeScript business logic, not one big SQL query** (per
  planning.md) — fetch completed results for the season, tally per config, sort by
  tiebreakers, return ordered array. Add a unit test.

---

## 5. Real-time distribution

- Viewers subscribe to a Supabase Realtime channel per fixture (e.g. Postgres
  Changes on `match_events` filtered by `fixture_id`, or a broadcast of a derived
  score summary).
- **Broadcast the score summary, not raw events**, to public viewers
  (team A / team B score, period, clock) — matches planning.md guidance.
- "LIVE" badge = `fixtures.status = 'live'`.

---

## 6. Offline & idempotency (backend requirements that enable the future frontend)

- Accept client-generated event UUIDs; `insert ... on conflict (id) do nothing`.
- `record` returns the **derived score after applying the event** so a client can
  reconcile its optimistic local state.
- `undo` targets a specific event id (soft-void), not "the last one on the server"
  — avoids races when a queue drains out of order.

---

## 7. Proposed sprint / epic / story breakdown (near-term scope only)

Milestones = sprints. Epics = umbrella issues (label `epic`). Stories = issues
under an epic. Tasks = checklist items or sub-issues.

### Sprint A — Scoring foundation
- **Epic: Match event model**
  - Story: `match_events` migration (append-only, soft-void, idempotent id) + RLS.
  - Story: `sport_configs` migration + RLS + seed for soccer/netball.
  - Story: score-derivation library (`_shared/score.ts`) + unit tests.
  - Story: extend `results` (periods, decided_by).

### Sprint B — Scoring service
- **Epic: Live scoring API**
  - Story: `scoring` function skeleton + match-token guard.
  - Story: `start` / first-event → `status = 'live'`.
  - Story: `record` event (score) returns derived score; idempotent.
  - Story: `undo` (soft-void by event id, with confirm semantics).
  - Story: `period` start/end.
  - Story: fouls / cards event types.
  - Story: `finalize` → snapshot `results`, `status = 'complete'`.

### Sprint C — Operator access
- **Epic: Scoped match access**
  - Story: `match_access` model (or signed scoped JWT) — decide + implement.
  - Story: `match-access` organiser function (mint / revoke).
  - Story: token validation in `scoring`, bound to fixture.
  - Story: expiry + revocation tests.

### Sprint D — Live viewing
- **Epic: Realtime score distribution**
  - Story: Realtime channel design + score-summary broadcast.
  - Story: `GET /live/:fixtureId` public derived score.
  - Story: "LIVE" status surfaced in `fixtures-public`.

### Sprint E — Standings & archive
- **Epic: Standings & results**
  - Story: standings calc service (config-driven) + unit tests.
  - Story: `GET /standings?season=` public.
  - Story: `results-public` past events archive.

---

## 8. Open questions (decide before the relevant sprint)

- **Operator access:** DB-backed PIN table vs signed scoped JWT? (Leaning JWT for
  no table + natural expiry; PIN table if you want easy revocation lists.)
- **Player attribution:** turn on `player_id` on score events now, or defer? The
  hook exists.
- **Penalty shootouts:** model as `match_events` (`type='penalty'`) now or later?
- **Multiple concurrent sports per night:** already supported by `fixtures.sport`
  — confirm standings are computed per (season, sport), not per season.
- **GitHub tracking:** Issues + Milestones via `gh` CLI (default) vs GitHub
  Projects v2 board?

---

## 9. Out of scope (later)

- Frontend (scoring screen UI, public pages) — separate team/stack.
- Push notifications.
- Admin panel / role hierarchy beyond "any authed user = organiser".
- Round-robin draw generator (separate track).

---

## Next sprint — `events` service (draw builder)

Right now the draw for a Monday night exists only because `seed.sql`
inserts one. There is **no organiser-facing API** for creating an
`event`, its `slots`, and its `fixtures`, or for publishing the draw.
That means the "organiser builds the draw" step of the arc in
[`overview.md`](overview.md) has no backend behind it — every downstream
service (fixtures-public, live, standings, results-public) reads data an
organiser cannot yet write in production.

This is out of scope for Sprint C/D/E but is the next sprint's headline:

- **`events`** function: CRUD on events, slots, fixtures.
  - `POST   /events` — create an event in a season on a date.
  - `POST   /events/:id/slots` — add a slot (slot_number, starts_at, pitch).
  - `POST   /events/:id/fixtures` — add a fixture (slot_id, home/away, sport).
  - `PATCH  /events/:id` / `DELETE /events/:id` etc.
  - `POST   /events/:id/publish` — single-action publish (sets
    `is_published=true`, stamps `published_at`).

RLS on events / slots / fixtures already gates public reads on
`is_published`, so the publish action really is a single-column flip —
no fan-out. The heavy work is the CRUD ergonomics: bulk-add slots,
bulk-add fixtures, a "generate round-robin" helper (which itself is a
follow-up sprint per §9).
