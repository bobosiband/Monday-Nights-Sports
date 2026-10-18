// -----------------------------------------------------------------------------
// teams/handlers/ListTeamsHandler.ts
//
// Handles GET /teams?season=<uuid>: returns teams in a season, alphabetical.
// -----------------------------------------------------------------------------

import { jsonResponse } from "../lib/Cors.ts";
import { isUuid } from "../lib/InputValidation.ts";
import type { TeamsRepository } from "../data/TeamsRepository.ts";

/** Handler for `GET /teams`. */
export class ListTeamsHandler {
  /**
   * @param repo - Teams data access.
   */
  constructor(private readonly repo: TeamsRepository) {}

  /**
   * @param request - Incoming request. Reads `?season=<uuid>` from the URL.
   * @returns 200 with `{ teams }`, or 400 when the `season` param is
   * missing or not a UUID.
   */
  async handle(request: Request): Promise<Response> {
    const seasonId = new URL(request.url).searchParams.get("season");
    if (!seasonId || !isUuid(seasonId)) {
      return jsonResponse(
        { error: "Query param 'season' (uuid) is required" },
        400,
      );
    }
    const teams = await this.repo.listBySeason(seasonId);
    return jsonResponse({ teams });
  }
}
