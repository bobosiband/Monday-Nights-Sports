// -----------------------------------------------------------------------------
// scoring/constants.ts
//
// String constants used across the scoring service. Kept in one file so the
// router, handlers, and tests all reference the same source of truth.
// -----------------------------------------------------------------------------

import type { MatchEventType } from "../_shared/score.ts";

/**
 * Route action names accepted after `/scoring/:fixtureId/`. Kept as a const
 * tuple so the router can validate the incoming action against it.
 */
export const SCORING_ACTIONS = [
  "start",
  "events",
  "undo",
  "period",
  "finalize",
] as const;

export type ScoringAction = (typeof SCORING_ACTIONS)[number];

/**
 * Every match_event type accepted by the write path. Mirrors the DB check
 * constraint in migration 0002.
 */
export const EVENT_TYPES: readonly MatchEventType[] = [
  "score",
  "foul",
  "card",
  "timeout",
  "period_start",
  "period_end",
  "note",
] as const;

/**
 * The subset of event types accepted by the generic `/events` route. Period
 * events go through `/period` so we can attach start/end semantics there;
 * accepting them here would silently bypass those guards.
 */
export const GENERIC_EVENT_TYPES: readonly MatchEventType[] = [
  "score",
  "foul",
  "card",
  "timeout",
  "note",
] as const;

/**
 * Fixture lifecycle values (mirrors 0001's fixtures.status check).
 */
export const FIXTURE_STATUS = {
  scheduled: "scheduled",
  live: "live",
  complete: "complete",
  cancelled: "cancelled",
} as const;

export type FixtureStatus =
  (typeof FIXTURE_STATUS)[keyof typeof FIXTURE_STATUS];

/**
 * Values accepted on `results.decided_by` (mirrors 0002).
 */
export const DECIDED_BY = {
  normal: "normal",
  penalties: "penalties",
  forfeit: "forfeit",
} as const;

export type DecidedBy = (typeof DECIDED_BY)[keyof typeof DECIDED_BY];
