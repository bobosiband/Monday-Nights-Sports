// -----------------------------------------------------------------------------
// _tests/events/validate-body.test.ts
//
// Pure-logic tests for the events body validators. These fire on every write
// route, so a regression here is a regression on the whole draw-builder.
// Cover shape errors AND the "sparse patch" contract on the update paths.
//
// Cross-field checks that require DB reads (team ∈ season, sport ∈
// seasons.sports, slot ∈ event) live in the handlers, not here — see
// validate-body.ts for the split.
//
// Run with: `deno test --allow-net supabase/functions/_tests/`
// -----------------------------------------------------------------------------

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isoDate,
  timeOfDay,
  validateCreateEvent,
  validateCreateFixture,
  validateCreateSlot,
  validateGenerate,
  validateUpdateEvent,
  validateUpdateFixture,
  validateUpdateSlot,
} from "../../events/validate-body.ts";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

Deno.test("isoDate accepts YYYY-MM-DD, rejects everything else", () => {
  assertEquals(isoDate("2026-03-05"), "2026-03-05");
  assertEquals(isoDate("2026-3-5"), null);
  assertEquals(isoDate("2026/03/05"), null);
  assertEquals(isoDate("not a date"), null);
  assertEquals(isoDate(20260305), null);
  assertEquals(isoDate(null), null);
  assertEquals(isoDate("2026-13-05"), null); // month 13 → NaN date
});

Deno.test("timeOfDay accepts HH:MM and HH:MM:SS, normalises to HH:MM:SS", () => {
  assertEquals(timeOfDay("18:00"), "18:00:00");
  assertEquals(timeOfDay("18:00:30"), "18:00:30");
  assertEquals(timeOfDay("00:00"), "00:00:00");
  assertEquals(timeOfDay("23:59:59"), "23:59:59");
});

Deno.test("timeOfDay rejects garbage and out-of-range", () => {
  assertEquals(timeOfDay("24:00"), null);
  assertEquals(timeOfDay("18:60"), null);
  assertEquals(timeOfDay("18:00:60"), null);
  assertEquals(timeOfDay("6pm"), null);
  assertEquals(timeOfDay("18:00Z"), null);
  assertEquals(timeOfDay(1800), null);
});

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

Deno.test("validateCreateEvent happy path", () => {
  const r = validateCreateEvent({
    season_id: "11111111-1111-1111-1111-111111111111",
    event_date: "2026-03-05",
  });
  assert(r.ok);
  assertEquals(r.value.event_date, "2026-03-05");
});

Deno.test("validateCreateEvent rejects missing/bad ids and dates", () => {
  assertEquals(validateCreateEvent(null).ok, false);
  assertEquals(
    validateCreateEvent({ season_id: "not-uuid", event_date: "2026-03-05" }).ok,
    false,
  );
  assertEquals(
    validateCreateEvent({
      season_id: "11111111-1111-1111-1111-111111111111",
      event_date: "not-a-date",
    }).ok,
    false,
  );
});

Deno.test("validateUpdateEvent requires a valid event_date", () => {
  assertEquals(validateUpdateEvent(null).ok, false);
  assertEquals(validateUpdateEvent({}).ok, false);
  const r = validateUpdateEvent({ event_date: "2026-04-06" });
  assert(r.ok);
  assertEquals(r.value.event_date, "2026-04-06");
});

// ---------------------------------------------------------------------------
// Slots
// ---------------------------------------------------------------------------

Deno.test("validateCreateSlot happy path", () => {
  const r = validateCreateSlot({
    slot_number: 1,
    starts_at: "18:00",
    pitch: "Court A",
  });
  assert(r.ok);
  assertEquals(r.value.slot_number, 1);
  assertEquals(r.value.starts_at, "18:00:00");
  assertEquals(r.value.pitch, "Court A");
});

Deno.test("validateCreateSlot allows omitted or null pitch", () => {
  const a = validateCreateSlot({ slot_number: 1, starts_at: "18:00" });
  assert(a.ok);
  assertEquals(a.value.pitch, null);
  const b = validateCreateSlot({
    slot_number: 1,
    starts_at: "18:00",
    pitch: null,
  });
  assert(b.ok);
  assertEquals(b.value.pitch, null);
});

Deno.test("validateCreateSlot rejects bad slot_number, starts_at, and non-string pitch", () => {
  assertEquals(
    validateCreateSlot({ slot_number: 0, starts_at: "18:00" }).ok,
    false,
  );
  assertEquals(
    validateCreateSlot({ slot_number: 1.5, starts_at: "18:00" }).ok,
    false,
  );
  assertEquals(
    validateCreateSlot({ slot_number: 1, starts_at: "18h00" }).ok,
    false,
  );
  assertEquals(
    validateCreateSlot({ slot_number: 1, starts_at: "18:00", pitch: 5 }).ok,
    false,
  );
});

Deno.test("validateUpdateSlot rejects empty patch, accepts sparse", () => {
  assertEquals(validateUpdateSlot({}).ok, false);
  const r = validateUpdateSlot({ pitch: null });
  assert(r.ok);
  assertEquals(r.value.pitch, null);
  assertEquals(Object.keys(r.value).length, 1);
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const U = (n: string) => `${n}-1111-1111-1111-111111111111`;

Deno.test("validateCreateFixture happy path", () => {
  const r = validateCreateFixture({
    slot_id: U("aaaaaaaa"),
    sport: "soccer",
    home_team_id: U("bbbbbbbb"),
    away_team_id: U("cccccccc"),
  });
  assert(r.ok);
  assertEquals(r.value.sport, "soccer");
  assertEquals(r.value.away_team_id, U("cccccccc"));
});

Deno.test("validateCreateFixture allows bye (away_team_id null or omitted)", () => {
  const a = validateCreateFixture({
    slot_id: U("aaaaaaaa"),
    sport: "soccer",
    home_team_id: U("bbbbbbbb"),
    away_team_id: null,
  });
  assert(a.ok);
  assertEquals(a.value.away_team_id, null);
  const b = validateCreateFixture({
    slot_id: U("aaaaaaaa"),
    sport: "soccer",
    home_team_id: U("bbbbbbbb"),
  });
  assert(b.ok);
  assertEquals(b.value.away_team_id, null);
});

Deno.test("validateCreateFixture rejects home == away", () => {
  const r = validateCreateFixture({
    slot_id: U("aaaaaaaa"),
    sport: "soccer",
    home_team_id: U("bbbbbbbb"),
    away_team_id: U("bbbbbbbb"),
  });
  assert(!r.ok);
});

Deno.test("validateUpdateFixture rejects setting status to live/complete", () => {
  const live = validateUpdateFixture({ status: "live" });
  assert(!live.ok);
  const complete = validateUpdateFixture({ status: "complete" });
  assert(!complete.ok);
});

Deno.test("validateUpdateFixture accepts scheduled/cancelled status changes", () => {
  const r = validateUpdateFixture({ status: "cancelled" });
  assert(r.ok);
  assertEquals(r.value.status, "cancelled");
});

Deno.test("validateUpdateFixture catches home==away across both fields", () => {
  const r = validateUpdateFixture({
    home_team_id: U("aaaaaaaa"),
    away_team_id: U("aaaaaaaa"),
  });
  assert(!r.ok);
});

Deno.test("validateUpdateFixture allows explicit bye via away_team_id: null", () => {
  const r = validateUpdateFixture({ away_team_id: null });
  assert(r.ok);
  assertEquals(r.value.away_team_id, null);
});

// ---------------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------------

Deno.test("validateGenerate happy path", () => {
  const r = validateGenerate({
    sport: "soccer",
    team_ids: [U("aaaaaaaa"), U("bbbbbbbb"), U("cccccccc")],
    slot_ids: [U("11111111"), U("22222222")],
  });
  assert(r.ok);
  assertEquals(r.value.team_ids.length, 3);
});

Deno.test("validateGenerate requires at least two teams", () => {
  const r = validateGenerate({
    sport: "soccer",
    team_ids: [U("aaaaaaaa")],
    slot_ids: [U("11111111")],
  });
  assert(!r.ok);
});

Deno.test("validateGenerate rejects duplicate team ids", () => {
  const r = validateGenerate({
    sport: "soccer",
    team_ids: [U("aaaaaaaa"), U("aaaaaaaa")],
    slot_ids: [U("11111111")],
  });
  assert(!r.ok);
  assert(r.error.includes("duplicates"));
});

Deno.test("validateGenerate rejects duplicate slot ids", () => {
  const r = validateGenerate({
    sport: "soccer",
    team_ids: [U("aaaaaaaa"), U("bbbbbbbb")],
    slot_ids: [U("11111111"), U("11111111")],
  });
  assert(!r.ok);
  assert(r.error.includes("duplicates"));
});

Deno.test("validateGenerate requires at least one slot", () => {
  const r = validateGenerate({
    sport: "soccer",
    team_ids: [U("aaaaaaaa"), U("bbbbbbbb")],
    slot_ids: [],
  });
  assert(!r.ok);
});
