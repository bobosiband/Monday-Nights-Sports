// -----------------------------------------------------------------------------
// _shared/score.ts
//
// Score-derivation helper. Pure function: fold a `match_events` list into a
// derived summary. Used by the scoring service (returns the derived score
// after each write) and by the live/standings endpoints later on.
//
// Kept dependency-free and side-effect-free so it can be unit-tested without
// a Supabase client.
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
 * Fold a `match_events` list into a derived score summary. Pure function:
 * given the same inputs it always returns the same output, and it makes no
 * network / DB calls.
 *
 * Rules:
 * - Any event with a non-null `voided_at` is skipped (soft-undo semantics).
 * - `type='score'`: `value` is added to `home` or `away` based on `team_id`
 *   matching `homeTeamId` / `awayTeamId`. Score events attributed to an
 *   unknown team are ignored — a well-formed insert path shouldn't produce
 *   those, but we tolerate them so a malformed row never crashes the fold.
 * - `type='foul'`: incremented in `foulsByTeam[team_id]` when
 *   `config.track_fouls` is true. When the sport doesn't track fouls the
 *   counters stay empty, matching the plan doc's guidance.
 * - `currentPeriod`: each `period_start` opens a period; a subsequent
 *   `period_end` with the same `period` number closes it back to `null`.
 *   Events are assumed ordered by `created_at` ascending (the DB query
 *   should have ordered them; the fold does not re-sort).
 * - `card` / `timeout` / `note` events are tolerated but do not contribute
 *   to the summary — the live-scoring UI reads them from the raw event feed.
 *
 * @param events - Ordered (by created_at ascending) match_events for one
 *                 fixture.
 * @param homeTeamId - The fixture's home team id.
 * @param awayTeamId - The fixture's away team id, or `null` for a bye.
 * @param config - The sport_config for the fixture's sport. Only
 *                 `track_fouls` is read here; other fields are the caller's
 *                 concern.
 * @returns The derived score summary.
 */
export function deriveScore(
  events: MatchEvent[],
  homeTeamId: string,
  awayTeamId: string | null,
  config: SportConfig,
): DerivedScore {
  let home = 0;
  let away = 0;
  const foulsByTeam: Record<string, number> = {};
  let currentPeriod: number | null = null;

  const trackFouls = config.track_fouls === true;

  for (const event of events) {
    if (event.voided_at) continue;

    switch (event.type) {
      case "score": {
        // A score event carries the number of points added in `value`. If
        // either the team or the value is missing we ignore the event
        // rather than crash the fold — the write path validates upstream.
        if (event.value === null || event.team_id === null) break;
        if (event.team_id === homeTeamId) home += event.value;
        else if (event.team_id === awayTeamId) away += event.value;
        break;
      }

      case "foul": {
        if (!trackFouls || event.team_id === null) break;
        foulsByTeam[event.team_id] = (foulsByTeam[event.team_id] ?? 0) + 1;
        break;
      }

      case "period_start": {
        // Any period_start opens that period; the value is the period number.
        // A subsequent period_start for a different period replaces the open
        // one — the spec doesn't forbid overlapping periods, but that would
        // be a UI bug rather than a fold concern.
        if (event.period !== null) currentPeriod = event.period;
        break;
      }

      case "period_end": {
        // Close the open period only if the period numbers match. A
        // period_end for a period that isn't open is a no-op — the write
        // path guards against this too, but keeping the fold tolerant lets
        // it survive a manually-inserted row.
        if (event.period !== null && event.period === currentPeriod) {
          currentPeriod = null;
        }
        break;
      }

      // card / timeout / note: intentionally do not touch the derived
      // summary. Left as explicit cases so exhaustiveness-checking helps if
      // MatchEventType ever grows.
      case "card":
      case "timeout":
      case "note":
        break;
    }
  }

  return { home, away, foulsByTeam, currentPeriod };
}
