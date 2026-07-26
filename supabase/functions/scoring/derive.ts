// -----------------------------------------------------------------------------
// scoring/derive.ts
//
// Handler-level helpers that combine DB loads with the pure `deriveScore`
// fold and build the standard response envelope. Kept out of `db.ts` so
// that file stays a pure "just Supabase queries" module.
//
// Also owns the write to `fixture_live_state`, the realtime projection
// (see docs/decisions/0003-realtime-projection.md). Every handler funnels
// through `respondDerived`, so this is the single place where the
// projection can be forgotten. It CANNOT — a projection write failure
// must not fail the scoring request, so we always attempt it, log on
// error, and continue.
// -----------------------------------------------------------------------------

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { jsonResponse } from "../_shared/cors.ts";
import { deriveScore, type DerivedScore } from "../_shared/score.ts";
import { loadEvents, loadSportConfig, upsertLiveState } from "./db.ts";
import type { FixtureContext, DerivedResponse } from "./types.ts";
import type { FixtureStatus } from "./constants.ts";

/**
 * Load the fixture's events + sport config, fold them into a derived
 * summary, upsert the realtime projection, and build the standard
 * `DerivedResponse` shape. Used by every write handler so the response
 * envelope AND the projection stay consistent.
 *
 * Projection failures are logged but never propagate — the event log is
 * the source of truth and `scripts/rebuild-live-state.sql` can regenerate
 * the projection from scratch. Letting a projection glitch 500 a scoring
 * write would be strictly worse.
 *
 * @param supabase - The Supabase client.
 * @param fixture - The fixture context.
 * @param overrideStatus - When the caller has just changed
 *                         `fixtures.status` in-flight, pass the new value
 *                         so the response reflects it without a re-query.
 * @returns A JSON `Response` with `{ fixture_id, fixture_status, derived }`.
 */
export async function respondDerived(
  supabase: SupabaseClient,
  fixture: FixtureContext,
  overrideStatus?: FixtureStatus,
): Promise<Response> {
  const [events, config] = await Promise.all([
    loadEvents(supabase, fixture.id),
    loadSportConfig(supabase, fixture.season_id, fixture.sport),
  ]);
  const derived = deriveScore(
    events,
    fixture.home_team_id,
    fixture.away_team_id,
    config,
  );
  const effectiveStatus: FixtureStatus = overrideStatus ?? fixture.status;

  // Latest non-voided event drives `last_event_at`. Events are already
  // ordered by created_at ascending in loadEvents; we search from the
  // back so a fully-voided log still yields null cleanly.
  let lastEventAt: string | null = null;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].voided_at === null) {
      lastEventAt = events[i].created_at;
      break;
    }
  }

  await writeLiveState(supabase, fixture.id, derived, effectiveStatus, lastEventAt);

  const body: DerivedResponse = {
    fixture_id: fixture.id,
    fixture_status: effectiveStatus,
    derived,
  };
  return jsonResponse(body);
}

/**
 * Upsert the fixture_live_state row. Non-fatal: logs and swallows errors
 * so a projection glitch never fails the scoring write.
 *
 * @param supabase - The Supabase client.
 * @param fixtureId - Fixture id.
 * @param derived - The derived score summary.
 * @param status - The fixture's current status (post-update, if any).
 * @param lastEventAt - ISO timestamp of the most recent non-voided event,
 *                      or null when no events exist.
 */
export async function writeLiveState(
  supabase: SupabaseClient,
  fixtureId: string,
  derived: DerivedScore,
  status: FixtureStatus,
  lastEventAt: string | null,
): Promise<void> {
  try {
    await upsertLiveState(supabase, {
      fixture_id: fixtureId,
      home_score: derived.home,
      away_score: derived.away,
      fouls: derived.foulsByTeam,
      current_period: derived.currentPeriod,
      status,
      last_event_at: lastEventAt,
    });
  } catch (error) {
    console.warn(
      `[scoring] fixture_live_state upsert failed for ${fixtureId}; ` +
        `event log is still authoritative:`,
      error,
    );
  }
}
