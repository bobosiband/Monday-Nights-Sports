// -----------------------------------------------------------------------------
// _tests/shared/round-robin.test.ts
//
// Pure-logic tests for `generateRoundRobin`. Locks in the algorithm's
// three critical invariants — every pair meets exactly once, byes are
// distributed fairly, and the output is deterministic — plus a few
// edge cases (empty / single team) so the caller can rely on the
// return type.
//
// Run with: `deno test --allow-net supabase/functions/_tests/`
// -----------------------------------------------------------------------------

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  generateRoundRobin,
  type RoundRobinFixture,
} from "../../_shared/round-robin.ts";

/**
 * Build a canonical, unordered key for a pair of team ids so we can
 * assert "each pair appears exactly once" without caring which team
 * was assigned the home seat.
 *
 * @param a - First team id.
 * @param b - Second team id.
 * @returns Sorted `"a|b"` key.
 */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Extract the set of pair keys from a fixture list, ignoring byes.
 *
 * @param fixtures - Schedule.
 * @returns Set of pair keys.
 */
function pairsPlayed(fixtures: RoundRobinFixture[]): Set<string> {
  const pairs = new Set<string>();
  for (const f of fixtures) {
    if (f.away_team_id !== null) {
      pairs.add(pairKey(f.home_team_id, f.away_team_id));
    }
  }
  return pairs;
}

/**
 * Count byes per team id.
 *
 * @param fixtures - Schedule.
 * @returns Map from team id → number of byes.
 */
function byesByTeam(fixtures: RoundRobinFixture[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const f of fixtures) {
    if (f.away_team_id === null) {
      out.set(f.home_team_id, (out.get(f.home_team_id) ?? 0) + 1);
    }
  }
  return out;
}

/**
 * Enumerate every unordered pair from a list of team ids.
 *
 * @param teamIds - Team ids.
 * @returns Set of pair keys.
 */
function allPairs(teamIds: string[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < teamIds.length; i++) {
    for (let j = i + 1; j < teamIds.length; j++) {
      out.add(pairKey(teamIds[i], teamIds[j]));
    }
  }
  return out;
}

// ---------- edge cases ----------------------------------------------------

Deno.test("empty input returns []", () => {
  assertEquals(generateRoundRobin([]), []);
});

Deno.test("single team returns [] (can't play itself)", () => {
  assertEquals(generateRoundRobin(["A"]), []);
});

Deno.test("two teams: one round, one fixture, no byes", () => {
  const fixtures = generateRoundRobin(["A", "B"]);
  assertEquals(fixtures.length, 1);
  assertEquals(fixtures[0].round, 1);
  assertEquals(pairKey(fixtures[0].home_team_id, fixtures[0].away_team_id!), "A|B");
});

// ---------- even counts ---------------------------------------------------

Deno.test("even count (4 teams): 3 rounds, 6 fixtures, no byes", () => {
  const teams = ["A", "B", "C", "D"];
  const fixtures = generateRoundRobin(teams);
  assertEquals(fixtures.length, 6);

  const rounds = new Set(fixtures.map((f) => f.round));
  assertEquals(rounds.size, 3);

  assertEquals(byesByTeam(fixtures).size, 0);

  // All-pairs invariant.
  assertEquals(pairsPlayed(fixtures), allPairs(teams));
});

Deno.test("even count (6 teams): 5 rounds, 15 fixtures, no byes", () => {
  const teams = ["A", "B", "C", "D", "E", "F"];
  const fixtures = generateRoundRobin(teams);
  assertEquals(fixtures.length, 15); // C(6,2)
  assertEquals(new Set(fixtures.map((f) => f.round)).size, 5);
  assertEquals(byesByTeam(fixtures).size, 0);
  assertEquals(pairsPlayed(fixtures), allPairs(teams));
});

// ---------- odd counts (bye handling) -------------------------------------

Deno.test("odd count (3 teams): 3 rounds, each team gets exactly one bye", () => {
  const teams = ["A", "B", "C"];
  const fixtures = generateRoundRobin(teams);

  // 3 pairs + 3 byes = 6 fixtures across 3 rounds.
  assertEquals(new Set(fixtures.map((f) => f.round)).size, 3);
  assertEquals(pairsPlayed(fixtures), allPairs(teams));

  const byes = byesByTeam(fixtures);
  assertEquals(byes.size, 3);
  for (const team of teams) {
    assertEquals(byes.get(team), 1, `${team} should have exactly 1 bye`);
  }
});

Deno.test("odd count (5 teams): 5 rounds, each team gets exactly one bye", () => {
  const teams = ["A", "B", "C", "D", "E"];
  const fixtures = generateRoundRobin(teams);

  // 10 pairs + 5 byes = 15 fixtures across 5 rounds.
  assertEquals(fixtures.length, 15);
  assertEquals(new Set(fixtures.map((f) => f.round)).size, 5);
  assertEquals(pairsPlayed(fixtures), allPairs(teams));

  const byes = byesByTeam(fixtures);
  assertEquals(byes.size, 5);
  for (const team of teams) {
    assertEquals(byes.get(team), 1, `${team} should have exactly 1 bye`);
  }
});

Deno.test("bye fixtures never have a null home_team_id", () => {
  const fixtures = generateRoundRobin(["A", "B", "C", "D", "E"]);
  for (const f of fixtures) {
    assert(
      typeof f.home_team_id === "string" && f.home_team_id.length > 0,
      "home_team_id must always be a real team id",
    );
  }
});

// ---------- determinism ---------------------------------------------------

Deno.test("determinism: two calls with the same input return identical output", () => {
  const teams = ["A", "B", "C", "D", "E"];
  const first = generateRoundRobin(teams);
  const second = generateRoundRobin(teams);
  assertEquals(first, second);
});

Deno.test("input array is not mutated", () => {
  const teams = ["A", "B", "C", "D", "E"];
  const snapshot = [...teams];
  generateRoundRobin(teams);
  assertEquals(teams, snapshot);
});

// ---------- fixture ordering ---------------------------------------------

Deno.test("fixtures are ordered by round ascending (1-indexed)", () => {
  const fixtures = generateRoundRobin(["A", "B", "C", "D", "E", "F"]);
  let last = 0;
  for (const f of fixtures) {
    assert(f.round >= last, `round ${f.round} came after ${last}`);
    last = f.round;
  }
  assertEquals(fixtures[0].round, 1);
});
