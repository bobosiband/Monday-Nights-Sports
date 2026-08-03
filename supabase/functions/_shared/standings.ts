// -----------------------------------------------------------------------------
// _shared/standings.ts
//
// Config-driven standings computation. Pure function: given a list of
// finished fixtures and a sport config, returns a sorted standings array.
//
// Kept dependency-free and side-effect-free (same discipline as
// `_shared/score.ts`) — no DB access, no `Deno` APIs, no `Date.now`, no
// mutation of the input array — so it can be unit-tested without a
// Supabase client and reused wherever a table needs to be derived.
//
// Design decision: standings are computed per (season, sport) — see
// docs/decisions/0004-standings-per-sport.md. This function never sees
// the sport; the caller runs it once per sport with that sport's config.
// -----------------------------------------------------------------------------

import type { SportConfig } from "./score.ts";

/**
 * A finished fixture that contributes to the table. `away_team_id: null`
 * marks a bye — byes contribute nothing (neither team's counters move).
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
 * One row of the standings table. Field names deliberately mirror the
 * ones used by every football-adjacent scoreboard: `for` / `against` are
 * goals-for / goals-against; `goal_diff` is the signed difference.
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
 * Default points scheme when a config is absent or missing the `standings`
 * block. Matches the plan doc's default (3/1/0) so nothing surprising
 * happens when an organiser scores a fixture before configuring a sport.
 */
const DEFAULT_POINTS = { win: 3, draw: 1, loss: 0 } as const;

/** Default tiebreakers when the config doesn't specify. */
const DEFAULT_TIEBREAKERS: readonly string[] = [
  "points",
  "goal_diff",
  "goals_for",
];

/**
 * Compute a standings table. Deterministic — given the same inputs, the
 * output rows and their order are always identical (final tiebreaker is
 * alphabetical by team name).
 *
 * @param fixtures - Finished fixtures with home/away scores.
 * @param config - The sport config (may be empty / missing `standings`).
 * @returns Sorted standings rows, one per team that appears in the input.
 */
export function computeStandings(
  fixtures: FinishedFixture[],
  config: SportConfig,
): StandingsRow[] {
  const points = config.standings?.points ?? DEFAULT_POINTS;
  const tiebreakers = config.standings?.tiebreakers ?? DEFAULT_TIEBREAKERS;

  // Accumulator per team. team_name is set on first sighting so we don't
  // need a separate lookup — the caller already denormalised the names
  // onto every fixture row.
  const table = new Map<string, StandingsRow>();

  /**
   * Get or create the accumulator row for a team. Kept local so it can
   * reach `table` without ceremony.
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
    // other fixtures — if a team has ONLY byes it never appears in the
    // table, which is the desired behaviour (they haven't played).
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

  // Backfill goal_diff so callers don't have to compute it.
  for (const row of table.values()) {
    row.goal_diff = row.for - row.against;
  }

  const rows = Array.from(table.values());
  rows.sort(buildComparator(tiebreakers));
  return rows;
}

/**
 * Build a sort comparator honouring the configured tiebreaker list.
 * Unknown tiebreaker names are ignored (not fatal) — an organiser typo
 * shouldn't crash the whole standings endpoint. The final tiebreaker is
 * always team_name ascending so the output is deterministic.
 *
 * Supported tiebreakers (all descending except name):
 *   - points        — total points
 *   - goal_diff     — for minus against
 *   - goals_for     — goals scored (for)
 *   - wins          — win count
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
 * Look up a tiebreaker value on a row. Returns NaN for unknown keys so
 * the comparator can skip them.
 *
 * @param row - The row to inspect.
 * @param key - The tiebreaker name from the config.
 * @returns The numeric value, or NaN when the key is not recognised.
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
