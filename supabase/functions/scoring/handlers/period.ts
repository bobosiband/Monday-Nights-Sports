// -----------------------------------------------------------------------------
// scoring/handlers/period.ts
//
// POST /:fixtureId/period — record a `period_start` or `period_end`
// match_event. Guards against ending a period that never opened (or that
// has already been ended).
// -----------------------------------------------------------------------------

import {
  nonNegativeInt,
  positiveInt,
  readJson,
} from "../../_shared/validate.ts";
import { badRequest, conflict } from "../../_shared/errors.ts";
import { FIXTURE_STATUS } from "../constants.ts";
import { client, insertEvent, loadEvents } from "../db.ts";
import { respondDerived } from "../derive.ts";
import { periodIsOpen } from "../period-state.ts";
import type {
  FixtureContext,
  MatchAccessContext,
  PeriodBody,
} from "../types.ts";

type PeriodIntent = "start" | "end";

/**
 * Record a period boundary. Two intents are accepted:
 *
 * - `start` — inserts a `period_start` event. The scoring UI is trusted to
 *   pick the correct period number; the fold tolerates overlapping periods
 *   (the last `period_start` wins), so accidental double-starts don't
 *   corrupt state.
 * - `end`   — inserts a `period_end` event, but only when the target
 *   period has a non-voided `period_start` and no non-voided `period_end`
 *   already. Ending a period that never opened is a client bug we surface
 *   loudly rather than absorbing.
 *
 * @param request - The incoming request; JSON body: `PeriodBody`.
 * @param fixture - The pre-loaded fixture context.
 * @param _access - Verified match-access context; unused today but passed
 *                  in for future operator attribution.
 * @returns The derived summary on success; 400 on bad body; 409 when the
 *          intent contradicts current state.
 */
export async function handlePeriod(
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
  if (period === null) return badRequest("period must be a positive integer");

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

  const supabase = client();
  const events = await loadEvents(supabase, fixture.id);

  if (intent === "end" && !periodIsOpen(events, period)) {
    return conflict(`Period ${period} is not currently open on this fixture`);
  }

  await insertEvent(supabase, {
    id: crypto.randomUUID(),
    fixture_id: fixture.id,
    type: intent === "start" ? "period_start" : "period_end",
    team_id: null,
    player_id: null,
    value: null,
    period,
    match_clock_ms: clock,
    voided_at: null,
    // TODO: attribute to `_access.access_id` once match_events grows an
    // `operator_access_id` column (created_by references auth.users today).
    created_by: null,
  });

  return await respondDerived(supabase, fixture);
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
