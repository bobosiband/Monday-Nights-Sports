// -----------------------------------------------------------------------------
// seasons/validation/SeasonBodyValidator.ts
//
// Request-body validation for the seasons service. Pure, no I/O: these
// functions turn an untyped JSON blob into either a typed value or a
// human-readable error string suitable for a 400 response.
// -----------------------------------------------------------------------------

import { nonEmptyString } from "../lib/InputValidation.ts";
import type {
  CreateSeasonInput,
  UpdateSeasonPatch,
} from "../data/SeasonsRepository.ts";

/** Loose shape of a create-season request body. */
export interface CreateSeasonBody {
  name?: unknown;
  sports?: unknown;
  starts_on?: unknown;
  ends_on?: unknown;
  is_active?: unknown;
}

/** Loose shape of an update-season request body. */
export interface UpdateSeasonBody {
  name?: unknown;
  sports?: unknown;
  starts_on?: unknown;
  ends_on?: unknown;
}

/** Discriminated-union result returned by every validator in this file. */
export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

/**
 * ISO date (YYYY-MM-DD) validator. The Postgres `date` type accepts more
 * than this but constraining the API keeps request payloads unambiguous.
 *
 * @param value - Any value.
 * @returns The date string if valid, otherwise `null`.
 */
function isoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : value;
}

/**
 * Validate a create-season payload.
 *
 * @param body - Parsed JSON body (or `null`).
 * @returns Either the validated value, or an error message.
 */
export function validateCreate(
  body: CreateSeasonBody | null,
): ValidationResult<CreateSeasonInput> {
  if (!body) return { ok: false, error: "Request body must be JSON" };

  const name = nonEmptyString(body.name);
  if (!name) return { ok: false, error: "name is required" };

  if (!Array.isArray(body.sports) || body.sports.length === 0) {
    return { ok: false, error: "sports must be a non-empty array of strings" };
  }
  const sports: string[] = [];
  for (const s of body.sports) {
    const cleaned = nonEmptyString(s, 60);
    if (!cleaned) {
      return { ok: false, error: "sports entries must be non-empty strings" };
    }
    sports.push(cleaned);
  }

  const starts_on = isoDate(body.starts_on);
  if (!starts_on) return { ok: false, error: "starts_on must be YYYY-MM-DD" };
  const ends_on = isoDate(body.ends_on);
  if (!ends_on) return { ok: false, error: "ends_on must be YYYY-MM-DD" };
  if (ends_on < starts_on) {
    return { ok: false, error: "ends_on must be on or after starts_on" };
  }

  const is_active = typeof body.is_active === "boolean"
    ? body.is_active
    : false;

  return { ok: true, value: { name, sports, starts_on, ends_on, is_active } };
}

/**
 * Validate an update-season payload. Returns a sparse patch containing only
 * the keys the caller supplied; unknown or unchanged fields are omitted so
 * Postgres leaves them alone.
 *
 * @param body - Parsed JSON body (or `null`).
 * @returns Either the validated patch, or an error message.
 */
export function validateUpdate(
  body: UpdateSeasonBody | null,
): ValidationResult<UpdateSeasonPatch> {
  if (!body) return { ok: false, error: "Request body must be JSON" };
  const patch: UpdateSeasonPatch = {};

  if (body.name !== undefined) {
    const name = nonEmptyString(body.name);
    if (!name) return { ok: false, error: "name must be a non-empty string" };
    patch.name = name;
  }

  if (body.sports !== undefined) {
    if (!Array.isArray(body.sports) || body.sports.length === 0) {
      return {
        ok: false,
        error: "sports must be a non-empty array of strings",
      };
    }
    const sports: string[] = [];
    for (const s of body.sports) {
      const cleaned = nonEmptyString(s, 60);
      if (!cleaned) {
        return {
          ok: false,
          error: "sports entries must be non-empty strings",
        };
      }
      sports.push(cleaned);
    }
    patch.sports = sports;
  }

  if (body.starts_on !== undefined) {
    const v = isoDate(body.starts_on);
    if (!v) return { ok: false, error: "starts_on must be YYYY-MM-DD" };
    patch.starts_on = v;
  }
  if (body.ends_on !== undefined) {
    const v = isoDate(body.ends_on);
    if (!v) return { ok: false, error: "ends_on must be YYYY-MM-DD" };
    patch.ends_on = v;
  }

  if (Object.keys(patch).length === 0) {
    return { ok: false, error: "No updatable fields provided" };
  }

  return { ok: true, value: patch };
}
