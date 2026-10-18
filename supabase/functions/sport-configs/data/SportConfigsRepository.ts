// -----------------------------------------------------------------------------
// sport-configs/data/SportConfigsRepository.ts
//
// All database access for the sport-configs service.
// -----------------------------------------------------------------------------

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { createServiceClient } from "../lib/SupabaseClientFactory.ts";

/** Row shape returned by the `sport_configs` table. */
export interface SportConfigRow {
  id: string;
  season_id: string;
  sport: string;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/** Fields written on an upsert. */
export interface SportConfigUpsertInput {
  season_id: string;
  sport: string;
  config: Record<string, unknown>;
}

/** Sparse patch for a PATCH /sport-configs/:id. */
export interface SportConfigPatch {
  sport?: string;
  config?: Record<string, unknown>;
}

/** Data access contract for the sport-configs service. */
export interface SportConfigsRepository {
  listBySeason(seasonId: string): Promise<SportConfigRow[]>;
  upsert(input: SportConfigUpsertInput): Promise<SportConfigRow>;
  update(id: string, patch: SportConfigPatch): Promise<SportConfigRow | null>;
  deleteById(id: string): Promise<string | null>;
}

/** Supabase-backed implementation of `SportConfigsRepository`. */
export class SupabaseSportConfigsRepository implements SportConfigsRepository {
  private readonly client: SupabaseClient;

  /**
   * @param client - Supabase client; defaults to the service-role client.
   */
  constructor(client: SupabaseClient = createServiceClient()) {
    this.client = client;
  }

  /**
   * @param seasonId - Season to list configs for.
   * @returns Configs ordered alphabetically by sport.
   */
  async listBySeason(seasonId: string): Promise<SportConfigRow[]> {
    const { data, error } = await this.client
      .from("sport_configs")
      .select("id, season_id, sport, config, created_at, updated_at")
      .eq("season_id", seasonId)
      .order("sport", { ascending: true });
    if (error) throw error;
    return (data ?? []) as SportConfigRow[];
  }

  /**
   * Upsert on `(season_id, sport)`.
   *
   * @param input - Validated upsert body.
   * @returns The row after the upsert.
   */
  async upsert(input: SportConfigUpsertInput): Promise<SportConfigRow> {
    const { data, error } = await this.client
      .from("sport_configs")
      .upsert(input, { onConflict: "season_id,sport" })
      .select()
      .single();
    if (error) throw error;
    return data as SportConfigRow;
  }

  /**
   * @param id - Row id.
   * @param patch - Fields to update.
   * @returns The updated row, or `null` when not found.
   */
  async update(
    id: string,
    patch: SportConfigPatch,
  ): Promise<SportConfigRow | null> {
    const { data, error } = await this.client
      .from("sport_configs")
      .update(patch)
      .eq("id", id)
      .select()
      .maybeSingle();
    if (error) throw error;
    return (data as SportConfigRow | null) ?? null;
  }

  /**
   * @param id - Row id.
   * @returns The deleted id, or `null` when nothing matched.
   */
  async deleteById(id: string): Promise<string | null> {
    const { data, error } = await this.client
      .from("sport_configs")
      .delete()
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    const row = data as { id: string } | null;
    return row?.id ?? null;
  }
}
