// -----------------------------------------------------------------------------
// seasons/lib/HttpHelpers.ts
//
// URL-shape helpers used by this service. Local copy, per ADR 0007.
// -----------------------------------------------------------------------------

/**
 * Split a request URL's pathname into the segments after this function's
 * mount-point. Functions are served at `/functions/v1/<name>/...`, but
 * proxies and local vs hosted runtimes report the raw path in different
 * shapes, so we anchor on the function name segment rather than trusting
 * a fixed prefix.
 *
 * If the anchor appears multiple times, the last occurrence wins so path
 * suffixes always resolve relative to the deepest match.
 *
 * @param request - The incoming request.
 * @param functionName - The folder name of the function (e.g. `"seasons"`).
 * @returns Segments after the anchor. Empty when the request targets the
 *          collection root.
 */
export function subPath(request: Request, functionName: string): string[] {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  const idx = parts.lastIndexOf(functionName);
  return idx >= 0 ? parts.slice(idx + 1) : parts;
}
