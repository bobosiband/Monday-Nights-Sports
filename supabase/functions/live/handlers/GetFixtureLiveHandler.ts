// -----------------------------------------------------------------------------
// live/handlers/GetFixtureLiveHandler.ts
//
// Handles GET /live/:fixtureId.
// -----------------------------------------------------------------------------

import { jsonResponse } from "../lib/Cors.ts";
import { isUuid } from "../lib/InputValidation.ts";
import type { LiveRepository } from "../data/LiveRepository.ts";
import { toSummary } from "../domain/LiveSummary.ts";

/** Handler for `GET /live/:fixtureId`. */
export class GetFixtureLiveHandler {
  /**
   * @param repo - Live data access.
   */
  constructor(private readonly repo: LiveRepository) {}

  /**
   * @param fixtureId - Fixture id from the path.
   * @returns 200 with the summary, 400 on bad id, 404 when the fixture is
   * missing or its event is not published.
   */
  async handle(fixtureId: string): Promise<Response> {
    if (!isUuid(fixtureId)) {
      return jsonResponse({ error: "Invalid fixture id" }, 400);
    }
    const fixture = await this.repo.loadFixture(fixtureId);
    if (!fixture) {
      return jsonResponse(
        { error: "Fixture not found or event not published" },
        404,
      );
    }
    const live = await this.repo.loadLive(fixtureId);
    return jsonResponse(toSummary(fixture, live));
  }
}
