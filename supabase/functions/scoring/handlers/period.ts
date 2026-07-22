// -----------------------------------------------------------------------------
// scoring/handlers/period.ts
//
// POST /:fixtureId/period — record a period_start or period_end event.
// Real implementation lands in story #33.
// -----------------------------------------------------------------------------

import { notImplemented } from "../errors.ts";
import type { FixtureContext } from "../types.ts";

/**
 * Record a `period_start` or `period_end` match_event. Guards against
 * ending a period that never opened.
 *
 * @param _request - The incoming request (JSON body: `PeriodBody`).
 * @param _fixture - The pre-loaded fixture context.
 * @returns `DerivedResponse` (once implemented).
 */
export function handlePeriod(
  _request: Request,
  _fixture: FixtureContext,
): Promise<Response> {
  return Promise.resolve(notImplemented("period not implemented"));
}
