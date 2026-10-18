// -----------------------------------------------------------------------------
// seasons/handlers/UpdateSeasonHandler.ts
//
// Handles PATCH /seasons/:id: validates a sparse patch and applies it.
// -----------------------------------------------------------------------------

import { jsonResponse } from "../lib/Cors.ts";
import { readJson } from "../lib/InputValidation.ts";
import type { SeasonsRepository } from "../data/SeasonsRepository.ts";
import {
  type UpdateSeasonBody,
  validateUpdate,
} from "../validation/SeasonBodyValidator.ts";

/** Handler for `PATCH /seasons/:id`. */
export class UpdateSeasonHandler {
  /**
   * @param repo - Seasons data access.
   */
  constructor(private readonly repo: SeasonsRepository) {}

  /**
   * @param request - Incoming request.
   * @param id - Season id (already UUID-validated).
   * @returns 200 with `{ season }`, 400 on validation failure, 404 when
   * the id does not match any row.
   */
  async handle(request: Request, id: string): Promise<Response> {
    const body = await readJson<UpdateSeasonBody>(request);
    const parsed = validateUpdate(body);
    if (!parsed.ok) return jsonResponse({ error: parsed.error }, 400);

    const season = await this.repo.update(id, parsed.value);
    if (!season) return jsonResponse({ error: "Season not found" }, 404);
    return jsonResponse({ season });
  }
}
