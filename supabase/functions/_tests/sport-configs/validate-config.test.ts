// -----------------------------------------------------------------------------
// _tests/sport-configs/validate-config.test.ts
//
// Pure-logic tests for `validateConfig`. Locks in the tradeoff the module
// documents: strict on wrong values (bad shape corrupts scoring AND
// standings later), permissive on absence (missing keys fall back to
// deriveScore / computeStandings defaults).
//
// Run with: `deno test --allow-net supabase/functions/_tests/`
// -----------------------------------------------------------------------------

import {
  assert,
  assertEquals,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { validateConfig } from "../../sport-configs/validate-config.ts";

/**
 * Convenience: run the validator and assert on the failure message. Fails
 * loudly if the input was unexpectedly accepted so a regression can't slip
 * a bad shape through with a confusing "assert on undefined".
 *
 * @param raw - The input to reject.
 * @param expected - Substring that must appear in the error message.
 */
function assertRejects(raw: unknown, expected: string): void {
  const result = validateConfig(raw);
  assertEquals(result.ok, false, `expected rejection for ${JSON.stringify(raw)}`);
  if (!result.ok) {
    assert(
      result.error.includes(expected),
      `expected error to include "${expected}", got "${result.error}"`,
    );
  }
}

// ---------- top-level shape ------------------------------------------------

Deno.test("empty object is accepted — every field defaulting to deriveScore/computeStandings is fine", () => {
  const result = validateConfig({});
  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.value, {});
});

Deno.test("null / undefined / non-objects / arrays are rejected as top-level shape errors", () => {
  for (const bad of [null, undefined, 0, "hello", true, [1, 2, 3]]) {
    assertRejects(bad, "config must be a JSON object");
  }
});

// ---------- periods --------------------------------------------------------

Deno.test("periods must be an object; array or scalar rejected", () => {
  assertRejects({ periods: [] }, "periods must be an object");
  assertRejects({ periods: "two" }, "periods must be an object");
  assertRejects({ periods: null }, "periods must be an object");
});

Deno.test("periods.count must be a positive integer", () => {
  assertRejects({ periods: {} }, "periods.count must be a positive integer");
  assertRejects({ periods: { count: 0 } }, "periods.count must be a positive integer");
  assertRejects({ periods: { count: -1 } }, "periods.count must be a positive integer");
  assertRejects({ periods: { count: 1.5 } }, "periods.count must be a positive integer");
  assertRejects({ periods: { count: "2" } }, "periods.count must be a positive integer");
});

Deno.test("periods.minutes optional; when present must be a positive integer", () => {
  // Absent minutes: still valid.
  assertEquals(validateConfig({ periods: { count: 2 } }).ok, true);
  assertRejects(
    { periods: { count: 2, minutes: 0 } },
    "periods.minutes must be a positive integer",
  );
  assertRejects(
    { periods: { count: 2, minutes: -5 } },
    "periods.minutes must be a positive integer",
  );
  assertRejects(
    { periods: { count: 2, minutes: 20.5 } },
    "periods.minutes must be a positive integer",
  );
});

Deno.test("periods.direction optional; when present must be 'up' or 'down'", () => {
  assertEquals(
    validateConfig({ periods: { count: 2, direction: "up" } }).ok,
    true,
  );
  assertEquals(
    validateConfig({ periods: { count: 2, direction: "down" } }).ok,
    true,
  );
  assertRejects(
    { periods: { count: 2, direction: "sideways" } },
    "periods.direction must be 'up' or 'down'",
  );
});

// ---------- score_increments ----------------------------------------------

Deno.test("score_increments must be a non-empty array", () => {
  assertRejects({ score_increments: [] }, "score_increments must be a non-empty array");
  assertRejects({ score_increments: "1,2,3" }, "score_increments must be a non-empty array");
  assertRejects({ score_increments: null }, "score_increments must be a non-empty array");
});

Deno.test("score_increments entries must all be positive integers", () => {
  assertRejects(
    { score_increments: [1, 0, 3] },
    "score_increments entries must be positive integers",
  );
  assertRejects(
    { score_increments: [1, -1] },
    "score_increments entries must be positive integers",
  );
  assertRejects(
    { score_increments: [1, 1.5] },
    "score_increments entries must be positive integers",
  );
  assertRejects(
    { score_increments: [1, "2"] },
    "score_increments entries must be positive integers",
  );
});

Deno.test("score_increments accepts realistic sport configs", () => {
  assertEquals(validateConfig({ score_increments: [1] }).ok, true); // soccer
  assertEquals(validateConfig({ score_increments: [1, 2, 3] }).ok, true); // basketball
});

// ---------- track_fouls ---------------------------------------------------

Deno.test("track_fouls optional; when present must be boolean", () => {
  assertEquals(validateConfig({ track_fouls: true }).ok, true);
  assertEquals(validateConfig({ track_fouls: false }).ok, true);
  assertRejects({ track_fouls: "yes" }, "track_fouls must be a boolean");
  assertRejects({ track_fouls: 1 }, "track_fouls must be a boolean");
  assertRejects({ track_fouls: null }, "track_fouls must be a boolean");
});

// ---------- standings -----------------------------------------------------

Deno.test("standings must be an object; array or scalar rejected", () => {
  assertRejects({ standings: [] }, "standings must be an object");
  assertRejects({ standings: "yes" }, "standings must be an object");
  assertRejects({ standings: null }, "standings must be an object");
});

Deno.test("standings.points requires win, draw, loss non-negative integers", () => {
  assertRejects(
    { standings: { points: {} } },
    "standings.points.win must be a non-negative integer",
  );
  assertRejects(
    { standings: { points: { win: 3, draw: 1 } } },
    "standings.points.loss must be a non-negative integer",
  );
  assertRejects(
    { standings: { points: { win: 3, draw: -1, loss: 0 } } },
    "standings.points.draw must be a non-negative integer",
  );
  assertRejects(
    { standings: { points: { win: 2.5, draw: 1, loss: 0 } } },
    "standings.points.win must be a non-negative integer",
  );
  // Zero is accepted — some sports use loss=0 explicitly.
  assertEquals(
    validateConfig({
      standings: { points: { win: 3, draw: 1, loss: 0 } },
    }).ok,
    true,
  );
});

Deno.test("standings.tiebreakers must be an array of strings; content not gated", () => {
  // Well-formed strings: accepted, even if the string is nonsense — the
  // consumer (computeStandings) tolerates unknown tiebreaker names by
  // skipping them.
  assertEquals(
    validateConfig({
      standings: { tiebreakers: ["points", "goal_diff", "goals_for"] },
    }).ok,
    true,
  );
  assertEquals(
    validateConfig({
      standings: { tiebreakers: ["something-weird"] },
    }).ok,
    true,
  );
  assertRejects(
    { standings: { tiebreakers: "points,goal_diff" } },
    "standings.tiebreakers must be an array of strings",
  );
  assertRejects(
    { standings: { tiebreakers: ["points", 1] } },
    "standings.tiebreakers must be an array of strings",
  );
});

// ---------- realistic wholes ---------------------------------------------

Deno.test("soccer config accepted end-to-end", () => {
  const soccer = {
    periods: { count: 2, minutes: 20, direction: "up" },
    score_increments: [1],
    track_fouls: true,
    standings: {
      points: { win: 3, draw: 1, loss: 0 },
      tiebreakers: ["points", "goal_diff", "goals_for"],
    },
  };
  const result = validateConfig(soccer);
  assertEquals(result.ok, true);
  if (result.ok) assertStrictEquals(result.value, soccer);
});

Deno.test("basketball config accepted end-to-end", () => {
  const basketball = {
    periods: { count: 4, minutes: 10, direction: "down" },
    score_increments: [1, 2, 3],
    track_fouls: true,
    standings: {
      points: { win: 2, draw: 0, loss: 1 },
      tiebreakers: ["points", "goal_diff"],
    },
  };
  const result = validateConfig(basketball);
  assertEquals(result.ok, true);
});

Deno.test("first failing field short-circuits — the error names it, not a later field", () => {
  // A config where BOTH periods.count is bad AND standings.tiebreakers is
  // bad: the caller should see the periods.count error, since it comes
  // first in the walk. This guards against a refactor accidentally
  // reordering the checks and shadowing an earlier failure.
  const result = validateConfig({
    periods: { count: 0 },
    standings: { tiebreakers: [1, 2] },
  });
  assertEquals(result.ok, false);
  if (!result.ok) {
    assert(result.error.includes("periods.count"), result.error);
  }
});
