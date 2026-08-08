// -----------------------------------------------------------------------------
// events/spread.ts
//
// Pure mapping from round-robin rounds onto the event's time slots. Kept
// deterministic and side-effect-free so `POST /events/:id/generate?dry_run`
// can preview the exact draw that will land without touching the DB, and so
// the unit tests don't need a Supabase client to exercise the interesting
// behaviour.
//
// Strategy: **round → slot with wrap.**
//   Round r (1-indexed) lands in slot at index (r - 1) mod slots.length.
//
// Why round-not-pairing: all matches in a single round of a round-robin are
// intended to happen at the same time (that's the whole point of "round" —
// one team appears at most once per round). Grouping a round's fixtures
// into one slot models the sports-night reality where a slot is a
// concurrent-play window across multiple pitches, not a single game.
//
// If R > slots.length, later rounds wrap to earlier slots. The wrap is
// obvious in the preview and the organiser can shuffle post-hoc if that's
// not what they wanted — nothing here tries to be clever about pitch
// balancing, which is out of scope for Sprint F (single round-robin only).
// -----------------------------------------------------------------------------

import type { RoundRobinFixture } from "../_shared/round-robin.ts";

/**
 * A proposed fixture ready to be inserted. `slot_id` is filled from the
 * caller-provided slot ordering; `round` is preserved from the round-robin
 * output so the preview UI can group by round if it wants to.
 */
export interface SpreadFixture {
  slot_id: string;
  round: number;
  home_team_id: string;
  away_team_id: string | null;
}

/** Success shape returned by `spreadAcrossSlots`. */
export interface SpreadOk {
  ok: true;
  fixtures: SpreadFixture[];
}

/** Failure shape returned by `spreadAcrossSlots`. */
export interface SpreadError {
  ok: false;
  error: string;
}

/**
 * Distribute round-robin pairings across a list of slot ids.
 *
 * The caller controls the slot order (typically the DB's `slot_number`
 * ordering) so the mapping is predictable: round 1 → slots[0], round 2 →
 * slots[1], and so on, wrapping when there are more rounds than slots.
 *
 * Both inputs are validated defensively — the callers are HTTP handlers
 * that will get some invalid combination sooner or later, and returning an
 * error object beats throwing so the router can 400 cleanly.
 *
 * @param params.pairings - Fixtures from `generateRoundRobin`. Empty input
 *                          returns an empty fixture list (not an error) —
 *                          a 1-team draw is a valid degenerate case.
 * @param params.slot_ids - Ordered slot ids to distribute into. Must be
 *                          non-empty when there are pairings; duplicates
 *                          are rejected because two rounds landing in the
 *                          same physical slot via a duplicate is almost
 *                          certainly a copy-paste error, not intent.
 * @returns `{ ok: true, fixtures }` or `{ ok: false, error }`.
 */
export function spreadAcrossSlots(params: {
  pairings: RoundRobinFixture[];
  slot_ids: string[];
}): SpreadOk | SpreadError {
  const { pairings, slot_ids } = params;

  if (pairings.length === 0) {
    return { ok: true, fixtures: [] };
  }

  if (slot_ids.length === 0) {
    return { ok: false, error: "At least one slot is required" };
  }

  const seen = new Set<string>();
  for (const s of slot_ids) {
    if (seen.has(s)) {
      return { ok: false, error: "slot_ids must not contain duplicates" };
    }
    seen.add(s);
  }

  const fixtures: SpreadFixture[] = pairings.map((p) => ({
    slot_id: slot_ids[(p.round - 1) % slot_ids.length],
    round: p.round,
    home_team_id: p.home_team_id,
    away_team_id: p.away_team_id,
  }));

  return { ok: true, fixtures };
}
