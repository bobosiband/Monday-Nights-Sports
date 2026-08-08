// -----------------------------------------------------------------------------
// _shared/http.ts
//
// URL-shape helpers shared across Edge Functions. Extracted so every
// microservice's router uses the same anchoring rule and we don't grow six
// slightly-different copies of the same six-line function.
//
// Nothing here talks to Supabase; keep it that way so it stays trivially
// testable and safe to import from any function without pulling in the
// service client.
// -----------------------------------------------------------------------------

/**
 * Split a request URL's pathname into the segments after the function's
 * mount-point. Functions are served at `/functions/v1/<name>/...`, but
 * proxies and local vs hosted runtimes report the raw path in different
 * shapes — so we anchor on the function name segment rather than trusting
 * a fixed prefix.
 *
 * If the anchor appears multiple times (a fixture id that happens to
 * repeat the function name, say), the *last* occurrence wins so path
 * suffixes always resolve relative to the deepest match.
 *
 * @param request - The incoming request.
 * @param functionName - The folder name of the function (e.g. `"events"`).
 * @returns Segments after the anchor. Empty when the request targets the
 *          collection root.
 */
export function subPath(request: Request, functionName: string): string[] {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  const idx = parts.lastIndexOf(functionName);
  return idx >= 0 ? parts.slice(idx + 1) : parts;
}
