// -----------------------------------------------------------------------------
// fixtures-public/index.ts
//
// Public delivery of a published event's draw. No authentication required —
// this is the URL that gets dropped into the group chat.
//
// Routes:
//   GET /fixtures-public?event=<uuid>              → HTML (default)
//   GET /fixtures-public?event=<uuid>&format=text  → plain text (chat-friendly)
//   GET /fixtures-public?event=<uuid>&format=json  → JSON (debug / integrators)
//
// RLS on the underlying tables restricts reads to published events, so an
// unpublished event id returns 404 even with a valid client.
//
// Sprint C additions: a LIVE badge is surfaced per fixture using
// `fixtures.status`, and a running score is shown for live fixtures
// (from `fixture_live_state`) and final scores for completed fixtures
// (from `results`). Rendering lives in `./render.ts`; this file is the
// HTTP + DB glue only.
// -----------------------------------------------------------------------------

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders, handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { createServiceClient } from "../_shared/supabase-client.ts";
import {
  type PublicEvent,
  type PublicFixture,
  renderHtml,
  renderText,
} from "./render.ts";

/** DB-shape row for a fixture with team + slot joins. */
interface FixtureRow {
  id: string;
  sport: string;
  status: "scheduled" | "live" | "complete" | "cancelled";
  slots:
    | { slot_number: number; starts_at: string; pitch: string | null }
    | null;
  home_team: { name: string } | null;
  away_team: { name: string } | null;
}

/** DB-shape row for an event with the season name join. */
interface EventRow {
  id: string;
  event_date: string;
  is_published: boolean;
  seasons: { name: string } | null;
}

/** DB-shape rows for the two score sources. */
interface LiveStateRow {
  fixture_id: string;
  home_score: number;
  away_score: number;
}
interface ResultRow {
  fixture_id: string;
  home_score: number;
  away_score: number;
}

/**
 * Load a published event + its fixtures + score rows in the minimum
 * queries needed. RLS handles the "must be published" check on every
 * table involved.
 *
 * @param eventId - UUID of the event.
 * @returns The rendered-ready shape, or `null` when the event isn't
 *          published (or doesn't exist).
 */
async function loadPublicEvent(eventId: string): Promise<
  { event: PublicEvent; fixtures: PublicFixture[] } | null
> {
  const supabase = createServiceClient();

  const { data: event, error: eventError } = await supabase
    .from("events")
    .select("id, event_date, is_published, seasons ( name )")
    .eq("id", eventId)
    .eq("is_published", true)
    .maybeSingle<EventRow>();
  if (eventError) throw eventError;
  if (!event) return null;

  const { data: fixtures, error: fixturesError } = await supabase
    .from("fixtures")
    .select(
      `id, sport, status,
       slots:slot_id ( slot_number, starts_at, pitch ),
       home_team:home_team_id ( name ),
       away_team:away_team_id ( name )`,
    )
    .eq("event_id", eventId);
  if (fixturesError) throw fixturesError;
  const rows = (fixtures ?? []) as unknown as FixtureRow[];
  rows.sort((a, b) =>
    (a.slots?.slot_number ?? 0) - (b.slots?.slot_number ?? 0)
  );

  const ids = rows.map((r) => r.id);

  // Two parallel score lookups. Empty `ids` short-circuits so an event
  // with no fixtures still returns cleanly (edge case, but cheap).
  const [liveMap, resultMap] = ids.length === 0
    ? [new Map<string, LiveStateRow>(), new Map<string, ResultRow>()]
    : await Promise.all([loadLiveMap(ids), loadResultMap(ids)]);

  const publicEvent: PublicEvent = {
    id: event.id,
    event_date: event.event_date,
    season_name: event.seasons?.name ?? null,
  };

  const publicFixtures: PublicFixture[] = rows.map((row) => {
    // Prefer results (locked-in final) over live-state (in-flight cache).
    const result = resultMap.get(row.id);
    const live = liveMap.get(row.id);
    const score = result
      ? { home: result.home_score, away: result.away_score }
      : live
      ? { home: live.home_score, away: live.away_score }
      : null;

    return {
      id: row.id,
      sport: row.sport,
      status: row.status,
      slot: row.slots
        ? {
          slot_number: row.slots.slot_number,
          starts_at: row.slots.starts_at,
          pitch: row.slots.pitch,
        }
        : null,
      home_team_name: row.home_team?.name ?? null,
      away_team_name: row.away_team?.name ?? null,
      score,
    };
  });

  return { event: publicEvent, fixtures: publicFixtures };
}

/**
 * Load fixture_live_state rows for a set of fixture ids.
 *
 * @param ids - Fixture ids to fetch.
 * @returns A map keyed by fixture_id.
 */
async function loadLiveMap(ids: string[]): Promise<Map<string, LiveStateRow>> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("fixture_live_state")
    .select("fixture_id, home_score, away_score")
    .in("fixture_id", ids);
  if (error) throw error;
  const out = new Map<string, LiveStateRow>();
  for (const r of (data ?? []) as LiveStateRow[]) out.set(r.fixture_id, r);
  return out;
}

/**
 * Load results rows for a set of fixture ids.
 *
 * @param ids - Fixture ids to fetch.
 * @returns A map keyed by fixture_id.
 */
async function loadResultMap(ids: string[]): Promise<Map<string, ResultRow>> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("results")
    .select("fixture_id, home_score, away_score")
    .in("fixture_id", ids);
  if (error) throw error;
  const out = new Map<string, ResultRow>();
  for (const r of (data ?? []) as ResultRow[]) out.set(r.fixture_id, r);
  return out;
}

serve(async (request) => {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  if (request.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const url = new URL(request.url);
  const eventId = url.searchParams.get("event");
  const format = url.searchParams.get("format") ?? "html";

  if (!eventId) {
    return jsonResponse({ error: "Missing required query param: event" }, 400);
  }

  try {
    const result = await loadPublicEvent(eventId);
    if (!result) {
      return jsonResponse({ error: "Event not found or not published" }, 404);
    }

    if (format === "json") {
      return jsonResponse({ event: result.event, fixtures: result.fixtures });
    }

    if (format === "text") {
      return new Response(renderText(result.event, result.fixtures), {
        status: 200,
        headers: {
          ...corsHeaders,
          "content-type": "text/plain; charset=utf-8",
        },
      });
    }

    return new Response(renderHtml(result.event, result.fixtures), {
      status: 200,
      headers: { ...corsHeaders, "content-type": "text/html; charset=utf-8" },
    });
  } catch (error) {
    console.error("fixtures-public error:", error);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
