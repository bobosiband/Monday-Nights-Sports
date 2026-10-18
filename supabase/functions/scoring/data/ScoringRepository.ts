// -----------------------------------------------------------------------------
// scoring/data/ScoringRepository.ts
//
// All database access for the scoring service. Keeps the handlers HTTP-shaped
// and lets tests pass a fake repository through the handler constructors.
// -----------------------------------------------------------------------------

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { createServiceClient } from "../lib/SupabaseClientFactory.ts";
import type { MatchEvent, SportConfig } from "../domain/ScoreCalculator.ts";
import type { DecidedBy, FixtureStatus } from "../domain/ScoringActions.ts";
import type {
  FixtureContext,
  PeriodBreakdown,
} from "../domain/ScoringTypes.ts";

/** Payload written to `fixture_live_state` on every scoring write. */
export interface LiveStateRow {
  fixture_id: string;
  home_score: number;
  away_score: number;
  fouls: Record<string, number>;
  current_period: number | null;
  status: FixtureStatus;
  last_event_at: string | null;
}

/** Data access contract for the scoring service. */
export interface ScoringRepository {
  loadFixtureContext(fixtureId: string): Promise<FixtureContext | null>;
  loadSportConfig(seasonId: string, sport: string): Promise<SportConfig>;
  loadEvents(fixtureId: string): Promise<MatchEvent[]>;
  findEvent(eventId: string): Promise<MatchEvent | null>;
  insertEvent(
    event: Omit<MatchEvent, "created_at"> & { created_by?: string | null },
  ): Promise<{ inserted: boolean }>;
  voidEvent(
    eventId: string,
    voidedBy: string | null,
  ): Promise<{ alreadyVoided: boolean }>;
  updateFixtureStatus(
    fixtureId: string,
    status: FixtureStatus,
  ): Promise<void>;
  upsertLiveState(row: LiveStateRow): Promise<void>;
  upsertResult(
    fixtureId: string,
    home: number,
    away: number,
    periods: PeriodBreakdown[],
    decidedBy: DecidedBy,
    confirmedBy: string | null,
  ): Promise<void>;
}

const EVENT_COLS =
  "id, fixture_id, type, team_id, player_id, value, period, match_clock_ms, voided_at, created_at";

/** Supabase-backed implementation of `ScoringRepository`. */
export class SupabaseScoringRepository implements ScoringRepository {
  private readonly client: SupabaseClient;

  /** @param client - Supabase client; defaults to the service-role client. */
  constructor(client: SupabaseClient = createServiceClient()) {
    this.client = client;
  }

  /**
   * Load the fixture plus its parent event's season_id. Used as the first
   * step of every write handler.
   *
   * @param fixtureId - UUID of the fixture.
   * @returns The fixture context, or `null` when not found.
   */
  async loadFixtureContext(
    fixtureId: string,
  ): Promise<FixtureContext | null> {
    const { data, error } = await this.client
      .from("fixtures")
      .select(
        "id, event_id, home_team_id, away_team_id, sport, status, events:event_id ( season_id )",
      )
      .eq("id", fixtureId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;

    const nested = (data as unknown as {
      events: { season_id: string } | { season_id: string }[] | null;
    }).events;
    const seasonId = Array.isArray(nested)
      ? nested[0]?.season_id
      : nested?.season_id;
    if (!seasonId) return null;

    return {
      id: data.id,
      event_id: data.event_id,
      season_id: seasonId,
      home_team_id: data.home_team_id,
      away_team_id: data.away_team_id,
      sport: data.sport,
      status: data.status as FixtureStatus,
    };
  }

  /**
   * Load the sport_config row for a (season, sport). Returns an empty
   * config when none exists.
   *
   * @param seasonId - UUID of the season.
   * @param sport - Sport name.
   * @returns The parsed config, or an empty object.
   */
  async loadSportConfig(
    seasonId: string,
    sport: string,
  ): Promise<SportConfig> {
    const { data, error } = await this.client
      .from("sport_configs")
      .select("config")
      .eq("season_id", seasonId)
      .eq("sport", sport)
      .maybeSingle();
    if (error) throw error;
    return (data?.config ?? {}) as SportConfig;
  }

  /**
   * Load every match_event for a fixture, ordered oldest-first.
   *
   * @param fixtureId - UUID of the fixture.
   * @returns Ordered events.
   */
  async loadEvents(fixtureId: string): Promise<MatchEvent[]> {
    const { data, error } = await this.client
      .from("match_events")
      .select(EVENT_COLS)
      .eq("fixture_id", fixtureId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data ?? []) as MatchEvent[];
  }

  /**
   * @param eventId - UUID of the event.
   * @returns The event row, or `null`.
   */
  async findEvent(eventId: string): Promise<MatchEvent | null> {
    const { data, error } = await this.client
      .from("match_events")
      .select(EVENT_COLS)
      .eq("id", eventId)
      .maybeSingle();
    if (error) throw error;
    return (data as MatchEvent | null) ?? null;
  }

  /**
   * Insert a match_event. Uses upsert with `ignoreDuplicates: true` so a
   * retried offline queue produces the same result as the first attempt.
   *
   * @param event - The event row to insert.
   * @returns Whether the row was newly written.
   */
  async insertEvent(
    event: Omit<MatchEvent, "created_at"> & { created_by?: string | null },
  ): Promise<{ inserted: boolean }> {
    const { data, error } = await this.client
      .from("match_events")
      .upsert(event, { onConflict: "id", ignoreDuplicates: true })
      .select("id");
    if (error) throw error;
    return { inserted: (data?.length ?? 0) > 0 };
  }

  /**
   * Soft-void a match_event. Idempotent: voiding an already-voided event
   * leaves `voided_at` unchanged.
   *
   * @param eventId - UUID of the event.
   * @param voidedBy - UUID of the operator recording the undo. Always
   * null today: see ADR 0005.
   * @returns Whether the row was already voided.
   */
  async voidEvent(
    eventId: string,
    voidedBy: string | null,
  ): Promise<{ alreadyVoided: boolean }> {
    const { data, error } = await this.client
      .from("match_events")
      .update({ voided_at: new Date().toISOString(), voided_by: voidedBy })
      .eq("id", eventId)
      .is("voided_at", null)
      .select("id");
    if (error) throw error;
    return { alreadyVoided: (data?.length ?? 0) === 0 };
  }

  /**
   * Update the status column on a fixture.
   *
   * @param fixtureId - UUID of the fixture.
   * @param status - Target status.
   */
  async updateFixtureStatus(
    fixtureId: string,
    status: FixtureStatus,
  ): Promise<void> {
    const { error } = await this.client
      .from("fixtures")
      .update({ status })
      .eq("id", fixtureId);
    if (error) throw error;
  }

  /**
   * Upsert the fixture_live_state projection row.
   *
   * @param row - The projection payload.
   */
  async upsertLiveState(row: LiveStateRow): Promise<void> {
    const { error } = await this.client
      .from("fixture_live_state")
      .upsert(row, { onConflict: "fixture_id" });
    if (error) throw error;
  }

  /**
   * Upsert the results row for a fixture.
   *
   * @param fixtureId - UUID of the fixture.
   * @param home - Final home score.
   * @param away - Final away score.
   * @param periods - Period-by-period breakdown persisted in JSONB.
   * @param decidedBy - How the fixture concluded.
   * @param confirmedBy - UUID of the operator (nullable).
   */
  async upsertResult(
    fixtureId: string,
    home: number,
    away: number,
    periods: PeriodBreakdown[],
    decidedBy: DecidedBy,
    confirmedBy: string | null,
  ): Promise<void> {
    const { error } = await this.client
      .from("results")
      .upsert(
        {
          fixture_id: fixtureId,
          home_score: home,
          away_score: away,
          periods,
          decided_by: decidedBy,
          confirmed_at: new Date().toISOString(),
          confirmed_by: confirmedBy,
        },
        { onConflict: "fixture_id" },
      );
    if (error) throw error;
  }
}
