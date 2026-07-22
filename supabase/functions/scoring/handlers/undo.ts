// -----------------------------------------------------------------------------
// scoring/handlers/undo.ts
//
// POST /:fixtureId/undo — soft-void a specific match_event id. Real
// implementation lands in story #32.
// -----------------------------------------------------------------------------

import { notImplemented } from "../errors.ts";
import type { FixtureContext } from "../types.ts";

/**
 * Soft-void a match_event so it no longer contributes to the derived score.
 * Targets a specific event id (not "the last one") so out-of-order retries
 * from an offline queue stay unambiguous.
 *
 * @param _request - The incoming request (JSON body: `UndoBody`).
 * @param _fixture - The pre-loaded fixture context.
 * @returns `DerivedResponse` (once implemented).
 */
export function handleUndo(
  _request: Request,
  _fixture: FixtureContext,
): Promise<Response> {
  return Promise.resolve(notImplemented("undo not implemented"));
}
