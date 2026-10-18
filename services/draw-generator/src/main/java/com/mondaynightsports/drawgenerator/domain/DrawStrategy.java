/*
 * Open/closed seam for draw-generation algorithms. One implementation today:
 * RoundRobinDrawStrategy. A knockout or Swiss format would be a new class
 * rather than an edit to this interface or its sole impl.
 */
package com.mondaynightsports.drawgenerator.domain;

import java.util.List;

/** Contract shared by every draw-generation strategy. */
public interface DrawStrategy {

  /**
   * Build the proposed pairings for a draw.
   *
   * @param teamIds Team ids in the order the caller wants seated. The strategy must not mutate the
   *     input.
   * @return An ordered list of pairings, 1-indexed by round. May be empty when the input has fewer
   *     than two teams.
   */
  List<Pairing> buildDraw(List<String> teamIds);
}
