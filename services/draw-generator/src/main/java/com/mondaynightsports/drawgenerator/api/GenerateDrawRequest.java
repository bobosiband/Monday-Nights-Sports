/*
 * Request body for the draw-generator Lambda. Jackson binds this directly.
 * JSON keys are camelCase (no legacy snake_case contract on the Java side).
 */
package com.mondaynightsports.drawgenerator.api;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;

/**
 * The JSON request body.
 *
 * @param teamIds Ordered team ids to seed the round-robin generator.
 * @param slotIds Ordered slot ids to assign pairings to.
 */
public record GenerateDrawRequest(List<String> teamIds, List<String> slotIds) {

  /**
   * Jackson constructor. Explicit because the records' default constructor relies on
   * `-parameters` compiler flag otherwise.
   *
   * @param teamIds team ids from JSON key `teamIds`.
   * @param slotIds slot ids from JSON key `slotIds`.
   */
  @JsonCreator
  public GenerateDrawRequest(
      @JsonProperty("teamIds") List<String> teamIds,
      @JsonProperty("slotIds") List<String> slotIds) {
    this.teamIds = teamIds;
    this.slotIds = slotIds;
  }
}
