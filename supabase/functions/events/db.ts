// -----------------------------------------------------------------------------
// events/db.ts
//
// All Supabase reads/writes for the events service live here so handlers stay
// HTTP-shaped. Every function is thin — one query, one shape — and lets
// errors bubble so the router's top-level try/catch logs and returns 500.
//
// Nothing here re-implements business rules — those live in `validate-body.ts`
// and `validate-draw.ts`. This file's job is "translate a validated intent
// into SQL and back".
// -----------------------------------------------------------------------------

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { createServiceClient } from "../_shared/supabase-client.ts";

/** Season columns the events service reads. */
export interface SeasonRow {
  id: string;
  sports: string[];
  is_archived: boolean;
}

/** Event row shape returned to organiser callers. */
export interface EventRow {
  id: string;
  season_id: string;
  event_date: string;
  is_published: boolean;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Slot row shape used everywhere in this service. */
export interface SlotRow {
  id: string;
  event_id: string;
  slot_number: number;
  starts_at: string;
  pitch: string | null;
  created_at: string;
}

/** Fixture row shape used everywhere in this service. */
export interface FixtureRow {
  id: string;
  event_id: string;
  slot_id: string;
  home_team_id: string;
  away_team_id: string | null;
  sport: string;
  status: string;
  created_at: string;
  updated_at: string;
}

/**
 * Build the DB client. Wrapper kept for symmetry with `scoring/db.ts` and
 * so tests can inject a fake later without touching every call site.
 *
 * @returns A service-role Supabase client.
 */
export function client(): SupabaseClient {
  return createServiceClient();
}

// ---------------------------------------------------------------------------
// Season lookups (used by fixture and generate cross-checks)
// ---------------------------------------------------------------------------

/**
 * Load a season by id.
 *
 * @param supabase - Supabase client.
 * @param seasonId - Season id.
 * @returns The season, or `null` when not found.
 */
export async function loadSeason(
  supabase: SupabaseClient,
  seasonId: string,
): Promise<SeasonRow | null> {
  const { data, error } = await supabase
    .from("seasons")
    .select("id, sports, is_archived")
    .eq("id", seasonId)
    .maybeSingle();
  if (error) throw error;
  return data as SeasonRow | null;
}

/**
 * List every team id in a season. Used to validate that fixture home/away
 * teams belong to the event's season without doing a full join.
 *
 * @param supabase - Supabase client.
 * @param seasonId - Season id.
 * @returns Array of team uuids in this season.
 */
export async function listTeamIdsInSeason(
  supabase: SupabaseClient,
  seasonId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("teams")
    .select("id")
    .eq("season_id", seasonId);
  if (error) throw error;
  return (data ?? []).map((r) => (r as { id: string }).id);
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/**
 * List events for a season, newest first.
 *
 * @param supabase - Supabase client.
 * @param seasonId - Season id.
 * @returns Ordered event rows.
 */
export async function listEventsForSeason(
  supabase: SupabaseClient,
  seasonId: string,
): Promise<EventRow[]> {
  const { data, error } = await supabase
    .from("events")
    .select(
      "id, season_id, event_date, is_published, published_at, created_at, updated_at",
    )
    .eq("season_id", seasonId)
    .order("event_date", { ascending: false });
  if (error) throw error;
  return (data ?? []) as EventRow[];
}

/**
 * Load one event by id.
 *
 * @param supabase - Supabase client.
 * @param id - Event id.
 * @returns The event or `null` if not found.
 */
export async function loadEvent(
  supabase: SupabaseClient,
  id: string,
): Promise<EventRow | null> {
  const { data, error } = await supabase
    .from("events")
    .select(
      "id, season_id, event_date, is_published, published_at, created_at, updated_at",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data as EventRow | null;
}

/**
 * Insert a new event. Callers must have validated the body first.
 *
 * @param supabase - Supabase client.
 * @param row - Event fields.
 * @returns The inserted event.
 */
export async function insertEvent(
  supabase: SupabaseClient,
  row: { season_id: string; event_date: string },
): Promise<EventRow> {
  const { data, error } = await supabase
    .from("events")
    .insert(row)
    .select(
      "id, season_id, event_date, is_published, published_at, created_at, updated_at",
    )
    .single();
  if (error) throw error;
  return data as EventRow;
}

/**
 * Sparse update. Only `event_date` is exposed at the API layer, but the
 * function itself takes a patch object so the same helper works for
 * publish/unpublish, which do their own writes for `is_published` and
 * `published_at`.
 *
 * @param supabase - Supabase client.
 * @param id - Event id.
 * @param patch - Fields to update.
 * @returns The updated event, or `null` if not found.
 */
export async function updateEvent(
  supabase: SupabaseClient,
  id: string,
  patch: Record<string, unknown>,
): Promise<EventRow | null> {
  const { data, error } = await supabase
    .from("events")
    .update(patch)
    .eq("id", id)
    .select(
      "id, season_id, event_date, is_published, published_at, created_at, updated_at",
    )
    .maybeSingle();
  if (error) throw error;
  return data as EventRow | null;
}

/**
 * Delete an event. Cascades to slots and fixtures via the schema, but the
 * caller MUST have refused this route on a published event first — RLS
 * would let public reads see the disappearing rows briefly otherwise.
 *
 * @param supabase - Supabase client.
 * @param id - Event id.
 * @returns The deleted id, or `null` if it didn't exist.
 */
export async function deleteEvent(
  supabase: SupabaseClient,
  id: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("events")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  return (data as { id: string } | null)?.id ?? null;
}

// ---------------------------------------------------------------------------
// Slots
// ---------------------------------------------------------------------------

/**
 * List slots for an event, ordered by slot_number.
 *
 * @param supabase - Supabase client.
 * @param eventId - Event id.
 * @returns Ordered slot rows.
 */
export async function listSlotsForEvent(
  supabase: SupabaseClient,
  eventId: string,
): Promise<SlotRow[]> {
  const { data, error } = await supabase
    .from("slots")
    .select("id, event_id, slot_number, starts_at, pitch, created_at")
    .eq("event_id", eventId)
    .order("slot_number", { ascending: true });
  if (error) throw error;
  return (data ?? []) as SlotRow[];
}

/**
 * Load one slot by id, scoped to a specific event so a caller can't reach
 * across events by guessing an id.
 *
 * @param supabase - Supabase client.
 * @param eventId - Owning event.
 * @param slotId - Slot id.
 * @returns The slot, or `null`.
 */
export async function loadSlotInEvent(
  supabase: SupabaseClient,
  eventId: string,
  slotId: string,
): Promise<SlotRow | null> {
  const { data, error } = await supabase
    .from("slots")
    .select("id, event_id, slot_number, starts_at, pitch, created_at")
    .eq("id", slotId)
    .eq("event_id", eventId)
    .maybeSingle();
  if (error) throw error;
  return data as SlotRow | null;
}

/**
 * Insert a slot.
 *
 * @param supabase - Supabase client.
 * @param row - Slot fields (event_id, slot_number, starts_at, pitch).
 * @returns The inserted slot.
 */
export async function insertSlot(
  supabase: SupabaseClient,
  row: {
    event_id: string;
    slot_number: number;
    starts_at: string;
    pitch: string | null;
  },
): Promise<SlotRow> {
  const { data, error } = await supabase
    .from("slots")
    .insert(row)
    .select("id, event_id, slot_number, starts_at, pitch, created_at")
    .single();
  if (error) throw error;
  return data as SlotRow;
}

/**
 * Sparse update on a slot.
 *
 * @param supabase - Supabase client.
 * @param slotId - Slot id.
 * @param patch - Fields to update.
 * @returns The updated slot, or `null`.
 */
export async function updateSlot(
  supabase: SupabaseClient,
  slotId: string,
  patch: Record<string, unknown>,
): Promise<SlotRow | null> {
  const { data, error } = await supabase
    .from("slots")
    .update(patch)
    .eq("id", slotId)
    .select("id, event_id, slot_number, starts_at, pitch, created_at")
    .maybeSingle();
  if (error) throw error;
  return data as SlotRow | null;
}

/**
 * Delete a slot. Callers must verify no fixtures reference the slot first
 * — the FK on `fixtures.slot_id` is `on delete restrict`.
 *
 * @param supabase - Supabase client.
 * @param slotId - Slot id.
 * @returns The deleted id, or `null` if it didn't exist.
 */
export async function deleteSlot(
  supabase: SupabaseClient,
  slotId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("slots")
    .delete()
    .eq("id", slotId)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  return (data as { id: string } | null)?.id ?? null;
}

/**
 * Count fixtures referencing a slot. Cheap pre-check for delete.
 *
 * @param supabase - Supabase client.
 * @param slotId - Slot id.
 * @returns Number of fixtures in the slot.
 */
export async function countFixturesInSlot(
  supabase: SupabaseClient,
  slotId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("fixtures")
    .select("id", { count: "exact", head: true })
    .eq("slot_id", slotId);
  if (error) throw error;
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * List every fixture on an event, ordered by slot then created time so
 * organiser UIs render a stable draw.
 *
 * @param supabase - Supabase client.
 * @param eventId - Event id.
 * @returns Ordered fixture rows.
 */
export async function listFixturesForEvent(
  supabase: SupabaseClient,
  eventId: string,
): Promise<FixtureRow[]> {
  const { data, error } = await supabase
    .from("fixtures")
    .select(
      "id, event_id, slot_id, home_team_id, away_team_id, sport, status, created_at, updated_at",
    )
    .eq("event_id", eventId)
    .order("slot_id", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as FixtureRow[];
}

/**
 * Load one fixture, scoped to an event.
 *
 * @param supabase - Supabase client.
 * @param eventId - Owning event id.
 * @param fixtureId - Fixture id.
 * @returns The fixture, or `null`.
 */
export async function loadFixtureInEvent(
  supabase: SupabaseClient,
  eventId: string,
  fixtureId: string,
): Promise<FixtureRow | null> {
  const { data, error } = await supabase
    .from("fixtures")
    .select(
      "id, event_id, slot_id, home_team_id, away_team_id, sport, status, created_at, updated_at",
    )
    .eq("id", fixtureId)
    .eq("event_id", eventId)
    .maybeSingle();
  if (error) throw error;
  return data as FixtureRow | null;
}

/**
 * Insert one fixture. `status` defaults to `'scheduled'` via the schema.
 *
 * @param supabase - Supabase client.
 * @param row - Fixture fields.
 * @returns The inserted fixture.
 */
export async function insertFixture(
  supabase: SupabaseClient,
  row: {
    event_id: string;
    slot_id: string;
    sport: string;
    home_team_id: string;
    away_team_id: string | null;
  },
): Promise<FixtureRow> {
  const { data, error } = await supabase
    .from("fixtures")
    .insert(row)
    .select(
      "id, event_id, slot_id, home_team_id, away_team_id, sport, status, created_at, updated_at",
    )
    .single();
  if (error) throw error;
  return data as FixtureRow;
}

/**
 * Bulk-insert fixtures. Used by `/generate` where we insert a whole draw
 * atomically after preview passes. A single insert is one round-trip;
 * looping `insertFixture` would N-ify latency.
 *
 * @param supabase - Supabase client.
 * @param rows - Fixture rows.
 * @returns The inserted fixture rows.
 */
export async function insertFixtures(
  supabase: SupabaseClient,
  rows: Array<{
    event_id: string;
    slot_id: string;
    sport: string;
    home_team_id: string;
    away_team_id: string | null;
  }>,
): Promise<FixtureRow[]> {
  if (rows.length === 0) return [];
  const { data, error } = await supabase
    .from("fixtures")
    .insert(rows)
    .select(
      "id, event_id, slot_id, home_team_id, away_team_id, sport, status, created_at, updated_at",
    );
  if (error) throw error;
  return (data ?? []) as FixtureRow[];
}

/**
 * Sparse update on a fixture.
 *
 * @param supabase - Supabase client.
 * @param fixtureId - Fixture id.
 * @param patch - Fields to update.
 * @returns The updated fixture, or `null`.
 */
export async function updateFixture(
  supabase: SupabaseClient,
  fixtureId: string,
  patch: Record<string, unknown>,
): Promise<FixtureRow | null> {
  const { data, error } = await supabase
    .from("fixtures")
    .update(patch)
    .eq("id", fixtureId)
    .select(
      "id, event_id, slot_id, home_team_id, away_team_id, sport, status, created_at, updated_at",
    )
    .maybeSingle();
  if (error) throw error;
  return data as FixtureRow | null;
}

/**
 * Delete a fixture. Callers must ensure the fixture has no `match_events`
 * — deleting a scored fixture would silently orphan the audit trail (the
 * schema has `on delete cascade`, which is worse: the events vanish).
 *
 * @param supabase - Supabase client.
 * @param fixtureId - Fixture id.
 * @returns The deleted id, or `null`.
 */
export async function deleteFixture(
  supabase: SupabaseClient,
  fixtureId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("fixtures")
    .delete()
    .eq("id", fixtureId)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  return (data as { id: string } | null)?.id ?? null;
}

/**
 * Count match_events attached to a fixture. Zero means it's safe to delete
 * the fixture.
 *
 * @param supabase - Supabase client.
 * @param fixtureId - Fixture id.
 * @returns Event count.
 */
export async function countMatchEventsForFixture(
  supabase: SupabaseClient,
  fixtureId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("match_events")
    .select("id", { count: "exact", head: true })
    .eq("fixture_id", fixtureId);
  if (error) throw error;
  return count ?? 0;
}
