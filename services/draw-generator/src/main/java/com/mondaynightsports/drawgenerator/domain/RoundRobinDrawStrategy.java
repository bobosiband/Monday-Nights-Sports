/*
 * Round-robin draw generator, the circle-method implementation.
 *
 * This is a Java-side mirror of the TypeScript
 * supabase/functions/events/domain/RoundRobinGenerator.ts. The two must agree
 * byte-for-byte on the pairings they emit for the same input: the parity
 * fixtures under src/test/resources/parity/ exercise both.
 *
 * Algorithm (circle method):
 *   1. If the input length is odd, append a null sentinel so the working list
 *      has even length N. The sentinel represents "no opponent this round";
 *      the team paired against it gets a bye.
 *   2. Fix the first team in its seat; the remaining N-1 teams rotate one
 *      seat clockwise per round.
 *   3. Each round pairs seat i with seat (N-1-i) for i in [0, N/2).
 *   4. Total rounds = N - 1. Every unordered pair of real teams meets
 *      exactly once by construction.
 */
package com.mondaynightsports.drawgenerator.domain;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

/**
 * Round-robin strategy: every unordered pair of teams meets exactly once. Deterministic for a given
 * input order; shuffle the input upstream if a randomised seeding is wanted.
 */
public final class RoundRobinDrawStrategy implements DrawStrategy {

  /**
   * Generate the pairings for the given team ids.
   *
   * @param teamIds Team ids in seat order. 0-length and 1-length inputs return an empty list (a
   *     single team cannot play itself).
   * @return The pairings, ordered by round ascending. For odd team counts the number of rounds
   *     equals the team count; for even counts it is one less.
   * @throws NullPointerException if teamIds or any element is null.
   */
  @Override
  public List<Pairing> buildDraw(List<String> teamIds) {
    if (teamIds == null) {
      throw new NullPointerException("teamIds must not be null");
    }
    if (teamIds.size() < 2) {
      return Collections.emptyList();
    }
    for (String id : teamIds) {
      if (id == null) {
        throw new NullPointerException("teamIds must not contain null entries");
      }
    }

    // Copy so we do not mutate the caller's list during rotation.
    // The sentinel is tracked as `null` inside the seat array; it never
    // leaves this method.
    String[] seats =
        teamIds.size() % 2 == 1 ? appendSentinel(teamIds) : teamIds.toArray(new String[0]);

    int n = seats.length;
    int rounds = n - 1;
    int halfRound = n / 2;
    List<Pairing> fixtures = new ArrayList<>(halfRound * rounds);

    for (int round = 1; round <= rounds; round++) {
      for (int i = 0; i < halfRound; i++) {
        String a = seats[i];
        String b = seats[n - 1 - i];

        // The sentinel means "bye for the real team". Reorient so homeTeamId
        // is always the real team and awayTeamId is null; no null ever
        // appears as a home id.
        if (a == null && b == null) {
          continue; // impossible for n >= 2, but defensive
        }
        if (a == null) {
          fixtures.add(new Pairing(round, b, null));
        } else if (b == null) {
          fixtures.add(new Pairing(round, a, null));
        } else {
          fixtures.add(new Pairing(round, a, b));
        }
      }
      rotate(seats);
    }

    return fixtures;
  }

  /**
   * Build the even-length seat array for an odd input by appending a null sentinel at the end.
   *
   * @param teamIds Original odd-length team ids.
   * @return Seat array with trailing null.
   */
  private static String[] appendSentinel(List<String> teamIds) {
    String[] seats = Arrays.copyOf(teamIds.toArray(new String[0]), teamIds.size() + 1);
    seats[teamIds.size()] = null;
    return seats;
  }

  /**
   * In-place clockwise rotation of seats[1..n-1] by one position, with seats[0] left fixed. This is
   * the "fix one, rotate the rest" step of the circle method.
   *
   * @param seats The working seat array; mutated in place.
   */
  private static void rotate(String[] seats) {
    if (seats.length <= 2) {
      return;
    }
    String last = seats[seats.length - 1];
    for (int i = seats.length - 1; i > 1; i--) {
      seats[i] = seats[i - 1];
    }
    seats[1] = last;
  }
}
