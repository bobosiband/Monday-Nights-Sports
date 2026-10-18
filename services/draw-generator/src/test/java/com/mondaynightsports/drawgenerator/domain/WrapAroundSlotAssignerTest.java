/*
 * Unit tests for WrapAroundSlotAssigner.
 *
 * Pins the two important properties:
 *   - round r (1-indexed) always lands in slots[(r - 1) % n]
 *   - 6 teams on 3 slots wraps rounds 4 and 5 onto slots 1 and 2
 */
package com.mondaynightsports.drawgenerator.domain;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.mondaynightsports.drawgenerator.api.ProposedFixture;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import org.junit.jupiter.api.Test;

final class WrapAroundSlotAssignerTest {

  private final RoundRobinDrawStrategy strategy = new RoundRobinDrawStrategy();
  private final WrapAroundSlotAssigner assigner = new WrapAroundSlotAssigner();

  @Test
  void emptyPairingsReturnsEmptyList() {
    assertTrue(assigner.assign(Collections.emptyList(), List.of("S1")).isEmpty());
    assertTrue(assigner.assign(Collections.emptyList(), Collections.emptyList()).isEmpty());
  }

  @Test
  void pairingsRequireAtLeastOneSlot() {
    List<Pairing> pairings = strategy.buildDraw(List.of("A", "B"));
    assertThrows(
        IllegalArgumentException.class, () -> assigner.assign(pairings, Collections.emptyList()));
  }

  @Test
  void duplicateSlotIdsRejected() {
    List<Pairing> pairings = strategy.buildDraw(List.of("A", "B"));
    assertThrows(
        IllegalArgumentException.class, () -> assigner.assign(pairings, List.of("S1", "S1")));
  }

  @Test
  void sixTeamsOnThreeSlotsWrapsRoundsFourAndFive() {
    List<String> teams = List.of("A", "B", "C", "D", "E", "F");
    List<Pairing> pairings = strategy.buildDraw(teams);
    List<String> slots = List.of("S1", "S2", "S3");

    List<ProposedFixture> out = assigner.assign(pairings, slots);

    // 6 teams -> 5 rounds, 3 fixtures per round -> 15 fixtures total.
    assertEquals(15, out.size());

    // Rounds 1, 2, 3 land in slots 1, 2, 3; rounds 4 and 5 wrap to slots
    // 1 and 2 respectively. Check each round's slot.
    for (ProposedFixture f : out) {
      String expectedSlot = slots.get((f.round() - 1) % slots.size());
      assertEquals(expectedSlot, f.slotId(), "round " + f.round() + " landed in wrong slot");
    }
  }

  @Test
  void fourTeamsOnFourSlotsLeavesSlotFourEmpty() {
    List<String> teams = List.of("A", "B", "C", "D");
    List<Pairing> pairings = strategy.buildDraw(teams);
    List<String> slots = List.of("S1", "S2", "S3", "S4");

    List<ProposedFixture> out = assigner.assign(pairings, slots);

    // 4 teams -> 3 rounds, 2 fixtures per round -> 6 fixtures. S4 unused.
    assertEquals(6, out.size());
    for (ProposedFixture f : out) {
      switch (f.round()) {
        case 1 -> assertEquals("S1", f.slotId());
        case 2 -> assertEquals("S2", f.slotId());
        case 3 -> assertEquals("S3", f.slotId());
        default -> throw new AssertionError("unexpected round: " + f.round());
      }
    }
  }

  @Test
  void slotIdsListIsNotMutated() {
    List<Pairing> pairings = strategy.buildDraw(List.of("A", "B"));
    List<String> slots = new ArrayList<>(List.of("S1"));
    List<String> expected = List.copyOf(slots);
    assigner.assign(pairings, slots);
    assertEquals(expected, slots);
  }
}
