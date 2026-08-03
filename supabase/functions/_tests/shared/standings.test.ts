// -----------------------------------------------------------------------------
// _tests/shared/standings.test.ts
//
// Unit tests for the pure standings computation. Covers:
//   - empty season
//   - a clean multi-team table
//   - points tie broken by goal difference
//   - points + GD tie broken by goals-for
//   - unknown tiebreaker string is ignored (doesn't crash)
//   - byes contribute nothing to either team
//   - netball's 2/1/0 config produces different order from soccer's 3/1/0
//   - config-absent path falls back to the 3/1/0 default
// -----------------------------------------------------------------------------

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  computeStandings,
  type FinishedFixture,
} from "../../_shared/standings.ts";
import type { SportConfig } from "../../_shared/score.ts";

const REDS = "a1111111-1111-1111-1111-111111111111";
const BLUES = "a2222222-2222-2222-2222-222222222222";
const GREENS = "a3333333-3333-3333-3333-333333333333";
const YELLOWS = "a4444444-4444-4444-4444-444444444444";

const soccerConfig: SportConfig = {
  standings: {
    points: { win: 3, draw: 1, loss: 0 },
    tiebreakers: ["points", "goal_diff", "goals_for"],
  },
};

const netballConfig: SportConfig = {
  standings: {
    points: { win: 2, draw: 1, loss: 0 },
    tiebreakers: ["points", "goal_diff", "goals_for"],
  },
};

/**
 * Build a FinishedFixture with sensible defaults.
 *
 * @param over - Overrides.
 * @returns A fixture ready for computeStandings.
 */
function fx(
  over: Partial<FinishedFixture> & {
    home_team_id: string;
    away_team_id: string | null;
    home_team_name: string;
    away_team_name: string | null;
    home_score: number;
    away_score: number;
  },
): FinishedFixture {
  return {
    fixture_id: over.fixture_id ?? crypto.randomUUID(),
    ...over,
  };
}

Deno.test("empty season → empty table", () => {
  assertEquals(computeStandings([], soccerConfig), []);
});

Deno.test("clean table: two wins > one win > no wins, points ordering", () => {
  const rows = computeStandings(
    [
      fx({
        home_team_id: REDS,
        home_team_name: "Reds",
        away_team_id: BLUES,
        away_team_name: "Blues",
        home_score: 2,
        away_score: 0,
      }),
      fx({
        home_team_id: REDS,
        home_team_name: "Reds",
        away_team_id: GREENS,
        away_team_name: "Greens",
        home_score: 3,
        away_score: 1,
      }),
      fx({
        home_team_id: BLUES,
        home_team_name: "Blues",
        away_team_id: GREENS,
        away_team_name: "Greens",
        home_score: 1,
        away_score: 1,
      }),
    ],
    soccerConfig,
  );

  // Reds first (6 pts). Blues and Greens tied on 1 pt and both on GD=-2;
  // Greens has more goals_for (2 vs Blues' 1) so goals_for tiebreaks Greens
  // above Blues.
  assertEquals(rows.map((r) => r.team_name), ["Reds", "Greens", "Blues"]);
  assertEquals(rows[0].points, 6); // Reds: 2 wins
  assertEquals(rows[1].points, 1); // Greens: 1 draw
  assertEquals(rows[2].points, 1); // Blues: 1 draw
});

Deno.test("goals_for tiebreaker orders equal points/GD correctly", () => {
  // Two teams with identical points and GD; the one with more goals_for
  // ranks higher.
  const rows = computeStandings(
    [
      fx({
        home_team_id: REDS,
        home_team_name: "Reds",
        away_team_id: BLUES,
        away_team_name: "Blues",
        home_score: 3,
        away_score: 3,
      }),
      fx({
        home_team_id: GREENS,
        home_team_name: "Greens",
        away_team_id: YELLOWS,
        away_team_name: "Yellows",
        home_score: 1,
        away_score: 1,
      }),
    ],
    soccerConfig,
  );
  // Points: all 1. GD: all 0. Goals_for: Reds/Blues=3, Greens/Yellows=1.
  const names = rows.map((r) => r.team_name);
  // Reds and Blues before Greens and Yellows.
  assertEquals(names.slice(0, 2).sort(), ["Blues", "Reds"]);
  assertEquals(names.slice(2, 4).sort(), ["Greens", "Yellows"]);
});

Deno.test("goal_diff tiebreaker breaks a points tie", () => {
  const rows = computeStandings(
    [
      fx({
        home_team_id: REDS,
        home_team_name: "Reds",
        away_team_id: BLUES,
        away_team_name: "Blues",
        home_score: 5,
        away_score: 0,
      }),
      fx({
        home_team_id: GREENS,
        home_team_name: "Greens",
        away_team_id: YELLOWS,
        away_team_name: "Yellows",
        home_score: 1,
        away_score: 0,
      }),
    ],
    soccerConfig,
  );
  // Reds and Greens both win 3 pts; Reds GD +5, Greens GD +1.
  assertEquals(rows[0].team_name, "Reds");
  assertEquals(rows[1].team_name, "Greens");
});

Deno.test("unknown tiebreaker string is skipped, not crashed", () => {
  const config: SportConfig = {
    standings: {
      points: { win: 3, draw: 1, loss: 0 },
      tiebreakers: ["reindeer", "points", "goal_diff"],
    },
  };
  const rows = computeStandings(
    [
      fx({
        home_team_id: REDS,
        home_team_name: "Reds",
        away_team_id: BLUES,
        away_team_name: "Blues",
        home_score: 1,
        away_score: 0,
      }),
    ],
    config,
  );
  assertEquals(rows[0].team_name, "Reds");
  assertEquals(rows[0].points, 3);
});

Deno.test("byes contribute nothing to either team", () => {
  // Reds plays Blues + a bye. Bye must not touch either side's counters.
  const rows = computeStandings(
    [
      fx({
        home_team_id: REDS,
        home_team_name: "Reds",
        away_team_id: BLUES,
        away_team_name: "Blues",
        home_score: 1,
        away_score: 0,
      }),
      fx({
        home_team_id: REDS,
        home_team_name: "Reds",
        away_team_id: null,
        away_team_name: null,
        home_score: 0,
        away_score: 0,
      }),
    ],
    soccerConfig,
  );
  const reds = rows.find((r) => r.team_name === "Reds")!;
  assertEquals(reds.played, 1);
  assertEquals(reds.won, 1);
  assertEquals(reds.points, 3);
});

Deno.test("netball 2-point-win config produces different totals from soccer's 3", () => {
  // A team with 2 wins should have 6 in soccer, 4 in netball.
  const fixtures = [
    fx({
      home_team_id: REDS,
      home_team_name: "Reds",
      away_team_id: BLUES,
      away_team_name: "Blues",
      home_score: 2,
      away_score: 0,
    }),
    fx({
      home_team_id: REDS,
      home_team_name: "Reds",
      away_team_id: GREENS,
      away_team_name: "Greens",
      home_score: 3,
      away_score: 1,
    }),
  ];
  const soccer = computeStandings(fixtures, soccerConfig);
  const netball = computeStandings(fixtures, netballConfig);
  assertEquals(soccer.find((r) => r.team_name === "Reds")!.points, 6);
  assertEquals(netball.find((r) => r.team_name === "Reds")!.points, 4);
});

Deno.test("absent standings block falls back to 3/1/0", () => {
  const empty: SportConfig = {}; // no `standings` at all
  const rows = computeStandings(
    [
      fx({
        home_team_id: REDS,
        home_team_name: "Reds",
        away_team_id: BLUES,
        away_team_name: "Blues",
        home_score: 1,
        away_score: 0,
      }),
    ],
    empty,
  );
  assertEquals(rows.find((r) => r.team_name === "Reds")!.points, 3);
});

Deno.test("goal_diff is populated on the returned rows", () => {
  const rows = computeStandings(
    [
      fx({
        home_team_id: REDS,
        home_team_name: "Reds",
        away_team_id: BLUES,
        away_team_name: "Blues",
        home_score: 4,
        away_score: 1,
      }),
    ],
    soccerConfig,
  );
  assertEquals(rows.find((r) => r.team_name === "Reds")!.goal_diff, 3);
  assertEquals(rows.find((r) => r.team_name === "Blues")!.goal_diff, -3);
});

Deno.test("final tiebreaker is alphabetical by team name (deterministic)", () => {
  // Two teams with identical everything → alphabetical.
  const rows = computeStandings(
    [
      fx({
        home_team_id: BLUES,
        home_team_name: "Blues",
        away_team_id: REDS,
        away_team_name: "Reds",
        home_score: 1,
        away_score: 1,
      }),
    ],
    soccerConfig,
  );
  assertEquals(rows.map((r) => r.team_name), ["Blues", "Reds"]);
});
