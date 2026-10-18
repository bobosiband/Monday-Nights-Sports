// -----------------------------------------------------------------------------
// events/data/EventsRepository.ts
//
// All database access for the events service. Keeps the handlers HTTP-shaped
// and lets tests pass a fake repository through the handler constructors.
// -----------------------------------------------------------------------------

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { createServiceClient } from "../lib/SupabaseClientFactory.ts";

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

/** Data access contract for the events service. */
export interface EventsRepository {
  loadSeason(seasonId: string): Promise<SeasonRow | null>;
  listTeamIdsInSeason(seasonId: string): Promise<string[]>;

  listEventsForSeason(seasonId: string): Promise<EventRow[]>;
  loadEvent(id: string): Promise<EventRow | null>;
  insertEvent(
    row: { season_id: string; event_date: string },
  ): Promise<EventRow>;
  updateEvent(
    id: string,
    patch: Record<string, unknown>,
  ): Promise<EventRow | null>;
  deleteEvent(id: string): Promise<string | null>;

  listSlotsForEvent(eventId: string): Promise<SlotRow[]>;
  loadSlotInEvent(eventId: string, slotId: string): Promise<SlotRow | null>;
  insertSlot(row: {
    event_id: string;
    slot_number: number;
    starts_at: string;
    pitch: string | null;
  }): Promise<SlotRow>;
  updateSlot(
    slotId: string,
    patch: Record<string, unknown>,
  ): Promise<SlotRow | null>;
  deleteSlot(slotId: string): Promise<string | null>;
  countFixturesInSlot(slotId: string): Promise<number>;

  listFixturesForEvent(eventId: string): Promise<FixtureRow[]>;
  loadFixtureInEvent(
    eventId: string,
    fixtureId: string,
  ): Promise<FixtureRow | null>;
  insertFixture(row: {
    event_id: string;
    slot_id: string;
    sport: string;
    home_team_id: string;
    away_team_id: string | null;
  }): Promise<FixtureRow>;
  insertFixtures(
    rows: Array<{
      event_id: string;
      slot_id: string;
      sport: string;
      home_team_id: string;
      away_team_id: string | null;
    }>,
  ): Promise<FixtureRow[]>;
  updateFixture(
    fixtureId: string,
    patch: Record<string, unknown>,
  ): Promise<FixtureRow | null>;
  deleteFixture(fixtureId: string): Promise<string | null>;
  countMatchEventsForFixture(fixtureId: string): Promise<number>;
}

const EVENT_COLS =
  "id, season_id, event_date, is_published, published_at, created_at, updated_at";
const SLOT_COLS = "id, event_id, slot_number, starts_at, pitch, created_at";
const FIXTURE_COLS =
  "id, event_id, slot_id, home_team_id, away_team_id, sport, status, created_at, updated_at";

/** Supabase-backed implementation of `EventsRepository`. */
export class SupabaseEventsRepository implements EventsRepository {
  private readonly client: SupabaseClient;

  /**
   * @param client - Supabase client; defaults to the service-role client.
   */
  constructor(client: SupabaseClient = createServiceClient()) {
    this.client = client;
  }

  /** @param seasonId - Season id. */
  async loadSeason(seasonId: string): Promise<SeasonRow | null> {
    const { data, error } = await this.client
      .from("seasons")
      .select("id, sports, is_archived")
      .eq("id", seasonId)
      .maybeSingle();
    if (error) throw error;
    return (data as SeasonRow | null) ?? null;
  }

  /** @param seasonId - Season id. */
  async listTeamIdsInSeason(seasonId: string): Promise<string[]> {
    const { data, error } = await this.client
      .from("teams")
      .select("id")
      .eq("season_id", seasonId);
    if (error) throw error;
    return (data ?? []).map((r) => (r as { id: string }).id);
  }

  /** @param seasonId - Season id. */
  async listEventsForSeason(seasonId: string): Promise<EventRow[]> {
    const { data, error } = await this.client
      .from("events")
      .select(EVENT_COLS)
      .eq("season_id", seasonId)
      .order("event_date", { ascending: false });
    if (error) throw error;
    return (data ?? []) as EventRow[];
  }

  /** @param id - Event id. */
  async loadEvent(id: string): Promise<EventRow | null> {
    const { data, error } = await this.client
      .from("events")
      .select(EVENT_COLS)
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return (data as EventRow | null) ?? null;
  }

  /** @param row - New event fields. */
  async insertEvent(
    row: { season_id: string; event_date: string },
  ): Promise<EventRow> {
    const { data, error } = await this.client
      .from("events")
      .insert(row)
      .select(EVENT_COLS)
      .single();
    if (error) throw error;
    return data as EventRow;
  }

  /**
   * @param id - Event id.
   * @param patch - Fields to update.
   */
  async updateEvent(
    id: string,
    patch: Record<string, unknown>,
  ): Promise<EventRow | null> {
    const { data, error } = await this.client
      .from("events")
      .update(patch)
      .eq("id", id)
      .select(EVENT_COLS)
      .maybeSingle();
    if (error) throw error;
    return (data as EventRow | null) ?? null;
  }

  /** @param id - Event id. */
  async deleteEvent(id: string): Promise<string | null> {
    const { data, error } = await this.client
      .from("events")
      .delete()
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    return (data as { id: string } | null)?.id ?? null;
  }

  /** @param eventId - Event id. */
  async listSlotsForEvent(eventId: string): Promise<SlotRow[]> {
    const { data, error } = await this.client
      .from("slots")
      .select(SLOT_COLS)
      .eq("event_id", eventId)
      .order("slot_number", { ascending: true });
    if (error) throw error;
    return (data ?? []) as SlotRow[];
  }

  /**
   * @param eventId - Owning event id.
   * @param slotId - Slot id.
   */
  async loadSlotInEvent(
    eventId: string,
    slotId: string,
  ): Promise<SlotRow | null> {
    const { data, error } = await this.client
      .from("slots")
      .select(SLOT_COLS)
      .eq("id", slotId)
      .eq("event_id", eventId)
      .maybeSingle();
    if (error) throw error;
    return (data as SlotRow | null) ?? null;
  }

  /** @param row - Slot fields. */
  async insertSlot(row: {
    event_id: string;
    slot_number: number;
    starts_at: string;
    pitch: string | null;
  }): Promise<SlotRow> {
    const { data, error } = await this.client
      .from("slots")
      .insert(row)
      .select(SLOT_COLS)
      .single();
    if (error) throw error;
    return data as SlotRow;
  }

  /**
   * @param slotId - Slot id.
   * @param patch - Fields to update.
   */
  async updateSlot(
    slotId: string,
    patch: Record<string, unknown>,
  ): Promise<SlotRow | null> {
    const { data, error } = await this.client
      .from("slots")
      .update(patch)
      .eq("id", slotId)
      .select(SLOT_COLS)
      .maybeSingle();
    if (error) throw error;
    return (data as SlotRow | null) ?? null;
  }

  /** @param slotId - Slot id. */
  async deleteSlot(slotId: string): Promise<string | null> {
    const { data, error } = await this.client
      .from("slots")
      .delete()
      .eq("id", slotId)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    return (data as { id: string } | null)?.id ?? null;
  }

  /** @param slotId - Slot id. */
  async countFixturesInSlot(slotId: string): Promise<number> {
    const { count, error } = await this.client
      .from("fixtures")
      .select("id", { count: "exact", head: true })
      .eq("slot_id", slotId);
    if (error) throw error;
    return count ?? 0;
  }

  /** @param eventId - Event id. */
  async listFixturesForEvent(eventId: string): Promise<FixtureRow[]> {
    const { data, error } = await this.client
      .from("fixtures")
      .select(FIXTURE_COLS)
      .eq("event_id", eventId)
      .order("slot_id", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data ?? []) as FixtureRow[];
  }

  /**
   * @param eventId - Owning event id.
   * @param fixtureId - Fixture id.
   */
  async loadFixtureInEvent(
    eventId: string,
    fixtureId: string,
  ): Promise<FixtureRow | null> {
    const { data, error } = await this.client
      .from("fixtures")
      .select(FIXTURE_COLS)
      .eq("id", fixtureId)
      .eq("event_id", eventId)
      .maybeSingle();
    if (error) throw error;
    return (data as FixtureRow | null) ?? null;
  }

  /** @param row - Fixture fields. */
  async insertFixture(row: {
    event_id: string;
    slot_id: string;
    sport: string;
    home_team_id: string;
    away_team_id: string | null;
  }): Promise<FixtureRow> {
    const { data, error } = await this.client
      .from("fixtures")
      .insert(row)
      .select(FIXTURE_COLS)
      .single();
    if (error) throw error;
    return data as FixtureRow;
  }

  /**
   * Bulk-insert fixtures. Used by `/generate` where we insert a whole draw
   * atomically. One insert is one round-trip; looping would N-ify latency.
   *
   * @param rows - Fixture rows.
   */
  async insertFixtures(
    rows: Array<{
      event_id: string;
      slot_id: string;
      sport: string;
      home_team_id: string;
      away_team_id: string | null;
    }>,
  ): Promise<FixtureRow[]> {
    if (rows.length === 0) return [];
    const { data, error } = await this.client
      .from("fixtures")
      .insert(rows)
      .select(FIXTURE_COLS);
    if (error) throw error;
    return (data ?? []) as FixtureRow[];
  }

  /**
   * @param fixtureId - Fixture id.
   * @param patch - Fields to update.
   */
  async updateFixture(
    fixtureId: string,
    patch: Record<string, unknown>,
  ): Promise<FixtureRow | null> {
    const { data, error } = await this.client
      .from("fixtures")
      .update(patch)
      .eq("id", fixtureId)
      .select(FIXTURE_COLS)
      .maybeSingle();
    if (error) throw error;
    return (data as FixtureRow | null) ?? null;
  }

  /** @param fixtureId - Fixture id. */
  async deleteFixture(fixtureId: string): Promise<string | null> {
    const { data, error } = await this.client
      .from("fixtures")
      .delete()
      .eq("id", fixtureId)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    return (data as { id: string } | null)?.id ?? null;
  }

  /** @param fixtureId - Fixture id. */
  async countMatchEventsForFixture(fixtureId: string): Promise<number> {
    const { count, error } = await this.client
      .from("match_events")
      .select("id", { count: "exact", head: true })
      .eq("fixture_id", fixtureId);
    if (error) throw error;
    return count ?? 0;
  }
}
