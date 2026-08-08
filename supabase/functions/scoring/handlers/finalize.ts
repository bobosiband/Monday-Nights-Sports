// -----------------------------------------------------------------------------
// scoring/handlers/finalize.ts
//
// POST /:fixtureId/finalize — snapshot the derived score + period breakdown
// into `results` and mark the fixture complete. This is the moment where
// standings/archive queries stop needing to re-fold the event log.
//
// Refuses to finalize an already-complete fixture unless the body sets
// `reopen: true` (organiser correction path).
// -----------------------------------------------------------------------------

import { readJson } from "../../_shared/validate.ts";
import { jsonResponse } from "../../_shared/cors.ts";
import { badRequest, conflict } from "../../_shared/errors.ts";
import { DECIDED_BY, type DecidedBy, FIXTURE_STATUS } from "../constants.ts";
import {
  client,
  loadEvents,
  loadSportConfig,
  updateFixtureStatus,
  upsertResult,
} from "../db.ts";
import { deriveScore } from "../../_shared/score.ts";
import { writeLiveState } from "../derive.ts";
import { buildPeriodBreakdown } from "../period-breakdown.ts";
import type {
  FinalizeBody,
  FinalizeResponse,
  FixtureContext,
  MatchAccessContext,
} from "../types.ts";

/**
 * Snapshot the final score + period breakdown for a fixture and mark it
 * complete. Idempotent-ish: re-finalizing a complete fixture requires
 * `reopen: true` on the body, to prevent an errant client from
 * accidentally overwriting a corrected result.
 *
 * @param request - The incoming request; JSON body: `FinalizeBody`
 *                  (optional).
 * @param fixture - The pre-loaded fixture context.
 * @param _access - Verified match-access context; unused today but passed
 *                  in for future operator attribution on results.
 * @returns `FinalizeResponse` on success; 400 on bad body; 409 when the
 *          fixture is already complete without reopen, or cancelled.
 */
export async function handleFinalize(
  request: Request,
  fixture: FixtureContext,
  _access: MatchAccessContext,
): Promise<Response> {
  const body = await readJson<FinalizeBody>(request);
  const decidedBy = resolveDecidedBy(body?.decided_by);
  if (decidedBy === "invalid") {
    return badRequest("decided_by must be one of: normal, penalties, forfeit");
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

  const supabase = client();
  const [events, config] = await Promise.all([
    loadEvents(supabase, fixture.id),
    loadSportConfig(supabase, fixture.season_id, fixture.sport),
  ]);

  const derived = deriveScore(
    events,
    fixture.home_team_id,
    fixture.away_team_id,
    config,
  );
  const periods = buildPeriodBreakdown(
    events,
    fixture.home_team_id,
    fixture.away_team_id,
  );

  // Persist the snapshot before flipping status so a race that observes
  // "complete" without a results row is impossible.
  // TODO: attribute `confirmed_by` to `_access.access_id` once results has
  // an `operator_access_id` column (confirmed_by references auth.users).
  await upsertResult(
    supabase,
    fixture.id,
    derived.home,
    derived.away,
    periods,
    decidedBy,
    null,
  );
  await updateFixtureStatus(supabase, fixture.id, FIXTURE_STATUS.complete);

  // Mirror the snapshot into fixture_live_state so viewers (subscribed to
  // that table over Realtime) transition to `complete` in the same tick.
  // Non-fatal per the projection contract in derive.ts.
  let lastEventAt: string | null = null;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].voided_at === null) {
      lastEventAt = events[i].created_at;
      break;
    }
  }
  await writeLiveState(
    supabase,
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

/**
 * Coerce the raw `decided_by` field. Defaults to `'normal'` when the field
 * is omitted; returns `"invalid"` when the value isn't one of the
 * accepted strings.
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
