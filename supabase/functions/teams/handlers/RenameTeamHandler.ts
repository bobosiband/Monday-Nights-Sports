// -----------------------------------------------------------------------------
// teams/handlers/RenameTeamHandler.ts
//
// Handles PATCH /teams/:id: renames a team, rejecting a case-insensitive
// collision with another team in the same season with a 409.
// -----------------------------------------------------------------------------

import { jsonResponse } from "../lib/Cors.ts";
import { nonEmptyString, readJson } from "../lib/InputValidation.ts";
import type { TeamsRepository } from "../data/TeamsRepository.ts";

/** Loose shape of a rename request body. */
interface RenameTeamBody {
  name?: unknown;
}

/** Handler for `PATCH /teams/:id`. */
export class RenameTeamHandler {
  /**
   * @param repo - Teams data access.
   */
  constructor(private readonly repo: TeamsRepository) {}

  /**
   * @param request - Incoming request.
   * @param id - Team id (already UUID-validated).
   * @returns 200 with `{ team }`, 400 on validation failure, 404 when the
   * id does not match any row, 409 on same-season name collision.
   */
  async handle(request: Request, id: string): Promise<Response> {
    const body = await readJson<RenameTeamBody>(request);
    const name = body ? nonEmptyString(body.name) : null;
    if (!name) return jsonResponse({ error: "name is required" }, 400);

    const current = await this.repo.find(id);
    if (!current) return jsonResponse({ error: "Team not found" }, 404);

    if (current.name.toLowerCase() !== name.toLowerCase()) {
      const dupe = await this.repo.findDuplicateInSeason(
        current.season_id,
        name,
      );
      if (dupe) {
        return jsonResponse(
          { error: `Team '${name}' already exists in this season` },
          409,
        );
      }
    }

    const team = await this.repo.rename(id, name);
    return jsonResponse({ team });
  }
}
