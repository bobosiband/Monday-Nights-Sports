// -----------------------------------------------------------------------------
// _tests/events/validate-draw.test.ts
//
// Pure-logic tests for `validatePublish` and `validateUnpublish`. Publish
// is the safety boundary — the moment `is_published` flips, RLS opens
// every row on the event to `anon`. Broken draws must fail here, not in
// the public renderer at 6pm on a Monday.
//
// Run with: `deno test --allow-net supabase/functions/_tests/`
// -----------------------------------------------------------------------------

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type DraftFixture,
  validatePublish,
  validateUnpublish,
} from "../../events/validate-draw.ts";

/** A syntactically-valid fixture for the happy path. */
function goodFixture(overrides: Partial<DraftFixture> = {}): DraftFixture {
  return {
    id: "fx-1",
    slot_id: "slot-1",
    home_team_id: "team-a",
    away_team_id: "team-b",
    sport: "soccer",
    status: "scheduled",
    ...overrides,
  };
}

const SLOTS = [{ id: "slot-1" }, { id: "slot-2" }];
const SEASON = { sports: ["soccer", "netball"] };
const TEAM_IDS = ["team-a", "team-b", "team-c"];

Deno.test("happy path: one valid fixture is publishable", () => {
  const r = validatePublish({
    fixtures: [goodFixture()],
    slots: SLOTS,
    season: SEASON,
    teamIdsInSeason: TEAM_IDS,
  });
  assert(r.ok);
});

Deno.test("empty fixtures list is rejected with a message that mentions generate", () => {
  const r = validatePublish({
    fixtures: [],
    slots: SLOTS,
    season: SEASON,
    teamIdsInSeason: TEAM_IDS,
  });
  assert(!r.ok);
  assert(r.reason.toLowerCase().includes("no fixtures"));
});

Deno.test("fixture missing slot_id is rejected", () => {
  const r = validatePublish({
    fixtures: [goodFixture({ slot_id: null })],
    slots: SLOTS,
    season: SEASON,
    teamIdsInSeason: TEAM_IDS,
  });
  assert(!r.ok);
  assert(r.reason.includes("not assigned to a slot"));
});

Deno.test("fixture pointing at a slot not on this event is rejected", () => {
  const r = validatePublish({
    fixtures: [goodFixture({ slot_id: "slot-elsewhere" })],
    slots: SLOTS,
    season: SEASON,
    teamIdsInSeason: TEAM_IDS,
  });
  assert(!r.ok);
  assert(r.reason.includes("not assigned to a slot"));
});

Deno.test("home team not in the season is rejected", () => {
  const r = validatePublish({
    fixtures: [goodFixture({ home_team_id: "outsider" })],
    slots: SLOTS,
    season: SEASON,
    teamIdsInSeason: TEAM_IDS,
  });
  assert(!r.ok);
  assert(r.reason.includes("home team"));
});

Deno.test("away team not in the season is rejected", () => {
  const r = validatePublish({
    fixtures: [goodFixture({ away_team_id: "outsider" })],
    slots: SLOTS,
    season: SEASON,
    teamIdsInSeason: TEAM_IDS,
  });
  assert(!r.ok);
  assert(r.reason.includes("away team"));
});

Deno.test("bye (away_team_id = null) is legal", () => {
  const r = validatePublish({
    fixtures: [goodFixture({ away_team_id: null })],
    slots: SLOTS,
    season: SEASON,
    teamIdsInSeason: TEAM_IDS,
  });
  assert(r.ok);
});

Deno.test("home == away is rejected", () => {
  const r = validatePublish({
    fixtures: [goodFixture({ away_team_id: "team-a" })],
    slots: SLOTS,
    season: SEASON,
    teamIdsInSeason: TEAM_IDS,
  });
  assert(!r.ok);
  assert(r.reason.includes("same team on both sides"));
});

Deno.test("sport not in seasons.sports is rejected", () => {
  const r = validatePublish({
    fixtures: [goodFixture({ sport: "basketball" })],
    slots: SLOTS,
    season: SEASON,
    teamIdsInSeason: TEAM_IDS,
  });
  assert(!r.ok);
  assert(r.reason.includes("not declared on the season"));
});

Deno.test("cancelled fixtures don't block publish", () => {
  const r = validatePublish({
    fixtures: [goodFixture({ status: "cancelled" })],
    slots: SLOTS,
    season: SEASON,
    teamIdsInSeason: TEAM_IDS,
  });
  assert(r.ok);
});

Deno.test("first bad fixture short-circuits — reason names its id", () => {
  const r = validatePublish({
    fixtures: [
      goodFixture({ id: "good" }),
      goodFixture({ id: "bad", home_team_id: "outsider" }),
      goodFixture({ id: "also-bad", sport: "basketball" }),
    ],
    slots: SLOTS,
    season: SEASON,
    teamIdsInSeason: TEAM_IDS,
  });
  assert(!r.ok);
  assertEquals(r.reason.includes("bad"), true);
  assertEquals(r.reason.includes("also-bad"), false);
});

// ---------------------------------------------------------------------------
// Unpublish
// ---------------------------------------------------------------------------

Deno.test("unpublish OK when all fixtures are scheduled or cancelled", () => {
  const r = validateUnpublish({
    fixtures: [
      { id: "1", status: "scheduled" },
      { id: "2", status: "cancelled" },
    ],
    force: false,
  });
  assert(r.ok);
});

Deno.test("unpublish blocked by a single live fixture", () => {
  const r = validateUnpublish({
    fixtures: [
      { id: "1", status: "scheduled" },
      { id: "2", status: "live" },
    ],
    force: false,
  });
  assert(!r.ok);
  assert(r.reason.includes("live or complete"));
  assert(r.reason.includes("force"));
});

Deno.test("unpublish blocked by a complete fixture", () => {
  const r = validateUnpublish({
    fixtures: [{ id: "1", status: "complete" }],
    force: false,
  });
  assert(!r.ok);
  assert(r.reason.includes("live or complete"));
});

Deno.test("unpublish passes through when force = true, even with live matches", () => {
  const r = validateUnpublish({
    fixtures: [{ id: "1", status: "live" }],
    force: true,
  });
  assert(r.ok);
});
