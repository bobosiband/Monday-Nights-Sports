// -----------------------------------------------------------------------------
// events/validate-body.ts
//
// Pure body validators for every write route on `events`. Extracting them
// here keeps the HTTP handlers thin and lets the tests hit every failure
// mode without a request object or a Supabase client.
//
// Every function returns a discriminated union:
//   { ok: true, value } — validated shape ready to hand to the DB layer.
//   { ok: false, error } — human-readable message, straight into a 400.
//
// The convention matches `scoring/validate-event.ts` so future readers
// can pattern-match one style across the whole codebase.
// -----------------------------------------------------------------------------

import { isUuid, nonEmptyString } from "../_shared/validate.ts";

/** Ok branch of a validated body. */
export interface Ok<T> {
  ok: true;
  value: T;
}

/** Failure branch — `error` becomes the 400 body. */
export interface Err {
  ok: false;
  error: string;
}

// ---------------------------------------------------------------------------
// Common primitives
// ---------------------------------------------------------------------------

/**
 * ISO date (YYYY-MM-DD) validator. Postgres `date` accepts more but the
 * API contract stays narrow so payloads are unambiguous across timezones.
 *
 * @param value - Any value.
 * @returns The date string if valid, otherwise `null`.
 */
export function isoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : value;
}

/**
 * `HH:MM` or `HH:MM:SS` time-of-day validator, matching the `time` column
 * on `slots`. Rejects timezone suffixes — the schema is naive time.
 *
 * @param value - Any value.
 * @returns The normalised `HH:MM:SS` string, or `null`.
 */
export function timeOfDay(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = value.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  const s = m[3] !== undefined ? Number(m[3]) : 0;
  if (h > 23 || min > 59 || s > 59) return null;
  return `${m[1]}:${m[2]}:${m[3] ?? "00"}`;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/** Validated create-event body. */
export interface CreateEventValue {
  season_id: string;
  event_date: string;
}

/** Raw create-event body — every field untyped for validation. */
export interface CreateEventBody {
  season_id?: unknown;
  event_date?: unknown;
}

/**
 * Validate a `POST /events` body.
 *
 * @param body - Parsed JSON body, or `null`.
 * @returns Ok with the validated fields, or Err with a message.
 */
export function validateCreateEvent(
  body: CreateEventBody | null,
): Ok<CreateEventValue> | Err {
  if (!body) return { ok: false, error: "Request body must be JSON" };
  if (!isUuid(body.season_id)) {
    return { ok: false, error: "season_id must be a uuid" };
  }
  const event_date = isoDate(body.event_date);
  if (!event_date) {
    return { ok: false, error: "event_date must be YYYY-MM-DD" };
  }
  return { ok: true, value: { season_id: body.season_id, event_date } };
}

/** Raw update-event body — only `event_date` is currently updatable. */
export interface UpdateEventBody {
  event_date?: unknown;
}

/**
 * Validate a `PATCH /events/:id` body. Only `event_date` is updatable —
 * changing `season_id` post-hoc would silently break RLS joins, and there
 * is no reason to move an event between seasons in normal operation.
 *
 * @param body - Parsed JSON body, or `null`.
 * @returns Ok with a sparse patch, or Err.
 */
export function validateUpdateEvent(
  body: UpdateEventBody | null,
): Ok<{ event_date: string }> | Err {
  if (!body) return { ok: false, error: "Request body must be JSON" };
  const event_date = isoDate(body.event_date);
  if (!event_date) {
    return { ok: false, error: "event_date must be YYYY-MM-DD" };
  }
  return { ok: true, value: { event_date } };
}

// ---------------------------------------------------------------------------
// Slots
// ---------------------------------------------------------------------------

/** Validated create-slot body. */
export interface CreateSlotValue {
  slot_number: number;
  starts_at: string;
  pitch: string | null;
}

/** Raw create-slot body. */
export interface CreateSlotBody {
  slot_number?: unknown;
  starts_at?: unknown;
  pitch?: unknown;
}

/**
 * Validate a `POST /events/:id/slots` body.
 *
 * @param body - Parsed JSON body, or `null`.
 * @returns Ok with the validated fields, or Err.
 */
export function validateCreateSlot(
  body: CreateSlotBody | null,
): Ok<CreateSlotValue> | Err {
  if (!body) return { ok: false, error: "Request body must be JSON" };
  if (
    typeof body.slot_number !== "number" ||
    !Number.isInteger(body.slot_number) ||
    body.slot_number <= 0
  ) {
    return { ok: false, error: "slot_number must be a positive integer" };
  }
  const starts_at = timeOfDay(body.starts_at);
  if (!starts_at) {
    return { ok: false, error: "starts_at must be HH:MM or HH:MM:SS" };
  }
  const pitch = body.pitch === undefined || body.pitch === null
    ? null
    : nonEmptyString(body.pitch, 80);
  if (body.pitch !== undefined && body.pitch !== null && pitch === null) {
    return {
      ok: false,
      error: "pitch, if present, must be a non-empty string",
    };
  }
  return {
    ok: true,
    value: { slot_number: body.slot_number, starts_at, pitch },
  };
}

/** Raw update-slot body — every field optional (sparse PATCH). */
export interface UpdateSlotBody {
  slot_number?: unknown;
  starts_at?: unknown;
  pitch?: unknown;
}

/**
 * Validate a `PATCH /events/:id/slots/:slotId` body. Every field is
 * optional; `pitch: null` explicitly clears it.
 *
 * @param body - Parsed JSON body, or `null`.
 * @returns Ok with the sparse patch, or Err.
 */
export function validateUpdateSlot(
  body: UpdateSlotBody | null,
): Ok<Record<string, unknown>> | Err {
  if (!body) return { ok: false, error: "Request body must be JSON" };
  const patch: Record<string, unknown> = {};

  if (body.slot_number !== undefined) {
    if (
      typeof body.slot_number !== "number" ||
      !Number.isInteger(body.slot_number) ||
      body.slot_number <= 0
    ) {
      return { ok: false, error: "slot_number must be a positive integer" };
    }
    patch.slot_number = body.slot_number;
  }
  if (body.starts_at !== undefined) {
    const s = timeOfDay(body.starts_at);
    if (!s) return { ok: false, error: "starts_at must be HH:MM or HH:MM:SS" };
    patch.starts_at = s;
  }
  if (body.pitch !== undefined) {
    if (body.pitch === null) {
      patch.pitch = null;
    } else {
      const p = nonEmptyString(body.pitch, 80);
      if (!p) return { ok: false, error: "pitch must be a non-empty string" };
      patch.pitch = p;
    }
  }
  if (Object.keys(patch).length === 0) {
    return { ok: false, error: "No updatable fields provided" };
  }
  return { ok: true, value: patch };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Validated create-fixture body. */
export interface CreateFixtureValue {
  slot_id: string;
  sport: string;
  home_team_id: string;
  away_team_id: string | null;
}

/** Raw create-fixture body. */
export interface CreateFixtureBody {
  slot_id?: unknown;
  sport?: unknown;
  home_team_id?: unknown;
  away_team_id?: unknown;
}

/**
 * Validate a `POST /events/:id/fixtures` body. Cross-field checks against
 * the season (sport ∈ seasons.sports, teams ∈ season) live in the handler
 * because they need DB reads; this function only checks the shape.
 *
 * @param body - Parsed JSON body, or `null`.
 * @returns Ok with the validated fields, or Err.
 */
export function validateCreateFixture(
  body: CreateFixtureBody | null,
): Ok<CreateFixtureValue> | Err {
  if (!body) return { ok: false, error: "Request body must be JSON" };
  if (!isUuid(body.slot_id)) {
    return { ok: false, error: "slot_id must be a uuid" };
  }
  const sport = nonEmptyString(body.sport, 60);
  if (!sport) return { ok: false, error: "sport must be a non-empty string" };
  if (!isUuid(body.home_team_id)) {
    return { ok: false, error: "home_team_id must be a uuid" };
  }
  let away_team_id: string | null = null;
  if (body.away_team_id !== undefined && body.away_team_id !== null) {
    if (!isUuid(body.away_team_id)) {
      return {
        ok: false,
        error: "away_team_id must be a uuid, null, or omitted (bye)",
      };
    }
    away_team_id = body.away_team_id;
  }
  if (away_team_id !== null && away_team_id === body.home_team_id) {
    return {
      ok: false,
      error: "home_team_id and away_team_id must be different",
    };
  }
  return {
    ok: true,
    value: {
      slot_id: body.slot_id,
      sport,
      home_team_id: body.home_team_id,
      away_team_id,
    },
  };
}

/** Raw update-fixture body — every field optional. */
export interface UpdateFixtureBody {
  slot_id?: unknown;
  sport?: unknown;
  home_team_id?: unknown;
  away_team_id?: unknown;
  status?: unknown;
}

/** Fixture statuses the organiser is allowed to set via PATCH. */
const PATCHABLE_STATUSES = new Set(["scheduled", "cancelled"]);

/**
 * Validate a `PATCH /events/:id/fixtures/:fid` body.
 *
 * Only `scheduled` and `cancelled` are valid via this route — `live` and
 * `complete` are transitions owned by the scoring service, and letting an
 * organiser flip them by hand here would let them "un-complete" a
 * finalised match without going through the audit trail.
 *
 * `away_team_id: null` explicitly turns the fixture into a bye. The
 * home/away distinctness check lives here to catch the case where the
 * caller PATCHes both to the same id in one request.
 *
 * @param body - Parsed JSON body, or `null`.
 * @returns Ok with the sparse patch, or Err.
 */
export function validateUpdateFixture(
  body: UpdateFixtureBody | null,
): Ok<Record<string, unknown>> | Err {
  if (!body) return { ok: false, error: "Request body must be JSON" };
  const patch: Record<string, unknown> = {};

  if (body.slot_id !== undefined) {
    if (!isUuid(body.slot_id)) {
      return { ok: false, error: "slot_id must be a uuid" };
    }
    patch.slot_id = body.slot_id;
  }
  if (body.sport !== undefined) {
    const sport = nonEmptyString(body.sport, 60);
    if (!sport) {
      return { ok: false, error: "sport must be a non-empty string" };
    }
    patch.sport = sport;
  }
  if (body.home_team_id !== undefined) {
    if (!isUuid(body.home_team_id)) {
      return { ok: false, error: "home_team_id must be a uuid" };
    }
    patch.home_team_id = body.home_team_id;
  }
  if (body.away_team_id !== undefined) {
    if (body.away_team_id === null) {
      patch.away_team_id = null;
    } else if (!isUuid(body.away_team_id)) {
      return {
        ok: false,
        error: "away_team_id must be a uuid or null (bye)",
      };
    } else {
      patch.away_team_id = body.away_team_id;
    }
  }
  if (body.status !== undefined) {
    if (
      typeof body.status !== "string" ||
      !PATCHABLE_STATUSES.has(body.status)
    ) {
      return {
        ok: false,
        error: "status may only be set to 'scheduled' or 'cancelled' here " +
          "(live/complete are managed by the scoring service)",
      };
    }
    patch.status = body.status;
  }

  // Home/away distinctness across the sparse patch: if either side is being
  // changed, the resulting pair must differ. We can only fully verify this
  // when both are present in the patch; when only one is present the handler
  // will re-check against the persisted row.
  if (
    patch.home_team_id !== undefined &&
    patch.away_team_id !== undefined &&
    patch.away_team_id !== null &&
    patch.home_team_id === patch.away_team_id
  ) {
    return {
      ok: false,
      error: "home_team_id and away_team_id must be different",
    };
  }

  if (Object.keys(patch).length === 0) {
    return { ok: false, error: "No updatable fields provided" };
  }
  return { ok: true, value: patch };
}

// ---------------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------------

/** Validated generate-draw body. */
export interface GenerateValue {
  sport: string;
  team_ids: string[];
  slot_ids: string[];
}

/** Raw generate-draw body. */
export interface GenerateBody {
  sport?: unknown;
  team_ids?: unknown;
  slot_ids?: unknown;
}

/**
 * Validate a `POST /events/:id/generate` body.
 *
 * Team-membership and sport-membership checks against the season live in
 * the handler; this validates shape only. `team_ids` must be unique — the
 * round-robin generator would silently produce a nonsense draw otherwise.
 *
 * @param body - Parsed JSON body, or `null`.
 * @returns Ok with the validated fields, or Err.
 */
export function validateGenerate(
  body: GenerateBody | null,
): Ok<GenerateValue> | Err {
  if (!body) return { ok: false, error: "Request body must be JSON" };
  const sport = nonEmptyString(body.sport, 60);
  if (!sport) return { ok: false, error: "sport must be a non-empty string" };

  if (!Array.isArray(body.team_ids) || body.team_ids.length < 2) {
    return {
      ok: false,
      error: "team_ids must be an array of at least 2 uuids",
    };
  }
  const teamIds: string[] = [];
  const seenTeams = new Set<string>();
  for (const t of body.team_ids) {
    if (!isUuid(t)) {
      return { ok: false, error: "team_ids entries must all be uuids" };
    }
    if (seenTeams.has(t)) {
      return { ok: false, error: "team_ids must not contain duplicates" };
    }
    seenTeams.add(t);
    teamIds.push(t);
  }

  if (!Array.isArray(body.slot_ids) || body.slot_ids.length === 0) {
    return { ok: false, error: "slot_ids must be a non-empty array of uuids" };
  }
  const slotIds: string[] = [];
  const seenSlots = new Set<string>();
  for (const s of body.slot_ids) {
    if (!isUuid(s)) {
      return { ok: false, error: "slot_ids entries must all be uuids" };
    }
    if (seenSlots.has(s)) {
      return { ok: false, error: "slot_ids must not contain duplicates" };
    }
    seenSlots.add(s);
    slotIds.push(s);
  }

  return { ok: true, value: { sport, team_ids: teamIds, slot_ids: slotIds } };
}
