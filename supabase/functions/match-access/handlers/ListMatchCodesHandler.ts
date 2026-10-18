// -----------------------------------------------------------------------------
// match-access/handlers/ListMatchCodesHandler.ts
//
// Handles GET /match-access?fixture=<uuid>. Returns metadata only, never
// the raw code or its hash, plus a derived `active` boolean so the UI
// does not duplicate the "not revoked and not expired" rule.
// -----------------------------------------------------------------------------

import { jsonResponse } from "../lib/Cors.ts";
import { isUuid } from "../lib/InputValidation.ts";
import type { MatchAccessRepository } from "../data/MatchAccessRepository.ts";

/** Handler for `GET /match-access?fixture=<uuid>`. */
export class ListMatchCodesHandler {
  /**
   * @param repo - Match-access data access.
   */
  constructor(private readonly repo: MatchAccessRepository) {}

  /**
   * @param fixtureId - UUID of the fixture.
   * @returns 200 with `{ codes }`, 400 when the query param is missing or
   * invalid.
   */
  async handle(fixtureId: string | null): Promise<Response> {
    if (!fixtureId || !isUuid(fixtureId)) {
      return jsonResponse(
        { error: "Query param 'fixture' (uuid) is required" },
        400,
      );
    }
    const rows = await this.repo.listAccessForFixture(fixtureId);
    const now = Date.now();
    const codes = rows.map((r) => ({
      id: r.id,
      fixture_id: r.fixture_id,
      label: r.label,
      expires_at: r.expires_at,
      revoked_at: r.revoked_at,
      last_used_at: r.last_used_at,
      active: r.revoked_at === null &&
        new Date(r.expires_at).getTime() > now,
    }));
    return jsonResponse({ codes });
  }
}
