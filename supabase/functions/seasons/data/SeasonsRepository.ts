// -----------------------------------------------------------------------------
// seasons/data/SeasonsRepository.ts
//
// All database access for the seasons service. Handlers depend on the
// `SeasonsRepository` interface and are given a `SupabaseSeasonsRepository`
// at wire-time; tests may pass any object with the same shape.
// -----------------------------------------------------------------------------

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { createServiceClient } from "../lib/SupabaseClientFactory.ts";

/** Shape of a row returned by the `seasons` table. */
export interface SeasonRow {
  id: string;
  name: string;
  sports: string[];
  starts_on: string;
  ends_on: string;
  is_active: boolean;
  is_archived: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Validated input for creating a season (post-validation shape). */
export interface CreateSeasonInput {
  name: string;
  sports: string[];
  starts_on: string;
  ends_on: string;
  is_active: boolean;
}

/** Sparse patch for updating a season. Only present keys are written. */
export type UpdateSeasonPatch = Partial<
  Pick<SeasonRow, "name" | "sports" | "starts_on" | "ends_on">
>;

/** Lookup result used by the activate flow. */
export interface SeasonActivateLookup {
  id: string;
  is_archived: boolean;
}

/** Data access contract for the seasons service. */
export interface SeasonsRepository {
  list(): Promise<SeasonRow[]>;
  create(input: CreateSeasonInput, createdBy: string): Promise<SeasonRow>;
  find(id: string): Promise<SeasonRow | null>;
  update(id: string, patch: UpdateSeasonPatch): Promise<SeasonRow | null>;
  findForActivate(id: string): Promise<SeasonActivateLookup | null>;
  unsetAllActive(): Promise<void>;
  unsetActiveExcept(id: string): Promise<void>;
  setActive(id: string): Promise<SeasonRow>;
  archive(id: string): Promise<SeasonRow | null>;
}

/** Supabase-backed implementation of `SeasonsRepository`. */
export class SupabaseSeasonsRepository implements SeasonsRepository {
  private readonly client: SupabaseClient;

  /**
   * @param client - Supabase client. Defaults to the service-role client;
   * tests may inject a stub.
   */
  constructor(client: SupabaseClient = createServiceClient()) {
    this.client = client;
  }

  /** @returns All seasons, newest start-date first. */
  async list(): Promise<SeasonRow[]> {
    const { data, error } = await this.client
      .from("seasons")
      .select("*")
      .order("starts_on", { ascending: false });
    if (error) throw error;
    return (data ?? []) as SeasonRow[];
  }

  /**
   * @param input - Validated season input.
   * @param createdBy - Authenticated user id, stored for audit.
   * @returns The inserted row.
   */
  async create(
    input: CreateSeasonInput,
    createdBy: string,
  ): Promise<SeasonRow> {
    const { data, error } = await this.client
      .from("seasons")
      .insert({ ...input, created_by: createdBy })
      .select()
      .single();
    if (error) throw error;
    return data as SeasonRow;
  }

  /**
   * @param id - Season id.
   * @returns The matching row, or `null` when not found.
   */
  async find(id: string): Promise<SeasonRow | null> {
    const { data, error } = await this.client
      .from("seasons")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return (data as SeasonRow | null) ?? null;
  }

  /**
   * @param id - Season id.
   * @param patch - Fields to update. Fields not present are left as-is.
   * @returns The updated row, or `null` when the row does not exist.
   */
  async update(
    id: string,
    patch: UpdateSeasonPatch,
  ): Promise<SeasonRow | null> {
    const { data, error } = await this.client
      .from("seasons")
      .update(patch)
      .eq("id", id)
      .select()
      .maybeSingle();
    if (error) throw error;
    return (data as SeasonRow | null) ?? null;
  }

  /**
   * Minimal lookup used by the activate flow; avoids pulling the full row
   * before we know we are going to touch it.
   *
   * @param id - Season id.
   * @returns The id/is_archived pair, or `null` when not found.
   */
  async findForActivate(id: string): Promise<SeasonActivateLookup | null> {
    const { data, error } = await this.client
      .from("seasons")
      .select("id, is_archived")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return (data as SeasonActivateLookup | null) ?? null;
  }

  /** Unsets `is_active` on every row currently flagged active. */
  async unsetAllActive(): Promise<void> {
    const { error } = await this.client
      .from("seasons")
      .update({ is_active: false })
      .eq("is_active", true);
    if (error) throw error;
  }

  /**
   * Unsets `is_active` on every active row except `id`.
   *
   * @param id - Season to leave untouched.
   */
  async unsetActiveExcept(id: string): Promise<void> {
    const { error } = await this.client
      .from("seasons")
      .update({ is_active: false })
      .eq("is_active", true)
      .neq("id", id);
    if (error) throw error;
  }

  /**
   * @param id - Season id to mark active.
   * @returns The updated row.
   */
  async setActive(id: string): Promise<SeasonRow> {
    const { data, error } = await this.client
      .from("seasons")
      .update({ is_active: true })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return data as SeasonRow;
  }

  /**
   * Archive a season. Also clears `is_active`: an archived season is never
   * active. Idempotent.
   *
   * @param id - Season id to archive.
   * @returns The archived row, or `null` when not found.
   */
  async archive(id: string): Promise<SeasonRow | null> {
    const { data, error } = await this.client
      .from("seasons")
      .update({ is_archived: true, is_active: false })
      .eq("id", id)
      .select()
      .maybeSingle();
    if (error) throw error;
    return (data as SeasonRow | null) ?? null;
  }
}
