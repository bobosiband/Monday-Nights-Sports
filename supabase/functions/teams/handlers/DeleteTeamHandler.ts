// -----------------------------------------------------------------------------
// teams/handlers/DeleteTeamHandler.ts
//
// Handles DELETE /teams/:id: removes a team row.
// -----------------------------------------------------------------------------

import { jsonResponse } from "../lib/Cors.ts";
import type { TeamsRepository } from "../data/TeamsRepository.ts";

/** Handler for `DELETE /teams/:id`. */
export class DeleteTeamHandler {
  /**
   * @param repo - Teams data access.
   */
  constructor(private readonly repo: TeamsRepository) {}

  /**
   * @param id - Team id (already UUID-validated).
   * @returns 200 with `{ deleted: <id> }`, or 404 when nothing matched.
   */
  async handle(id: string): Promise<Response> {
    const deletedId = await this.repo.deleteById(id);
    if (!deletedId) return jsonResponse({ error: "Team not found" }, 404);
    return jsonResponse({ deleted: deletedId });
  }
}
