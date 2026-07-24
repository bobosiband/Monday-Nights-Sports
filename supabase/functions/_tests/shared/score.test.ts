// -----------------------------------------------------------------------------
// _tests/shared/score.test.ts
//
// Unit tests for the score-derivation fold in `../../_shared/score.ts`.
// Pure function so we can exercise every branch without a Supabase client.
//
// Note: the story spec referred to this file as
// `_shared/score.test.ts`, but the repo convention (established in an
// earlier commit) puts every test tree under `_tests/` — with a leading
// underscore so Supabase does not deploy it as an Edge Function. Same
// content, honoured location.
//
// Run with: `deno test supabase/functions/_tests/`
// -----------------------------------------------------------------------------

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { deriveScore, MatchEvent, SportConfig } from "../../_shared/score.ts";

const HOME = "11111111-1111-1111-1111-111111111111";
const AWAY = "22222222-2222-2222-2222-222222222222";
const OTHER = "99999999-9999-9999-9999-999999999999"; // stand-in for a stray team id

const soccerConfig: SportConfig = {
  score_increments: [1],
  track_fouls: true,
};

const basketballConfig: SportConfig = {
  score_increments: [1, 2, 3],
  track_fouls: false,
};

const configWithoutFouls: SportConfig = {}; // track_fouls absent

/**
 * Build a MatchEvent with sensible defaults so tests only override the
 * fields they care about. `created_at` defaults to a fixed base timestamp
 * plus an incrementing offset so the derivation is deterministic without
 * touching the wall clock.
 *
 * @param over - Partial overrides for the event.
 * @returns A fully-formed MatchEvent.
 */
function event(
  over: Partial<MatchEvent> & { type: MatchEvent["type"] },
): MatchEvent {
  createdCounter += 1;
  const createdAt = over.created_at ??
    new Date(BASE_TIME + createdCounter * 1000).toISOString();
  return {
    id: over.id ?? `evt-${createdCounter}`,
    fixture_id: over.fixture_id ?? "fixture-1",
    type: over.type,
    team_id: over.team_id ?? null,
    player_id: over.player_id ?? null,
    value: over.value ?? null,
    period: over.period ?? null,
    match_clock_ms: over.match_clock_ms ?? null,
    voided_at: over.voided_at ?? null,
    created_at: createdAt,
  };
}
const BASE_TIME = Date.UTC(2026, 6, 20, 18, 0, 0); // fixed reference — no runtime clock
let createdCounter = 0;

// ---------- basics ----------------------------------------------------------

Deno.test("empty event list → zeros and null period", () => {
  const result = deriveScore([], HOME, AWAY, soccerConfig);
  assertEquals(result, {
    home: 0,
    away: 0,
    // track_fouls=true, so both team ids are present and zeroed.
    foulsByTeam: { [HOME]: 0, [AWAY]: 0 },
    currentPeriod: null,
  });
});

Deno.test("two home scores sum into home total; away unaffected", () => {
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

Deno.test("score events with missing team or value contribute 0", () => {
  const events = [
    event({ type: "score", team_id: null, value: 1 }),
    event({ type: "score", team_id: HOME, value: null }),
    event({ type: "score", team_id: HOME, value: 1 }),
  ];
  const result = deriveScore(events, HOME, AWAY, soccerConfig);
  assertEquals(result.home, 1);
});

Deno.test("score attributed to a team outside the fixture is ignored", () => {
  const events = [
    event({ type: "score", team_id: OTHER, value: 1 }),
    event({ type: "score", team_id: HOME, value: 1 }),
  ];
  const result = deriveScore(events, HOME, AWAY, soccerConfig);
  assertEquals(result.home, 1);
  assertEquals(result.away, 0);
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

// ---------- undo (soft-void) ------------------------------------------------

Deno.test("voided score events do not count", () => {
  const events = [
    event({ type: "score", team_id: HOME, value: 1 }),
    event({
      type: "score",
      team_id: HOME,
      value: 1,
      voided_at: new Date(BASE_TIME + 999_000).toISOString(),
    }),
    event({ type: "score", team_id: HOME, value: 1 }),
  ];
  const result = deriveScore(events, HOME, AWAY, soccerConfig);
  assertEquals(result.home, 2);
});

Deno.test("voided fouls do not count", () => {
  const events = [
    event({ type: "foul", team_id: HOME }),
    event({
      type: "foul",
      team_id: HOME,
      voided_at: new Date(BASE_TIME + 999_000).toISOString(),
    }),
  ];
  const result = deriveScore(events, HOME, AWAY, soccerConfig);
  assertEquals(result.foulsByTeam[HOME], 1);
});

Deno.test("undo symmetry: voiding one event differs by exactly that event's contribution", () => {
  // Build a mixed sequence, then produce a second copy with the middle
  // score event voided. Everything else must remain identical.
  const live = [
    event({ type: "score", team_id: HOME, value: 1 }),
    event({ type: "score", team_id: HOME, value: 1 }),
    event({ type: "score", team_id: AWAY, value: 1 }),
    event({ type: "foul", team_id: AWAY }),
  ];
  const voided = live.map((e, i) =>
    i === 1
      ? { ...e, voided_at: new Date(BASE_TIME + 999_000).toISOString() }
      : e
  );

  const before = deriveScore(live, HOME, AWAY, soccerConfig);
  const after = deriveScore(voided, HOME, AWAY, soccerConfig);

  assertEquals(before.home - after.home, 1); // only diff is the voided home goal
  assertEquals(before.away, after.away);
  assertEquals(before.foulsByTeam, after.foulsByTeam);
  assertEquals(before.currentPeriod, after.currentPeriod);
});

// ---------- fouls -----------------------------------------------------------

Deno.test("fouls counted per team when track_fouls=true; both team ids present", () => {
  const events = [
    event({ type: "foul", team_id: HOME }),
    event({ type: "foul", team_id: AWAY }),
    event({ type: "foul", team_id: HOME }),
  ];
  const result = deriveScore(events, HOME, AWAY, soccerConfig);
  assertEquals(result.foulsByTeam, { [HOME]: 2, [AWAY]: 1 });
});

Deno.test("team with no fouls still appears at 0 when track_fouls=true", () => {
  const events = [event({ type: "foul", team_id: HOME })];
  const result = deriveScore(events, HOME, AWAY, soccerConfig);
  assertEquals(result.foulsByTeam, { [HOME]: 1, [AWAY]: 0 });
});

Deno.test("fouls attributed to a team outside the fixture are ignored", () => {
  const events = [
    event({ type: "foul", team_id: OTHER }),
    event({ type: "foul", team_id: HOME }),
  ];
  const result = deriveScore(events, HOME, AWAY, soccerConfig);
  // Only HOME + AWAY keys should appear; the stray team is dropped.
  assertEquals(result.foulsByTeam, { [HOME]: 1, [AWAY]: 0 });
});

Deno.test("foulsByTeam is {} when track_fouls=false", () => {
  const events = [
    event({ type: "foul", team_id: HOME }),
    event({ type: "foul", team_id: AWAY }),
  ];
  const result = deriveScore(events, HOME, AWAY, basketballConfig);
  assertEquals(result.foulsByTeam, {});
});

Deno.test("foulsByTeam is {} when track_fouls is absent from the config", () => {
  const events = [event({ type: "foul", team_id: HOME })];
  const result = deriveScore(events, HOME, AWAY, configWithoutFouls);
  assertEquals(result.foulsByTeam, {});
});

// ---------- periods ---------------------------------------------------------

Deno.test("period_start without matching period_end reports currentPeriod", () => {
  const events = [
    event({ type: "period_start", period: 1 }),
    event({ type: "score", team_id: HOME, value: 1 }),
  ];
  const result = deriveScore(events, HOME, AWAY, soccerConfig);
  assertEquals(result.currentPeriod, 1);
});

Deno.test("period_end closes the open period back to null", () => {
  const events = [
    event({ type: "period_start", period: 1 }),
    event({ type: "period_end", period: 1 }),
  ];
  const result = deriveScore(events, HOME, AWAY, soccerConfig);
  assertEquals(result.currentPeriod, null);
});

Deno.test("period_end for a non-open period is a no-op (defensive)", () => {
  const events = [
    event({ type: "period_start", period: 1 }),
    event({ type: "period_end", period: 2 }),
  ];
  const result = deriveScore(events, HOME, AWAY, soccerConfig);
  assertEquals(result.currentPeriod, 1);
});

Deno.test("stray period_end with nothing open is a no-op", () => {
  const events = [event({ type: "period_end", period: 1 })];
  const result = deriveScore(events, HOME, AWAY, soccerConfig);
  assertEquals(result.currentPeriod, null);
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

Deno.test("voided period_start does not open a period", () => {
  const events = [
    event({
      type: "period_start",
      period: 1,
      voided_at: new Date(BASE_TIME + 999_000).toISOString(),
    }),
  ];
  const result = deriveScore(events, HOME, AWAY, soccerConfig);
  assertEquals(result.currentPeriod, null);
});

// ---------- bye fixture -----------------------------------------------------

Deno.test("bye (awayTeamId=null): home scores accumulate; foulsByTeam only lists home", () => {
  const events = [
    event({ type: "score", team_id: HOME, value: 1 }),
    event({ type: "score", team_id: HOME, value: 1 }),
    event({ type: "foul", team_id: HOME }),
  ];
  const result = deriveScore(events, HOME, null, soccerConfig);
  assertEquals(result.home, 2);
  assertEquals(result.away, 0);
  assertEquals(result.foulsByTeam, { [HOME]: 1 });
});

Deno.test("bye: score attributed to any non-home team is dropped", () => {
  const events = [
    event({ type: "score", team_id: OTHER, value: 1 }),
    event({ type: "score", team_id: HOME, value: 1 }),
  ];
  const result = deriveScore(events, HOME, null, soccerConfig);
  assertEquals(result.home, 1);
  assertEquals(result.away, 0);
});

// ---------- ordering + purity -----------------------------------------------

Deno.test("out-of-order events derive identically to sorted input", () => {
  const shuffled = [
    event({
      type: "score",
      team_id: HOME,
      value: 1,
      created_at: new Date(BASE_TIME + 3000).toISOString(),
    }),
    event({
      type: "period_start",
      period: 1,
      created_at: new Date(BASE_TIME + 1000).toISOString(),
    }),
    event({
      type: "score",
      team_id: AWAY,
      value: 1,
      created_at: new Date(BASE_TIME + 4000).toISOString(),
    }),
    event({
      type: "score",
      team_id: HOME,
      value: 1,
      created_at: new Date(BASE_TIME + 2000).toISOString(),
    }),
  ];
  const sorted = [...shuffled].sort((a, b) =>
    a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0
  );

  const fromShuffled = deriveScore(shuffled, HOME, AWAY, soccerConfig);
  const fromSorted = deriveScore(sorted, HOME, AWAY, soccerConfig);
  assertEquals(fromShuffled, fromSorted);
});

Deno.test("deriveScore does not mutate the input array", () => {
  const events = [
    event({
      type: "score",
      team_id: HOME,
      value: 1,
      created_at: new Date(BASE_TIME + 2000).toISOString(),
    }),
    event({
      type: "score",
      team_id: AWAY,
      value: 1,
      created_at: new Date(BASE_TIME + 1000).toISOString(),
    }),
  ];
  const snapshot = events.map((e) => e.id);
  deriveScore(events, HOME, AWAY, soccerConfig);
  // Same ids in the same positions — the caller's array is untouched
  // even though the internal fold worked from a chronologically-sorted copy.
  assertEquals(events.map((e) => e.id), snapshot);
});

// ---------- misc ------------------------------------------------------------

Deno.test("card / timeout / note events do not affect the summary", () => {
  const events = [
    event({ type: "score", team_id: HOME, value: 1 }),
    event({ type: "card", team_id: HOME, value: 1 }),
    event({ type: "timeout", team_id: AWAY }),
    event({ type: "note" }),
  ];
  const result = deriveScore(events, HOME, AWAY, soccerConfig);
  assertEquals(result, {
    home: 1,
    away: 0,
    foulsByTeam: { [HOME]: 0, [AWAY]: 0 },
    currentPeriod: null,
  });
});
