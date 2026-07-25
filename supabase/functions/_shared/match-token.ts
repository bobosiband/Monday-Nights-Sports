// -----------------------------------------------------------------------------
// _shared/match-token.ts
//
// Scoped match-token primitive. Per ADR 0001
// (docs/decisions/0001-operator-access-model.md), match tokens are HS256 JWTs
// signed with MATCH_TOKEN_SECRET, plus a `match_access` table used as a
// revocation list keyed by jti.
//
// Exports:
//   MatchTokenClaims / MintedMatchToken           — shared types
//   MATCH_TOKEN_DEFAULT_TTL_SECONDS / …_MAX_…     — bounded TTLs
//   mintMatchToken(fixtureId, ttlSeconds, sub)    — stateless mint (no DB)
//   verifyMatchTokenSignature(token, now?)        — pure crypto + expiry
//   isMatchTokenRevoked(jti)                      — DB revocation lookup
//   verifyMatchToken(request, isRevoked?)         — HTTP guard used by scoring
//
// Uses only Deno's Web Crypto — no third-party JWT library.
// -----------------------------------------------------------------------------

import { createServiceClient } from "./supabase-client.ts";
import { jsonResponse } from "./cors.ts";

/** Default token lifetime (6 hours) — enough for a Monday-night event. */
export const MATCH_TOKEN_DEFAULT_TTL_SECONDS = 6 * 60 * 60;

/** Hard upper bound on TTL (24 hours). Mint refuses anything larger. */
export const MATCH_TOKEN_MAX_TTL_SECONDS = 24 * 60 * 60;

/** JWT `typ` claim; prevents accidental confusion with Supabase Auth JWTs. */
const MATCH_TOKEN_TYPE = "match_token";

export interface MatchTokenClaims {
  fixture_id: string;
  jti: string;
  exp: number; // unix seconds
  iat: number; // unix seconds
  sub: string | null; // organiser user id (audit)
}

export interface MintedMatchToken {
  /** The raw signed JWT — return to the caller ONCE; treat as a bearer secret. */
  token: string;
  /** The token's jti; use this to identify the token for later revocation. */
  id: string;
  /** When the token stops being valid (does not account for revocation). */
  expiresAt: Date;
}

/**
 * Read a required env var or throw with a clear message. Same pattern as
 * `_shared/supabase-client.ts` — failing at boot is much easier to debug
 * than a runtime 500.
 *
 * @param name - Env var name.
 * @returns The env var value.
 */
function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// base64url helpers (RFC 4648 §5). Not exported — internal to this module.
// ---------------------------------------------------------------------------

/**
 * base64url-encode a UTF-8 string.
 *
 * @param input - The string to encode.
 * @returns URL-safe base64 without padding.
 */
function base64UrlEncodeString(input: string): string {
  return base64UrlEncodeBytes(new TextEncoder().encode(input));
}

/**
 * base64url-encode a byte array.
 *
 * @param bytes - The bytes to encode.
 * @returns URL-safe base64 without padding.
 */
function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

/**
 * base64url-decode into a byte array. Throws on invalid input so the caller
 * can turn that into a 401 rather than passing garbage to downstream code.
 *
 * @param input - URL-safe base64 (with or without padding).
 * @returns Decoded bytes.
 */
function base64UrlDecode(input: string): Uint8Array {
  const padded = input.replaceAll("-", "+").replaceAll("_", "/") +
    "=".repeat((4 - (input.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

// ---------------------------------------------------------------------------
// HMAC helpers via Web Crypto.
// ---------------------------------------------------------------------------

/**
 * HMAC-SHA256 sign a message with the given secret.
 *
 * @param secret - Signing secret.
 * @param message - Message to sign.
 * @returns Signature bytes.
 */
async function hmacSign(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  return new Uint8Array(sig);
}

/**
 * Constant-time byte comparison. Prevents a timing side-channel on the
 * signature compare — the naive `===` on typed arrays would short-circuit
 * on the first mismatch, leaking one byte's worth of secret per query.
 *
 * @param a - First buffer.
 * @param b - Second buffer.
 * @returns `true` when the buffers are byte-identical.
 */
function constantTimeEq(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Mint a scoped match token. Stateless: no DB write. The token exists purely
 * by virtue of being a valid signed JWT until `expiresAt` (or until its jti
 * is revoked via `match_access`).
 *
 * @param fixtureId - The fixture id this token authorises writes for.
 * @param ttlSeconds - Token lifetime; refused above
 *                     `MATCH_TOKEN_MAX_TTL_SECONDS`.
 * @param createdBy - Organiser user id that minted this token (recorded in
 *                    the JWT `sub` claim for later audit). Nullable in dev.
 * @returns The signed token, its jti, and its expiry.
 */
export async function mintMatchToken(
  fixtureId: string,
  ttlSeconds: number,
  createdBy: string | null,
): Promise<MintedMatchToken> {
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error(`ttlSeconds must be a positive integer; got ${ttlSeconds}`);
  }
  if (ttlSeconds > MATCH_TOKEN_MAX_TTL_SECONDS) {
    throw new Error(
      `ttlSeconds ${ttlSeconds} exceeds MATCH_TOKEN_MAX_TTL_SECONDS ` +
        `(${MATCH_TOKEN_MAX_TTL_SECONDS})`,
    );
  }

  const secret = requireEnv("MATCH_TOKEN_SECRET");
  const jti = crypto.randomUUID();
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + Math.floor(ttlSeconds);

  const payload = {
    fixture_id: fixtureId,
    jti,
    iat,
    exp,
    sub: createdBy,
    typ: MATCH_TOKEN_TYPE,
  };

  const header = { alg: "HS256", typ: "JWT" };
  const message = base64UrlEncodeString(JSON.stringify(header)) + "." +
    base64UrlEncodeString(JSON.stringify(payload));
  const signature = await hmacSign(secret, message);
  const token = message + "." + base64UrlEncodeBytes(signature);

  return { token, id: jti, expiresAt: new Date(exp * 1000) };
}

/**
 * Verify a match token's signature, structure, and expiry. **Pure** — no DB,
 * no network. `now` defaults to real wall-clock time; tests inject a fixed
 * date to check expiry without sleeping.
 *
 * @param token - The raw JWT string.
 * @param now - Reference time for expiry check. Defaults to `new Date()`.
 * @returns The parsed claims on success, or `{ error }` on failure. The
 *          error string is safe to expose in a 401 body.
 */
export async function verifyMatchTokenSignature(
  token: string,
  now: Date = new Date(),
): Promise<MatchTokenClaims | { error: string }> {
  const parts = token.split(".");
  if (parts.length !== 3) return { error: "Malformed token" };
  const [headerB64, payloadB64, sigB64] = parts;

  const secret = requireEnv("MATCH_TOKEN_SECRET");
  const message = headerB64 + "." + payloadB64;
  const expected = await hmacSign(secret, message);

  let provided: Uint8Array;
  try {
    provided = base64UrlDecode(sigB64);
  } catch {
    return { error: "Malformed token" };
  }
  if (!constantTimeEq(expected, provided)) {
    return { error: "Invalid signature" };
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(
      new TextDecoder().decode(base64UrlDecode(payloadB64)),
    );
  } catch {
    return { error: "Malformed payload" };
  }

  if (payload.typ !== MATCH_TOKEN_TYPE) return { error: "Wrong token type" };
  if (typeof payload.fixture_id !== "string") {
    return { error: "Malformed payload" };
  }
  if (typeof payload.jti !== "string") return { error: "Malformed payload" };
  if (typeof payload.exp !== "number") return { error: "Malformed payload" };
  if (typeof payload.iat !== "number") return { error: "Malformed payload" };

  const nowSec = Math.floor(now.getTime() / 1000);
  if (nowSec >= payload.exp) return { error: "Token expired" };

  return {
    fixture_id: payload.fixture_id,
    jti: payload.jti,
    exp: payload.exp,
    iat: payload.iat,
    sub: typeof payload.sub === "string" ? payload.sub : null,
  };
}

/**
 * Check whether a jti has been revoked. Single indexed lookup on
 * `match_access.id`. The row's mere existence signals revocation; the
 * caller does not need to inspect its columns.
 *
 * @param jti - The token's jti.
 * @returns `true` when a revocation row exists.
 */
export async function isMatchTokenRevoked(jti: string): Promise<boolean> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("match_access")
    .select("id")
    .eq("id", jti)
    .maybeSingle();
  if (error) throw error;
  return data !== null;
}

/**
 * HTTP guard: verify the `Authorization: Bearer <jwt>` header on the request.
 * On success returns the claims; on failure returns a `Response` (401 with a
 * JSON body) that the caller returns unchanged.
 *
 * `isRevoked` is a testing seam so unit tests can inject a fake without
 * touching the database. Defaults to the real DB lookup.
 *
 * NOTE for future routes: this guard proves the caller holds a token scoped
 * to `claims.fixture_id`. Any handler that also accepts a fixture id in the
 * request body (none do today) MUST additionally check that the body value
 * matches `claims.fixture_id` — never trust a body field alone (plan §4).
 * The route-vs-token check lives in `scoring/index.ts` for the same reason.
 *
 * @param request - The incoming request.
 * @param isRevoked - Revocation checker (defaults to DB lookup).
 * @returns The claims or a 401 `Response`.
 */
export async function verifyMatchToken(
  request: Request,
  isRevoked: (jti: string) => Promise<boolean> = isMatchTokenRevoked,
): Promise<MatchTokenClaims | Response> {
  const header = request.headers.get("authorization");
  if (!header) return unauthorized("Missing match token");

  const trimmed = header.trim();
  const lower = trimmed.toLowerCase();
  if (!lower.startsWith("bearer ")) {
    return unauthorized("Malformed Authorization header");
  }
  const token = trimmed.slice("bearer ".length).trim();
  if (!token) return unauthorized("Malformed Authorization header");

  const verified = await verifyMatchTokenSignature(token);
  if ("error" in verified) return unauthorized(verified.error);

  if (await isRevoked(verified.jti)) return unauthorized("Token revoked");

  return verified;
}

/**
 * 401 response with a `{ error }` JSON body. Kept local to this module so
 * the guard has one consistent error shape.
 *
 * @param message - Description shown to the caller.
 * @returns A 401 Response.
 */
function unauthorized(message: string): Response {
  return jsonResponse({ error: message }, 401);
}
