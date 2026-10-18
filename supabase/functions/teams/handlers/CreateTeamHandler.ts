// -----------------------------------------------------------------------------
// teams/handlers/CreateTeamHandler.ts
//
// Handles POST /teams: adds a single team to a season, rejecting a
// case-insensitive duplicate with a 409 so the UI shows a clean message
// instead of the raw unique-constraint error.
// -----------------------------------------------------------------------------

import { jsonResponse } from "../lib/Cors.ts";
import { isUuid, nonEmptyString, readJson } from "../lib/InputValidation.ts";
import type { TeamsRepository } from "../data/TeamsRepository.ts";

/** Loose shape of a create-team request body. */
interface CreateTeamBody {
  season_id?: unknown;
  name?: unknown;
}

/** Handler for `POST /teams`. */
export class CreateTeamHandler {
  /**
   * @param repo - Teams data access.
   */
  constructor(private readonly repo: TeamsRepository) {}

  /**
   * @param request - Incoming request.
   * @returns 201 with `{ team }`, 400 on validation failure, 409 when a
   * same-season name collision is detected.
   */
  async handle(request: Request): Promise<Response> {
    const body = await readJson<CreateTeamBody>(request);
    if (!body) {
      return jsonResponse({ error: "Request body must be JSON" }, 400);
    }
    if (!isUuid(body.season_id)) {
      return jsonResponse({ error: "season_id must be a uuid" }, 400);
    }
    const name = nonEmptyString(body.name);
    if (!name) return jsonResponse({ error: "name is required" }, 400);

    const dupe = await this.repo.findDuplicateInSeason(
      body.season_id as string,
      name,
    );
    if (dupe) {
      return jsonResponse(
        { error: `Team '${name}' already exists in this season` },
        409,
      );
    }

    const team = await this.repo.insert(body.season_id as string, name);
    return jsonResponse({ team }, 201);
  }
}
