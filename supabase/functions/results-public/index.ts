// -----------------------------------------------------------------------------
// results-public/index.ts
//
// Public archive of past events + their results. Reads only from the
// `results` snapshots (never re-folds match_events).
//
// Routes:
//   GET /results-public?season=<uuid>&limit=&before=  → paginated by event date
//   GET /results-public?event=<uuid>                  → one event's results
//
// Pagination:
//   - `limit`  — default 10, max 50; anything larger is clamped.
//   - `before` — ISO date; only events strictly before this date are returned.
//     Absent means "start from most recent". The next page uses the earliest
//     `event_date` from the current page as `before` on the next call.
// -----------------------------------------------------------------------------

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { createServiceClient } from "../_shared/supabase-client.ts";
import { isUuid } from "../_shared/validate.ts";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

interface EventRow {
  id: string;
  event_date: string;
  seasons: { name: string } | { name: string }[] | null;
}

interface FixtureWithResultRow {
  id: string;
  event_id: string;
  sport: string;
  home_team: { name: string } | null;
  away_team: { name: string } | null;
  results:
    | {
      home_score: number;
      away_score: number;
      periods: Array<{ period: number; home: number; away: number }> | null;
      decided_by: string;
      confirmed_at: string;
    }
    | Array<{
      home_score: number;
      away_score: number;
      periods: Array<{ period: number; home: number; away: number }> | null;
      decided_by: string;
      confirmed_at: string;
    }>
    | null;
}

/**
 * Resolve the `limit` query param to a bounded integer.
 *
 * @param raw - Raw string from the URL, or null.
 * @returns Clamped integer between 1 and MAX_LIMIT.
 */
function resolveLimit(raw: string | null): number {
  if (raw === null) return DEFAULT_LIMIT;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

/**
 * Load one published event by id. RLS gates publication so unpublished
 * events silently 404.
 *
 * @param eventId - UUID of the event.
 * @returns The event row, or null.
 */
async function loadEvent(eventId: string): Promise<EventRow | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("events")
    .select("id, event_date, is_published, seasons ( name )")
    .eq("id", eventId)
    .eq("is_published", true)
    .maybeSingle();
  if (error) throw error;
  return (data as EventRow | null) ?? null;
}

/**
 * Load up to `limit` published events for a season, strictly before
 * `beforeDate` when provided, newest-first.
 *
 * @param seasonId - UUID of the season.
 * @param limit - Max rows to return.
 * @param beforeDate - Optional cursor; only events strictly older.
 * @returns Event rows.
 */
async function loadEventsForSeason(
  seasonId: string,
  limit: number,
  beforeDate: string | null,
): Promise<EventRow[]> {
  const supabase = createServiceClient();
  let query = supabase
    .from("events")
    .select("id, event_date, is_published, seasons ( name )")
    .eq("season_id", seasonId)
    .eq("is_published", true)
    .order("event_date", { ascending: false })
    .limit(limit);
  if (beforeDate) query = query.lt("event_date", beforeDate);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as EventRow[];
}

/**
 * Load all fixtures + their result rows for a set of event ids.
 *
 * @param eventIds - Event UUIDs to fetch fixtures for.
 * @returns Rows with the result join.
 */
async function loadFixturesWithResults(
  eventIds: string[],
): Promise<FixtureWithResultRow[]> {
  if (eventIds.length === 0) return [];
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("fixtures")
    .select(
      `id, event_id, sport,
       home_team:home_team_id ( name ),
       away_team:away_team_id ( name ),
       results ( home_score, away_score, periods, decided_by, confirmed_at )`,
    )
    .in("event_id", eventIds);
  if (error) throw error;
  return (data ?? []) as unknown as FixtureWithResultRow[];
}

/**
 * Reshape the DB rows into the JSON structure the caller sees. Groups
 * fixtures under their parent event and prunes fixtures without results.
 *
 * @param events - Event rows.
 * @param fixtures - Fixtures with their result join.
 * @returns Public-shaped event objects (each with a `fixtures` array).
 */
function shape(events: EventRow[], fixtures: FixtureWithResultRow[]) {
  const byEvent = new Map<string, ReturnType<typeof toPublicFixture>[]>();
  for (const f of fixtures) {
    const result = Array.isArray(f.results) ? f.results[0] : f.results;
    if (!result) continue; // include only finalized fixtures in the archive
    const shaped = toPublicFixture(f, result);
    const list = byEvent.get(f.event_id);
    if (list) list.push(shaped);
    else byEvent.set(f.event_id, [shaped]);
  }

  return events.map((e) => {
    const seasonName = Array.isArray(e.seasons)
      ? e.seasons[0]?.name ?? null
      : e.seasons?.name ?? null;
    return {
      id: e.id,
      event_date: e.event_date,
      season_name: seasonName,
      fixtures: byEvent.get(e.id) ?? [],
    };
  });
}

/**
 * Shape one fixture + its result row into the public form. Kept small so
 * `shape` reads cleanly.
 */
function toPublicFixture(
  f: FixtureWithResultRow,
  result: {
    home_score: number;
    away_score: number;
    periods: Array<{ period: number; home: number; away: number }> | null;
    decided_by: string;
    confirmed_at: string;
  },
) {
  return {
    id: f.id,
    sport: f.sport,
    home_team_name: f.home_team?.name ?? null,
    away_team_name: f.away_team?.name ?? null,
    home_score: result.home_score,
    away_score: result.away_score,
    periods: result.periods ?? [],
    decided_by: result.decided_by,
    confirmed_at: result.confirmed_at,
  };
}

serve(async (request) => {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  if (request.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const url = new URL(request.url);
  const eventId = url.searchParams.get("event");
  const seasonId = url.searchParams.get("season");

  try {
    // Single-event branch.
    if (eventId) {
      if (!isUuid(eventId)) {
        return jsonResponse({ error: "Invalid event id" }, 400);
      }
      const event = await loadEvent(eventId);
      if (!event) {
        return jsonResponse({ error: "Event not found or not published" }, 404);
      }
      const fixtures = await loadFixturesWithResults([eventId]);
      const [shaped] = shape([event], fixtures);
      return jsonResponse({ event: shaped });
    }

    // Season archive branch.
    if (!seasonId || !isUuid(seasonId)) {
      return jsonResponse({
        error: "Provide either ?season=<uuid> or ?event=<uuid>",
      }, 400);
    }
    const limit = resolveLimit(url.searchParams.get("limit"));
    const before = url.searchParams.get("before");
    if (before !== null && !/^\d{4}-\d{2}-\d{2}$/.test(before)) {
      return jsonResponse({ error: "'before' must be YYYY-MM-DD" }, 400);
    }

    const events = await loadEventsForSeason(seasonId, limit, before);
    const fixtures = await loadFixturesWithResults(events.map((e) => e.id));
    const shaped = shape(events, fixtures);

    // Emit the cursor for the next page so a client doesn't need to guess.
    const nextBefore = events.length === limit
      ? events[events.length - 1].event_date
      : null;

    return jsonResponse({
      season: seasonId,
      events: shaped,
      next_before: nextBefore,
    });
  } catch (error) {
    console.error("results-public error:", error);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
