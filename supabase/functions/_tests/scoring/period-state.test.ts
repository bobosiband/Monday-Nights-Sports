// -----------------------------------------------------------------------------
// _tests/scoring/period-state.test.ts
//
// Tests for the periodIsOpen helper. Pure function, no DB.
// -----------------------------------------------------------------------------

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { periodIsOpen } from "../../scoring/period-state.ts";
import type { MatchEvent } from "../../_shared/score.ts";

/**
 * Build a period_start / period_end event. Test-only helper.
 *
 * @param type - Either `period_start` or `period_end`.
 * @param period - The period number.
 * @param voided - When true, sets voided_at.
 * @returns A MatchEvent shape.
 */
function periodEvent(
  type: "period_start" | "period_end",
  period: number,
  voided = false,
): MatchEvent {
  return {
    id: crypto.randomUUID(),
    fixture_id: "f",
    type,
    team_id: null,
    player_id: null,
    value: null,
    period,
    match_clock_ms: null,
    voided_at: voided ? new Date().toISOString() : null,
    created_at: new Date().toISOString(),
  };
}

Deno.test("period never started is not open", () => {
  assertEquals(periodIsOpen([], 1), false);
});

Deno.test("period_start alone leaves the period open", () => {
  assertEquals(periodIsOpen([periodEvent("period_start", 1)], 1), true);
});

Deno.test("period_end after period_start closes it", () => {
  const events = [periodEvent("period_start", 1), periodEvent("period_end", 1)];
  assertEquals(periodIsOpen(events, 1), false);
});

Deno.test("period_end targeting a different period doesn't close period 1", () => {
  const events = [periodEvent("period_start", 1), periodEvent("period_end", 2)];
  assertEquals(periodIsOpen(events, 1), true);
});

Deno.test("re-opening a period after closing", () => {
  const events = [
    periodEvent("period_start", 1),
    periodEvent("period_end", 1),
    periodEvent("period_start", 1),
  ];
  assertEquals(periodIsOpen(events, 1), true);
});

Deno.test("voided period_start doesn't open the period", () => {
  const events = [periodEvent("period_start", 1, true)];
  assertEquals(periodIsOpen(events, 1), false);
});

Deno.test("voided period_end doesn't close an open period", () => {
  const events = [
    periodEvent("period_start", 1),
    periodEvent("period_end", 1, true),
  ];
  assertEquals(periodIsOpen(events, 1), true);
});
