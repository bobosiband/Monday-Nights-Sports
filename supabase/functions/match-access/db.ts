// -----------------------------------------------------------------------------
// match-access/db.ts
//
// All Supabase reads/writes for the match-access service. Kept in one place
// so the HTTP file (`index.ts`) stays request-shaped and easy to skim.
//
// Every function is thin — one query, one shape. Callers pass the client so
// tests can inject a fake.
// -----------------------------------------------------------------------------

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

/**
 * Minimal fixture row used by the mint path — we only need enough to check
 * existence and the current status.
 */
export interface FixtureRow {
  id: string;
  status: string;
}

/**
 * Row shape returned from the listing endpoint. Deliberately omits
 * `code_hash` and `created_by` — the hash is a bearer secret and never
 * leaves the DB.
 */
export interface AccessListRow {
  id: string;
  fixture_id: string;
  label: string | null;
  expires_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
}

/**
 * Load just the fields needed to reason about a fixture during mint.
 *
 * @param supabase - Service-role Supabase client.
 * @param fixtureId - UUID of the fixture.
 * @returns The fixture row, or null when it doesn't exist.
 */
export async function loadFixture(
  supabase: SupabaseClient,
  fixtureId: string,
): Promise<FixtureRow | null> {
  const { data, error } = await supabase
    .from("fixtures")
    .select("id, status")
    .eq("id", fixtureId)
    .maybeSingle();
  if (error) throw error;
  return (data as FixtureRow | null) ?? null;
}

/**
 * Insert a new match_access row. Returns the id + expires_at that Postgres
 * finalised (the row's `id` is server-generated).
 *
 * @param supabase - Service-role client.
 * @param row - Fields to insert. `code_hash` is the pre-hashed value; the
 *              raw code never touches this module.
 * @returns `{ id, expires_at }` from the inserted row.
 */
export async function insertAccess(
  supabase: SupabaseClient,
  row: {
    fixture_id: string;
    code_hash: string;
    label: string | null;
    expires_at: string;
    created_by: string | null;
  },
): Promise<{ id: string; expires_at: string }> {
  const { data, error } = await supabase
    .from("match_access")
    .insert(row)
    .select("id, expires_at")
    .single();
  if (error) throw error;
  return data as { id: string; expires_at: string };
}

/**
 * Fetch a match_access row by id (used by revoke). Returns null when the
 * id doesn't exist.
 *
 * @param supabase - Service-role client.
 * @param id - UUID of the match_access row.
 * @returns Row with the fields needed by revoke, or null.
 */
export async function findAccess(
  supabase: SupabaseClient,
  id: string,
): Promise<{ id: string; revoked_at: string | null } | null> {
  const { data, error } = await supabase
    .from("match_access")
    .select("id, revoked_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as { id: string; revoked_at: string | null } | null) ?? null;
}

/**
 * Mark a match_access row as revoked. Idempotent — if the row is already
 * revoked, the timestamp is left as-is (RETURN the existing one).
 *
 * @param supabase - Service-role client.
 * @param id - UUID of the match_access row.
 * @returns The revoked_at timestamp on the row after the call.
 */
export async function revokeAccess(
  supabase: SupabaseClient,
  id: string,
): Promise<string> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("match_access")
    .update({ revoked_at: now })
    .eq("id", id)
    .is("revoked_at", null)
    .select("revoked_at")
    .maybeSingle();
  if (error) throw error;
  if (data) return (data as { revoked_at: string }).revoked_at;

  // Already-revoked path: re-read to return the existing timestamp so the
  // caller can render an accurate response.
  const { data: existing, error: readErr } = await supabase
    .from("match_access")
    .select("revoked_at")
    .eq("id", id)
    .maybeSingle();
  if (readErr) throw readErr;
  return (existing as { revoked_at: string }).revoked_at;
}

/**
 * List codes for a given fixture. Never returns `code_hash` or the
 * creator's user id.
 *
 * @param supabase - Service-role client.
 * @param fixtureId - UUID of the fixture.
 * @returns Rows suitable for the organiser UI.
 */
export async function listAccessForFixture(
  supabase: SupabaseClient,
  fixtureId: string,
): Promise<AccessListRow[]> {
  const { data, error } = await supabase
    .from("match_access")
    .select("id, fixture_id, label, expires_at, revoked_at, last_used_at")
    .eq("fixture_id", fixtureId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as AccessListRow[];
}
