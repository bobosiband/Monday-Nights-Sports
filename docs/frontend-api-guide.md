# Frontend API guide

For the frontend team. Everything you need to build against the Monday Night
Sports backend, written narrative-first: here is how you build a draw, here is
how you show a live score, here are the three pages you probably want first and
the exact calls each one needs.

> The formal spec is `docs/openapi.yaml` — Swagger UI at `/api-docs` renders it
> and lets you Try-it-out. This guide points at the pieces of the spec you care
> about and explains the workflows the spec alone doesn't.

---

## Base URL and headers

Every function is served under `/functions/v1/<function-name>`.

- **Local:** `http://127.0.0.1:54321/functions/v1` (once `supabase start` is
  running).
- **Hosted:** `https://baqvcnotpcovsirmlaek.supabase.co/functions/v1`.

Two headers matter:

- `apikey: <publishable-key>` — always send it. Sometimes the platform gateway
  refuses requests that omit it, even on public routes. Use the Supabase
  publishable / anon key (starts with `sb_publishable_...` or the legacy
  `eyJ…`).
- `authorization: Bearer <token>` — required for organiser routes (JWT) and
  scoring routes (operator code). See "Two auth stories" below.

CORS is on for every function via `_shared/cors.ts`. Preflight requests return
204 with the right headers, so `fetch` from a browser Just Works.

---

## Two auth stories

There are exactly two credential shapes in this API. Do not conflate them.

### 1. Organiser JWT

A Supabase Auth JWT that says "an authenticated user is doing this." Used by
every write route the organiser touches: `seasons`, `teams`, `sport-configs`,
`events` (all of it), `match-access` (mint / revoke / list).

You get one by signing the user in:

```ts
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
const { data } = await supabase.auth.signInWithPassword({ email, password });
const jwt = data.session?.access_token;

fetch(`${BASE}/events`, {
  method: "POST",
  headers: {
    apikey: SUPABASE_PUBLISHABLE_KEY,
    authorization: `Bearer ${jwt}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({ season_id, event_date: "2026-04-06" }),
});
```

JWTs expire after 1 hour (`config.toml: jwt_expiry = 3600`). Let `supabase-js`
handle refresh in the browser; on a server just re-fetch a fresh one before it
expires. There's no organiser-vs-viewer role split yet — "any authenticated
user" is the organiser check today (see ADR 0001/0002).

### 2. Operator match code

An opaque 8-character bearer secret scoped to **one fixture**. Minted by an
organiser via `POST /match-access`, handed to the score operator (an SMS, QR,
whatever), and used by the operator's phone as the `Authorization` header on
`/scoring/:fixtureId/*` writes.

Concrete flow:

```ts
// Organiser: mint. Store the raw `code` in the URL you hand to the operator.
// The response returns the raw code EXACTLY ONCE — never again.
const { code, id, expires_at } = await fetch(`${BASE}/match-access`, {
  method: "POST",
  headers: {
    apikey,
    authorization: `Bearer ${jwt}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    fixture_id,
    ttl_minutes: 240,
    label: "Sam, sideline",
  }),
}).then((r) => r.json());

// Operator: score. Bearer = the raw code, no JWT involved.
await fetch(`${BASE}/scoring/${fixtureId}/start`, {
  method: "POST",
  headers: { apikey, authorization: `Bearer ${code}` },
});
```

The code is case-insensitive; dashes and whitespace are stripped server-side so
`sam-code-abcdef` and `SAMCODEABCDEF` hit the same row. Missing / expired /
revoked codes 401. A valid code used against a different fixture 403s.

Codes have TTLs (15–720 min, default 240) and can be revoked idempotently via
`POST /match-access/:id/revoke`.

---

## Public routes — no credentials

`fixtures-public`, `live`, `standings`, `results-public`, and `api-docs` work
with just `apikey`. RLS gates what they see (only published events are visible
to `anon`).

---

## Workflow 1 — build and publish a draw

The full arc, all HTTP, no SQL. Assumes an organiser JWT in `$JWT`.

```
1  POST /seasons                  { name, sports:["soccer"], starts_on, ends_on }
2  POST /teams/bulk               { season_id, names: [...] }
3  POST /events                   { season_id, event_date: "2026-04-06" }
4  POST /events/:id/slots         { slot_number, starts_at:"18:00", pitch } × N
5  POST /events/:id/generate?dry_run=true   { sport, team_ids, slot_ids }
       → returns { preview: [{ round, slot_id, home_team_id, away_team_id }, …] }
5b Organiser eyeballs the preview, edits if needed…
6  POST /events/:id/generate      same body → 201 { inserted: [fixtures] }
6b (optional) PATCH individual fixtures to move slots / change teams
7  POST /events/:id/publish       (no body) — flips is_published=true
```

Publishing runs a structural pre-flight (`validatePublish` in
`events/validate-draw.ts`). It refuses with 409 and a specific `error` string
when:

- The event has zero fixtures.
- A fixture has no slot, or points at a slot that isn't on this event.
- A home team is missing.
- Any team isn't in the season's teams.
- Any sport isn't in `seasons.sports`.
- A fixture has the same team on both sides.

The reasoning: RLS opens every row under the event to `anon` the moment publish
flips. Broken structure would render a broken public page — better to 409 here
than surface it to students. See ADR 0006.

Undo: `POST /events/:id/unpublish`. Refuses when any fixture is live or complete
unless the body says `{ "force": true }`.

### Editing before publish

Every route is available: `POST/PATCH/DELETE /events/:id/slots[/:slotId]`, same
for fixtures. Two constraints:

- **Slot delete** refuses (409) when any fixture references the slot.
- **Fixture delete** refuses (409) when any `match_events` exist — cancel the
  fixture (`PATCH { "status": "cancelled" }`) to keep the audit trail.

### Editing after publish

- `PATCH /events/:id` refuses on published events (409). Unpublish first.
- `DELETE /events/:id` refuses on published events.
- Slots and fixtures on published events can still be edited, but any hole you
  introduce is now student-visible in real time.

---

## Workflow 2 — live scoring

The score operator's phone. Every route below needs the operator code as the
bearer.

```
POST /scoring/:fixtureId/start        (idempotent — flips status to 'live')
POST /scoring/:fixtureId/period       { intent:"start"|"end", period:1, match_clock_ms? }
POST /scoring/:fixtureId/events       { id, type:"score"|"foul"|"card"|..., team_id?, value? }
POST /scoring/:fixtureId/undo         { event_id }
POST /scoring/:fixtureId/finalize     { decided_by:"normal"|"penalties"|"forfeit", reopen? }
```

Two things worth knowing for the client UI:

- **Client generates the `id` on `/events`.** Server does
  `insert … on
  conflict (id) do nothing` and returns `inserted: false` on
  replay. So an offline queue can retry without double-counting — the operator's
  phone can drop out of wifi mid-half.
- **Response always includes the derived score.** Every scoring intent returns
  `{ fixture_id, fixture_status, derived: { home, away, foulsByTeam,
  currentPeriod } }`.
  No need to re-`GET /live/:id` after each write — the reply is what you'd show
  anyway.

---

## Workflow 3 — student view (live)

Two data sources:

1. `GET /live/:fixtureId` — snapshot of current score, period, fouls, and a
   `realtime` sub-object with subscription params.
2. Supabase Realtime subscription — pushes updates as they happen.

The docs/realtime.md file has the exact code. Short version:

```ts
const { fixture_id, home, away, realtime } = await fetch(
  `${BASE}/live/${fixtureId}`,
  { headers: { apikey } },
).then((r) => r.json());

const channel = supabase.channel(realtime.channel).on(
  "postgres_changes",
  {
    event: "*",
    schema: "public",
    table: "fixture_live_state",
    filter: realtime.filter,
  },
  (payload) => {
    // payload.new has the same shape as fixture_live_state — render it.
  },
).subscribe();
```

`fixture_live_state` is the derived projection (score, fouls, current period,
last event timestamp). The raw `match_events` log is not published on Realtime —
viewers get a summary, not a firehose.

For a "watch every game on the night" page: `GET /live?event=<uuid>` returns the
same summary for every fixture in a published event. Subscribe to each one's
channel, or use the shared `fixture_live_state` table with a broader filter.

---

## Three pages to build first

The organiser and viewer stories fan out into a lot of pages, but if you're
starting fresh, these three cover the demo and lock in the auth story:

### Page A — Draw builder (organiser)

Layout: left column is the slot list, right column is a grid of fixtures per
slot. "Generate draw" button.

Calls, in order:

- `GET /seasons` — populate a season dropdown
- `GET /teams?season=<uuid>` — the pool for fixture creation
- On event select: `GET /events/:id` — returns `{ event, slots, fixtures }` in
  one round-trip
- "Add slot" → `POST /events/:id/slots`
- "Add fixture" (drag two teams into a slot) → `POST /events/:id/fixtures`
- "Generate draw" opens a modal:
  - `POST /events/:id/generate?dry_run=true` for preview
  - Confirm → `POST /events/:id/generate` (same body, no dry_run)
- "Publish" → `POST /events/:id/publish`. On 409, show the `error` string — it
  names the specific fixture and reason.

### Page B — Public fixtures for tonight (student, no login)

- `GET /fixtures-public?event=<uuid>&format=json` — the whole draw
- Render slot times, home vs away, `status` badge
- For any `status: "live"` or `"complete"` fixture, show `score.home` /
  `score.away` (the endpoint already includes them)
- Deep-link to Page C by fixture id

### Page C — One live match (student, no login)

- `GET /live/:fixtureId` — initial snapshot + `realtime` subscription params
- Subscribe to Supabase Realtime as in Workflow 3
- On subscribe payload: replace state with `payload.new` (fixture_live_state
  shape)
- Show sport, home team, away team (or "BYE" when null), score, fouls (if the
  sport tracks them), current period, LIVE badge when status = live

That's it. Everything else (sport-configs UI, standings tables, results archive,
operator scoring screen) is a variation on those three shapes and the workflows
above.

---

## Common failure modes

- **401 with `Missing or malformed Authorization header`** — organiser route hit
  without a JWT, or scoring route hit without an operator code.
- **401 with `Invalid or expired token`** — JWT expired; refresh it.
- **403 on scoring** — the operator code was minted for a different fixture.
  Codes are scoped to one fixture; mint a new one.
- **409 on publish** — draw is structurally broken; the `error` string names the
  fixture and reason. Fix it and try again.
- **409 on generate** — cross-check failed (team not in season, sport not in
  `seasons.sports`, slot not on this event). String tells you which.
- **400 `Request body must be JSON`** — Content-Type wasn't `application/json`,
  or the body was empty.

---

## Where to look next

- `docs/openapi.yaml` — full spec. Also served at `/api-docs` (Swagger UI).
- `docs/realtime.md` — Realtime subscription protocol details.
- `docs/decisions/` — ADRs. 0002 for the operator-code model, 0003 for Realtime,
  0006 for draw generation, 0005 for what's deferred.
- `scripts/smoke-live.sh` — a runnable script that walks the full arc. Copy
  shapes from it when you need a working example.
