// -----------------------------------------------------------------------------
// sport-configs/handlers/UpdateSportConfigHandler.ts
//
// Handles PATCH /sport-configs/:id: partial update of sport and/or config.
// -----------------------------------------------------------------------------

import { jsonResponse } from "../lib/Cors.ts";
import { nonEmptyString, readJson } from "../lib/InputValidation.ts";
import type {
  SportConfigPatch,
  SportConfigsRepository,
} from "../data/SportConfigsRepository.ts";
import { validateConfig } from "../validation/SportConfigValidator.ts";

/** Loose shape of a PATCH body. */
interface PatchBody {
  sport?: unknown;
  config?: unknown;
}

/** Handler for `PATCH /sport-configs/:id`. */
export class UpdateSportConfigHandler {
  /**
   * @param repo - Sport-configs data access.
   */
  constructor(private readonly repo: SportConfigsRepository) {}

  /**
   * @param request - Incoming request.
   * @param id - Row id (already UUID-validated).
   * @returns 200 with `{ sport_config }`, 400 on validation failure, 404
   * when the id does not match any row.
   */
  async handle(request: Request, id: string): Promise<Response> {
    const body = await readJson<PatchBody>(request);
    if (!body) {
      return jsonResponse({ error: "Request body must be JSON" }, 400);
    }

    const patch: SportConfigPatch = {};
    if (body.sport !== undefined) {
      const s = nonEmptyString(body.sport, 60);
      if (!s) return jsonResponse({ error: "sport must be non-empty" }, 400);
      patch.sport = s;
    }
    if (body.config !== undefined) {
      const parsed = validateConfig(body.config);
      if (!parsed.ok) return jsonResponse({ error: parsed.error }, 400);
      patch.config = parsed.value;
    }
    if (Object.keys(patch).length === 0) {
      return jsonResponse({ error: "No updatable fields provided" }, 400);
    }

    const sport_config = await this.repo.update(id, patch);
    if (!sport_config) {
      return jsonResponse({ error: "Sport config not found" }, 404);
    }
    return jsonResponse({ sport_config });
  }
}
