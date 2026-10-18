// -----------------------------------------------------------------------------
// tests/events/DrawParity.test.ts
//
// Deno-side parity test: assert the TypeScript RoundRobinGenerator + slot
// spread produce byte-for-byte the same output as the Java draw-generator
// for the shared JSON fixtures under
// services/draw-generator/src/test/resources/parity/. The Java twin lives
// at services/draw-generator/src/test/java/.../ParityFixturesTest.java;
// if the two sides drift, both tests fail at the same fixture.
// -----------------------------------------------------------------------------

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { generateRoundRobin } from "../../supabase/functions/events/domain/RoundRobinGenerator.ts";
import { spreadAcrossSlots } from "../../supabase/functions/events/domain/SlotSpread.ts";

/** Shape of each parity fixture, in JSON. Mirrors the Java-side records. */
interface ParityFixture {
  name: string;
  input: {
    teamIds: string[];
    slotIds: string[];
  };
  expected: Array<{
    round: number;
    slotId: string;
    homeTeamId: string;
    awayTeamId: string | null;
  }>;
}

/** Files to load; keep in sync with ParityFixturesTest.FIXTURE_FILES. */
const FIXTURE_FILES = [
  "four-teams-four-slots.json",
  "three-teams-two-slots-with-byes.json",
  "six-teams-three-slots-wrap.json",
  "two-teams-one-slot.json",
  "five-teams-four-slots.json",
];

const PARITY_DIR = new URL(
  "../../services/draw-generator/src/test/resources/parity/",
  import.meta.url,
);

/**
 * Load one parity fixture from disk.
 *
 * @param name - The file name.
 * @returns The parsed fixture.
 */
async function loadFixture(name: string): Promise<ParityFixture> {
  const path = new URL(name, PARITY_DIR);
  const text = await Deno.readTextFile(path);
  return JSON.parse(text) as ParityFixture;
}

for (const name of FIXTURE_FILES) {
  Deno.test(
    `parity: ${name} TypeScript output matches shared expected JSON`,
    async () => {
      const fixture = await loadFixture(name);
      const pairings = generateRoundRobin(fixture.input.teamIds);
      const spread = spreadAcrossSlots({
        pairings,
        slot_ids: fixture.input.slotIds,
      });
      assert(spread.ok, "spread must succeed on parity fixture");
      const actual = spread.fixtures.map((f) => ({
        round: f.round,
        slotId: f.slot_id,
        homeTeamId: f.home_team_id,
        awayTeamId: f.away_team_id,
      }));
      assertEquals(actual, fixture.expected);
    },
  );
}
