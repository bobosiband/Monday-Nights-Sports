/*
 * Response body for the draw-generator Lambda. Jackson binds this directly.
 */
package com.mondaynightsports.drawgenerator.api;

import java.util.List;

/**
 * The JSON response body on the happy path.
 *
 * @param fixtures Proposed fixtures, each carrying its slot id and round number.
 */
public record GenerateDrawResponse(List<ProposedFixture> fixtures) {}
