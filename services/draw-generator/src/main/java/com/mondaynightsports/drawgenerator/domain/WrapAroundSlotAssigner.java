/*
 * Slot assignment: round r (1-indexed) lands in slots[(r - 1) % slots.size()].
 *
 * Mirrors events/domain/SlotSpread.ts in the TypeScript side. All matches in
 * a round of a round-robin are intended to run at the same time (one team
 * per round), so grouping a round's fixtures into one slot models the
 * sports-night reality where a slot is a concurrent-play window across
 * multiple pitches. If there are more rounds than slots, later rounds wrap
 * to earlier slots; the preview makes this visible to the organiser.
 */
package com.mondaynightsports.drawgenerator.domain;

import com.mondaynightsports.drawgenerator.api.ProposedFixture;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** Round-to-slot assigner with wrap when there are more rounds than slots. */
public final class WrapAroundSlotAssigner implements SlotAssigner {

  /**
   * Distribute pairings across slots using the wrap rule.
   *
   * @param pairings Pairings; must not be null.
   * @param slotIds Ordered slot ids; must not be null.
   * @return The proposed fixtures.
   * @throws NullPointerException if either argument is null, or if slotIds contains null.
   * @throws IllegalArgumentException if there are pairings but no slots, or if slotIds contains
   *     duplicates.
   */
  @Override
  public List<ProposedFixture> assign(List<Pairing> pairings, List<String> slotIds) {
    if (pairings == null) {
      throw new NullPointerException("pairings must not be null");
    }
    if (slotIds == null) {
      throw new NullPointerException("slotIds must not be null");
    }

    if (pairings.isEmpty()) {
      return Collections.emptyList();
    }
    if (slotIds.isEmpty()) {
      throw new IllegalArgumentException("At least one slot is required");
    }

    Set<String> seen = new HashSet<>();
    for (String id : slotIds) {
      if (id == null) {
        throw new NullPointerException("slotIds must not contain null entries");
      }
      if (!seen.add(id)) {
        throw new IllegalArgumentException("slotIds must not contain duplicates");
      }
    }

    List<ProposedFixture> out = new ArrayList<>(pairings.size());
    int n = slotIds.size();
    for (Pairing p : pairings) {
      String slot = slotIds.get((p.round() - 1) % n);
      out.add(new ProposedFixture(p.round(), slot, p.homeTeamId(), p.awayTeamId()));
    }
    return out;
  }
}
