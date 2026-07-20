// -----------------------------------------------------------------------------
// _shared/auth.ts
//
// Placeholder for the organiser authentication guard. The real implementation
// lands in Task 3 (Sprint 1). The signature is fixed now so services written
// against it in Tasks 4–5 don't need to change once the body arrives.
// -----------------------------------------------------------------------------

export interface AuthenticatedUser {
  id: string;
  email: string | null;
}

/**
 * Verify the caller is an authenticated organiser. Returns the user on
 * success or a `Response` (401) that the caller should return unchanged.
 *
 * Placeholder — replaced by the real guard in Task 3.
 *
 * @param _request - The incoming request.
 * @returns The authenticated user, or a `Response` to return to the caller.
 */
export function requireOrganiser(
  _request: Request,
): Promise<AuthenticatedUser | Response> {
  throw new Error("requireOrganiser is not implemented yet (Task 3).");
}
