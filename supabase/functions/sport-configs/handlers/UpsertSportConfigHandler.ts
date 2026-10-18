// -----------------------------------------------------------------------------
// sport-configs/handlers/UpsertSportConfigHandler.ts
//
// Handles POST /sport-configs: upserts on `(season_id, sport)`.
// -----------------------------------------------------------------------------

import { jsonResponse } from "../lib/Cors.ts";
import { isUuid, nonEmptyString, readJson } from "../lib/InputValidation.ts";
import type { SportConfigsRepository } from "../data/SportConfigsRepository.ts";
import { validateConfig } from "../validation/SportConfigValidator.ts";

/** Loose shape of an upsert body. */
interface UpsertBody {
  season_id?: unknown;
  sport?: unknown;
  config?: unknown;
}

/** Handler for `POST /sport-configs`. */
export class UpsertSportConfigHandler {
  /**
   * @param repo - Sport-configs data access.
   */
  constructor(private readonly repo: SportConfigsRepository) {}

  /**
   * @param request - Incoming request.
   * @returns 201 with `{ sport_config }`, or 400 on validation failure.
   */
  async handle(request: Request): Promise<Response> {
    const body = await readJson<UpsertBody>(request);
    if (!body) {
      return jsonResponse({ error: "Request body must be JSON" }, 400);
    }
    if (!isUuid(body.season_id)) {
      return jsonResponse({ error: "season_id must be a UUID" }, 400);
    }
    const sport = nonEmptyString(body.sport, 60);
    if (!sport) {
      return jsonResponse(
        { error: "sport must be a non-empty string" },
        400,
      );
    }
    const parsed = validateConfig(body.config);
    if (!parsed.ok) return jsonResponse({ error: parsed.error }, 400);

    const sport_config = await this.repo.upsert({
      season_id: body.season_id as string,
      sport,
      config: parsed.value,
    });
    return jsonResponse({ sport_config }, 201);
  }
}
