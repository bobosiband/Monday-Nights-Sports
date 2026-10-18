// -----------------------------------------------------------------------------
// api-docs/lib/Cors.ts
//
// CORS helpers used by this service. Local copy, per ADR 0007: services do
// not share code outside their own folder. Keep this file in sync with the
// other services' Cors.ts only if the public CORS policy changes.
// -----------------------------------------------------------------------------

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
};

/**
 * Handle a CORS preflight `OPTIONS` request. Call this at the top of the
 * router so browsers can complete the preflight without hitting business
 * logic.
 *
 * @param request - The incoming request.
 * @returns A 204 response if this was a preflight, otherwise `null` and the
 * caller should continue processing.
 */
export function handlePreflight(request: Request): Response | null {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  return null;
}
