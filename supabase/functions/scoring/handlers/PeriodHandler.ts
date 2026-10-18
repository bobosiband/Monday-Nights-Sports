// -----------------------------------------------------------------------------
// scoring/handlers/PeriodHandler.ts
//
// POST /:fixtureId/period: record a `period_start` or `period_end`
// match_event. Guards against ending a period that never opened (or that
// has already been ended).
// -----------------------------------------------------------------------------

import {
  nonNegativeInt,
  positiveInt,
  readJson,
} from "../lib/InputValidation.ts";
import { badRequest, conflict } from "../lib/HttpErrors.ts";
import { FIXTURE_STATUS } from "../domain/ScoringActions.ts";
import type { ScoringRepository } from "../data/ScoringRepository.ts";
import type { ScoringFormat } from "../domain/ScoringFormat.ts";
import { periodIsOpen } from "../domain/PeriodState.ts";
import type {
  FixtureContext,
  MatchAccessContext,
  PeriodBody,
} from "../domain/ScoringTypes.ts";
import { respondDerived } from "./DerivedResponse.ts";

type PeriodIntent = "start" | "end";

/** Handler for `POST /:fixtureId/period`. */
export class PeriodHandler {
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
   * @returns The derived summary on success; 400 on bad body; 409 when
   * the intent contradicts current state.
   */
  async handle(
    request: Request,
    fixture: FixtureContext,
    _access: MatchAccessContext,
  ): Promise<Response> {
    if (
      fixture.status === FIXTURE_STATUS.complete ||
      fixture.status === FIXTURE_STATUS.cancelled
    ) {
      return conflict(
        `Fixture is ${fixture.status}; cannot change period boundaries.`,
      );
    }

    const body = await readJson<PeriodBody>(request);
    if (!body) return badRequest("Request body must be JSON");

    const intent = validateIntent(body.intent);
    if (!intent) return badRequest("intent must be 'start' or 'end'");

    const period = positiveInt(body.period);
    if (period === null) {
      return badRequest("period must be a positive integer");
    }

    const clock =
      body.match_clock_ms === undefined || body.match_clock_ms === null
        ? null
        : nonNegativeInt(body.match_clock_ms);
    if (
      body.match_clock_ms !== undefined && body.match_clock_ms !== null &&
      clock === null
    ) {
      return badRequest("match_clock_ms must be a non-negative integer");
    }

    const events = await this.repo.loadEvents(fixture.id);

    if (intent === "end" && !periodIsOpen(events, period)) {
      return conflict(
        `Period ${period} is not currently open on this fixture`,
      );
    }

    await this.repo.insertEvent({
      id: crypto.randomUUID(),
      fixture_id: fixture.id,
      type: intent === "start" ? "period_start" : "period_end",
      team_id: null,
      player_id: null,
      value: null,
      period,
      match_clock_ms: clock,
      voided_at: null,
      created_by: null,
    });

    return await respondDerived(this.repo, this.format, fixture);
  }
}

/**
 * Coerce the raw `intent` field into the typed union.
 *
 * @param raw - Any value.
 * @returns The intent, or `null` if unrecognised.
 */
function validateIntent(raw: unknown): PeriodIntent | null {
  if (raw === "start" || raw === "end") return raw;
  return null;
}
