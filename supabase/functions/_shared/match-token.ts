// -----------------------------------------------------------------------------
// _shared/match-token.ts
//
// Operator match-code primitive. A "match code" is an opaque, human-typable
// string minted by an organiser and typed by a sideline scorer into their
// device. The raw code is a bearer secret: it is returned exactly once at
// mint time and never persisted server-side — only its SHA-256 hash lives
// in the `match_access` table, which the scoring guard looks up on every
// write.
//
// This module is intentionally pure crypto + string handling. It has no DB
// access and no network access, so it is trivially unit-testable and can
// be reused by both the mint path (match-access) and the verify path
// (scoring/guard.ts). The DB read/write lives with those services.
//
// The switch from a signed JWT (see ADR 0001) to an opaque-code table was
// made deliberately — see docs/decisions/0002-operator-access-model-v2.md.
// Short version: an organiser must be able to pull a leaked code back
// before its natural expiry, and a stateless JWT can't offer that without
// a revocation list — at which point the JWT layer is dead weight.
//
// Exports:
//   MATCH_CODE_ALPHABET       — the characters a generated code may use
//   MATCH_CODE_LENGTH         — 8 characters (default)
//   generateMatchCode()       — cryptographically-random human-typable code
//   normaliseMatchCode(input) — canonical form (uppercase, no dashes/space)
//   hashMatchCode(code)       — SHA-256 hex of the normalised code
//   extractBearer(request)    — pull the raw bearer value off a Request
// -----------------------------------------------------------------------------

/**
 * Alphabet used by `generateMatchCode`. Crockford-style base32 with the
 * ambiguous letters removed:
 *   - I / L look like 1
 *   - O   looks like 0
 *   - U   omitted so a code can't accidentally spell something offensive
 * The remaining 30 characters are safe to read aloud across a noisy pitch.
 */
export const MATCH_CODE_ALPHABET =
  "0123456789ABCDEFGHJKMNPQRSTVWXYZ".replaceAll("U", "");
// After the replace the string is 31 chars (0-9 + 22 letters). We reject-
// sample from that pool to keep the distribution uniform. See generate().

/** Default length of a generated code. Short enough to type in a hurry. */
export const MATCH_CODE_LENGTH = 8;

/**
 * Generate a fresh match code. Uniformly random over `MATCH_CODE_ALPHABET`
 * via rejection sampling — a modulo-bias approach would slightly favour
 * lower-indexed characters, which is not acceptable for a credential.
 *
 * Uses `crypto.getRandomValues` (Web Crypto), which is available in Deno
 * and every modern runtime. Refills the entropy buffer as needed so we
 * never block on a single small read.
 *
 * @param length - How many characters. Defaults to `MATCH_CODE_LENGTH`.
 * @returns The generated code, upper-case, no separators.
 */
export function generateMatchCode(length = MATCH_CODE_LENGTH): string {
  if (!Number.isInteger(length) || length <= 0) {
    throw new Error(`length must be a positive integer; got ${length}`);
  }

  const alphabet = MATCH_CODE_ALPHABET;
  const n = alphabet.length;
  // The largest multiple of `n` that fits in a byte. Bytes above it are
  // rejected to keep the sampling uniform (otherwise the low residues get
  // picked slightly more often — the classic modulo-bias hazard).
  const cap = 256 - (256 % n);

  const out: string[] = [];
  // Draw entropy in reasonably large chunks so we don't hit the CSPRNG
  // once per character. 4× the requested length is comfortable slack for
  // rejection sampling — with n=31 the rejection rate is ~3%.
  const buf = new Uint8Array(length * 4);
  crypto.getRandomValues(buf);
  let idx = 0;

  while (out.length < length) {
    if (idx >= buf.length) {
      crypto.getRandomValues(buf);
      idx = 0;
    }
    const byte = buf[idx++];
    if (byte < cap) {
      out.push(alphabet[byte % n]);
    }
  }
  return out.join("");
}

/**
 * Normalise a raw match-code input into its canonical form:
 *
 *   - Uppercase (users may type either case).
 *   - Strip ASCII whitespace, hyphens, and underscores (some UIs will
 *     format the code as `ABCD-EFGH` for readability).
 *
 * Verification hashes the normalised form so that `abcd-efgh` and
 * `ABCDEFGH` map to the same code_hash. Do NOT accept anything other
 * than the alphabet above at this layer — that's the callers' job (mint
 * only ever emits `MATCH_CODE_ALPHABET`, verify runs a lookup and either
 * finds a row or doesn't).
 *
 * @param input - The raw string from the request header or form field.
 * @returns The canonical uppercase, separator-free form.
 */
export function normaliseMatchCode(input: string): string {
  return input.replace(/[\s\-_]+/g, "").toUpperCase();
}

/**
 * SHA-256 hex of the normalised code. Uses Web Crypto — no dependencies.
 *
 * @param code - The raw code as typed by the operator. Normalised
 *               internally before hashing so the caller doesn't have to
 *               remember the order.
 * @returns Lowercase hex string, 64 chars long.
 */
export async function hashMatchCode(code: string): Promise<string> {
  const normalised = normaliseMatchCode(code);
  const bytes = new TextEncoder().encode(normalised);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return bytesToHex(new Uint8Array(digest));
}

/**
 * Pull the raw bearer value out of an `Authorization: Bearer <value>`
 * header. Returns `null` for missing / malformed headers so the caller
 * can respond with a clean 401.
 *
 * Header lookup is case-insensitive per the spec; `Headers.get` is too,
 * but the explicit lowercase avoids depending on that quirk.
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
 * Encode a byte buffer as lowercase hex. Small local helper so this
 * module has no dependency on Deno std.
 *
 * @param bytes - Bytes to encode.
 * @returns Hex string (lowercase, no separators).
 */
function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}
