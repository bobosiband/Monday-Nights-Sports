// -----------------------------------------------------------------------------
// teams/lib/OrganiserAuthGuard.ts
//
// Organiser authentication guard. Local copy, per ADR 0007.
//
// Every write route in this service funnels through `requireOrganiser` to
// validate the caller's JWT against Supabase Auth before touching the
// database.
// -----------------------------------------------------------------------------

import { createServiceClient } from "./SupabaseClientFactory.ts";
import { jsonResponse } from "./Cors.ts";

/** The identity extracted from a valid organiser JWT. */
export interface AuthenticatedUser {
  id: string;
  email: string | null;
}

/**
 * Extract the bearer token from the `Authorization` header. Header lookup
 * is case-insensitive per the spec; the explicit lowercase avoids relying
 * on `Headers.get` quirks.
 *
 * @param request - The incoming request.
 * @returns The raw JWT string, or `null` if absent/malformed.
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
 * user; on failure returns a `Response` (401) the caller should return
 * unchanged.
 *
 * @param request - The incoming request.
 * @returns The authenticated user, or a `Response` to return to the caller.
 */
export async function requireOrganiser(
  request: Request,
): Promise<AuthenticatedUser | Response> {
  const token = extractBearerToken(request);
  if (!token) {
    return jsonResponse(
      { error: "Missing or malformed Authorization header" },
      401,
    );
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    return jsonResponse({ error: "Invalid or expired token" }, 401);
  }

  return { id: data.user.id, email: data.user.email ?? null };
}

/**
 * Type guard distinguishing the authenticated branch from the Response
 * branch of `requireOrganiser`.
 *
 * @param value - The value returned by `requireOrganiser`.
 * @returns `true` when the value is a `Response`.
 */
export function isAuthFailure(
  value: AuthenticatedUser | Response,
): value is Response {
  return value instanceof Response;
}
