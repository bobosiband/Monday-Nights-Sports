// -----------------------------------------------------------------------------
// match-access/handlers/RevokeMatchCodeHandler.ts
//
// Handles POST /match-access/:id/revoke. Idempotent: revoking an
// already-revoked code returns 200 with the original revoked_at
// timestamp so the UI does not need a two-call check-first flow.
// -----------------------------------------------------------------------------

import { jsonResponse } from "../lib/Cors.ts";
import { isUuid } from "../lib/InputValidation.ts";
import type { MatchAccessRepository } from "../data/MatchAccessRepository.ts";

/** Handler for `POST /match-access/:id/revoke`. */
export class RevokeMatchCodeHandler {
  /**
   * @param repo - Match-access data access.
   */
  constructor(private readonly repo: MatchAccessRepository) {}

  /**
   * @param id - UUID of the `match_access` row.
   * @returns 200 with `{ id, revoked_at, already_revoked }`, 400 on
   * invalid id, 404 when the id does not match any row.
   */
  async handle(id: string): Promise<Response> {
    if (!isUuid(id)) {
      return jsonResponse({ error: "Invalid match_access id" }, 400);
    }
    const existing = await this.repo.findAccess(id);
    if (!existing) {
      return jsonResponse({ error: "Match access not found" }, 404);
    }
    const revokedAt = await this.repo.revokeAccess(id);
    return jsonResponse({
      id,
      revoked_at: revokedAt,
      already_revoked: existing.revoked_at !== null,
    });
  }
}
