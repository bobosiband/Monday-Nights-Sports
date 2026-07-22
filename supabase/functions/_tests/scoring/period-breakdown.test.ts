// -----------------------------------------------------------------------------
// _tests/scoring/period-breakdown.test.ts
//
// Tests for buildPeriodBreakdown. Pure function, no DB.
// -----------------------------------------------------------------------------

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildPeriodBreakdown } from "../../scoring/period-breakdown.ts";
import type { MatchEvent } from "../../_shared/score.ts";

const HOME = "11111111-1111-1111-1111-111111111111";
const AWAY = "22222222-2222-2222-2222-222222222222";

/**
 * Build a match_event for the tests. Test-only helper.
 *
 * @param over - Overrides.
 * @returns A MatchEvent.
 */
function event(
  over: Partial<MatchEvent> & { type: MatchEvent["type"] },
): MatchEvent {
  return {
    id: over.id ?? crypto.randomUUID(),
    fixture_id: over.fixture_id ?? "f",
    type: over.type,
    team_id: over.team_id ?? null,
    player_id: over.player_id ?? null,
    value: over.value ?? null,
    period: over.period ?? null,
    match_clock_ms: over.match_clock_ms ?? null,
    voided_at: over.voided_at ?? null,
    created_at: over.created_at ?? new Date().toISOString(),
  };
}

Deno.test("empty log returns an empty breakdown", () => {
  assertEquals(buildPeriodBreakdown([], HOME, AWAY), []);
});

Deno.test("scores inside an open period are attributed to it", () => {
  const events = [
    event({ type: "period_start", period: 1 }),
    event({ type: "score", team_id: HOME, value: 1 }),
    event({ type: "score", team_id: AWAY, value: 1 }),
    event({ type: "period_end", period: 1 }),
    event({ type: "period_start", period: 2 }),
    event({ type: "score", team_id: HOME, value: 1 }),
    event({ type: "period_end", period: 2 }),
  ];
  const result = buildPeriodBreakdown(events, HOME, AWAY);
  assertEquals(result, [
    { period: 1, home: 1, away: 1 },
    { period: 2, home: 1, away: 0 },
  ]);
});

Deno.test("event.period wins over derived currentPeriod when set", () => {
  const events = [
    event({ type: "period_start", period: 1 }),
    // score explicitly tagged period 2 despite period 1 being open
    event({ type: "score", team_id: HOME, value: 1, period: 2 }),
  ];
  const result = buildPeriodBreakdown(events, HOME, AWAY);
  assertEquals(result, [{ period: 2, home: 1, away: 0 }]);
});

Deno.test("scores with no period context are dropped", () => {
  const events = [
    // no period_start yet, no explicit period on the event
    event({ type: "score", team_id: HOME, value: 1 }),
  ];
  const result = buildPeriodBreakdown(events, HOME, AWAY);
  assertEquals(result, []);
});

Deno.test("voided score does not contribute", () => {
  const events = [
    event({ type: "period_start", period: 1 }),
    event({ type: "score", team_id: HOME, value: 1 }),
    event({
      type: "score",
      team_id: HOME,
      value: 1,
      voided_at: new Date().toISOString(),
    }),
  ];
  const result = buildPeriodBreakdown(events, HOME, AWAY);
  assertEquals(result, [{ period: 1, home: 1, away: 0 }]);
});

Deno.test("scores from a re-opened period accumulate into the same bucket", () => {
  const events = [
    event({ type: "period_start", period: 1 }),
    event({ type: "score", team_id: HOME, value: 1 }),
    event({ type: "period_end", period: 1 }),
    event({ type: "period_start", period: 1 }), // reopened for correction
    event({ type: "score", team_id: HOME, value: 1 }),
  ];
  const result = buildPeriodBreakdown(events, HOME, AWAY);
  assertEquals(result, [{ period: 1, home: 2, away: 0 }]);
});

Deno.test("scores attributed to an unknown team are dropped", () => {
  const events = [
    event({ type: "period_start", period: 1 }),
    event({ type: "score", team_id: "not-in-match", value: 1 }),
    event({ type: "score", team_id: HOME, value: 1 }),
  ];
  const result = buildPeriodBreakdown(events, HOME, AWAY);
  assertEquals(result, [{ period: 1, home: 1, away: 0 }]);
});
