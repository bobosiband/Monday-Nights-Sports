// -----------------------------------------------------------------------------
// scoring/handlers/start.ts
//
// POST /:fixtureId/start — flips fixtures.status='live'. Real implementation
// lands in story #30.
// -----------------------------------------------------------------------------

import { notImplemented } from "../errors.ts";
import type { FixtureContext } from "../types.ts";

/**
 * Explicit "start scoring" action. Idempotent by design: replaying start
 * against a live fixture is a no-op; against a complete fixture it fails.
 *
 * @param _request - The incoming request (body ignored).
 * @param _fixture - The pre-loaded fixture context.
 * @returns The updated derived summary (once implemented).
 */
export function handleStart(
  _request: Request,
  _fixture: FixtureContext,
): Promise<Response> {
  return Promise.resolve(notImplemented("start not implemented"));
}
