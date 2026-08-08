// -----------------------------------------------------------------------------
// _tests/events/spread.test.ts
//
// Pure-logic tests for `spreadAcrossSlots`. The dry-run preview and the
// insert path both feed on this output, so we need every failure mode and
// every distribution edge case pinned down.
//
// Run with: `deno test --allow-net supabase/functions/_tests/`
// -----------------------------------------------------------------------------

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { spreadAcrossSlots } from "../../events/spread.ts";
import { generateRoundRobin } from "../../_shared/round-robin.ts";

Deno.test("empty pairings returns an empty fixture list, not an error", () => {
  const result = spreadAcrossSlots({ pairings: [], slot_ids: ["s1", "s2"] });
  assert(result.ok);
  assertEquals(result.fixtures, []);
});

Deno.test("empty pairings + empty slots is still ok (1-team degenerate case)", () => {
  const result = spreadAcrossSlots({ pairings: [], slot_ids: [] });
  assert(result.ok);
  assertEquals(result.fixtures, []);
});

Deno.test("non-empty pairings with zero slots is a shape error", () => {
  const pairings = generateRoundRobin(["a", "b"]);
  const result = spreadAcrossSlots({ pairings, slot_ids: [] });
  assert(!result.ok);
  assert(
    result.error.includes("At least one slot"),
    `expected slot-required message, got: ${result.error}`,
  );
});

Deno.test("duplicate slot ids are rejected — almost certainly a copy-paste error", () => {
  const pairings = generateRoundRobin(["a", "b"]);
  const result = spreadAcrossSlots({
    pairings,
    slot_ids: ["s1", "s2", "s1"],
  });
  assert(!result.ok);
  assert(
    result.error.includes("duplicates"),
    `expected duplicate message, got: ${result.error}`,
  );
});

Deno.test("round N lands in slot at index (N-1) mod slots.length", () => {
  const pairings = generateRoundRobin(["a", "b", "c", "d"]); // 3 rounds
  const result = spreadAcrossSlots({
    pairings,
    slot_ids: ["slot-1", "slot-2", "slot-3", "slot-4"],
  });
  assert(result.ok);
  // Each round has 2 fixtures for 4 teams
  const byRound: Record<number, Set<string>> = {};
  for (const f of result.fixtures) {
    (byRound[f.round] ??= new Set()).add(f.slot_id);
  }
  assertEquals([...byRound[1]], ["slot-1"]);
  assertEquals([...byRound[2]], ["slot-2"]);
  assertEquals([...byRound[3]], ["slot-3"]);
  // Slot 4 unused because there are only 3 rounds — deliberate.
});

Deno.test("more rounds than slots wraps around to slot 0 (deterministic)", () => {
  const pairings = generateRoundRobin(["a", "b", "c", "d", "e", "f"]); // 5 rounds
  const result = spreadAcrossSlots({
    pairings,
    slot_ids: ["s1", "s2", "s3"],
  });
  assert(result.ok);
  // Every fixture in round 4 should land on slot 1 (wrap of index 3 mod 3 = 0)
  const round4 = result.fixtures.filter((f) => f.round === 4);
  assert(round4.length > 0);
  for (const f of round4) assertEquals(f.slot_id, "s1");
  // Every fixture in round 5 should land on slot 2 (index 4 mod 3 = 1)
  const round5 = result.fixtures.filter((f) => f.round === 5);
  assert(round5.length > 0);
  for (const f of round5) assertEquals(f.slot_id, "s2");
});

Deno.test("preserves round number and team ids from generateRoundRobin", () => {
  const pairings = generateRoundRobin(["team-1", "team-2"]);
  const result = spreadAcrossSlots({ pairings, slot_ids: ["only-slot"] });
  assert(result.ok);
  assertEquals(result.fixtures.length, 1);
  assertEquals(result.fixtures[0].round, 1);
  assertEquals(result.fixtures[0].home_team_id, "team-1");
  assertEquals(result.fixtures[0].away_team_id, "team-2");
  assertEquals(result.fixtures[0].slot_id, "only-slot");
});

Deno.test("odd team count produces a bye — away_team_id preserved as null", () => {
  const pairings = generateRoundRobin(["a", "b", "c"]);
  const result = spreadAcrossSlots({ pairings, slot_ids: ["s1", "s2", "s3"] });
  assert(result.ok);
  const byes = result.fixtures.filter((f) => f.away_team_id === null);
  assertEquals(byes.length, 3); // each real team gets exactly one bye
  for (const b of byes) assert(b.home_team_id !== null);
});
