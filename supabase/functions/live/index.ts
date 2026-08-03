// -----------------------------------------------------------------------------
// live/index.ts
//
// Public live-score endpoint. No authentication — RLS on
// `fixture_live_state` restricts reads to published events. Reads the
// realtime projection first, falls back to a zeroed summary derived from
// the fixture row when no projection exists yet (fixture never scored).
//
// Routes:
//   GET /live/:fixtureId              → one fixture's live summary
//   GET /live?event=<uuid>            → every fixture in a published event
//
// Each response includes a `realtime` object naming the Supabase Realtime
// channel/filter a client should subscribe to. See docs/realtime.md for
// the full protocol.
// -----------------------------------------------------------------------------

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { createServiceClient } from "../_shared/supabase-client.ts";
import { isUuid } from "../_shared/validate.ts";

/**
 * Shape of the JSON body returned for one fixture. Deliberately flat so a
 * mobile viewer doesn't have to hop through nested objects.
 */
interface LiveSummary {
  fixture_id: string;
  sport: string;
  status: string;
  home: { team_id: string; name: string; score: number };
  away: { team_id: string; name: string; score: number } | null;
  fouls: Record<string, number>;
  current_period: number | null;
  last_event_at: string | null;
  realtime: {
    channel: string;
    table: string;
    filter: string;
  };
}

/** Fixture columns needed to build a summary and its fallback. */
interface FixtureRow {
  id: string;
  event_id: string;
  sport: string;
  status: string;
  home_team_id: string;
  away_team_id: string | null;
  home_team: { name: string } | null;
  away_team: { name: string } | null;
}

/** Live-state row shape (matches the 0004 table columns). */
interface LiveStateRow {
  fixture_id: string;
  home_score: number;
  away_score: number;
  fouls: Record<string, number>;
  current_period: number | null;
  status: string;
  last_event_at: string | null;
}

/**
 * Split the URL path relative to this function's mount point.
 *
 * @param request - The incoming request.
 * @returns Path segments after `live`.
 */
function subPath(request: Request): string[] {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  const idx = parts.lastIndexOf("live");
  return idx >= 0 ? parts.slice(idx + 1) : parts;
}

/**
 * Build the realtime subscription hint object for a fixture. Documented
 * separately in docs/realtime.md so clients don't need to guess the shape.
 *
 * @param fixtureId - Fixture id.
 * @returns Channel/filter tuple a Supabase Realtime client can use.
 */
function realtimeHint(fixtureId: string): LiveSummary["realtime"] {
  return {
    channel: `fixture:${fixtureId}`,
    table: "public.fixture_live_state",
    filter: `fixture_id=eq.${fixtureId}`,
  };
}

/**
 * Merge a fixture row with an optional live-state row into a public
 * summary. When no live-state row exists, the summary is zeroed and takes
 * status straight from the fixture — that's the right default because a
 * fixture that's never been scored has no projection yet.
 *
 * @param fixture - Fixture row with team relations expanded.
 * @param live - The projection row, or null.
 * @returns A flat summary suitable for the response.
 */
function toSummary(
  fixture: FixtureRow,
  live: LiveStateRow | null,
): LiveSummary {
  return {
    fixture_id: fixture.id,
    sport: fixture.sport,
    status: live?.status ?? fixture.status,
    home: {
      team_id: fixture.home_team_id,
      name: fixture.home_team?.name ?? "TBD",
      score: live?.home_score ?? 0,
    },
    away: fixture.away_team_id
      ? {
        team_id: fixture.away_team_id,
        name: fixture.away_team?.name ?? "TBD",
        score: live?.away_score ?? 0,
      }
      : null,
    fouls: live?.fouls ?? {},
    current_period: live?.current_period ?? null,
    last_event_at: live?.last_event_at ?? null,
    realtime: realtimeHint(fixture.id),
  };
}

/**
 * Look up one fixture (with team names) whose parent event is published.
 * RLS enforces the publication check, so unpublished events silently
 * return null.
 *
 * @param fixtureId - UUID of the fixture.
 * @returns The fixture row or null.
 */
async function loadFixture(fixtureId: string): Promise<FixtureRow | null> {
  const supabase = createServiceClient();

  // Two-step so we can enforce the "event must be published" gate here
  // regardless of the caller's role (the service-role client bypasses RLS).
  const { data: fixture, error } = await supabase
    .from("fixtures")
    .select(
      `id, event_id, sport, status, home_team_id, away_team_id,
       home_team:home_team_id ( name ),
       away_team:away_team_id ( name ),
       events:event_id ( is_published )`,
    )
    .eq("id", fixtureId)
    .maybeSingle();
  if (error) throw error;
  if (!fixture) return null;

  const events = (fixture as unknown as {
    events: { is_published: boolean } | { is_published: boolean }[] | null;
  }).events;
  const published = Array.isArray(events)
    ? events[0]?.is_published
    : events?.is_published;
  if (!published) return null;

  return {
    id: fixture.id,
    event_id: fixture.event_id,
    sport: fixture.sport,
    status: fixture.status,
    home_team_id: fixture.home_team_id,
    away_team_id: fixture.away_team_id,
    home_team: (fixture as unknown as { home_team: { name: string } | null })
      .home_team,
    away_team: (fixture as unknown as { away_team: { name: string } | null })
      .away_team,
  };
}

/**
 * Load every published fixture for an event with its live-state row.
 *
 * @param eventId - UUID of the event.
 * @returns Array of `{fixture, live}` pairs, or null if the event is
 *          missing or unpublished.
 */
async function loadEventFixtures(
  eventId: string,
): Promise<Array<{ fixture: FixtureRow; live: LiveStateRow | null }> | null> {
  const supabase = createServiceClient();

  const { data: event, error: eventErr } = await supabase
    .from("events")
    .select("id, is_published")
    .eq("id", eventId)
    .maybeSingle();
  if (eventErr) throw eventErr;
  if (!event || !event.is_published) return null;

  const { data: fixtures, error: fixErr } = await supabase
    .from("fixtures")
    .select(
      `id, event_id, sport, status, home_team_id, away_team_id,
       home_team:home_team_id ( name ),
       away_team:away_team_id ( name )`,
    )
    .eq("event_id", eventId);
  if (fixErr) throw fixErr;

  const fixtureRows = (fixtures ?? []) as unknown as FixtureRow[];
  if (fixtureRows.length === 0) return [];

  const ids = fixtureRows.map((f) => f.id);
  const { data: liveRows, error: liveErr } = await supabase
    .from("fixture_live_state")
    .select(
      "fixture_id, home_score, away_score, fouls, current_period, status, last_event_at",
    )
    .in("fixture_id", ids);
  if (liveErr) throw liveErr;
  const byFixture = new Map<string, LiveStateRow>();
  for (const r of (liveRows ?? []) as LiveStateRow[]) {
    byFixture.set(r.fixture_id, r);
  }

  return fixtureRows.map((fixture) => ({
    fixture,
    live: byFixture.get(fixture.id) ?? null,
  }));
}

/**
 * Handle `GET /live/:fixtureId`.
 *
 * @param fixtureId - Fixture id from the path.
 * @returns 200 with the summary; 400 for a bad id; 404 when the fixture
 *          doesn't exist or its event isn't published.
 */
async function handleFixture(fixtureId: string): Promise<Response> {
  if (!isUuid(fixtureId)) {
    return jsonResponse({ error: "Invalid fixture id" }, 400);
  }
  const fixture = await loadFixture(fixtureId);
  if (!fixture) {
    return jsonResponse(
      { error: "Fixture not found or event not published" },
      404,
    );
  }

  const supabase = createServiceClient();
  const { data: live, error } = await supabase
    .from("fixture_live_state")
    .select(
      "fixture_id, home_score, away_score, fouls, current_period, status, last_event_at",
    )
    .eq("fixture_id", fixtureId)
    .maybeSingle();
  if (error) throw error;

  return jsonResponse(
    toSummary(fixture, (live as LiveStateRow | null) ?? null),
  );
}

/**
 * Handle `GET /live?event=<uuid>` — every published fixture for one event.
 *
 * @param eventId - Event id from the query string.
 * @returns 200 with `{ event, fixtures: [...] }`; 400/404 for the usual
 *          failure modes.
 */
async function handleEvent(eventId: string): Promise<Response> {
  if (!isUuid(eventId)) {
    return jsonResponse({ error: "Invalid event id" }, 400);
  }
  const rows = await loadEventFixtures(eventId);
  if (rows === null) {
    return jsonResponse({ error: "Event not found or not published" }, 404);
  }
  return jsonResponse({
    event: eventId,
    fixtures: rows.map(({ fixture, live }) => toSummary(fixture, live)),
  });
}

serve(async (request) => {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  if (request.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const segments = subPath(request);
  try {
    if (segments.length === 1) {
      return await handleFixture(segments[0]);
    }
    if (segments.length === 0) {
      const eventId = new URL(request.url).searchParams.get("event");
      if (!eventId) {
        return jsonResponse({
          error: "Provide /live/:fixtureId or /live?event=<uuid>",
        }, 400);
      }
      return await handleEvent(eventId);
    }
    return jsonResponse({ error: "Not found" }, 404);
  } catch (error) {
    console.error("live error:", error);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
