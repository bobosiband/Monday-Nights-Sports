// -----------------------------------------------------------------------------
// _tests/shared/score.test.ts
//
// Unit tests for the score-derivation fold in `../../_shared/score.ts`.
// Pure function so we can exercise every branch without a Supabase client.
//
// Run with: `deno test supabase/functions/_tests/`
// -----------------------------------------------------------------------------

import {
  assertEquals,
  assertObjectMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { deriveScore, MatchEvent, SportConfig } from "../../_shared/score.ts";

const HOME = "11111111-1111-1111-1111-111111111111";
const AWAY = "22222222-2222-2222-2222-222222222222";

const soccerConfig: SportConfig = {
  score_increments: [1],
  track_fouls: true,
};

const basketballConfig: SportConfig = {
  score_increments: [1, 2, 3],
  track_fouls: false,
};

/**
 * Build a MatchEvent with sensible defaults so tests only override the
 * fields they care about. Not exported — internal to this test file.
 *
 * @param over - Partial overrides for the event.
 * @returns A fully-formed MatchEvent.
 */
function event(over: Partial<MatchEvent> & { type: MatchEvent["type"] }): MatchEvent {
  return {
    id: over.id ?? crypto.randomUUID(),
    fixture_id: over.fixture_id ?? "fixture-1",
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

Deno.test("empty event list returns zeros", () => {
  const result = deriveScore([], HOME, AWAY, soccerConfig);
  assertEquals(result, { home: 0, away: 0, foulsByTeam: {}, currentPeriod: null });
});

Deno.test("two home scores sum into home total", () => {
  const events = [
    event({ type: "score", team_id: HOME, value: 1 }),
    event({ type: "score", team_id: HOME, value: 1 }),
  ];
  const result = deriveScore(events, HOME, AWAY, soccerConfig);
  assertEquals(result.home, 2);
  assertEquals(result.away, 0);
});

Deno.test("scores route to home or away by team_id", () => {
  const events = [
    event({ type: "score", team_id: HOME, value: 1 }),
    event({ type: "score", team_id: AWAY, value: 1 }),
    event({ type: "score", team_id: AWAY, value: 1 }),
  ];
  const result = deriveScore(events, HOME, AWAY, soccerConfig);
  assertEquals(result.home, 1);
  assertEquals(result.away, 2);
});

Deno.test("voided score events do not count", () => {
  const events = [
    event({ type: "score", team_id: HOME, value: 1 }),
    event({
      type: "score",
      team_id: HOME,
      value: 1,
      voided_at: new Date().toISOString(),
    }),
    event({ type: "score", team_id: HOME, value: 1 }),
  ];
  const result = deriveScore(events, HOME, AWAY, soccerConfig);
  // Two live goals, one voided → 2.
  assertEquals(result.home, 2);
});

Deno.test("score events with missing team or value are ignored", () => {
  const events = [
    event({ type: "score", team_id: null, value: 1 }),
    event({ type: "score", team_id: HOME, value: null }),
    event({ type: "score", team_id: HOME, value: 1 }),
  ];
  const result = deriveScore(events, HOME, AWAY, soccerConfig);
  assertEquals(result.home, 1);
});

Deno.test("score attributed to unknown team is ignored", () => {
  const events = [
    event({ type: "score", team_id: "not-in-this-match", value: 1 }),
    event({ type: "score", team_id: HOME, value: 1 }),
  ];
  const result = deriveScore(events, HOME, AWAY, soccerConfig);
  assertEquals(result.home, 1);
  assertEquals(result.away, 0);
});

Deno.test("fouls counted per team when track_fouls=true", () => {
  const events = [
    event({ type: "foul", team_id: HOME }),
    event({ type: "foul", team_id: AWAY }),
    event({ type: "foul", team_id: HOME }),
  ];
  const result = deriveScore(events, HOME, AWAY, soccerConfig);
  assertObjectMatch(result.foulsByTeam, { [HOME]: 2, [AWAY]: 1 });
});

Deno.test("fouls are not counted when track_fouls=false", () => {
  const events = [
    event({ type: "foul", team_id: HOME }),
    event({ type: "foul", team_id: AWAY }),
  ];
  const result = deriveScore(events, HOME, AWAY, basketballConfig);
  assertEquals(result.foulsByTeam, {});
});

Deno.test("voided fouls do not count", () => {
  const events = [
    event({ type: "foul", team_id: HOME }),
    event({
      type: "foul",
      team_id: HOME,
      voided_at: new Date().toISOString(),
    }),
  ];
  const result = deriveScore(events, HOME, AWAY, soccerConfig);
  assertObjectMatch(result.foulsByTeam, { [HOME]: 1 });
});

Deno.test("period_start without matching period_end reports currentPeriod", () => {
  const events = [
    event({ type: "period_start", period: 1 }),
    event({ type: "score", team_id: HOME, value: 1 }),
  ];
  const result = deriveScore(events, HOME, AWAY, soccerConfig);
  assertEquals(result.currentPeriod, 1);
});

Deno.test("period_end closes the open period", () => {
  const events = [
    event({ type: "period_start", period: 1 }),
    event({ type: "period_end", period: 1 }),
  ];
  const result = deriveScore(events, HOME, AWAY, soccerConfig);
  assertEquals(result.currentPeriod, null);
});

Deno.test("period_end for a non-open period is a no-op", () => {
  const events = [
    event({ type: "period_start", period: 1 }),
    event({ type: "period_end", period: 2 }),
  ];
  const result = deriveScore(events, HOME, AWAY, soccerConfig);
  // Period 1 remains open because period_end targeted period 2.
  assertEquals(result.currentPeriod, 1);
});

Deno.test("subsequent period_start replaces the open period number", () => {
  const events = [
    event({ type: "period_start", period: 1 }),
    event({ type: "period_end", period: 1 }),
    event({ type: "period_start", period: 2 }),
  ];
  const result = deriveScore(events, HOME, AWAY, soccerConfig);
  assertEquals(result.currentPeriod, 2);
});

Deno.test("basketball-style mixed increments sum correctly", () => {
  const events = [
    event({ type: "score", team_id: HOME, value: 3 }),
    event({ type: "score", team_id: HOME, value: 2 }),
    event({ type: "score", team_id: AWAY, value: 1 }),
    event({ type: "score", team_id: AWAY, value: 3 }),
  ];
  const result = deriveScore(events, HOME, AWAY, basketballConfig);
  assertEquals(result.home, 5);
  assertEquals(result.away, 4);
});

Deno.test("card / timeout / note events do not affect the summary", () => {
  const events = [
    event({ type: "score", team_id: HOME, value: 1 }),
    event({ type: "card", team_id: HOME, value: 1 }),
    event({ type: "timeout", team_id: AWAY }),
    event({ type: "note" }),
  ];
  const result = deriveScore(events, HOME, AWAY, soccerConfig);
  assertEquals(result, { home: 1, away: 0, foulsByTeam: {}, currentPeriod: null });
});
