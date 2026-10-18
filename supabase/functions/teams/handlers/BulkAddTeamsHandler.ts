// -----------------------------------------------------------------------------
// teams/handlers/BulkAddTeamsHandler.ts
//
// Handles POST /teams/bulk: inserts a batch of team names into a season,
// echoing back any names dropped as duplicates (either within the input or
// against existing teams).
// -----------------------------------------------------------------------------

import { jsonResponse } from "../lib/Cors.ts";
import { isUuid, nonEmptyString, readJson } from "../lib/InputValidation.ts";
import type { TeamsRepository } from "../data/TeamsRepository.ts";
import { dedupeCaseInsensitive } from "../domain/TeamNameDedup.ts";

/** Loose shape of a bulk-add request body. */
interface BulkAddBody {
  season_id?: unknown;
  names?: unknown;
}

/** Handler for `POST /teams/bulk`. */
export class BulkAddTeamsHandler {
  /**
   * @param repo - Teams data access.
   */
  constructor(private readonly repo: TeamsRepository) {}

  /**
   * @param request - Incoming request.
   * @returns 201 with `{ inserted, skipped_duplicates_in_input,
   * skipped_existing_in_season }`, or 400 on validation failure.
   */
  async handle(request: Request): Promise<Response> {
    const body = await readJson<BulkAddBody>(request);
    if (!body) {
      return jsonResponse({ error: "Request body must be JSON" }, 400);
    }
    if (!isUuid(body.season_id)) {
      return jsonResponse({ error: "season_id must be a uuid" }, 400);
    }
    if (!Array.isArray(body.names) || body.names.length === 0) {
      return jsonResponse(
        { error: "names must be a non-empty array of strings" },
        400,
      );
    }

    const cleaned: string[] = [];
    for (const n of body.names) {
      const c = nonEmptyString(n);
      if (!c) {
        return jsonResponse(
          { error: "Every name must be a non-empty string" },
          400,
        );
      }
      cleaned.push(c);
    }

    const { unique, dropped: droppedInInput } = dedupeCaseInsensitive(cleaned);

    const seasonId = body.season_id as string;
    const existing = await this.repo.listNamesInSeason(seasonId);
    const existingLower = new Set(existing.map((n) => n.toLowerCase()));

    const toInsert: string[] = [];
    const droppedExisting: string[] = [];
    for (const n of unique) {
      if (existingLower.has(n.toLowerCase())) {
        droppedExisting.push(n);
      } else {
        toInsert.push(n);
      }
    }

    const inserted = await this.repo.insertMany(seasonId, toInsert);

    return jsonResponse({
      inserted,
      skipped_duplicates_in_input: droppedInInput,
      skipped_existing_in_season: droppedExisting,
    }, 201);
  }
}
