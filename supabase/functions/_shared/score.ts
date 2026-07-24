// -----------------------------------------------------------------------------
// _shared/score.ts
//
// Score-derivation helper. Pure function: fold a `match_events` list into a
// derived summary. Used by the scoring service (returns the derived score
// after each write) and by the future live/standings endpoints.
//
// Kept dependency-free and side-effect-free — no DB access, no `Deno` APIs,
// no `Date.now()`, no mutation of the input array — so it can be unit-tested
// without a Supabase client and safely reused wherever an event list needs a
// summary.
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
 * network / DB / clock calls.
 *
 * Rules:
 * - Any event with a non-null `voided_at` is skipped everywhere — score,
 *   fouls, and period detection. This is how undo works (soft-void, never
 *   delete). Two calls with the same list before and after voiding one
 *   event differ only by that event's contribution.
 * - `type='score'`: `value` is added to `home` or `away` based on `team_id`
 *   matching `homeTeamId` / `awayTeamId`. A null/undefined `value`
 *   contributes 0. Score events whose `team_id` matches neither team
 *   (or is null) are ignored — bye fixtures where `awayTeamId` is `null`
 *   still derive cleanly.
 * - `type='foul'`: incremented in `foulsByTeam[team_id]` when
 *   `config.track_fouls === true`. In that mode the returned map always has
 *   both fixture team ids present and zero-initialised, so callers can
 *   render "0 fouls" without a nullish check. When `track_fouls` is
 *   anything else, the map is `{}`. Fouls attributed to teams outside the
 *   fixture are ignored.
 * - `currentPeriod`: each `period_start` opens that period; a subsequent
 *   `period_end` with the same `period` value closes it back to `null`.
 *   Otherwise `null`. See the switch case for the ambiguity note when a
 *   stray `period_end` arrives.
 * - **Ordering:** the caller isn't trusted to sort. The fold walks a
 *   locally-sorted copy (by `created_at` ascending), so an out-of-order
 *   input derives identically to a sorted one. `Array.prototype.sort` is
 *   stable since ES2019 (V8 compliant), so equal timestamps preserve
 *   input order.
 * - `card` / `timeout` / `note` events are tolerated but do not contribute
 *   to the summary — the live-scoring UI reads them from the raw event feed.
 *
 * @param events - Match events for one fixture; will be sorted internally.
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
  const trackFouls = config.track_fouls === true;

  // Zero-initialise the counter map when the sport tracks fouls, so callers
  // always see "0 fouls" rather than a missing key. For a bye, only the
  // home team is present. When track_fouls is off, the map stays `{}`.
  const foulsByTeam: Record<string, number> = {};
  if (trackFouls) {
    foulsByTeam[homeTeamId] = 0;
    if (awayTeamId !== null) foulsByTeam[awayTeamId] = 0;
  }

  // Copy-then-sort so we don't mutate the caller's array. `sort` is stable
  // in ES2019+, so equal `created_at` values keep their input order — this
  // matters when several events land in the same millisecond during a
  // rapid-fire sequence.
  const ordered = [...events].sort(compareByCreatedAt);

  let home = 0;
  let away = 0;
  let currentPeriod: number | null = null;

  for (const event of ordered) {
    if (event.voided_at) continue;

    switch (event.type) {
      case "score": {
        // A null/undefined value contributes zero; a null team_id or a
        // team_id not part of this fixture is silently ignored so a
        // malformed insert never crashes the fold or misattributes.
        if (event.value === null || event.team_id === null) break;
        if (event.team_id === homeTeamId) home += event.value;
        else if (event.team_id === awayTeamId) away += event.value;
        break;
      }

      case "foul": {
        if (!trackFouls || event.team_id === null) break;
        // Fouls attributed to teams outside the fixture are ignored — the
        // returned map only ever carries the fixture's own team ids.
        if (event.team_id !== homeTeamId && event.team_id !== awayTeamId) break;
        foulsByTeam[event.team_id] = (foulsByTeam[event.team_id] ?? 0) + 1;
        break;
      }

      case "period_start": {
        // Any period_start opens that period. If a UI double-starts (opens
        // a new period without ending the previous one), the newer one
        // wins — the fold reflects "whatever the last intent was".
        if (event.period !== null) currentPeriod = event.period;
        break;
      }

      case "period_end": {
        // Ambiguity: what does a period_end mean when nothing (or a
        // different period) is open? Two readings of the spec ("the most
        // recent period_start with no matching period_end after it"):
        //   (a) walk sequentially — a period_end only closes the currently-
        //       open period if the numbers match; otherwise no-op.
        //   (b) recompute globally — the "most recent" period_start
        //       qualifies unless there's a matching period_end after it,
        //       even if a later period was opened and closed.
        // We pick (a): it matches actual UI intent (once period 2 has
        // ended you're between periods, not back in period 1) and is
        // defensive against stray period_end rows from bad manual edits.
        if (event.period !== null && event.period === currentPeriod) {
          currentPeriod = null;
        }
        break;
      }

      // card / timeout / note: intentionally do not touch the derived
      // summary. Left as explicit cases so exhaustiveness-checking helps
      // if MatchEventType ever grows.
      case "card":
      case "timeout":
      case "note":
        break;
    }
  }

  return { home, away, foulsByTeam, currentPeriod };
}

/**
 * Chronological comparator on `created_at`. Kept as its own function so the
 * sort call reads cleanly and the compare logic is easy to reason about.
 * `created_at` is an ISO-8601 timestamp string, which compares correctly
 * lexicographically, so string ordering matches chronological ordering.
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
