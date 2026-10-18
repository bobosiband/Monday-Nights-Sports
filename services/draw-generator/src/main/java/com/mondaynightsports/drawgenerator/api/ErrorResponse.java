/*
 * Error-shape returned on 4xx and 5xx. Mirrors the `{ "error": "..." }`
 * envelope used across the Supabase services so callers do not have to
 * learn a second error contract.
 */
package com.mondaynightsports.drawgenerator.api;

/**
 * Error envelope.
 *
 * @param error Human-readable error message.
 */
public record ErrorResponse(String error) {}
