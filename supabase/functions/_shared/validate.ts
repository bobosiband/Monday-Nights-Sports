// -----------------------------------------------------------------------------
// _shared/validate.ts
//
// Small, dependency-free input validators shared across Edge Functions.
// Extracted so scoring and any future services don't grow their own copies
// of the same helpers.
// -----------------------------------------------------------------------------

/**
 * Parse a JSON body defensively. Returns `null` for missing bodies and for
 * bodies that fail to parse, so callers can respond with a clean 400 rather
 * than surface a raw SyntaxError.
 *
 * @param request - The incoming request.
 * @returns The parsed body typed as `T`, or `null`.
 */
export async function readJson<T>(request: Request): Promise<T | null> {
  try {
    if (!request.body) return null;
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Non-empty trimmed string validator. Returns the trimmed value if it is a
 * non-empty string within `max` characters, otherwise `null`.
 *
 * @param value - Any value.
 * @param max - Maximum length after trim (default 200).
 * @returns The trimmed string, or `null`.
 */
export function nonEmptyString(value: unknown, max = 200): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

/**
 * UUID (v4-ish) validator. Loose enough to accept any hex-and-dash UUID
 * shape — we only weed out obviously malformed input; the DB still rejects
 * anything the parser will refuse.
 *
 * @param value - Any value.
 * @returns `true` if the string looks like a UUID.
 */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
      .test(value);
}

/**
 * Non-negative integer validator (allows 0). Returns the value as a number
 * on success, otherwise `null`.
 *
 * @param value - Any value.
 * @returns The integer, or `null`.
 */
export function nonNegativeInt(value: unknown): number | null {
  if (typeof value !== "number") return null;
  if (!Number.isInteger(value) || value < 0) return null;
  return value;
}

/**
 * Positive integer validator (rejects 0). Returns the value as a number on
 * success, otherwise `null`.
 *
 * @param value - Any value.
 * @returns The integer, or `null`.
 */
export function positiveInt(value: unknown): number | null {
  const n = nonNegativeInt(value);
  return n === null || n === 0 ? null : n;
}
