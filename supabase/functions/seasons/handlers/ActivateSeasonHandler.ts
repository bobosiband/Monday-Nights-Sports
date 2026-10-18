// -----------------------------------------------------------------------------
// seasons/handlers/ActivateSeasonHandler.ts
//
// Handles POST /seasons/:id/activate: marks a season active and unsets
// every other active season. Two updates: not atomic across callers, but
// the partial unique index still prevents two active rows simultaneously.
// -----------------------------------------------------------------------------

import { jsonResponse } from "../lib/Cors.ts";
import type { SeasonsRepository } from "../data/SeasonsRepository.ts";

/** Handler for `POST /seasons/:id/activate`. */
export class ActivateSeasonHandler {
  /**
   * @param repo - Seasons data access.
   */
  constructor(private readonly repo: SeasonsRepository) {}

  /**
   * @param id - Season id (already UUID-validated).
   * @returns 200 with `{ season }`, 404 when not found, 400 when the
   * target is archived.
   */
  async handle(id: string): Promise<Response> {
    const existing = await this.repo.findForActivate(id);
    if (!existing) return jsonResponse({ error: "Season not found" }, 404);
    if (existing.is_archived) {
      return jsonResponse(
        { error: "Cannot activate an archived season" },
        400,
      );
    }

    await this.repo.unsetActiveExcept(id);
    const season = await this.repo.setActive(id);
    return jsonResponse({ season });
  }
}
