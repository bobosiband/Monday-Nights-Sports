// -----------------------------------------------------------------------------
// scoring/handlers/start.ts
//
// POST /:fixtureId/start — mark scoring as underway. Flips
// `fixtures.status` from `scheduled` to `live`. Idempotent for a fixture
// that is already `live`; refuses to restart a `complete` or `cancelled`
// fixture (organisers reopen those explicitly via finalize).
// -----------------------------------------------------------------------------

import { conflict } from "../errors.ts";
import { FIXTURE_STATUS, type FixtureStatus } from "../constants.ts";
import { client, updateFixtureStatus } from "../db.ts";
import { respondDerived } from "../derive.ts";
import type { FixtureContext, MatchAccessContext } from "../types.ts";

/**
 * Handle the explicit `start` action. Recording the first event on a
 * `scheduled` fixture also flips it (see `handleRecordEvent`); `start` is
 * for the case where the operator wants to signal "match in progress"
 * without recording anything yet (e.g. displaying the LIVE badge before
 * kick-off).
 *
 * @param _request - The incoming request; body is not read.
 * @param fixture - The pre-loaded fixture context.
 * @param _access - Verified match-access context; unused today but passed
 *                  in for future operator attribution.
 * @returns A `DerivedResponse` reflecting the (possibly updated) status.
 */
export async function handleStart(
  _request: Request,
  fixture: FixtureContext,
  _access: MatchAccessContext,
): Promise<Response> {
  const supabase = client();

  let nextStatus: FixtureStatus = fixture.status;

  switch (fixture.status) {
    case FIXTURE_STATUS.scheduled:
      await updateFixtureStatus(supabase, fixture.id, FIXTURE_STATUS.live);
      nextStatus = FIXTURE_STATUS.live;
      break;
    case FIXTURE_STATUS.live:
      // Idempotent — a retried /start is a no-op.
      break;
    case FIXTURE_STATUS.complete:
      return conflict(
        "Fixture is already complete. Reopen via /finalize with reopen=true if you need to correct it.",
      );
    case FIXTURE_STATUS.cancelled:
      return conflict("Fixture is cancelled and cannot be started.");
  }

  return await respondDerived(supabase, fixture, nextStatus);
}
