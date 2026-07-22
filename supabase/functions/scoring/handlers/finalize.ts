// -----------------------------------------------------------------------------
// scoring/handlers/finalize.ts
//
// POST /:fixtureId/finalize — snapshot the derived score into `results` and
// mark the fixture complete. Real implementation lands in story #35.
// -----------------------------------------------------------------------------

import { notImplemented } from "../errors.ts";
import type { FixtureContext } from "../types.ts";

/**
 * Derive final score + per-period breakdown from the event log, upsert into
 * `results`, and set `fixtures.status='complete'`. Refuses to finalize an
 * already-complete fixture unless the body sets `reopen: true`.
 *
 * @param _request - The incoming request (JSON body: `FinalizeBody`).
 * @param _fixture - The pre-loaded fixture context.
 * @returns `FinalizeResponse` (once implemented).
 */
export function handleFinalize(
  _request: Request,
  _fixture: FixtureContext,
): Promise<Response> {
  return Promise.resolve(notImplemented("finalize not implemented"));
}
