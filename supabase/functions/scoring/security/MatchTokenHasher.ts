// -----------------------------------------------------------------------------
// scoring/security/MatchTokenHasher.ts
//
// CONTRACT (match-access <-> scoring). The normalise-and-hash logic in this
// file is a two-service contract: `match-access` mints the raw code and
// stores its hash, and `scoring` reads the typed code, normalises and
// hashes it on the verify side. The two implementations must agree
// byte-for-byte: a single difference in whitespace stripping or case
// handling leaks silently as a 403 for an otherwise-valid operator.
//
// Both services carry their own copy of the normaliser and the hasher. The
// test vector pinned in `tests/scoring/MatchTokenHasher.test.ts` and
// `tests/match-access/MatchTokenHasher.test.ts` must match. If you change
// this file, update the twin in `supabase/functions/match-access/security/
// MatchTokenHasher.ts` and the pinned test vector in both test files.
// -----------------------------------------------------------------------------

/**
 * Normalise a raw match-code input into its canonical form:
 *   - Uppercase (users may type either case).
 *   - Strip ASCII whitespace, hyphens, and underscores (some UIs will
 *     format the code as `ABCD-EFGH` for readability).
 *
 * @param input - The raw string from the request header.
 * @returns The canonical uppercase, separator-free form.
 */
export function normaliseMatchCode(input: string): string {
  return input.replace(/[\s\-_]+/g, "").toUpperCase();
}

/**
 * SHA-256 hex of the normalised code. Uses Web Crypto, no dependencies.
 *
 * @param code - The raw code as typed by the operator. Normalised
 *               internally before hashing so the caller does not have
 *               to remember the order.
 * @returns Lowercase hex string, 64 chars long.
 */
export async function hashMatchCode(code: string): Promise<string> {
  const normalised = normaliseMatchCode(code);
  const bytes = new TextEncoder().encode(normalised);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return bytesToHex(new Uint8Array(digest));
}

/**
 * Pull the raw bearer value off an `Authorization: Bearer <value>` header.
 * Returns `null` for missing or malformed headers so the caller can
 * respond with a clean 401.
 *
 * Header lookup is case-insensitive per the spec; the explicit lowercase
 * avoids depending on that quirk.
 *
 * @param request - The incoming request.
 * @returns The bearer value (never trimmed to empty), or `null`.
 */
export function extractBearer(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const trimmed = header.trim();
  if (!trimmed.toLowerCase().startsWith("bearer ")) return null;
  const value = trimmed.slice("bearer ".length).trim();
  return value.length > 0 ? value : null;
}

/**
 * Encode a byte buffer as lowercase hex.
 *
 * @param bytes - Bytes to encode.
 * @returns Hex string (lowercase, no separators).
 */
function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}
