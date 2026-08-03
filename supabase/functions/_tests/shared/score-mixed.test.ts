// -----------------------------------------------------------------------------
// _tests/shared/score-mixed.test.ts
//
// Coverage for fouls + cards flowing through the fold alongside scores.
// The individual pieces are already tested in `score.test.ts`; these cases
// verify the mix doesn't cross-contaminate — a card doesn't tick foul
// counters, a card severity doesn't leak into the score, etc.
// -----------------------------------------------------------------------------

import {
  assertEquals,
  assertObjectMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { deriveScore, MatchEvent, SportConfig } from "../../_shared/score.ts";

const HOME = "11111111-1111-1111-1111-111111111111";
const AWAY = "22222222-2222-2222-2222-222222222222";

const soccer: SportConfig = { score_increments: [1], track_fouls: true };
const basketball: SportConfig = {
  score_increments: [1, 2, 3],
  track_fouls: false,
};

/**
 * Build a match_event with sensible defaults. Test-only.
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

Deno.test("soccer mix: scores, fouls, cards, timeouts, notes coexist cleanly", () => {
  const events = [
    event({ type: "period_start", period: 1 }),
    event({ type: "score", team_id: HOME, value: 1 }),
    event({ type: "foul", team_id: AWAY }),
    event({ type: "card", team_id: AWAY, value: 1 }), // severity, not points
    event({ type: "score", team_id: AWAY, value: 1 }),
    event({ type: "timeout", team_id: HOME }),
    event({ type: "note" }),
    event({ type: "foul", team_id: AWAY }),
  ];
  const result = deriveScore(events, HOME, AWAY, soccer);
  assertEquals(result.home, 1);
  assertEquals(result.away, 1);
  assertObjectMatch(result.foulsByTeam, { [AWAY]: 2 });
  assertEquals(result.currentPeriod, 1);
});

Deno.test("basketball mix: fouls suppressed when track_fouls=false", () => {
  const events = [
    event({ type: "period_start", period: 1 }),
    event({ type: "score", team_id: HOME, value: 3 }),
    event({ type: "foul", team_id: HOME }),
    event({ type: "foul", team_id: AWAY }),
    event({ type: "card", team_id: HOME, value: 1 }),
    event({ type: "score", team_id: AWAY, value: 2 }),
  ];
  const result = deriveScore(events, HOME, AWAY, basketball);
  assertEquals(result.home, 3);
  assertEquals(result.away, 2);
  assertEquals(result.foulsByTeam, {});
});

Deno.test("card severity does not leak into the score total", () => {
  const events = [
    event({ type: "card", team_id: HOME, value: 3 }),
    event({ type: "score", team_id: HOME, value: 1 }),
  ];
  const result = deriveScore(events, HOME, AWAY, soccer);
  // Card severity is 3, but only the score event adds 1 to home.
  assertEquals(result.home, 1);
  assertEquals(result.away, 0);
});
