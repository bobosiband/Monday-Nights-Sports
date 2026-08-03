# Realtime score distribution — client protocol

The `live` Edge Function returns a snapshot; the ongoing live update stream
comes from Supabase Realtime, subscribed directly by the browser.

The projection published on Realtime is `public.fixture_live_state` — one row
per fixture, upserted by the scoring service on every accepted write. The raw
`match_events` log is intentionally NOT published: viewers get a derived
summary, not a per-card / per-timeout firehose.

## Subscription

Every `GET /live/:fixtureId` response carries a `realtime` object naming the
exact subscription parameters:

```json
{
  "realtime": {
    "channel": "fixture:<fixture-id>",
    "table": "public.fixture_live_state",
    "filter": "fixture_id=eq.<fixture-id>"
  }
}
```

With the `@supabase/supabase-js` client that's:

```ts
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const channel = supabase
  .channel(`fixture:${fixtureId}`)
  .on(
    "postgres_changes",
    {
      event: "*",
      schema: "public",
      table: "fixture_live_state",
      filter: `fixture_id=eq.${fixtureId}`,
    },
    (payload) => {
      // payload.new is the new fixture_live_state row.
      applySummary(payload.new);
    },
  )
  .subscribe();
```

## Payload shape

The `new` row on each event matches the summary you got from `GET /live`:

| Column           | Type               | Meaning                                           |
| ---------------- | ------------------ | ------------------------------------------------- |
| `fixture_id`     | uuid               | The fixture.                                      |
| `home_score`     | int                | Derived home total.                               |
| `away_score`     | int                | Derived away total (0 on a bye).                  |
| `fouls`          | jsonb              | `{ team_id: count }` when the sport tracks fouls. |
| `current_period` | int / null         | Currently open period, or null between periods.   |
| `status`         | text               | `scheduled` / `live` / `complete` / `cancelled`.  |
| `last_event_at`  | timestamptz / null | Most recent non-voided event.                     |
| `updated_at`     | timestamptz        | Set by trigger.                                   |

`INSERT`, `UPDATE`, and `DELETE` events all use the same channel. A `DELETE`
should be treated as "revert to the fixture-only summary" (the projection was
blown away, e.g. by `scripts/rebuild-live-state.sql` — the next scoring write
will restore it).

## Reconnect / resync

Realtime delivery is best-effort. If your client disconnects and reconnects
(sleep, tab restore, wifi drop) it MAY have missed one or more updates. On
reconnect, always fetch `GET /live/:fixtureId` once to resync the score, then
resume applying realtime events on top. This keeps the client correct without
requiring guaranteed delivery.

## Access control

`fixture_live_state` has an RLS policy that allows `select` to the `anon` role
only when the parent event is `is_published`. Public viewers subscribe with the
anon key; Realtime honours RLS on subscription, so an unpublished event's
channel will simply return no rows.

## Not published on Realtime

- `match_events` — the raw event log. Internal only; contains card/timeout/note
  noise that public viewers should not see.
- `results` — read once via `results-public` when a fixture finalises. The
  `status='complete'` transition on `fixture_live_state` is the realtime signal
  that a final result exists.
- `match_access` — bearer material; never leaves the server.
