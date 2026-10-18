// -----------------------------------------------------------------------------
// results-public/handlers/GetSeasonArchiveHandler.ts
//
// Handles GET /results-public?season=<uuid>&limit=&before=: returns the
// paginated archive for a season. The response emits `next_before` so a
// client does not have to guess the cursor.
// -----------------------------------------------------------------------------

import { jsonResponse } from "../lib/Cors.ts";
import { isUuid } from "../lib/InputValidation.ts";
import type { ResultsPublicRepository } from "../data/ResultsPublicRepository.ts";
import { shapeArchive } from "../domain/PublicResultsShaper.ts";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

/** Handler for the season-archive branch of the results-public route. */
export class GetSeasonArchiveHandler {
  /**
   * @param repo - Results-public data access.
   */
  constructor(private readonly repo: ResultsPublicRepository) {}

  /**
   * @param seasonId - Season id (not yet UUID-validated).
   * @param rawLimit - Raw `limit` query param.
   * @param beforeDate - Raw `before` query param (YYYY-MM-DD or null).
   * @returns 200 with `{ season, events, next_before }`, or 400 on bad
   * input.
   */
  async handle(
    seasonId: string | null,
    rawLimit: string | null,
    beforeDate: string | null,
  ): Promise<Response> {
    if (!seasonId || !isUuid(seasonId)) {
      return jsonResponse(
        { error: "Provide either ?season=<uuid> or ?event=<uuid>" },
        400,
      );
    }
    if (beforeDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(beforeDate)) {
      return jsonResponse({ error: "'before' must be YYYY-MM-DD" }, 400);
    }
    const limit = resolveLimit(rawLimit);

    const events = await this.repo.loadEventsForSeason(
      seasonId,
      limit,
      beforeDate,
    );
    const fixtures = await this.repo.loadFixturesWithResults(
      events.map((e) => e.id),
    );
    const shaped = shapeArchive(events, fixtures);

    const nextBefore = events.length === limit
      ? events[events.length - 1].event_date
      : null;

    return jsonResponse({
      season: seasonId,
      events: shaped,
      next_before: nextBefore,
    });
  }
}

/**
 * Resolve the `limit` query param to a bounded integer.
 *
 * @param raw - Raw string from the URL, or null.
 * @returns Clamped integer between 1 and `MAX_LIMIT`.
 */
function resolveLimit(raw: string | null): number {
  if (raw === null) return DEFAULT_LIMIT;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}
