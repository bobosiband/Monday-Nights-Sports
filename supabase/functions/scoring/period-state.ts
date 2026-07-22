// -----------------------------------------------------------------------------
// scoring/period-state.ts
//
// Pure helpers for reasoning about period_start / period_end events on an
// event log. Kept separate from the handler so it's testable without a
// Supabase client.
// -----------------------------------------------------------------------------

import type { MatchEvent } from "../_shared/score.ts";

/**
 * Is the given period currently open on this event log? A period is open
 * when at least one non-voided `period_start` for it exists and no later
 * non-voided `period_end` for the same period appears after it.
 *
 * Events are assumed ordered ascending by `created_at` (the DB query in
 * `db.ts` orders them that way).
 *
 * @param events - The fixture's match_events.
 * @param period - The period number to check.
 * @returns `true` when the period is currently open, `false` otherwise
 *          (never opened, or opened then closed).
 */
export function periodIsOpen(events: MatchEvent[], period: number): boolean {
  let open = false;
  for (const event of events) {
    if (event.voided_at) continue;
    if (event.period !== period) continue;
    if (event.type === "period_start") open = true;
    else if (event.type === "period_end") open = false;
  }
  return open;
}
