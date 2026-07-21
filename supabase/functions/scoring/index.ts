// -----------------------------------------------------------------------------
// scoring/index.ts
//
// Live scoring service — skeleton. Real behaviour lands per story:
//   #29 skeleton + match-token guard hook (this file)
//   #30 start / first-event → status='live'
//   #31 record event (idempotent) + derived score in response
//   #32 undo (soft-void by event id)
//   #33 period start/end events
//   #34 fouls / cards event types
//   #35 finalize → snapshot results, status='complete'
//
// Routes (all require a match token — validation stub for now):
//   POST /scoring/:fixtureId/start
//   POST /scoring/:fixtureId/events
//   POST /scoring/:fixtureId/undo
//   POST /scoring/:fixtureId/period
//   POST /scoring/:fixtureId/finalize
// -----------------------------------------------------------------------------

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";

interface MatchTokenClaims {
  fixture_id: string;
}

/**
 * Verify a scoped match token from the `Authorization` header. Skeleton —
 * story #C1/#C3 replaces this with either a signed-JWT verification or a
 * `match_access` table lookup, depending on the access-model decision.
 *
 * @param request - The incoming request.
 * @returns The claims on success, or a `Response` (401) on failure.
 */
function verifyMatchToken(
  request: Request,
): MatchTokenClaims | Response {
  // TODO(#36, #38): actual token verification.
  const header = request.headers.get("authorization");
  if (!header) {
    return jsonResponse({ error: "Missing match token" }, 401);
  }
  return jsonResponse({ error: "Match token verification not implemented" }, 501);
}

/**
 * Parse `/scoring/:fixtureId/:action` out of the request URL.
 *
 * @param request - The incoming request.
 * @returns `{ fixtureId, action }` or `null` if the path doesn't match.
 */
function parseRoute(
  request: Request,
): { fixtureId: string; action: string } | null {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  const idx = parts.lastIndexOf("scoring");
  if (idx < 0 || parts.length < idx + 3) return null;
  return { fixtureId: parts[idx + 1], action: parts[idx + 2] };
}

serve((request) => {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const claims = verifyMatchToken(request);
  if (claims instanceof Response) return claims;

  const route = parseRoute(request);
  if (!route) return jsonResponse({ error: "Not found" }, 404);
  if (route.fixtureId !== claims.fixture_id) {
    return jsonResponse({ error: "Token does not match fixture" }, 403);
  }

  switch (route.action) {
    case "start":
      // TODO(#30): flip fixtures.status='live' if scheduled.
      return jsonResponse({ error: "Not implemented" }, 501);
    case "events":
      // TODO(#31, #34): insert match_event on conflict do nothing; return derived score.
      return jsonResponse({ error: "Not implemented" }, 501);
    case "undo":
      // TODO(#32): soft-void a specific event id.
      return jsonResponse({ error: "Not implemented" }, 501);
    case "period":
      // TODO(#33): period_start / period_end events.
      return jsonResponse({ error: "Not implemented" }, 501);
    case "finalize":
      // TODO(#35): upsert results, set fixtures.status='complete'.
      return jsonResponse({ error: "Not implemented" }, 501);
    default:
      return jsonResponse({ error: "Unknown action" }, 404);
  }
});
