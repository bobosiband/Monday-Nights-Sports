// -----------------------------------------------------------------------------
// match-access/security/MatchTokenHasher.ts
//
// CONTRACT (match-access <-> scoring). The normalise-and-hash logic in this
// file is a two-service contract: `match-access` mints the raw code and
// stores its hash here, and `scoring` reads the typed code, normalises
// and hashes it on the verify side. The two implementations must agree
// byte-for-byte: a single difference in whitespace stripping or case
// handling leaks silently as a 403 for an otherwise-valid operator.
//
// Both services carry their own copy of the normaliser and the hasher. The
// test vector pinned in `tests/match-access/MatchTokenHasher.test.ts` and
// `tests/scoring/MatchTokenHasher.test.ts` must match. If you change this
// file, update the twin in `supabase/functions/scoring/security/
// MatchTokenHasher.ts` and the pinned test vector in both test files.
//
// The switch from a signed JWT (ADR 0001) to an opaque code table was made
// deliberately: see `docs/decisions/0002-operator-access-model-v2.md`.
// -----------------------------------------------------------------------------

/**
 * Alphabet used by `generateMatchCode`. Crockford-style base32 with the
 * ambiguous letters removed:
 *   - I / L look like 1
 *   - O   looks like 0
 *   - U   omitted so a code cannot accidentally spell something offensive
 * The remaining 30 characters are safe to read aloud across a noisy pitch.
 */
export const MATCH_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
  .replaceAll("U", "");

/** Default length of a generated code. Short enough to type in a hurry. */
export const MATCH_CODE_LENGTH = 8;

/**
 * Generate a fresh match code. Uniformly random over `MATCH_CODE_ALPHABET`
 * via rejection sampling: a modulo-bias approach would slightly favour
 * lower-indexed characters, which is not acceptable for a credential.
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
  // Largest multiple of `n` that fits in a byte. Bytes above it are
  // rejected to keep sampling uniform (modulo-bias hazard).
  const cap = 256 - (256 % n);

  const out: string[] = [];
  // Draw entropy in reasonably large chunks so we do not hit the CSPRNG
  // once per character. 4x the requested length is comfortable slack.
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
 *   - Uppercase (users may type either case).
 *   - Strip ASCII whitespace, hyphens, and underscores (some UIs will
 *     format the code as `ABCD-EFGH` for readability).
 *
 * The hasher runs the normaliser internally so `abcd-efgh` and `ABCDEFGH`
 * map to the same `code_hash`.
 *
 * @param input - The raw string.
 * @returns The canonical uppercase, separator-free form.
 */
export function normaliseMatchCode(input: string): string {
  return input.replace(/[\s\-_]+/g, "").toUpperCase();
}

/**
 * SHA-256 hex of the normalised code. Uses Web Crypto, no dependencies.
 *
 * @param code - The raw code. Normalised internally before hashing so the
 *               caller does not have to remember the order.
 * @returns Lowercase hex string, 64 chars long.
 */
export async function hashMatchCode(code: string): Promise<string> {
  const normalised = normaliseMatchCode(code);
  const bytes = new TextEncoder().encode(normalised);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return bytesToHex(new Uint8Array(digest));
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
