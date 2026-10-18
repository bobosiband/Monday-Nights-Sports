/*
 * Open/closed seam for the "distribute pairings across slots" step. Mirrors
 * the TypeScript events/domain/SlotSpread.ts contract. One implementation
 * today: WrapAroundSlotAssigner.
 */
package com.mondaynightsports.drawgenerator.domain;

import com.mondaynightsports.drawgenerator.api.ProposedFixture;
import java.util.List;

/** Contract for mapping round-robin pairings onto a caller-provided slot list. */
public interface SlotAssigner {

  /**
   * Distribute pairings across slots.
   *
   * @param pairings Pairings from a {@link DrawStrategy}; must not be null.
   * @param slotIds Ordered slot ids; must not be null. May be empty only when pairings is
   *     also empty (which returns an empty proposed-fixture list).
   * @return An ordered list of proposed fixtures, each carrying its slot id and round
   *     number.
   * @throws IllegalArgumentException if there are pairings but no slots, or if slotIds
   *     contains a duplicate.
   */
  List<ProposedFixture> assign(List<Pairing> pairings, List<String> slotIds);
}
