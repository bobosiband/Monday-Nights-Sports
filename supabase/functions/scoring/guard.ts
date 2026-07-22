// -----------------------------------------------------------------------------
// scoring/guard.ts
//
// Match-token guard. Placeholder implementation: accepts any bearer token
// and echoes the URL's fixture id back as the token's claim, so the routes
// are exercisable during Sprint B development.
//
// TODO(Sprint C, #38): replace with real signed-JWT verification (or
// match_access table lookup, depending on the outcome of #36). At that
// point the guard must also reject:
//   - missing / malformed Authorization header (401)
//   - expired / revoked tokens (401)
//   - tokens whose claim doesn't match the URL fixture id (403)
// -----------------------------------------------------------------------------

import { unauthorized } from "./errors.ts";
import type { MatchTokenClaims } from "./types.ts";

/**
 * Verify the caller has a match token scoped to `fixtureId`. Returns
 * claims on success or a `Response` (401) the caller returns unchanged.
 *
 * The dev stub requires *some* Authorization header (so callers get into
 * the habit of sending one) but does not verify its contents. This is safe
 * only for local development; production must not deploy the stub.
 *
 * @param request - The incoming request.
 * @param fixtureId - The fixture id parsed from the URL.
 * @returns The claims, or a 401 `Response`.
 */
export function verifyMatchToken(
  request: Request,
  fixtureId: string,
): MatchTokenClaims | Response {
  const header = request.headers.get("authorization");
  if (!header || !header.trim().toLowerCase().startsWith("bearer ")) {
    return unauthorized("Missing or malformed match token");
  }

  // TODO(Sprint C): parse and cryptographically verify the token; compare
  // its `fixture_id` claim to `fixtureId` and 403 on mismatch. For now we
  // trust the URL, which is fine for local development only.
  return { fixture_id: fixtureId };
}
