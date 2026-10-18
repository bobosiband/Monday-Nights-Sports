/*
 * Unit tests for DrawRequestValidator. Mirrors the TypeScript side's
 * EventBodyValidator tests for the fields this service accepts.
 */
package com.mondaynightsports.drawgenerator.validation;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.mondaynightsports.drawgenerator.api.GenerateDrawRequest;
import com.mondaynightsports.drawgenerator.validation.DrawRequestValidator.ValidationResult;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import org.junit.jupiter.api.Test;

final class DrawRequestValidatorTest {

  private final DrawRequestValidator validator = new DrawRequestValidator();

  @Test
  void nullRequestIsRejected() {
    ValidationResult r = validator.validate(null);
    assertFalse(r.ok());
    assertEquals("Request body must be JSON", r.error());
  }

  @Test
  void teamIdsMustBeAtLeastTwo() {
    GenerateDrawRequest r1 = new GenerateDrawRequest(Collections.emptyList(), List.of("S1"));
    assertFalse(validator.validate(r1).ok());

    GenerateDrawRequest r2 = new GenerateDrawRequest(List.of("A"), List.of("S1"));
    assertFalse(validator.validate(r2).ok());
  }

  @Test
  void teamIdsEntriesMustBeNonEmpty() {
    GenerateDrawRequest r1 = new GenerateDrawRequest(Arrays.asList("A", null), List.of("S1"));
    assertEquals("teamIds entries must be non-empty strings", validator.validate(r1).error());

    GenerateDrawRequest r2 = new GenerateDrawRequest(List.of("A", "  "), List.of("S1"));
    assertFalse(validator.validate(r2).ok());
  }

  @Test
  void teamIdsMustNotContainDuplicates() {
    GenerateDrawRequest r = new GenerateDrawRequest(List.of("A", "A"), List.of("S1"));
    assertEquals("teamIds must not contain duplicates", validator.validate(r).error());
  }

  @Test
  void slotIdsMustBeNonEmpty() {
    GenerateDrawRequest r = new GenerateDrawRequest(List.of("A", "B"), Collections.emptyList());
    assertEquals("slotIds must be a non-empty array", validator.validate(r).error());
  }

  @Test
  void slotIdsEntriesMustBeNonEmpty() {
    GenerateDrawRequest r = new GenerateDrawRequest(List.of("A", "B"), Arrays.asList("S1", null));
    assertEquals("slotIds entries must be non-empty strings", validator.validate(r).error());
  }

  @Test
  void slotIdsMustNotContainDuplicates() {
    GenerateDrawRequest r = new GenerateDrawRequest(List.of("A", "B"), List.of("S1", "S1"));
    assertEquals("slotIds must not contain duplicates", validator.validate(r).error());
  }

  @Test
  void wellFormedRequestPasses() {
    GenerateDrawRequest r = new GenerateDrawRequest(List.of("A", "B", "C"), List.of("S1", "S2"));
    assertTrue(validator.validate(r).ok());
  }
}
