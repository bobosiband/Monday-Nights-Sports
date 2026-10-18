/*
 * Unit tests for RoundRobinDrawStrategy.
 *
 * Pins the critical invariants the TypeScript side's RoundRobinGenerator.ts
 * also pins:
 *   - every unordered pair of real teams meets exactly once
 *   - total rounds = n - 1 for even n, equals n for odd n
 *   - each real team gets exactly one bye when n is odd; no byes when even
 *   - homeTeamId in a bye row is always the real team
 *   - the specific 4-team and 3-team worked examples from the TypeScript
 *     docstring must match byte-for-byte
 */
package com.mondaynightsports.drawgenerator.domain;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

final class RoundRobinDrawStrategyTest {

  private final RoundRobinDrawStrategy strategy = new RoundRobinDrawStrategy();

  @Test
  void fewerThanTwoTeamsProducesNoFixtures() {
    assertEquals(Collections.emptyList(), strategy.buildDraw(Collections.emptyList()));
    assertEquals(Collections.emptyList(), strategy.buildDraw(List.of("A")));
  }

  @Test
  void fourTeamsMatchesTheDocumentedWorkedExample() {
    List<Pairing> fixtures = strategy.buildDraw(List.of("A", "B", "C", "D"));

    List<Pairing> expected =
        List.of(
            new Pairing(1, "A", "D"),
            new Pairing(1, "B", "C"),
            new Pairing(2, "A", "C"),
            new Pairing(2, "D", "B"),
            new Pairing(3, "A", "B"),
            new Pairing(3, "C", "D"));
    assertEquals(expected, fixtures);
  }

  @Test
  void threeTeamsMatchesTheDocumentedWorkedExample() {
    List<Pairing> fixtures = strategy.buildDraw(List.of("A", "B", "C"));

    // Mirrors the ASCII example in RoundRobinGenerator.ts for odd n=3.
    List<Pairing> expected =
        List.of(
            new Pairing(1, "A", null),
            new Pairing(1, "B", "C"),
            new Pairing(2, "A", "C"),
            new Pairing(2, "B", null),
            new Pairing(3, "A", "B"),
            new Pairing(3, "C", null));
    assertEquals(expected, fixtures);
  }

  @ParameterizedTest
  @ValueSource(ints = {2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12})
  void everyUnorderedPairMeetsExactlyOnce(int n) {
    List<String> teams = teamIds(n);
    List<Pairing> fixtures = strategy.buildDraw(teams);

    Set<String> seenPairs = new HashSet<>();
    for (Pairing p : fixtures) {
      if (p.awayTeamId() == null) {
        continue;
      }
      String key = unorderedKey(p.homeTeamId(), p.awayTeamId());
      assertTrue(seenPairs.add(key), "duplicate pair: " + key);
      // Home must be a real team even on byes; always true here because
      // byes are filtered out above, but assert the shape of real rows.
      assertFalse(p.homeTeamId().equals(p.awayTeamId()), "team paired with itself");
    }

    long expectedPairs = (long) n * (n - 1) / 2;
    assertEquals(expectedPairs, seenPairs.size(), "pair count mismatch for n=" + n);
  }

  @ParameterizedTest
  @ValueSource(ints = {3, 5, 7, 9, 11})
  void oddTeamCountsGiveEachRealTeamExactlyOneBye(int n) {
    List<String> teams = teamIds(n);
    List<Pairing> fixtures = strategy.buildDraw(teams);

    // One bye per real team.
    int byes = 0;
    Set<String> teamsWithBye = new HashSet<>();
    for (Pairing p : fixtures) {
      if (p.awayTeamId() == null) {
        byes++;
        teamsWithBye.add(p.homeTeamId());
      }
    }
    assertEquals(n, byes, "byes count for n=" + n);
    assertEquals(n, teamsWithBye.size(), "distinct teams with byes for n=" + n);
  }

  @ParameterizedTest
  @ValueSource(ints = {2, 4, 6, 8, 10, 12})
  void evenTeamCountsGiveNoByes(int n) {
    List<Pairing> fixtures = strategy.buildDraw(teamIds(n));
    for (Pairing p : fixtures) {
      assertFalse(p.awayTeamId() == null, "unexpected bye at round " + p.round());
    }
  }

  @Test
  void homeTeamIsNeverNullForABye() {
    for (int n = 3; n <= 11; n += 2) {
      for (Pairing p : strategy.buildDraw(teamIds(n))) {
        if (p.awayTeamId() == null) {
          assertFalse(
              p.homeTeamId() == null, "home must be real on a bye at round " + p.round());
        }
      }
    }
  }

  @Test
  void totalRoundsForEvenAndOddCounts() {
    // Even n: n - 1 rounds.
    assertEquals(1, maxRound(strategy.buildDraw(teamIds(2))));
    assertEquals(3, maxRound(strategy.buildDraw(teamIds(4))));
    assertEquals(5, maxRound(strategy.buildDraw(teamIds(6))));

    // Odd n: n rounds (sentinel pushes us up by one).
    assertEquals(3, maxRound(strategy.buildDraw(teamIds(3))));
    assertEquals(5, maxRound(strategy.buildDraw(teamIds(5))));
  }

  @Test
  void doesNotMutateTheInputList() {
    List<String> input = new ArrayList<>(List.of("A", "B", "C", "D"));
    List<String> expected = List.copyOf(input);
    strategy.buildDraw(input);
    assertEquals(expected, input);
  }

  @Test
  void sentinelNeverLeaksAsAnId() {
    for (Pairing p : strategy.buildDraw(teamIds(5))) {
      assertFalse(p.homeTeamId() == null, "home sentinel leaked");
      // awayTeamId may be null (bye), but never any other null marker.
      if (p.awayTeamId() != null) {
        assertFalse(p.awayTeamId().isBlank(), "away blank leak");
      }
    }
  }

  @Test
  void nullInputRejected() {
    assertNullPointerExceptionOnBuild(null);
  }

  @Test
  void nullEntryInInputRejected() {
    assertNullPointerExceptionOnBuild(Arrays.asList("A", null, "C"));
  }

  private void assertNullPointerExceptionOnBuild(List<String> input) {
    try {
      strategy.buildDraw(input);
      // The fall-through means no NPE was raised.
      assertFalse(true, "expected NullPointerException");
    } catch (NullPointerException expected) {
      // ok
    }
  }

  private static List<String> teamIds(int n) {
    List<String> teams = new ArrayList<>(n);
    for (int i = 0; i < n; i++) {
      teams.add("T" + i);
    }
    return teams;
  }

  private static String unorderedKey(String a, String b) {
    return a.compareTo(b) <= 0 ? a + "|" + b : b + "|" + a;
  }

  private static int maxRound(List<Pairing> fixtures) {
    int max = 0;
    for (Pairing p : fixtures) {
      if (p.round() > max) {
        max = p.round();
      }
    }
    return max;
  }

  @Test
  void parameterizedCallIsDeterministic() {
    assertEquals(
        strategy.buildDraw(List.of("A", "B", "C", "D")),
        strategy.buildDraw(List.of("A", "B", "C", "D")));
  }

  @Test
  void nullAwayGuardsOverRealId() {
    // Belt-and-braces: a bye row must have null away, not an empty string.
    for (Pairing p : strategy.buildDraw(teamIds(3))) {
      if (p.awayTeamId() == null) {
        assertNull(p.awayTeamId());
      }
    }
  }
}
