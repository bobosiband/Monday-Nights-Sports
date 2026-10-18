// -----------------------------------------------------------------------------
// sport-configs/handlers/DeleteSportConfigHandler.ts
//
// Handles DELETE /sport-configs/:id.
// -----------------------------------------------------------------------------

import { jsonResponse } from "../lib/Cors.ts";
import type { SportConfigsRepository } from "../data/SportConfigsRepository.ts";

/** Handler for `DELETE /sport-configs/:id`. */
export class DeleteSportConfigHandler {
  /**
   * @param repo - Sport-configs data access.
   */
  constructor(private readonly repo: SportConfigsRepository) {}

  /**
   * @param id - Row id (already UUID-validated).
   * @returns 200 with `{ deleted }`, or 404 when nothing matched.
   */
  async handle(id: string): Promise<Response> {
    const deletedId = await this.repo.deleteById(id);
    if (!deletedId) {
      return jsonResponse({ error: "Sport config not found" }, 404);
    }
    return jsonResponse({ deleted: deletedId });
  }
}
