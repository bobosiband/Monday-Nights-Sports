// -----------------------------------------------------------------------------
// seasons/handlers/CreateSeasonHandler.ts
//
// Handles POST /seasons: validates the body and inserts a new season. If
// the caller asked for `is_active: true`, the previous active season is
// unset first so the partial unique index does not reject.
// -----------------------------------------------------------------------------

import { jsonResponse } from "../lib/Cors.ts";
import { readJson } from "../lib/InputValidation.ts";
import type { AuthenticatedUser } from "../lib/OrganiserAuthGuard.ts";
import type { SeasonsRepository } from "../data/SeasonsRepository.ts";
import {
  type CreateSeasonBody,
  validateCreate,
} from "../validation/SeasonBodyValidator.ts";

/** Handler for `POST /seasons`. */
export class CreateSeasonHandler {
  /**
   * @param repo - Seasons data access.
   */
  constructor(private readonly repo: SeasonsRepository) {}

  /**
   * @param request - Incoming request.
   * @param user - Authenticated organiser; stored on the row as creator.
   * @returns 201 with `{ season }` on success, 400 on validation failure.
   */
  async handle(request: Request, user: AuthenticatedUser): Promise<Response> {
    const body = await readJson<CreateSeasonBody>(request);
    const parsed = validateCreate(body);
    if (!parsed.ok) return jsonResponse({ error: parsed.error }, 400);

    if (parsed.value.is_active) {
      await this.repo.unsetAllActive();
    }
    const season = await this.repo.create(parsed.value, user.id);
    return jsonResponse({ season }, 201);
  }
}
