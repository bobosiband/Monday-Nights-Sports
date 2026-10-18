// -----------------------------------------------------------------------------
// events/domain/DrawStrategy.ts
//
// Open/closed seam for draw-generation algorithms. One implementation
// today: `RoundRobinDrawStrategy`, which composes the round-robin
// generator with the slot spread. Adding a knockout format later is a new
// class, not an edit here.
// -----------------------------------------------------------------------------

import { generateRoundRobin } from "./RoundRobinGenerator.ts";
import {
  spreadAcrossSlots,
  type SpreadError,
  type SpreadFixture,
  type SpreadOk,
} from "./SlotSpread.ts";

/** Input shape every strategy accepts. */
export interface DrawInput {
  team_ids: string[];
  slot_ids: string[];
}

/** Result shape every strategy returns. Mirrors `SlotSpread`'s result. */
export type DrawResult = SpreadOk | SpreadError;

/** Contract shared by every draw-generation strategy. */
export interface DrawStrategy {
  /**
   * Build the proposed fixtures for one draw.
   *
   * @param input - Team ids (ordered) and slot ids (ordered).
   * @returns Fixtures to insert, or an error reason.
   */
  buildDraw(input: DrawInput): DrawResult;
}

/**
 * Round-robin strategy: everyone plays everyone once. Deterministic for a
 * given input order; shuffle `team_ids` upstream if you want a randomised
 * seeding.
 */
export class RoundRobinDrawStrategy implements DrawStrategy {
  /**
   * @param input - Team ids and slot ids.
   * @returns Fixtures carrying their slot id and round number, or an
   *          error object.
   */
  buildDraw(input: DrawInput): DrawResult {
    const pairings = generateRoundRobin(input.team_ids);
    return spreadAcrossSlots({ pairings, slot_ids: input.slot_ids });
  }
}

export type { SpreadFixture };
