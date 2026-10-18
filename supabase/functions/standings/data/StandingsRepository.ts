// -----------------------------------------------------------------------------
// standings/data/StandingsRepository.ts
//
// Data access for the public standings endpoint. The service-role client
// bypasses RLS; the handler re-asserts the "season must be live" check at
// the application layer so an archived season does not surface here.
// -----------------------------------------------------------------------------

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { createServiceClient } from "../lib/SupabaseClientFactory.ts";
import type { StandingsConfig } from "../domain/StandingsTypes.ts";

/** Fixture + team-name + result join for one finished fixture. */
export interface FinishedRow {
  fixture_id: string;
  sport: string;
  home_team_id: string;
  away_team_id: string | null;
  home_team_name: string;
  away_team_name: string | null;
  home_score: number;
  away_score: number;
}

/** Data access contract for the standings service. */
export interface StandingsRepository {
  seasonIsLive(seasonId: string): Promise<boolean>;
  loadFinishedFixtures(seasonId: string): Promise<FinishedRow[]>;
  loadConfigsBySport(seasonId: string): Promise<Map<string, StandingsConfig>>;
}

/** Supabase-backed implementation of `StandingsRepository`. */
export class SupabaseStandingsRepository implements StandingsRepository {
  private readonly client: SupabaseClient;

  /**
   * @param client - Supabase client; defaults to the service-role client.
   */
  constructor(client: SupabaseClient = createServiceClient()) {
    this.client = client;
  }

  /**
   * Confirm the season exists and is not archived. Archived seasons return
   * 404: the standings endpoint is public and archived data intentionally
   * does not surface here.
   *
   * @param seasonId - UUID of the season.
   * @returns True when the season is live, false otherwise.
   */
  async seasonIsLive(seasonId: string): Promise<boolean> {
    const { data, error } = await this.client
      .from("seasons")
      .select("id, is_archived")
      .eq("id", seasonId)
      .maybeSingle();
    if (error) throw error;
    return data !== null && data.is_archived === false;
  }

  /**
   * Load every completed fixture plus result row for a season, denormalised
   * with team names so the pure calculator does not hit the DB.
   *
   * @param seasonId - UUID of the season.
   * @returns Rows suitable for the standings calculator.
   */
  async loadFinishedFixtures(seasonId: string): Promise<FinishedRow[]> {
    const { data, error } = await this.client
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
      // Filter by season here rather than in the query: the join makes
      // that awkward and the fixture set per season is small enough.
      const seasonFromRow = Array.isArray(raw.events)
        ? raw.events[0]?.season_id
        : raw.events?.season_id;
      if (seasonFromRow !== seasonId) continue;

      const result = Array.isArray(raw.results) ? raw.results[0] : raw.results;
      if (!result) continue;

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
   * Load sport-configs for a season, keyed by sport. Missing sports fall
   * back to `{}` in the caller so an unconfigured sport still produces a
   * sensible default table.
   *
   * @param seasonId - UUID of the season.
   * @returns Map keyed by sport.
   */
  async loadConfigsBySport(
    seasonId: string,
  ): Promise<Map<string, StandingsConfig>> {
    const { data, error } = await this.client
      .from("sport_configs")
      .select("sport, config")
      .eq("season_id", seasonId);
    if (error) throw error;
    const out = new Map<string, StandingsConfig>();
    for (
      const r of (data ?? []) as Array<{
        sport: string;
        config: StandingsConfig;
      }>
    ) {
      out.set(r.sport, r.config ?? {});
    }
    return out;
  }
}
