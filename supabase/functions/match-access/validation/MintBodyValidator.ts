// -----------------------------------------------------------------------------
// match-access/validation/MintBodyValidator.ts
//
// Pure validation for the mint request body.
// -----------------------------------------------------------------------------

/** Bounds on the caller-supplied TTL (minutes). */
export const TTL_MIN_MINUTES = 15;
export const TTL_MAX_MINUTES = 720;
export const TTL_DEFAULT_MINUTES = 240;

/** Max length of the human label the organiser attaches to a code. */
export const LABEL_MAX_LEN = 80;

/**
 * Resolve the caller-supplied `ttl_minutes` field into a validated integer.
 *
 * @param raw - Any value from the request body.
 * @returns The resolved minute count, or the literal `"invalid"` when the
 *          value is not an integer or is out of range.
 */
export function resolveTtlMinutes(raw: unknown): number | "invalid" {
  if (raw === undefined || raw === null) return TTL_DEFAULT_MINUTES;
  if (typeof raw !== "number" || !Number.isInteger(raw)) return "invalid";
  if (raw < TTL_MIN_MINUTES || raw > TTL_MAX_MINUTES) return "invalid";
  return raw;
}
