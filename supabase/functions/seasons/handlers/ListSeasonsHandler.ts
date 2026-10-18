// -----------------------------------------------------------------------------
// seasons/handlers/ListSeasonsHandler.ts
//
// Handles GET /seasons: returns every season, newest start-date first.
// -----------------------------------------------------------------------------

import { jsonResponse } from "../lib/Cors.ts";
import type { SeasonsRepository } from "../data/SeasonsRepository.ts";

/** Handler for `GET /seasons`. */
export class ListSeasonsHandler {
  /**
   * @param repo - Seasons data access.
   */
  constructor(private readonly repo: SeasonsRepository) {}

  /**
   * @returns 200 with `{ seasons: [...] }`.
   */
  async handle(): Promise<Response> {
    const seasons = await this.repo.list();
    return jsonResponse({ seasons });
  }
}
