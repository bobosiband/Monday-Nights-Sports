// -----------------------------------------------------------------------------
// seasons/handlers/GetSeasonHandler.ts
//
// Handles GET /seasons/:id: returns one season by id.
// -----------------------------------------------------------------------------

import { jsonResponse } from "../lib/Cors.ts";
import type { SeasonsRepository } from "../data/SeasonsRepository.ts";

/** Handler for `GET /seasons/:id`. */
export class GetSeasonHandler {
  /**
   * @param repo - Seasons data access.
   */
  constructor(private readonly repo: SeasonsRepository) {}

  /**
   * @param id - Season id (already validated as a UUID by the router).
   * @returns 200 with `{ season }` or 404 when not found.
   */
  async handle(id: string): Promise<Response> {
    const season = await this.repo.find(id);
    if (!season) return jsonResponse({ error: "Season not found" }, 404);
    return jsonResponse({ season });
  }
}
