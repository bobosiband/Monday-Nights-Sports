// -----------------------------------------------------------------------------
// scoring/handlers/FinalizeMatchHandler.ts
//
// POST /:fixtureId/finalize: snapshot the derived score plus period
// breakdown into `results` and mark the fixture complete. This is the
// moment where standings and archive queries stop needing to re-fold the
// event log.
//
// Refuses to finalize an already-complete fixture unless the body sets
// `reopen: true` (organiser correction path).
// -----------------------------------------------------------------------------

import { readJson } from "../lib/InputValidation.ts";
import { jsonResponse } from "../lib/Cors.ts";
import { badRequest, conflict } from "../lib/HttpErrors.ts";
import {
  DECIDED_BY,
  type DecidedBy,
  FIXTURE_STATUS,
} from "../domain/ScoringActions.ts";
import type { ScoringRepository } from "../data/ScoringRepository.ts";
import type { ScoringFormat } from "../domain/ScoringFormat.ts";
import { buildPeriodBreakdown } from "../domain/PeriodBreakdown.ts";
import type {
  FinalizeBody,
  FinalizeResponse,
  FixtureContext,
  MatchAccessContext,
} from "../domain/ScoringTypes.ts";
import { writeLiveState } from "./DerivedResponse.ts";

/** Handler for `POST /:fixtureId/finalize`. */
export class FinalizeMatchHandler {
  /**
   * @param repo - Scoring data access.
   * @param format - Scoring format for the derived response.
   */
  constructor(
    private readonly repo: ScoringRepository,
    private readonly format: ScoringFormat,
  ) {}

  /**
   * @param request - The incoming request.
   * @param fixture - The pre-loaded fixture context.
   * @param _access - Verified match-access context; unused today.
   * @returns `FinalizeResponse` on success; 400 on bad body; 409 when
   * the fixture is already complete without reopen, or cancelled.
   */
  async handle(
    request: Request,
    fixture: FixtureContext,
    _access: MatchAccessContext,
  ): Promise<Response> {
    const body = await readJson<FinalizeBody>(request);
    const decidedBy = resolveDecidedBy(body?.decided_by);
    if (decidedBy === "invalid") {
      return badRequest(
        "decided_by must be one of: normal, penalties, forfeit",
      );
    }
    const reopen = body?.reopen === true;

    if (fixture.status === FIXTURE_STATUS.complete && !reopen) {
      return conflict(
        "Fixture is already complete. Set reopen=true to re-finalize.",
      );
    }
    if (fixture.status === FIXTURE_STATUS.cancelled) {
      return conflict("Fixture is cancelled and cannot be finalized.");
    }

    const [events, config] = await Promise.all([
      this.repo.loadEvents(fixture.id),
      this.repo.loadSportConfig(fixture.season_id, fixture.sport),
    ]);

    const derived = this.format.derive(events, {
      homeTeamId: fixture.home_team_id,
      awayTeamId: fixture.away_team_id,
      config,
    });
    const periods = buildPeriodBreakdown(
      events,
      fixture.home_team_id,
      fixture.away_team_id,
    );

    // Persist the snapshot before flipping status so a race that observes
    // "complete" without a results row is impossible.
    await this.repo.upsertResult(
      fixture.id,
      derived.home,
      derived.away,
      periods,
      decidedBy,
      null,
    );
    await this.repo.updateFixtureStatus(fixture.id, FIXTURE_STATUS.complete);

    let lastEventAt: string | null = null;
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].voided_at === null) {
        lastEventAt = events[i].created_at;
        break;
      }
    }
    await writeLiveState(
      this.repo,
      fixture.id,
      derived,
      FIXTURE_STATUS.complete,
      lastEventAt,
    );

    const responseBody: FinalizeResponse = {
      fixture_id: fixture.id,
      fixture_status: FIXTURE_STATUS.complete,
      derived,
      result: {
        home_score: derived.home,
        away_score: derived.away,
        periods,
        decided_by: decidedBy,
      },
    };
    return jsonResponse(responseBody);
  }
}

/**
 * Coerce the raw `decided_by` field. Defaults to `'normal'` when omitted;
 * returns `"invalid"` when the value is not one of the accepted strings.
 *
 * @param raw - Any value.
 * @returns The resolved `DecidedBy` or `"invalid"`.
 */
function resolveDecidedBy(raw: unknown): DecidedBy | "invalid" {
  if (raw === undefined || raw === null) return DECIDED_BY.normal;
  if (
    raw === DECIDED_BY.normal ||
    raw === DECIDED_BY.penalties ||
    raw === DECIDED_BY.forfeit
  ) {
    return raw;
  }
  return "invalid";
}
