// -----------------------------------------------------------------------------
// scoring/domain/ScoreCalculator.ts
//
// Score-derivation helper. Pure function: fold a `match_events` list into
// a derived summary. Owned by the scoring service per ADR 0007; other
// services call scoring over HTTP rather than importing this fold.
//
// Dependency-free and side-effect-free: no DB access, no `Deno` APIs, no
// `Date.now`, no mutation of the input array. Trivially unit-testable
// without a Supabase client.
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
 * Fold a `match_events` list into a derived score summary. Pure.
 *
 * Rules:
 * - Any event with a non-null `voided_at` is skipped (soft-void = undo).
 * - `type='score'`: `value` is added to `home` or `away` based on
 *   `team_id` matching `homeTeamId` / `awayTeamId`. A null/undefined
 *   `value` contributes 0. Score events whose `team_id` matches neither
 *   team are ignored.
 * - `type='foul'`: incremented in `foulsByTeam[team_id]` when
 *   `config.track_fouls === true`. In that mode the returned map always
 *   has both fixture team ids present and zero-initialised. When
 *   `track_fouls` is anything else, the map is `{}`.
 * - `currentPeriod`: each `period_start` opens that period; a subsequent
 *   `period_end` with the same `period` value closes it back to `null`.
 * - **Ordering:** the caller is not trusted to sort. The fold walks a
 *   locally-sorted copy (by `created_at` ascending), so an out-of-order
 *   input derives identically to a sorted one.
 * - `card` / `timeout` / `note` events are tolerated but do not
 *   contribute to the summary.
 *
 * @param events - Match events for one fixture; sorted internally.
 * @param homeTeamId - The fixture's home team id.
 * @param awayTeamId - The fixture's away team id, or `null` for a bye.
 * @param config - The sport config for the fixture's sport.
 * @returns The derived score summary.
 */
export function deriveScore(
  events: MatchEvent[],
  homeTeamId: string,
  awayTeamId: string | null,
  config: SportConfig,
): DerivedScore {
  const trackFouls = config.track_fouls === true;

  const foulsByTeam: Record<string, number> = {};
  if (trackFouls) {
    foulsByTeam[homeTeamId] = 0;
    if (awayTeamId !== null) foulsByTeam[awayTeamId] = 0;
  }

  // Copy-then-sort so the caller's array stays intact.
  const ordered = [...events].sort(compareByCreatedAt);

  let home = 0;
  let away = 0;
  let currentPeriod: number | null = null;

  for (const event of ordered) {
    if (event.voided_at) continue;

    switch (event.type) {
      case "score": {
        if (event.value === null || event.team_id === null) break;
        if (event.team_id === homeTeamId) home += event.value;
        else if (event.team_id === awayTeamId) away += event.value;
        break;
      }

      case "foul": {
        if (!trackFouls || event.team_id === null) break;
        if (
          event.team_id !== homeTeamId && event.team_id !== awayTeamId
        ) break;
        foulsByTeam[event.team_id] = (foulsByTeam[event.team_id] ?? 0) + 1;
        break;
      }

      case "period_start": {
        if (event.period !== null) currentPeriod = event.period;
        break;
      }

      case "period_end": {
        // Only close the currently-open period; stray period_end rows
        // from bad manual edits should not reopen earlier periods.
        if (event.period !== null && event.period === currentPeriod) {
          currentPeriod = null;
        }
        break;
      }

      case "card":
      case "timeout":
      case "note":
        break;
    }
  }

  return { home, away, foulsByTeam, currentPeriod };
}

/**
 * Chronological comparator on `created_at`. `created_at` is ISO-8601
 * which compares correctly lexicographically.
 *
 * @param a - First event.
 * @param b - Second event.
 * @returns Negative if `a` is older, positive if newer, zero when equal.
 */
function compareByCreatedAt(a: MatchEvent, b: MatchEvent): number {
  if (a.created_at < b.created_at) return -1;
  if (a.created_at > b.created_at) return 1;
  return 0;
}
