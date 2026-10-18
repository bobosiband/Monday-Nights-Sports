// -----------------------------------------------------------------------------
// sport-configs/handlers/ListSportConfigsHandler.ts
//
// Handles GET /sport-configs?season=<uuid>: returns configs for a season.
// -----------------------------------------------------------------------------

import { jsonResponse } from "../lib/Cors.ts";
import { isUuid } from "../lib/InputValidation.ts";
import type { SportConfigsRepository } from "../data/SportConfigsRepository.ts";

/** Handler for `GET /sport-configs`. */
export class ListSportConfigsHandler {
  /**
   * @param repo - Sport-configs data access.
   */
  constructor(private readonly repo: SportConfigsRepository) {}

  /**
   * @param request - Incoming request. Reads `?season=<uuid>` from the URL.
   * @returns 200 with `{ sport_configs }`, 400 on bad input.
   */
  async handle(request: Request): Promise<Response> {
    const seasonId = new URL(request.url).searchParams.get("season");
    if (!seasonId || !isUuid(seasonId)) {
      return jsonResponse(
        { error: "Query param 'season' (uuid) is required" },
        400,
      );
    }
    const sport_configs = await this.repo.listBySeason(seasonId);
    return jsonResponse({ sport_configs });
  }
}
