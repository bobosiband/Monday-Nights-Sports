// -----------------------------------------------------------------------------
// seasons/handlers/ArchiveSeasonHandler.ts
//
// Handles POST /seasons/:id/archive: soft-deletes a season. Also clears
// `is_active`: an archived season is never active. Idempotent.
// -----------------------------------------------------------------------------

import { jsonResponse } from "../lib/Cors.ts";
import type { SeasonsRepository } from "../data/SeasonsRepository.ts";

/** Handler for `POST /seasons/:id/archive`. */
export class ArchiveSeasonHandler {
  /**
   * @param repo - Seasons data access.
   */
  constructor(private readonly repo: SeasonsRepository) {}

  /**
   * @param id - Season id (already UUID-validated).
   * @returns 200 with `{ season }` or 404 when not found.
   */
  async handle(id: string): Promise<Response> {
    const season = await this.repo.archive(id);
    if (!season) return jsonResponse({ error: "Season not found" }, 404);
    return jsonResponse({ season });
  }
}
