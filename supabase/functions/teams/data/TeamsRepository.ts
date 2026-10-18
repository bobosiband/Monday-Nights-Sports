// -----------------------------------------------------------------------------
// teams/data/TeamsRepository.ts
//
// All database access for the teams service.
// -----------------------------------------------------------------------------

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { createServiceClient } from "../lib/SupabaseClientFactory.ts";

/** Row shape returned by the `teams` table. */
export interface TeamRow {
  id: string;
  season_id: string;
  name: string;
  created_at: string;
}

/** Minimal row shape used when checking rename collisions. */
export interface TeamNameLookup {
  id: string;
  season_id: string;
  name: string;
}

/** Data access contract for the teams service. */
export interface TeamsRepository {
  listBySeason(seasonId: string): Promise<TeamRow[]>;
  findDuplicateInSeason(
    seasonId: string,
    name: string,
  ): Promise<{ id: string } | null>;
  insert(seasonId: string, name: string): Promise<TeamRow>;
  listNamesInSeason(seasonId: string): Promise<string[]>;
  insertMany(seasonId: string, names: string[]): Promise<TeamRow[]>;
  find(id: string): Promise<TeamNameLookup | null>;
  rename(id: string, name: string): Promise<TeamRow>;
  deleteById(id: string): Promise<string | null>;
}

/** Supabase-backed implementation of `TeamsRepository`. */
export class SupabaseTeamsRepository implements TeamsRepository {
  private readonly client: SupabaseClient;

  /**
   * @param client - Supabase client; defaults to the service-role client.
   */
  constructor(client: SupabaseClient = createServiceClient()) {
    this.client = client;
  }

  /**
   * @param seasonId - Season to list teams for.
   * @returns Teams ordered alphabetically by name.
   */
  async listBySeason(seasonId: string): Promise<TeamRow[]> {
    const { data, error } = await this.client
      .from("teams")
      .select("id, season_id, name, created_at")
      .eq("season_id", seasonId)
      .order("name", { ascending: true });
    if (error) throw error;
    return (data ?? []) as TeamRow[];
  }

  /**
   * Case-insensitive lookup of a team name within a season.
   *
   * @param seasonId - Season to search.
   * @param name - Candidate name.
   * @returns `{ id }` of the colliding row, or `null`.
   */
  async findDuplicateInSeason(
    seasonId: string,
    name: string,
  ): Promise<{ id: string } | null> {
    const { data, error } = await this.client
      .from("teams")
      .select("id")
      .eq("season_id", seasonId)
      .ilike("name", name)
      .maybeSingle();
    if (error) throw error;
    return (data as { id: string } | null) ?? null;
  }

  /**
   * @param seasonId - Season to insert into.
   * @param name - Team name.
   * @returns The inserted row.
   */
  async insert(seasonId: string, name: string): Promise<TeamRow> {
    const { data, error } = await this.client
      .from("teams")
      .insert({ season_id: seasonId, name })
      .select()
      .single();
    if (error) throw error;
    return data as TeamRow;
  }

  /**
   * @param seasonId - Season to inspect.
   * @returns All existing team names in that season, exact casing.
   */
  async listNamesInSeason(seasonId: string): Promise<string[]> {
    const { data, error } = await this.client
      .from("teams")
      .select("name")
      .eq("season_id", seasonId);
    if (error) throw error;
    return (data ?? []).map((r) => (r as { name: string }).name);
  }

  /**
   * Bulk-insert multiple team names into a season.
   *
   * @param seasonId - Season to insert into.
   * @param names - Names to insert, already deduped against existing rows.
   * @returns The inserted rows.
   */
  async insertMany(seasonId: string, names: string[]): Promise<TeamRow[]> {
    if (names.length === 0) return [];
    const rows = names.map((name) => ({ season_id: seasonId, name }));
    const { data, error } = await this.client
      .from("teams")
      .insert(rows)
      .select();
    if (error) throw error;
    return (data ?? []) as TeamRow[];
  }

  /**
   * @param id - Team id.
   * @returns The minimal lookup shape or `null`.
   */
  async find(id: string): Promise<TeamNameLookup | null> {
    const { data, error } = await this.client
      .from("teams")
      .select("id, season_id, name")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return (data as TeamNameLookup | null) ?? null;
  }

  /**
   * @param id - Team id.
   * @param name - New name.
   * @returns The updated row.
   */
  async rename(id: string, name: string): Promise<TeamRow> {
    const { data, error } = await this.client
      .from("teams")
      .update({ name })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return data as TeamRow;
  }

  /**
   * @param id - Team id.
   * @returns The id of the deleted row, or `null` when nothing matched.
   */
  async deleteById(id: string): Promise<string | null> {
    const { data, error } = await this.client
      .from("teams")
      .delete()
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    const row = data as { id: string } | null;
    return row?.id ?? null;
  }
}
