// -----------------------------------------------------------------------------
// scoring/derive.ts
//
// Handler-level helpers that combine DB loads with the pure `deriveScore`
// fold and build the standard response envelope. Kept out of `db.ts` so
// that file stays a pure "just Supabase queries" module.
// -----------------------------------------------------------------------------

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { jsonResponse } from "../_shared/cors.ts";
import { deriveScore } from "../_shared/score.ts";
import { loadEvents, loadSportConfig } from "./db.ts";
import type { FixtureContext, DerivedResponse } from "./types.ts";
import type { FixtureStatus } from "./constants.ts";

/**
 * Load the fixture's events + sport config, fold them into a derived
 * summary, and build the standard `DerivedResponse` shape. Used by every
 * write handler so the response envelope is consistent.
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
  const body: DerivedResponse = {
    fixture_id: fixture.id,
    fixture_status: overrideStatus ?? fixture.status,
    derived,
  };
  return jsonResponse(body);
}
