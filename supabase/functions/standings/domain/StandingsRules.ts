// -----------------------------------------------------------------------------
// standings/domain/StandingsRules.ts
//
// Pure standings computation, exposed behind a small interface so a new
// scoring format later is a new class, not an edit to this file. One
// implementation today: `PointsTableRules` (classical points table with
// configurable win/draw/loss and tiebreakers).
//
// Kept dependency-free and side-effect-free: no DB access, no `Deno` APIs,
// no `Date.now`, no mutation of the input array. Trivially unit-testable
// without a Supabase client.
//
// Design decision: standings are computed per (season, sport), see
// `docs/decisions/0004-standings-per-sport.md`. The caller runs the rules
// once per sport with that sport's config.
// -----------------------------------------------------------------------------

import type {
  FinishedFixture,
  StandingsConfig,
  StandingsRow,
} from "./StandingsTypes.ts";

/**
 * Default points scheme when a config is absent or missing the `standings`
 * block. Matches the plan doc's default (3/1/0) so nothing surprising
 * happens when an organiser scores a fixture before configuring a sport.
 */
const DEFAULT_POINTS = { win: 3, draw: 1, loss: 0 } as const;

/** Default tiebreakers when the config does not specify. */
const DEFAULT_TIEBREAKERS: readonly string[] = [
  "points",
  "goal_diff",
  "goals_for",
];

/**
 * Open/closed seam for standings formats. Add a new class to introduce a
 * new table format (knockout, Swiss, etc.) without editing this file.
 */
export interface StandingsRules {
  /**
   * Compute the standings table for a set of finished fixtures.
   *
   * @param fixtures - Finished fixtures with home/away scores.
   * @returns Sorted standings rows, one per team that appears in the input.
   */
  computeTable(fixtures: FinishedFixture[]): StandingsRow[];
}

/**
 * Classical points-table rules: configurable points for win/draw/loss, a
 * configurable list of tiebreakers, and a final deterministic alphabetical
 * tiebreak on team name.
 */
export class PointsTableRules implements StandingsRules {
  /**
   * @param config - The standings slice of the sport config. Missing or
   * absent fields fall back to the defaults documented in this file.
   */
  constructor(private readonly config: StandingsConfig) {}

  /**
   * Compute the standings table. Deterministic: given the same inputs, the
   * output rows and their order are always identical (final tiebreaker is
   * alphabetical by team name).
   *
   * @param fixtures - Finished fixtures with home/away scores.
   * @returns Sorted standings rows, one per team that appears in the input.
   */
  computeTable(fixtures: FinishedFixture[]): StandingsRow[] {
    const points = this.config.standings?.points ?? DEFAULT_POINTS;
    const tiebreakers = this.config.standings?.tiebreakers ??
      DEFAULT_TIEBREAKERS;

    const table = new Map<string, StandingsRow>();

    /**
     * Get or create the accumulator row for a team. Local closure to keep
     * `table` out of a wider scope.
     *
     * @param teamId - Team id.
     * @param teamName - Team display name.
     * @returns The mutable accumulator row.
     */
    const rowFor = (teamId: string, teamName: string): StandingsRow => {
      const existing = table.get(teamId);
      if (existing) return existing;
      const fresh: StandingsRow = {
        team_id: teamId,
        team_name: teamName,
        played: 0,
        won: 0,
        drawn: 0,
        lost: 0,
        for: 0,
        against: 0,
        goal_diff: 0,
        points: 0,
      };
      table.set(teamId, fresh);
      return fresh;
    };

    for (const f of fixtures) {
      // Byes contribute nothing. The home team is still listed via its
      // other fixtures; a team with only byes never appears in the table,
      // which is the desired behaviour (they have not played).
      if (f.away_team_id === null || f.away_team_name === null) continue;

      const home = rowFor(f.home_team_id, f.home_team_name);
      const away = rowFor(f.away_team_id, f.away_team_name);

      home.played += 1;
      away.played += 1;
      home.for += f.home_score;
      home.against += f.away_score;
      away.for += f.away_score;
      away.against += f.home_score;

      if (f.home_score > f.away_score) {
        home.won += 1;
        away.lost += 1;
        home.points += points.win;
        away.points += points.loss;
      } else if (f.home_score < f.away_score) {
        away.won += 1;
        home.lost += 1;
        away.points += points.win;
        home.points += points.loss;
      } else {
        home.drawn += 1;
        away.drawn += 1;
        home.points += points.draw;
        away.points += points.draw;
      }
    }

    for (const row of table.values()) {
      row.goal_diff = row.for - row.against;
    }

    const rows = Array.from(table.values());
    rows.sort(buildComparator(tiebreakers));
    return rows;
  }
}

/**
 * Build a sort comparator honouring the configured tiebreaker list.
 * Unknown tiebreaker names are ignored (not fatal): an organiser typo
 * should not crash the whole standings endpoint. The final tiebreaker is
 * always team_name ascending so the output is deterministic.
 *
 * Supported tiebreakers (all descending except name):
 *   - points        : total points
 *   - goal_diff     : for minus against
 *   - goals_for     : goals scored (for)
 *   - wins          : win count
 *
 * @param tiebreakers - Ordered list of tiebreaker names from the config.
 * @returns A comparator suitable for `Array.prototype.sort`.
 */
function buildComparator(
  tiebreakers: readonly string[],
): (a: StandingsRow, b: StandingsRow) => number {
  return (a, b) => {
    for (const key of tiebreakers) {
      const diff = tiebreakerValue(b, key) - tiebreakerValue(a, key);
      // NaN happens when the key is unknown; treat as "no signal" and
      // fall through to the next tiebreaker so a bad config degrades
      // gracefully.
      if (Number.isFinite(diff) && diff !== 0) return diff;
    }
    return a.team_name.localeCompare(b.team_name);
  };
}

/**
 * Look up a tiebreaker value on a row.
 *
 * @param row - The row to inspect.
 * @param key - The tiebreaker name from the config.
 * @returns The numeric value, or `NaN` when the key is not recognised.
 */
function tiebreakerValue(row: StandingsRow, key: string): number {
  switch (key) {
    case "points":
      return row.points;
    case "goal_diff":
      return row.goal_diff;
    case "goals_for":
      return row.for;
    case "wins":
      return row.won;
    default:
      return Number.NaN;
  }
}
