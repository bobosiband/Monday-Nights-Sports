// -----------------------------------------------------------------------------
// standings/handlers/GetStandingsHandler.ts
//
// Handles GET /standings?season=<uuid>[&sport=...]. Groups finished
// fixtures by sport and runs the standings rules once per group with that
// sport's config.
// -----------------------------------------------------------------------------

import { jsonResponse } from "../lib/Cors.ts";
import { isUuid } from "../lib/InputValidation.ts";
import type {
  FinishedRow,
  StandingsRepository,
} from "../data/StandingsRepository.ts";
import type {
  FinishedFixture,
  StandingsConfig,
  StandingsRow,
} from "../domain/StandingsTypes.ts";
import { PointsTableRules } from "../domain/StandingsRules.ts";

/** Handler for `GET /standings`. */
export class GetStandingsHandler {
  /**
   * @param repo - Standings data access.
   */
  constructor(private readonly repo: StandingsRepository) {}

  /**
   * @param request - Incoming request. Reads `season` and optional `sport`
   * from the query string.
   * @returns 200 JSON, 400 for bad input, 404 for an archived or missing
   * season.
   */
  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const seasonId = url.searchParams.get("season");
    const sportFilter = url.searchParams.get("sport");

    if (!seasonId || !isUuid(seasonId)) {
      return jsonResponse(
        { error: "Query param 'season' (uuid) is required" },
        400,
      );
    }

    if (!(await this.repo.seasonIsLive(seasonId))) {
      return jsonResponse({ error: "Season not found or archived" }, 404);
    }

    const [fixtures, configs] = await Promise.all([
      this.repo.loadFinishedFixtures(seasonId),
      this.repo.loadConfigsBySport(seasonId),
    ]);

    const bySport = this.computeBySport(fixtures, configs);

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
  }

  /**
   * Group fixtures by sport, then run the standings rules once per group.
   *
   * @param fixtures - Every finished fixture in the season.
   * @param configs - Sport configs keyed by sport name.
   * @returns Standings tables keyed by sport.
   */
  private computeBySport(
    fixtures: FinishedRow[],
    configs: Map<string, StandingsConfig>,
  ): Record<string, StandingsRow[]> {
    const bySport = new Map<string, FinishedFixture[]>();
    for (const f of fixtures) {
      const entry: FinishedFixture = {
        fixture_id: f.fixture_id,
        home_team_id: f.home_team_id,
        away_team_id: f.away_team_id,
        home_team_name: f.home_team_name,
        away_team_name: f.away_team_name,
        home_score: f.home_score,
        away_score: f.away_score,
      };
      const list = bySport.get(f.sport);
      if (list) list.push(entry);
      else bySport.set(f.sport, [entry]);
    }

    const out: Record<string, StandingsRow[]> = {};
    for (const [sport, group] of bySport) {
      const rules = new PointsTableRules(configs.get(sport) ?? {});
      out[sport] = rules.computeTable(group);
    }
    return out;
  }
}
