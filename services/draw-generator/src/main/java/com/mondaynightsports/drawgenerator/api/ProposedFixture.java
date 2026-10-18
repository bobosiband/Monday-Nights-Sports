/*
 * Response-side DTO: one proposed fixture ready for insertion. JSON keys are
 * camelCase; this is a new Java-side API with no legacy snake_case contract.
 */
package com.mondaynightsports.drawgenerator.api;

/**
 * A single proposed fixture with its slot id and 1-indexed round.
 *
 * @param round 1-indexed round number from the round-robin generator.
 * @param slotId Slot id this fixture should land in.
 * @param homeTeamId Home team id; always a real team.
 * @param awayTeamId Away team id, or null for a bye.
 */
public record ProposedFixture(int round, String slotId, String homeTeamId, String awayTeamId) {}
