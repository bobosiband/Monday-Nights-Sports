// -----------------------------------------------------------------------------
// _shared/auth.ts
//
// Organiser authentication guard. Every write service (seasons, teams)
// funnels through `requireOrganiser` to validate the caller's JWT against
// Supabase Auth before touching the database. Public read services do NOT
// call this — RLS + `verify_jwt = false` handles their access story.
// -----------------------------------------------------------------------------

import { createServiceClient } from "./supabase-client.ts";
import { jsonResponse } from "./cors.ts";

export interface AuthenticatedUser {
  id: string;
  email: string | null;
}

/**
 * Extract the bearer token from the `Authorization` header. Header lookup is
 * case-insensitive in the spec but Deno's `Headers.get` is already
 * case-insensitive — the explicit lowercase avoids relying on that quirk.
 *
 * @param request - The incoming request.
 * @returns The raw JWT string, or `null` if the header is absent/malformed.
 */
function extractBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const [scheme, token] = header.split(" ", 2);
  if (!scheme || scheme.toLowerCase() !== "bearer" || !token) return null;
  return token.trim();
}

/**
 * Verify the caller is an authenticated organiser. On success returns the
 * user; on failure returns a `Response` (401) that the caller should return
 * unchanged. Returning a `Response` instead of throwing keeps the error path
 * uniform across services and easy to unit-test.
 *
 * Organiser identity for Sprint 1 is "any authenticated Supabase Auth user".
 * A role-based check can be layered on top later without changing this
 * signature — services depend on the return shape, not on the check itself.
 *
 * @param request - The incoming request.
 * @returns The authenticated user, or a `Response` to return to the caller.
 */
export async function requireOrganiser(
  request: Request,
): Promise<AuthenticatedUser | Response> {
  const token = extractBearerToken(request);
  if (!token) {
    return jsonResponse({ error: "Missing or malformed Authorization header" }, 401);
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    return jsonResponse({ error: "Invalid or expired token" }, 401);
  }

  return { id: data.user.id, email: data.user.email ?? null };
}

/**
 * Type guard letting callers distinguish the "authenticated" from the
 * "return this response" branch of `requireOrganiser`.
 *
 * @param value - The value returned by `requireOrganiser`.
 * @returns `true` when the value is a `Response`.
 */
export function isAuthFailure(
  value: AuthenticatedUser | Response,
): value is Response {
  return value instanceof Response;
}
