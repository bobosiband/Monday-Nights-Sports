// -----------------------------------------------------------------------------
// live/domain/LiveSummary.ts
//
// Shape of the live-score summary returned to viewers, and the pure
// transformation from a (fixture, live-state) pair to that shape. No DB
// access here: the data layer loads the rows and this file reshapes.
// -----------------------------------------------------------------------------

/**
 * Public shape of the JSON body returned for one fixture. Deliberately
 * flat so a mobile viewer does not have to hop through nested objects.
 */
export interface LiveSummary {
  fixture_id: string;
  sport: string;
  status: string;
  home: { team_id: string; name: string; score: number };
  away: { team_id: string; name: string; score: number } | null;
  fouls: Record<string, number>;
  current_period: number | null;
  last_event_at: string | null;
  realtime: {
    channel: string;
    table: string;
    filter: string;
  };
}

/** Fixture columns the summary needs. */
export interface FixtureForSummary {
  id: string;
  event_id: string;
  sport: string;
  status: string;
  home_team_id: string;
  away_team_id: string | null;
  home_team: { name: string } | null;
  away_team: { name: string } | null;
}

/** Live-state row columns the summary needs. */
export interface LiveStateForSummary {
  fixture_id: string;
  home_score: number;
  away_score: number;
  fouls: Record<string, number>;
  current_period: number | null;
  status: string;
  last_event_at: string | null;
}

/**
 * Build the realtime subscription hint object for a fixture. The shape is
 * documented in `docs/realtime.md` so clients do not need to guess.
 *
 * @param fixtureId - Fixture id.
 * @returns Channel, table and filter a Supabase Realtime client can use.
 */
export function realtimeHint(fixtureId: string): LiveSummary["realtime"] {
  return {
    channel: `fixture:${fixtureId}`,
    table: "public.fixture_live_state",
    filter: `fixture_id=eq.${fixtureId}`,
  };
}

/**
 * Merge a fixture row with an optional live-state row into a public
 * summary. When no live-state row exists the summary is zeroed and takes
 * status straight from the fixture, which is the right default for a
 * fixture that has never been scored.
 *
 * @param fixture - Fixture row with team relations expanded.
 * @param live - The projection row, or `null`.
 * @returns A flat summary suitable for the response.
 */
export function toSummary(
  fixture: FixtureForSummary,
  live: LiveStateForSummary | null,
): LiveSummary {
  return {
    fixture_id: fixture.id,
    sport: fixture.sport,
    status: live?.status ?? fixture.status,
    home: {
      team_id: fixture.home_team_id,
      name: fixture.home_team?.name ?? "TBD",
      score: live?.home_score ?? 0,
    },
    away: fixture.away_team_id
      ? {
        team_id: fixture.away_team_id,
        name: fixture.away_team?.name ?? "TBD",
        score: live?.away_score ?? 0,
      }
      : null,
    fouls: live?.fouls ?? {},
    current_period: live?.current_period ?? null,
    last_event_at: live?.last_event_at ?? null,
    realtime: realtimeHint(fixture.id),
  };
}
