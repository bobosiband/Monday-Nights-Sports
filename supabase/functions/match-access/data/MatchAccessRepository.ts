// -----------------------------------------------------------------------------
// match-access/data/MatchAccessRepository.ts
//
// All database access for the match-access service.
// -----------------------------------------------------------------------------

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { createServiceClient } from "../lib/SupabaseClientFactory.ts";

/** Minimal fixture row used by the mint path. */
export interface FixtureRow {
  id: string;
  status: string;
}

/**
 * Row shape returned from the listing endpoint. Deliberately omits
 * `code_hash` and `created_by`: the hash is a bearer secret and never
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

/** Fields written by the mint path. */
export interface InsertAccessInput {
  fixture_id: string;
  code_hash: string;
  label: string | null;
  expires_at: string;
  created_by: string | null;
}

/** Data access contract for the match-access service. */
export interface MatchAccessRepository {
  loadFixture(fixtureId: string): Promise<FixtureRow | null>;
  insertAccess(
    row: InsertAccessInput,
  ): Promise<{ id: string; expires_at: string }>;
  findAccess(
    id: string,
  ): Promise<{ id: string; revoked_at: string | null } | null>;
  revokeAccess(id: string): Promise<string>;
  listAccessForFixture(fixtureId: string): Promise<AccessListRow[]>;
}

/** Supabase-backed implementation of `MatchAccessRepository`. */
export class SupabaseMatchAccessRepository implements MatchAccessRepository {
  private readonly client: SupabaseClient;

  /**
   * @param client - Supabase client; defaults to the service-role client.
   */
  constructor(client: SupabaseClient = createServiceClient()) {
    this.client = client;
  }

  /**
   * @param fixtureId - UUID of the fixture.
   * @returns Fixture row or `null`.
   */
  async loadFixture(fixtureId: string): Promise<FixtureRow | null> {
    const { data, error } = await this.client
      .from("fixtures")
      .select("id, status")
      .eq("id", fixtureId)
      .maybeSingle();
    if (error) throw error;
    return (data as FixtureRow | null) ?? null;
  }

  /**
   * Insert a new match_access row.
   *
   * @param row - Fields to insert. `code_hash` is pre-hashed; the raw
   *              code never touches this layer.
   * @returns `{ id, expires_at }` from the inserted row.
   */
  async insertAccess(
    row: InsertAccessInput,
  ): Promise<{ id: string; expires_at: string }> {
    const { data, error } = await this.client
      .from("match_access")
      .insert(row)
      .select("id, expires_at")
      .single();
    if (error) throw error;
    return data as { id: string; expires_at: string };
  }

  /**
   * @param id - UUID of the match_access row.
   * @returns Minimal row for revocation, or `null`.
   */
  async findAccess(
    id: string,
  ): Promise<{ id: string; revoked_at: string | null } | null> {
    const { data, error } = await this.client
      .from("match_access")
      .select("id, revoked_at")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return (data as { id: string; revoked_at: string | null } | null) ?? null;
  }

  /**
   * Mark a match_access row revoked. Idempotent: if already revoked, the
   * timestamp is left as-is and returned.
   *
   * @param id - UUID of the match_access row.
   * @returns The `revoked_at` after the call.
   */
  async revokeAccess(id: string): Promise<string> {
    const now = new Date().toISOString();
    const { data, error } = await this.client
      .from("match_access")
      .update({ revoked_at: now })
      .eq("id", id)
      .is("revoked_at", null)
      .select("revoked_at")
      .maybeSingle();
    if (error) throw error;
    if (data) return (data as { revoked_at: string }).revoked_at;

    const { data: existing, error: readErr } = await this.client
      .from("match_access")
      .select("revoked_at")
      .eq("id", id)
      .maybeSingle();
    if (readErr) throw readErr;
    return (existing as { revoked_at: string }).revoked_at;
  }

  /**
   * @param fixtureId - UUID of the fixture.
   * @returns Rows suitable for the organiser UI; no secrets leak.
   */
  async listAccessForFixture(fixtureId: string): Promise<AccessListRow[]> {
    const { data, error } = await this.client
      .from("match_access")
      .select("id, fixture_id, label, expires_at, revoked_at, last_used_at")
      .eq("fixture_id", fixtureId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as AccessListRow[];
  }
}
