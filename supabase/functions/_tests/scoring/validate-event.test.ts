// -----------------------------------------------------------------------------
// _tests/scoring/validate-event.test.ts
//
// Pure-function tests for the record-event validator.
//
// Run with: `deno test supabase/functions/_tests/`
// -----------------------------------------------------------------------------

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { validateRecordBody } from "../../scoring/validate-event.ts";
import type { FixtureContext, SportConfig } from "../../scoring/types.ts";

const FIXTURE_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const EVENT_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const HOME = "11111111-1111-1111-1111-111111111111";
const AWAY = "22222222-2222-2222-2222-222222222222";

const fixture: FixtureContext = {
  id: FIXTURE_ID,
  event_id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
  season_id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
  home_team_id: HOME,
  away_team_id: AWAY,
  sport: "soccer",
  status: "scheduled",
};

const soccerConfig: SportConfig = { score_increments: [1], track_fouls: true };
const basketballConfig: SportConfig = {
  score_increments: [1, 2, 3],
  track_fouls: false,
};

Deno.test("rejects a null body", () => {
  const result = validateRecordBody(null, fixture, soccerConfig);
  assertEquals(result.ok, false);
});

Deno.test("rejects a body without a UUID id", () => {
  const result = validateRecordBody(
    { id: "not-a-uuid", type: "score", team_id: HOME, value: 1 },
    fixture,
    soccerConfig,
  );
  assertEquals(result.ok, false);
});

Deno.test("rejects unknown event type", () => {
  const result = validateRecordBody(
    { id: EVENT_ID, type: "goal", team_id: HOME, value: 1 },
    fixture,
    soccerConfig,
  );
  assertEquals(result.ok, false);
});

Deno.test("rejects period_start on the generic events route", () => {
  const result = validateRecordBody(
    { id: EVENT_ID, type: "period_start", period: 1 },
    fixture,
    soccerConfig,
  );
  assertEquals(result.ok, false);
});

Deno.test("accepts a valid soccer goal", () => {
  const result = validateRecordBody(
    { id: EVENT_ID, type: "score", team_id: HOME, value: 1 },
    fixture,
    soccerConfig,
  );
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.value.type, "score");
    assertEquals(result.value.team_id, HOME);
    assertEquals(result.value.value, 1);
  }
});

Deno.test("rejects a soccer score with value 2 (not an allowed increment)", () => {
  const result = validateRecordBody(
    { id: EVENT_ID, type: "score", team_id: HOME, value: 2 },
    fixture,
    soccerConfig,
  );
  assertEquals(result.ok, false);
});

Deno.test("accepts a basketball 3-pointer", () => {
  const result = validateRecordBody(
    { id: EVENT_ID, type: "score", team_id: HOME, value: 3 },
    fixture,
    basketballConfig,
  );
  assertEquals(result.ok, true);
});

Deno.test("accepts any positive score value when sport config declares none", () => {
  const result = validateRecordBody(
    { id: EVENT_ID, type: "score", team_id: HOME, value: 7 },
    fixture,
    {}, // no score_increments declared
  );
  assertEquals(result.ok, true);
});

Deno.test("rejects a score value of 0", () => {
  const result = validateRecordBody(
    { id: EVENT_ID, type: "score", team_id: HOME, value: 0 },
    fixture,
    soccerConfig,
  );
  assertEquals(result.ok, false);
});

Deno.test("rejects team_id that isn't part of the fixture", () => {
  const result = validateRecordBody(
    {
      id: EVENT_ID,
      type: "score",
      team_id: "99999999-9999-9999-9999-999999999999",
      value: 1,
    },
    fixture,
    soccerConfig,
  );
  assertEquals(result.ok, false);
});

Deno.test("accepts a foul without value", () => {
  const result = validateRecordBody(
    { id: EVENT_ID, type: "foul", team_id: HOME },
    fixture,
    soccerConfig,
  );
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.value.type, "foul");
    assertEquals(result.value.value, null);
  }
});

Deno.test("rejects a foul without team_id", () => {
  const result = validateRecordBody(
    { id: EVENT_ID, type: "foul" },
    fixture,
    soccerConfig,
  );
  assertEquals(result.ok, false);
});

Deno.test("accepts a card with severity value", () => {
  const result = validateRecordBody(
    { id: EVENT_ID, type: "card", team_id: HOME, value: 2 },
    fixture,
    soccerConfig,
  );
  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.value.value, 2);
});

Deno.test("rejects a card without severity", () => {
  const result = validateRecordBody(
    { id: EVENT_ID, type: "card", team_id: HOME },
    fixture,
    soccerConfig,
  );
  assertEquals(result.ok, false);
});

Deno.test("accepts a note without team_id", () => {
  const result = validateRecordBody(
    { id: EVENT_ID, type: "note" },
    fixture,
    soccerConfig,
  );
  assertEquals(result.ok, true);
});

Deno.test("rejects a negative match_clock_ms", () => {
  const result = validateRecordBody(
    {
      id: EVENT_ID,
      type: "score",
      team_id: HOME,
      value: 1,
      match_clock_ms: -1,
    },
    fixture,
    soccerConfig,
  );
  assertEquals(result.ok, false);
});
