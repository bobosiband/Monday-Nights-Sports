// -----------------------------------------------------------------------------
// _shared/score.test.ts
//
// Unit tests for the score-derivation helper. Skeleton — story #27 fills in
// the real cases (score sums, ignoring voided, foul counting, current-period
// detection, undo semantics).
//
// Run with: `deno test supabase/functions/_shared/score.test.ts`
// -----------------------------------------------------------------------------

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { deriveScore } from "./score.ts";

Deno.test("deriveScore returns zeros for an empty event list (stub)", () => {
  const result = deriveScore([], "home-id", "away-id", {});
  assertEquals(result.home, 0);
  assertEquals(result.away, 0);
  assertEquals(result.currentPeriod, null);
});

// TODO(#27): real cases —
//   - two `score` events for home sum to correct home total
//   - voided score event does not count
//   - `foul` events counted per team when track_fouls = true
//   - period_start without matching period_end reports currentPeriod
//   - period_end zeroes out currentPeriod
