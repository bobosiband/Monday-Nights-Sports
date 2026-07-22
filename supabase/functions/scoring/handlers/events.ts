// -----------------------------------------------------------------------------
// scoring/handlers/events.ts
//
// POST /:fixtureId/events — record a match_event. Real implementation lands
// in story #31 (record) and story #34 (fouls/cards validation).
// -----------------------------------------------------------------------------

import { notImplemented } from "../errors.ts";
import type { FixtureContext } from "../types.ts";

/**
 * Insert a match_event with an idempotent client-supplied id and return the
 * derived score after applying it.
 *
 * @param _request - The incoming request (JSON body: `RecordEventBody`).
 * @param _fixture - The pre-loaded fixture context.
 * @returns `RecordEventResponse` (once implemented).
 */
export function handleRecordEvent(
  _request: Request,
  _fixture: FixtureContext,
): Promise<Response> {
  return Promise.resolve(notImplemented("events not implemented"));
}
