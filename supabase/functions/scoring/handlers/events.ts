// -----------------------------------------------------------------------------
// scoring/handlers/events.ts
//
// POST /:fixtureId/events — record a match_event. Client supplies the event
// UUID so the insert is idempotent across offline-queue retries; the response
// carries the derived score after the write so the client can reconcile its
// optimistic local state.
//
// Also handles the "first accepted event flips scheduled → live" transition
// so an operator who jumps straight into scoring without hitting /start
// still ends up with a live-badged fixture.
// -----------------------------------------------------------------------------

import { readJson } from "../_shared/validate.ts";
import { jsonResponse } from "../_shared/cors.ts";
import { badRequest, conflict } from "../errors.ts";
import { FIXTURE_STATUS, type FixtureStatus } from "../constants.ts";
import {
  client,
  insertEvent,
  loadEvents,
  loadSportConfig,
  updateFixtureStatus,
} from "../db.ts";
import { deriveScore } from "../_shared/score.ts";
import { validateRecordBody } from "../validate-event.ts";
import type {
  FixtureContext,
  RecordEventBody,
  RecordEventResponse,
} from "../types.ts";

/**
 * Insert (or idempotently skip) a match_event and return the derived score.
 *
 * @param request - The incoming request; JSON body validated against
 *                  `RecordEventBody`.
 * @param fixture - The pre-loaded fixture context.
 * @returns `RecordEventResponse` on success, 400 on validation failure,
 *          409 when the fixture is complete/cancelled.
 */
export async function handleRecordEvent(
  request: Request,
  fixture: FixtureContext,
): Promise<Response> {
  if (
    fixture.status === FIXTURE_STATUS.complete ||
    fixture.status === FIXTURE_STATUS.cancelled
  ) {
    return conflict(
      `Fixture is ${fixture.status}; reopen via /finalize with reopen=true to record more events.`,
    );
  }

  const supabase = client();
  const body = await readJson<RecordEventBody>(request);
  const config = await loadSportConfig(supabase, fixture.season_id, fixture.sport);
  const parsed = validateRecordBody(body, fixture, config);
  if (!parsed.ok) return badRequest(parsed.error);

  // Idempotent insert. If the row already exists the DB does nothing and
  // we treat the request as a replay — still return the current derived
  // state so the caller reconciles.
  const { inserted } = await insertEvent(supabase, {
    id: parsed.value.id,
    fixture_id: fixture.id,
    type: parsed.value.type,
    team_id: parsed.value.team_id,
    player_id: parsed.value.player_id,
    value: parsed.value.value,
    period: parsed.value.period,
    match_clock_ms: parsed.value.match_clock_ms,
    voided_at: null,
    // TODO(Sprint C): populate from token claims once the guard is real.
    created_by: null,
  });

  // First-event live transition. Only flip when we actually inserted a new
  // row — a duplicate replay shouldn't change status.
  let nextStatus: FixtureStatus = fixture.status;
  if (inserted && fixture.status === FIXTURE_STATUS.scheduled) {
    await updateFixtureStatus(supabase, fixture.id, FIXTURE_STATUS.live);
    nextStatus = FIXTURE_STATUS.live;
  }

  const events = await loadEvents(supabase, fixture.id);
  const derived = deriveScore(
    events,
    fixture.home_team_id,
    fixture.away_team_id,
    config,
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
