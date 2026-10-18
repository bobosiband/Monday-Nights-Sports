// -----------------------------------------------------------------------------
// scoring/handlers/RecordEventHandler.ts
//
// POST /:fixtureId/events: record a match_event. Client supplies the event
// UUID so the insert is idempotent across offline-queue retries; the
// response carries the derived score after the write so the client can
// reconcile its optimistic local state.
//
// Also handles the "first accepted event flips scheduled -> live"
// transition so an operator who jumps straight into scoring without
// hitting /start still ends up with a live-badged fixture.
// -----------------------------------------------------------------------------

import { readJson } from "../lib/InputValidation.ts";
import { jsonResponse } from "../lib/Cors.ts";
import { badRequest, conflict } from "../lib/HttpErrors.ts";
import {
  FIXTURE_STATUS,
  type FixtureStatus,
} from "../domain/ScoringActions.ts";
import type { ScoringRepository } from "../data/ScoringRepository.ts";
import type { ScoringFormat } from "../domain/ScoringFormat.ts";
import { validateRecordBody } from "../validation/EventBodyValidator.ts";
import type {
  FixtureContext,
  MatchAccessContext,
  RecordEventBody,
  RecordEventResponse,
} from "../domain/ScoringTypes.ts";
import { writeLiveState } from "./DerivedResponse.ts";

/** Handler for `POST /:fixtureId/events`. */
export class RecordEventHandler {
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
   * @returns `RecordEventResponse` on success, 400 on validation failure,
   * 409 when the fixture is complete/cancelled.
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
        `Fixture is ${fixture.status}; reopen via /finalize with reopen=true to record more events.`,
      );
    }

    const body = await readJson<RecordEventBody>(request);
    const config = await this.repo.loadSportConfig(
      fixture.season_id,
      fixture.sport,
    );
    const parsed = validateRecordBody(body, fixture, config);
    if (!parsed.ok) return badRequest(parsed.error);

    const { inserted } = await this.repo.insertEvent({
      id: parsed.value.id,
      fixture_id: fixture.id,
      type: parsed.value.type,
      team_id: parsed.value.team_id,
      player_id: parsed.value.player_id,
      value: parsed.value.value,
      period: parsed.value.period,
      match_clock_ms: parsed.value.match_clock_ms,
      voided_at: null,
      created_by: null,
    });

    // First-event live transition. Only flip when we actually inserted a
    // new row: a duplicate replay should not change status.
    let nextStatus: FixtureStatus = fixture.status;
    if (inserted && fixture.status === FIXTURE_STATUS.scheduled) {
      await this.repo.updateFixtureStatus(fixture.id, FIXTURE_STATUS.live);
      nextStatus = FIXTURE_STATUS.live;
    }

    const events = await this.repo.loadEvents(fixture.id);
    const derived = this.format.derive(events, {
      homeTeamId: fixture.home_team_id,
      awayTeamId: fixture.away_team_id,
      config,
    });

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
      nextStatus,
      lastEventAt,
    );

    const responseBody: RecordEventResponse = {
      fixture_id: fixture.id,
      fixture_status: nextStatus,
      event_id: parsed.value.id,
      inserted,
      derived,
    };
    return jsonResponse(responseBody, inserted ? 201 : 200);
  }
}
