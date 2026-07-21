// -----------------------------------------------------------------------------
// match-access/index.ts
//
// Organiser-only service for minting and revoking scoped match tokens.
// Skeleton — real behaviour lands per story:
//   #36 decide access model (PIN table vs signed scoped JWT) + implement
//   #37 mint / revoke routes (this file becomes real)
//
// Routes (organiser-guarded via the existing _shared/auth guard):
//   POST /match-access                     Mint a token for a fixture
//   POST /match-access/:id/revoke          Revoke an active token
// -----------------------------------------------------------------------------

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { isAuthFailure, requireOrganiser } from "../_shared/auth.ts";

/**
 * Split the URL path relative to this function's mount point.
 *
 * @param request - The incoming request.
 * @returns The path segments after `match-access`.
 */
function subPath(request: Request): string[] {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  const idx = parts.lastIndexOf("match-access");
  return idx >= 0 ? parts.slice(idx + 1) : parts;
}

serve(async (request) => {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireOrganiser(request);
  if (isAuthFailure(auth)) return auth;

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const segments = subPath(request);

  if (segments.length === 0) {
    // TODO(#37): mint a match token for a given fixture_id + TTL.
    return jsonResponse({ error: "Not implemented" }, 501);
  }

  if (segments.length === 2 && segments[1] === "revoke") {
    // TODO(#37): revoke the token identified by segments[0].
    return jsonResponse({ error: "Not implemented" }, 501);
  }

  return jsonResponse({ error: "Not found" }, 404);
});
