// -----------------------------------------------------------------------------
// results-public/handlers/GetEventResultsHandler.ts
//
// Handles GET /results-public?event=<uuid>: returns the archived view for
// a single published event.
// -----------------------------------------------------------------------------

import { jsonResponse } from "../lib/Cors.ts";
import { isUuid } from "../lib/InputValidation.ts";
import type { ResultsPublicRepository } from "../data/ResultsPublicRepository.ts";
import { shapeArchive } from "../domain/PublicResultsShaper.ts";

/** Handler for the single-event branch of the results-public route. */
export class GetEventResultsHandler {
  /**
   * @param repo - Results-public data access.
   */
  constructor(private readonly repo: ResultsPublicRepository) {}

  /**
   * @param eventId - UUID of the event; validated here.
   * @returns 200 with `{ event }`, 400 on invalid id, 404 when not
   * published or not found.
   */
  async handle(eventId: string): Promise<Response> {
    if (!isUuid(eventId)) {
      return jsonResponse({ error: "Invalid event id" }, 400);
    }
    const event = await this.repo.loadEvent(eventId);
    if (!event) {
      return jsonResponse(
        { error: "Event not found or not published" },
        404,
      );
    }
    const fixtures = await this.repo.loadFixturesWithResults([eventId]);
    const [shaped] = shapeArchive([event], fixtures);
    return jsonResponse({ event: shaped });
  }
}
