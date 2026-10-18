// -----------------------------------------------------------------------------
// standings/domain/StandingsTypes.ts
//
// Types owned by the standings service. The service deliberately does not
// import `SportConfig` from scoring: it only reads two sub-fields from the
// sport config, so it carries its own narrow type here. Keeps the two
// services decoupled per ADR 0007.
// -----------------------------------------------------------------------------

/**
 * A finished fixture that contributes to the table. `away_team_id: null`
 * marks a bye: byes contribute nothing (neither team's counters move).
 */
export interface FinishedFixture {
  fixture_id: string;
  home_team_id: string;
  away_team_id: string | null;
  home_team_name: string;
  away_team_name: string | null;
  home_score: number;
  away_score: number;
}

/**
 * One row of the standings table. Field names mirror the ones used by every
 * football-adjacent scoreboard: `for` / `against` are goals-for /
 * goals-against; `goal_diff` is the signed difference.
 */
export interface StandingsRow {
  team_id: string;
  team_name: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  for: number;
  against: number;
  goal_diff: number;
  points: number;
}

/**
 * The sub-set of a sport config this service reads. The scoring config has
 * other fields; those stay with scoring and never cross into standings.
 */
export interface StandingsConfig {
  standings?: {
    points: { win: number; draw: number; loss: number };
    tiebreakers: string[];
  };
}
