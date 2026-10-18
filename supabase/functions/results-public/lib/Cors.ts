// -----------------------------------------------------------------------------
// results-public/lib/Cors.ts
//
// CORS helpers used by this service. Local copy, per ADR 0007.
// -----------------------------------------------------------------------------

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
};

/**
 * Handle a CORS preflight `OPTIONS` request.
 *
 * @param request - The incoming request.
 * @returns A 204 response if this was a preflight, otherwise `null`.
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
 * @returns A Response with `application/json` content-type.
 */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}
