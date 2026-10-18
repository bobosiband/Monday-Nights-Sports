// -----------------------------------------------------------------------------
// scoring/handlers/StartMatchHandler.ts
//
// POST /:fixtureId/start: mark scoring as underway. Flips
// `fixtures.status` from `scheduled` to `live`. Idempotent on a fixture
// that is already `live`; refuses to restart a `complete` or `cancelled`
// fixture (organisers reopen those explicitly via finalize).
// -----------------------------------------------------------------------------

import { conflict } from "../lib/HttpErrors.ts";
import {
  FIXTURE_STATUS,
  type FixtureStatus,
} from "../domain/ScoringActions.ts";
import type { ScoringRepository } from "../data/ScoringRepository.ts";
import type { ScoringFormat } from "../domain/ScoringFormat.ts";
import type {
  FixtureContext,
  MatchAccessContext,
} from "../domain/ScoringTypes.ts";
import { respondDerived } from "./DerivedResponse.ts";

/** Handler for `POST /:fixtureId/start`. */
export class StartMatchHandler {
  /**
   * @param repo - Scoring data access.
   * @param format - Scoring format for the derived response.
   */
  constructor(
    private readonly repo: ScoringRepository,
    private readonly format: ScoringFormat,
  ) {}

  /**
   * @param _request - The incoming request; body is not read.
   * @param fixture - The pre-loaded fixture context.
   * @param _access - Verified match-access context; unused today.
   * @returns A `DerivedResponse` reflecting the (possibly updated) status.
   */
  async handle(
    _request: Request,
    fixture: FixtureContext,
    _access: MatchAccessContext,
  ): Promise<Response> {
    let nextStatus: FixtureStatus = fixture.status;

    switch (fixture.status) {
      case FIXTURE_STATUS.scheduled:
        await this.repo.updateFixtureStatus(
          fixture.id,
          FIXTURE_STATUS.live,
        );
        nextStatus = FIXTURE_STATUS.live;
        break;
      case FIXTURE_STATUS.live:
        // Idempotent: a retried /start is a no-op.
        break;
      case FIXTURE_STATUS.complete:
        return conflict(
          "Fixture is already complete. Reopen via /finalize with reopen=true if you need to correct it.",
        );
      case FIXTURE_STATUS.cancelled:
        return conflict("Fixture is cancelled and cannot be started.");
    }

    return await respondDerived(this.repo, this.format, fixture, nextStatus);
  }
}
