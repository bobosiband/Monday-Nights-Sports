// -----------------------------------------------------------------------------
// _shared/errors.ts
//
// Typed error-response helpers. Each returns a `Response` the caller can
// return directly, so handlers stay readable and every failure mode carries
// the correct HTTP status.
//
// Every write service (scoring, events, and future arrivals) needs the same
// 4xx/5xx shapes; keeping them in _shared is cheaper than growing a copy per
// service and gives us a single place to change the JSON envelope.
// -----------------------------------------------------------------------------

import { jsonResponse } from "./cors.ts";

/**
 * 400 Bad Request — the client sent something we couldn't parse or validate.
 *
 * @param message - Human-readable description of the problem.
 * @returns A 400 Response with `{ error: message }`.
 */
export function badRequest(message: string): Response {
  return jsonResponse({ error: message }, 400);
}

/**
 * 401 Unauthorized — the caller didn't supply valid credentials.
 *
 * @param message - Description shown to the caller.
 * @returns A 401 Response.
 */
export function unauthorized(message: string): Response {
  return jsonResponse({ error: message }, 401);
}

/**
 * 403 Forbidden — credentials were valid but not for this resource. Used
 * when a match token doesn't match the fixture in the URL.
 *
 * @param message - Description shown to the caller.
 * @returns A 403 Response.
 */
export function forbidden(message: string): Response {
  return jsonResponse({ error: message }, 403);
}

/**
 * 404 Not Found — the target resource doesn't exist.
 *
 * @param message - Description shown to the caller.
 * @returns A 404 Response.
 */
export function notFound(message: string): Response {
  return jsonResponse({ error: message }, 404);
}

/**
 * 405 Method Not Allowed — used when a route accepts one method only.
 *
 * @param message - Description shown to the caller.
 * @returns A 405 Response.
 */
export function methodNotAllowed(message = "Method not allowed"): Response {
  return jsonResponse({ error: message }, 405);
}

/**
 * 409 Conflict — the request contradicts current server state (e.g.
 * finalizing an already-complete fixture without an explicit reopen flag).
 *
 * @param message - Description shown to the caller.
 * @returns A 409 Response.
 */
export function conflict(message: string): Response {
  return jsonResponse({ error: message }, 409);
}

/**
 * 500 Internal Server Error — a catch-all for unhandled failures. The
 * message stays generic so we don't leak stack contents to the client;
 * details go to the function log.
 *
 * @returns A 500 Response.
 */
export function serverError(): Response {
  return jsonResponse({ error: "Internal server error" }, 500);
}
