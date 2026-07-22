// -----------------------------------------------------------------------------
// scoring/validate-event.ts
//
// Pure validation for the record-event request body. Kept separate from
// `handlers/events.ts` so it can be unit-tested without a Supabase client.
// -----------------------------------------------------------------------------

import { isUuid, nonNegativeInt } from "../_shared/validate.ts";
import { GENERIC_EVENT_TYPES } from "./constants.ts";
import type {
  FixtureContext,
  MatchEventType,
  RecordEventBody,
  SportConfig,
} from "./types.ts";

export interface ValidatedEvent {
  id: string;
  type: MatchEventType;
  team_id: string | null;
  player_id: string | null;
  value: number | null;
  period: number | null;
  match_clock_ms: number | null;
}

export type ValidationResult =
  | { ok: true; value: ValidatedEvent }
  | { ok: false; error: string };

/**
 * Validate a record-event request body against the schema and against the
 * fixture context (team ids must match the fixture; score values must be
 * an allowed increment for the sport).
 *
 * Rules:
 * - `id` must be a UUID (client-supplied for idempotency).
 * - `type` must be one of the generic types (score, foul, card, timeout,
 *   note). period_start / period_end go through /period.
 * - `team_id` — required for score/foul/card/timeout; optional for note.
 *   When present it must be either the home or away team of the fixture.
 * - `value` — required and > 0 for score/card; must appear in
 *   `sport_config.score_increments` for score (only when the config
 *   declares increments; unconfigured sports accept any positive int).
 * - `player_id`, `period`, `match_clock_ms` — optional; when present must
 *   have the right shape.
 *
 * @param body - The parsed JSON body (possibly null).
 * @param fixture - Fixture context (used to check team_id membership).
 * @param config - Sport config (used to check score increments).
 * @returns Either the validated event or an error message.
 */
export function validateRecordBody(
  body: RecordEventBody | null,
  fixture: FixtureContext,
  config: SportConfig,
): ValidationResult {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Request body must be JSON" };
  }

  if (!isUuid(body.id)) {
    return { ok: false, error: "id must be a client-supplied UUID" };
  }

  if (typeof body.type !== "string" || !isGenericType(body.type)) {
    return {
      ok: false,
      error:
        "type must be one of: " + GENERIC_EVENT_TYPES.join(", ") +
        " (period_start/period_end go through /period)",
    };
  }
  const type = body.type as MatchEventType;

  const teamId = validateTeamId(body.team_id, fixture, type);
  if (teamId === "invalid") {
    return { ok: false, error: "team_id must be null or match the fixture's home/away team" };
  }
  if (teamId === "required") {
    return { ok: false, error: `team_id is required for ${type} events` };
  }

  const playerId = body.player_id ?? null;
  if (playerId !== null && !isUuid(playerId)) {
    return { ok: false, error: "player_id must be a UUID or null" };
  }

  const period = body.period === undefined || body.period === null
    ? null
    : nonNegativeInt(body.period);
  if (body.period !== undefined && body.period !== null && period === null) {
    return { ok: false, error: "period must be a non-negative integer" };
  }

  const clock = body.match_clock_ms === undefined || body.match_clock_ms === null
    ? null
    : nonNegativeInt(body.match_clock_ms);
  if (
    body.match_clock_ms !== undefined && body.match_clock_ms !== null &&
    clock === null
  ) {
    return { ok: false, error: "match_clock_ms must be a non-negative integer" };
  }

  const valueResult = validateValue(body.value, type, config);
  if (!valueResult.ok) return valueResult;

  return {
    ok: true,
    value: {
      id: body.id as string,
      type,
      team_id: teamId,
      player_id: playerId as string | null,
      value: valueResult.value,
      period,
      match_clock_ms: clock,
    },
  };
}

/**
 * Runtime check that a string is one of the generic event types.
 *
 * @param value - Candidate string.
 * @returns `true` if the string is accepted by the events route.
 */
function isGenericType(value: string): boolean {
  return (GENERIC_EVENT_TYPES as readonly string[]).includes(value);
}

/**
 * Validate `team_id` against the fixture. Score/foul/card/timeout require a
 * team; note accepts null.
 *
 * @returns The validated team id (string or null), or `"invalid"` / `"required"`.
 */
function validateTeamId(
  raw: unknown,
  fixture: FixtureContext,
  type: MatchEventType,
): string | null | "invalid" | "required" {
  const optional = type === "note";
  if (raw === null || raw === undefined) {
    return optional ? null : "required";
  }
  if (typeof raw !== "string" || !isUuid(raw)) return "invalid";
  if (raw !== fixture.home_team_id && raw !== fixture.away_team_id) {
    return "invalid";
  }
  return raw;
}

/**
 * Validate the `value` field per event type. Rules:
 * - score: positive int; must be in sport_config.score_increments if the
 *   config declares any (unconfigured sports accept any positive int).
 * - card: positive int (severity — the fold does not read it, but writes
 *   without a value would lose intent).
 * - foul: null accepted (a foul is a count, not a value).
 * - timeout / note: value is optional; ignored if present.
 *
 * @returns Either the resolved value or an error message.
 */
function validateValue(
  raw: unknown,
  type: MatchEventType,
  config: SportConfig,
): { ok: true; value: number | null } | { ok: false; error: string } {
  if (type === "score") {
    if (typeof raw !== "number" || !Number.isInteger(raw) || raw <= 0) {
      return { ok: false, error: "value must be a positive integer for score events" };
    }
    const allowed = config.score_increments;
    if (Array.isArray(allowed) && allowed.length > 0 && !allowed.includes(raw)) {
      return {
        ok: false,
        error: `value ${raw} is not an allowed score increment (${allowed.join(", ")})`,
      };
    }
    return { ok: true, value: raw };
  }

  if (type === "card") {
    if (typeof raw !== "number" || !Number.isInteger(raw) || raw <= 0) {
      return { ok: false, error: "value must be a positive integer for card events (severity)" };
    }
    return { ok: true, value: raw };
  }

  // foul / timeout / note: value is not required.
  return { ok: true, value: null };
}
