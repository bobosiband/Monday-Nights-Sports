// -----------------------------------------------------------------------------
// _shared/cors.ts
//
// Cross-origin helpers shared by every Edge Function.
//
// The public fixtures function is called from browsers (players opening the
// share link); the organiser services will be called from whatever frontend
// the app team eventually picks. Allowing "*" is fine for read endpoints and
// for write endpoints that already require a bearer token — the token is
// what actually gates access, not the origin.
// -----------------------------------------------------------------------------

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
};

/**
 * Handle a CORS preflight `OPTIONS` request. Call this at the top of every
 * function's request handler so browsers can complete the preflight without
 * hitting business logic.
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

/**
 * Build a JSON response with CORS headers already attached.
 *
 * @param body - Any JSON-serialisable payload.
 * @param status - HTTP status code (defaults to 200).
 * @returns A `Response` with `application/json` content-type.
 */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}
