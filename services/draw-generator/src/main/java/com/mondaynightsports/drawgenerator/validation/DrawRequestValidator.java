/*
 * Pure validation for the draw-generator request body. The TypeScript side
 * applies the same shape rules in validation/EventBodyValidator.ts; this
 * carries the subset relevant to the standalone Java service.
 */
package com.mondaynightsports.drawgenerator.validation;

import com.mondaynightsports.drawgenerator.api.GenerateDrawRequest;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** Pure validation. Returns a result object; never throws. */
public final class DrawRequestValidator {

  /**
   * Validate the request body.
   *
   * Rules (match the TypeScript events validator):
   *   - teamIds must be a non-null list of at least 2 non-null, non-blank strings.
   *   - teamIds must not contain duplicates.
   *   - slotIds must be a non-null, non-empty list of non-null, non-blank strings.
   *   - slotIds must not contain duplicates.
   *
   * @param request The parsed body, or null.
   * @return A result that is either ok or carries an error message.
   */
  public ValidationResult validate(GenerateDrawRequest request) {
    if (request == null) {
      return ValidationResult.error("Request body must be JSON");
    }

    List<String> teamIds = request.teamIds();
    if (teamIds == null || teamIds.size() < 2) {
      return ValidationResult.error("teamIds must be an array of at least 2 ids");
    }
    Set<String> seenTeams = new HashSet<>();
    for (String id : teamIds) {
      if (id == null || id.isBlank()) {
        return ValidationResult.error("teamIds entries must be non-empty strings");
      }
      if (!seenTeams.add(id)) {
        return ValidationResult.error("teamIds must not contain duplicates");
      }
    }

    List<String> slotIds = request.slotIds();
    if (slotIds == null || slotIds.isEmpty()) {
      return ValidationResult.error("slotIds must be a non-empty array");
    }
    Set<String> seenSlots = new HashSet<>();
    for (String id : slotIds) {
      if (id == null || id.isBlank()) {
        return ValidationResult.error("slotIds entries must be non-empty strings");
      }
      if (!seenSlots.add(id)) {
        return ValidationResult.error("slotIds must not contain duplicates");
      }
    }

    return ValidationResult.ok();
  }

  /** Simple two-state result returned by the validator. */
  public record ValidationResult(boolean ok, String error) {

    /** @return A successful result. */
    public static ValidationResult ok() {
      return new ValidationResult(true, null);
    }

    /**
     * @param message Human-readable error.
     * @return A failing result carrying the message.
     */
    public static ValidationResult error(String message) {
      return new ValidationResult(false, message);
    }
  }
}
