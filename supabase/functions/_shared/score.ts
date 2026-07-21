// -----------------------------------------------------------------------------
// _shared/score.ts
//
// Score-derivation helper. Pure function: fold a match_events list into a
// derived summary. Used by the scoring service (return derived score after
// each write) and by the live/standings endpoints.
//
// Skeleton only — the real implementation lands in story #27 (score-derivation
// library + unit tests) and is exercised by stories #31, #35, #41, #43.
// -----------------------------------------------------------------------------

export type MatchEventType =
  | "score"
  | "foul"
  | "card"
  | "timeout"
  | "period_start"
  | "period_end"
  | "note";

export interface MatchEvent {
  id: string;
  fixture_id: string;
  type: MatchEventType;
  team_id: string | null;
  player_id: string | null;
  value: number | null;
  period: number | null;
  match_clock_ms: number | null;
  voided_at: string | null;
  created_at: string;
}

export interface SportConfig {
  periods?: { count: number; minutes: number; direction: "up" | "down" };
  score_increments?: number[];
  track_fouls?: boolean;
  standings?: {
    points: { win: number; draw: number; loss: number };
    tiebreakers: string[];
  };
}

export interface DerivedScore {
  home: number;
  away: number;
  foulsByTeam: Record<string, number>;
  currentPeriod: number | null;
}

/**
 * Fold a match_events list into a derived score summary. Ignores voided
 * events. Score comes from summing `value` on non-voided `type='score'`
 * events per team; fouls count non-voided `type='foul'`; current period is
 * the latest `period_start` without a matching `period_end`.
 *
 * @param events - Ordered (by created_at) match_events for a single fixture.
 * @param homeTeamId - The home team id (used to route score/foul totals).
 * @param awayTeamId - The away team id, or null for a bye.
 * @param _config - The sport_config for the fixture's sport (drives foul
 *                  visibility etc.). Prefixed `_` until the real
 *                  implementation lands.
 * @returns The derived score summary.
 */
export function deriveScore(
  events: MatchEvent[],
  homeTeamId: string,
  awayTeamId: string | null,
  _config: SportConfig,
): DerivedScore {
  // TODO(#27): implement the real fold. This stub returns zeros so callers
  // can compile against the signature while the story is in flight.
  void events;
  void homeTeamId;
  void awayTeamId;
  return {
    home: 0,
    away: 0,
    foulsByTeam: {},
    currentPeriod: null,
  };
}
