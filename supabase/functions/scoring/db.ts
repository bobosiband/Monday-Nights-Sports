// -----------------------------------------------------------------------------
// scoring/db.ts
//
// All Supabase reads/writes for the scoring service live here so handlers
// stay HTTP-shaped and are easy to reason about. Every function is thin —
// one query, one shape — and lets errors bubble so the top-level try/catch
// in the router can log + return 500.
// -----------------------------------------------------------------------------

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { createServiceClient } from "../_shared/supabase-client.ts";
import type { MatchEvent, SportConfig } from "../_shared/score.ts";
import type { DecidedBy, FixtureStatus } from "./constants.ts";
import type { FixtureContext, PeriodBreakdown } from "./types.ts";

/**
 * Build the DB client. Kept as a wrapper so tests can inject a fake later.
 *
 * @returns A service-role Supabase client.
 */
export function client(): SupabaseClient {
  return createServiceClient();
}

/**
 * Load the fixture + its parent event's season_id in a single query. Used
 * as the first step of every write handler so downstream logic has the
 * team ids, sport, and current status without re-querying.
 *
 * @param supabase - The Supabase client.
 * @param fixtureId - UUID of the fixture.
 * @returns The fixture context, or `null` if no such fixture exists.
 */
export async function loadFixtureContext(
  supabase: SupabaseClient,
  fixtureId: string,
): Promise<FixtureContext | null> {
  const { data, error } = await supabase
    .from("fixtures")
    .select(
      "id, event_id, home_team_id, away_team_id, sport, status, events:event_id ( season_id )",
    )
    .eq("id", fixtureId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  // Supabase returns the related row nested; flatten so downstream code
  // has a single shape.
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
 * Load the sport_config row for a (season, sport). Returns an empty config
 * object if none exists — the scoring service refuses to reject writes
 * purely on a missing config, so an organiser can start scoring before
 * they've customised sport rules.
 *
 * @param supabase - The Supabase client.
 * @param seasonId - UUID of the season.
 * @param sport - Sport name (matches fixtures.sport).
 * @returns The parsed config, or an empty object.
 */
export async function loadSportConfig(
  supabase: SupabaseClient,
  seasonId: string,
  sport: string,
): Promise<SportConfig> {
  const { data, error } = await supabase
    .from("sport_configs")
    .select("config")
    .eq("season_id", seasonId)
    .eq("sport", sport)
    .maybeSingle();
  if (error) throw error;
  return (data?.config ?? {}) as SportConfig;
}

/**
 * Load every match_event for a fixture, ordered oldest-first so the fold
 * can walk them in-place.
 *
 * @param supabase - The Supabase client.
 * @param fixtureId - UUID of the fixture.
 * @returns Ordered events.
 */
export async function loadEvents(
  supabase: SupabaseClient,
  fixtureId: string,
): Promise<MatchEvent[]> {
  const { data, error } = await supabase
    .from("match_events")
    .select(
      "id, fixture_id, type, team_id, player_id, value, period, match_clock_ms, voided_at, created_at",
    )
    .eq("fixture_id", fixtureId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as MatchEvent[];
}

/**
 * Fetch a single event by id (used by undo). Returns `null` when missing.
 *
 * @param supabase - The Supabase client.
 * @param eventId - UUID of the event.
 * @returns The event row or `null`.
 */
export async function findEvent(
  supabase: SupabaseClient,
  eventId: string,
): Promise<MatchEvent | null> {
  const { data, error } = await supabase
    .from("match_events")
    .select(
      "id, fixture_id, type, team_id, player_id, value, period, match_clock_ms, voided_at, created_at",
    )
    .eq("id", eventId)
    .maybeSingle();
  if (error) throw error;
  return (data as MatchEvent | null) ?? null;
}

/**
 * Insert a match_event. Uses upsert with `ignoreDuplicates: true` so a
 * retried offline queue produces the same result as the first attempt.
 *
 * @param supabase - The Supabase client.
 * @param event - The event row to insert.
 * @returns `{ inserted }` — `true` when the row was newly written, `false`
 *          when the id was already present.
 */
export async function insertEvent(
  supabase: SupabaseClient,
  event: Omit<MatchEvent, "created_at"> & { created_by?: string | null },
): Promise<{ inserted: boolean }> {
  const { data, error } = await supabase
    .from("match_events")
    .upsert(event, { onConflict: "id", ignoreDuplicates: true })
    .select("id");
  if (error) throw error;
  return { inserted: (data?.length ?? 0) > 0 };
}

/**
 * Soft-void a match_event. Idempotent — voiding an already-voided event
 * leaves `voided_at` unchanged.
 *
 * @param supabase - The Supabase client.
 * @param eventId - UUID of the event.
 * @param voidedBy - UUID of the operator recording the undo. Always null
 *                   today: `match_events.voided_by` references
 *                   `auth.users`, but sideline operators authenticate via
 *                   `match_access` codes and have no auth user. See
 *                   ADR 0005 for the deferred-attribution plan.
 * @returns `{ alreadyVoided }` so the handler can pick the right response.
 */
export async function voidEvent(
  supabase: SupabaseClient,
  eventId: string,
  voidedBy: string | null,
): Promise<{ alreadyVoided: boolean }> {
  const { data, error } = await supabase
    .from("match_events")
    .update({ voided_at: new Date().toISOString(), voided_by: voidedBy })
    .eq("id", eventId)
    .is("voided_at", null)
    .select("id");
  if (error) throw error;
  return { alreadyVoided: (data?.length ?? 0) === 0 };
}

/**
 * Update the status column on a fixture. No-op when the fixture is already
 * in the target status.
 *
 * @param supabase - The Supabase client.
 * @param fixtureId - UUID of the fixture.
 * @param status - Target status.
 */
export async function updateFixtureStatus(
  supabase: SupabaseClient,
  fixtureId: string,
  status: FixtureStatus,
): Promise<void> {
  const { error } = await supabase
    .from("fixtures")
    .update({ status })
    .eq("id", fixtureId);
  if (error) throw error;
}

/**
 * Upsert the fixture_live_state projection row. One row per fixture.
 * `on conflict (fixture_id)` handles both the first write and subsequent
 * updates; the caller doesn't need to know which one it is.
 *
 * @param supabase - The Supabase client.
 * @param row - The projection payload built from a DerivedScore.
 */
export async function upsertLiveState(
  supabase: SupabaseClient,
  row: {
    fixture_id: string;
    home_score: number;
    away_score: number;
    fouls: Record<string, number>;
    current_period: number | null;
    status: FixtureStatus;
    last_event_at: string | null;
  },
): Promise<void> {
  const { error } = await supabase
    .from("fixture_live_state")
    .upsert(row, { onConflict: "fixture_id" });
  if (error) throw error;
}

/**
 * Upsert the results row for a fixture. `unique(fixture_id)` on `results`
 * guarantees at most one row per fixture — an organiser correction is an
 * update, never a second row.
 *
 * @param supabase - The Supabase client.
 * @param fixtureId - UUID of the fixture.
 * @param home - Final home score.
 * @param away - Final away score.
 * @param periods - Period-by-period breakdown to persist in JSONB.
 * @param decidedBy - How the fixture concluded.
 * @param confirmedBy - UUID of the operator (nullable in Sprint B).
 */
export async function upsertResult(
  supabase: SupabaseClient,
  fixtureId: string,
  home: number,
  away: number,
  periods: PeriodBreakdown[],
  decidedBy: DecidedBy,
  confirmedBy: string | null,
): Promise<void> {
  const { error } = await supabase
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
