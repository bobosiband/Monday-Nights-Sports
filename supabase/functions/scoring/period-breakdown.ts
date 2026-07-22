// -----------------------------------------------------------------------------
// scoring/period-breakdown.ts
//
// Pure helper: fold a match_events log into a period-by-period score
// breakdown that is persisted into `results.periods` on finalize.
// -----------------------------------------------------------------------------

import type { MatchEvent } from "../_shared/score.ts";
import type { PeriodBreakdown } from "./types.ts";

/**
 * Build a per-period `{ period, home, away }` breakdown from a fixture's
 * event log. Score events are attributed to their own `event.period` when
 * set; otherwise to the currently-open period derived from surrounding
 * `period_start` / `period_end` events. Score events with no period
 * context (never inside an open period, no explicit period on the event)
 * are dropped from the breakdown so an incomplete log doesn't produce
 * garbage rows.
 *
 * Events are assumed ordered ascending by `created_at`.
 *
 * @param events - The fixture's match_events.
 * @param homeTeamId - Home team id (used to route scores).
 * @param awayTeamId - Away team id, or null for a bye.
 * @returns Ordered array of period breakdowns; empty when no scores had
 *          a period context.
 */
export function buildPeriodBreakdown(
  events: MatchEvent[],
  homeTeamId: string,
  awayTeamId: string | null,
): PeriodBreakdown[] {
  const byPeriod = new Map<number, { home: number; away: number }>();
  let currentPeriod: number | null = null;

  for (const event of events) {
    if (event.voided_at) continue;

    if (event.type === "period_start") {
      if (event.period !== null) currentPeriod = event.period;
      continue;
    }
    if (event.type === "period_end") {
      if (event.period !== null && event.period === currentPeriod) {
        currentPeriod = null;
      }
      continue;
    }
    if (event.type !== "score") continue;
    if (event.value === null || event.team_id === null) continue;

    const period = event.period ?? currentPeriod;
    if (period === null) continue;

    let entry = byPeriod.get(period);
    if (!entry) {
      entry = { home: 0, away: 0 };
      byPeriod.set(period, entry);
    }
    if (event.team_id === homeTeamId) entry.home += event.value;
    else if (event.team_id === awayTeamId) entry.away += event.value;
    // scores attributed to unknown teams are ignored — matches deriveScore
  }

  return Array.from(byPeriod.entries())
    .sort(([a], [b]) => a - b)
    .map(([period, s]) => ({ period, home: s.home, away: s.away }));
}
