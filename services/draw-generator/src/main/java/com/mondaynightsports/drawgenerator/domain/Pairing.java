/*
 * Pairing record emitted by the round-robin generator.
 *
 * `round` is 1-indexed to read naturally in UIs. `awayTeamId` is null when
 * the home team is on a bye for that round; the bye team is always the real
 * team on the home side (the virtual sentinel never surfaces to callers).
 */
package com.mondaynightsports.drawgenerator.domain;

/**
 * One generated pairing from the round-robin generator.
 *
 * @param round 1-indexed round number.
 * @param homeTeamId Home team id; always a real team, never the bye sentinel.
 * @param awayTeamId Away team id, or null when this round is a bye for the home team.
 */
public record Pairing(int round, String homeTeamId, String awayTeamId) {}
