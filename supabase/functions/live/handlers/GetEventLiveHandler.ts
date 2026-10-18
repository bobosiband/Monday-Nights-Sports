// -----------------------------------------------------------------------------
// live/handlers/GetEventLiveHandler.ts
//
// Handles GET /live?event=<uuid>: returns every published fixture's live
// summary for one event.
// -----------------------------------------------------------------------------

import { jsonResponse } from "../lib/Cors.ts";
import { isUuid } from "../lib/InputValidation.ts";
import type { LiveRepository } from "../data/LiveRepository.ts";
import { toSummary } from "../domain/LiveSummary.ts";

/** Handler for `GET /live?event=<uuid>`. */
export class GetEventLiveHandler {
  /**
   * @param repo - Live data access.
   */
  constructor(private readonly repo: LiveRepository) {}

  /**
   * @param eventId - Event id from the query string.
   * @returns 200 with `{ event, fixtures }`, 400/404 for the usual failure
   * modes.
   */
  async handle(eventId: string): Promise<Response> {
    if (!isUuid(eventId)) {
      return jsonResponse({ error: "Invalid event id" }, 400);
    }
    const rows = await this.repo.loadEventFixtures(eventId);
    if (rows === null) {
      return jsonResponse(
        { error: "Event not found or not published" },
        404,
      );
    }
    return jsonResponse({
      event: eventId,
      fixtures: rows.map(({ fixture, live }) => toSummary(fixture, live)),
    });
  }
}
