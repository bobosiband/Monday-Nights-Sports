// -----------------------------------------------------------------------------
// standings/index.ts
//
// Public standings endpoint. Computes tables in TypeScript from the
// `results` snapshots (never by re-folding match_events) so the same
// numbers a viewer sees also match what an organiser confirmed at
// finalize time.
//
// Routes:
//   GET /standings?season=<uuid>              → grouped by sport
//   GET /standings?season=<uuid>&sport=soccer → single sport
//
// Per docs/decisions/0004-standings-per-sport.md, a season can span
// multiple sports (soccer + netball on the same night). Each sport has its
// own config, its own scoring rules, and its own table. This endpoint
// runs `computeStandings` once per sport with that sport's config.
// -----------------------------------------------------------------------------

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { createServiceClient } from "../_shared/supabase-client.ts";
import { isUuid } from "../_shared/validate.ts";
import {
  computeStandings,
  type FinishedFixture,
  type StandingsRow,
} from "../_shared/standings.ts";
import type { SportConfig } from "../_shared/score.ts";

/** Fixture + team-name + result join for one finished fixture. */
interface FinishedRow {
  fixture_id: string;
  sport: string;
  home_team_id: string;
  away_team_id: string | null;
  home_team_name: string;
  away_team_name: string | null;
  home_score: number;
  away_score: number;
}

/**
 * Confirm the season exists and isn't archived. Archived seasons return
 * 404 — the standings endpoint is public and archived data intentionally
 * doesn't surface here.
 *
 * @param seasonId - UUID of the season.
 * @returns True when the season is live, false otherwise.
 */
async function seasonIsLive(seasonId: string): Promise<boolean> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("seasons")
    .select("id, is_archived")
    .eq("id", seasonId)
    .maybeSingle();
  if (error) throw error;
  return data !== null && data.is_archived === false;
}

/**
 * Load every completed fixture + result row for a season, denormalised
 * with team names so the pure library doesn't need to hit the DB.
 *
 * @param seasonId - UUID of the season.
 * @returns Rows suitable for computeStandings.
 */
async function loadFinishedFixtures(seasonId: string): Promise<FinishedRow[]> {
  const supabase = createServiceClient();

  // Fetch every fixture in the season (via events → season_id), joining
  // team names and the result row. Only rows with a matching result count.
  const { data, error } = await supabase
    .from("fixtures")
    .select(
      `id, sport, home_team_id, away_team_id,
       home_team:home_team_id ( name ),
       away_team:away_team_id ( name ),
       events:event_id ( season_id ),
       results ( home_score, away_score )`,
    )
    .eq("status", "complete");
  if (error) throw error;

  const rows: FinishedRow[] = [];
  for (
    const raw of (data ?? []) as unknown as Array<{
      id: string;
      sport: string;
      home_team_id: string;
      away_team_id: string | null;
      home_team: { name: string } | null;
      away_team: { name: string } | null;
      events: { season_id: string } | { season_id: string }[] | null;
      results:
        | { home_score: number; away_score: number }
        | { home_score: number; away_score: number }[]
        | null;
    }>
  ) {
    // Filter by season here rather than in the query — the join makes
    // that awkward and the fixture set per season is small enough.
    const seasonFromRow = Array.isArray(raw.events)
      ? raw.events[0]?.season_id
      : raw.events?.season_id;
    if (seasonFromRow !== seasonId) continue;

    const result = Array.isArray(raw.results) ? raw.results[0] : raw.results;
    if (!result) continue; // status=complete without a result should not
    // exist — finalize writes the result first — but skip defensively.

    rows.push({
      fixture_id: raw.id,
      sport: raw.sport,
      home_team_id: raw.home_team_id,
      away_team_id: raw.away_team_id,
      home_team_name: raw.home_team?.name ?? "TBD",
      away_team_name: raw.away_team?.name ?? null,
      home_score: result.home_score,
      away_score: result.away_score,
    });
  }
  return rows;
}

/**
 * Load sport_configs for a season, keyed by sport. Missing sports fall
 * back to `{}` in the caller so an unconfigured sport still produces a
 * sensible default table.
 *
 * @param seasonId - UUID of the season.
 * @returns Map from sport → SportConfig.
 */
async function loadConfigsBySport(
  seasonId: string,
): Promise<Map<string, SportConfig>> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("sport_configs")
    .select("sport, config")
    .eq("season_id", seasonId);
  if (error) throw error;
  const out = new Map<string, SportConfig>();
  for (
    const r of (data ?? []) as Array<{ sport: string; config: SportConfig }>
  ) {
    out.set(r.sport, r.config ?? {});
  }
  return out;
}

/**
 * Group fixtures by sport, then run computeStandings once per group.
 *
 * @param fixtures - Every finished fixture in the season.
 * @param configs - Sport configs keyed by sport name.
 * @returns Standings tables keyed by sport.
 */
function tablesBySport(
  fixtures: FinishedRow[],
  configs: Map<string, SportConfig>,
): Record<string, StandingsRow[]> {
  const bySport = new Map<string, FinishedFixture[]>();
  for (const f of fixtures) {
    const list = bySport.get(f.sport);
    const entry: FinishedFixture = {
      fixture_id: f.fixture_id,
      home_team_id: f.home_team_id,
      away_team_id: f.away_team_id,
      home_team_name: f.home_team_name,
      away_team_name: f.away_team_name,
      home_score: f.home_score,
      away_score: f.away_score,
    };
    if (list) list.push(entry);
    else bySport.set(f.sport, [entry]);
  }

  const out: Record<string, StandingsRow[]> = {};
  for (const [sport, group] of bySport) {
    out[sport] = computeStandings(group, configs.get(sport) ?? {});
  }
  return out;
}

serve(async (request) => {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  if (request.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const url = new URL(request.url);
  const seasonId = url.searchParams.get("season");
  const sportFilter = url.searchParams.get("sport");

  if (!seasonId || !isUuid(seasonId)) {
    return jsonResponse({
      error: "Query param 'season' (uuid) is required",
    }, 400);
  }

  try {
    if (!(await seasonIsLive(seasonId))) {
      return jsonResponse({ error: "Season not found or archived" }, 404);
    }

    const [fixtures, configs] = await Promise.all([
      loadFinishedFixtures(seasonId),
      loadConfigsBySport(seasonId),
    ]);

    const bySport = tablesBySport(fixtures, configs);

    if (sportFilter) {
      return jsonResponse({
        season: seasonId,
        sport: sportFilter,
        standings: bySport[sportFilter] ?? [],
      });
    }

    return jsonResponse({
      season: seasonId,
      standings_by_sport: bySport,
    });
  } catch (error) {
    console.error("standings error:", error);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
