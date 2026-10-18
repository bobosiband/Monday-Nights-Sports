// -----------------------------------------------------------------------------
// scoring/domain/ScoringFormat.ts
//
// Open/closed seam for score-derivation formats. One implementation
// today: `HeadToHeadScoringFormat`, which wraps the pure `deriveScore`
// fold. Adding a new format later (knockout, aggregate, etc.) is a new
// class, not an edit here.
// -----------------------------------------------------------------------------

import {
  type DerivedScore,
  deriveScore,
  type MatchEvent,
  type SportConfig,
} from "./ScoreCalculator.ts";

/** Context the format needs to derive a score for a fixture. */
export interface ScoringContext {
  homeTeamId: string;
  awayTeamId: string | null;
  config: SportConfig;
}

/** Contract shared by every scoring format. */
export interface ScoringFormat {
  /**
   * Derive the score summary for a fixture from its event log.
   *
   * @param events - Match events for the fixture.
   * @param context - Fixture-specific context.
   * @returns The derived score summary.
   */
  derive(events: MatchEvent[], context: ScoringContext): DerivedScore;
}

/**
 * Classic head-to-head format: one home team, one away team, scores
 * attributed by `team_id`. Delegates to the pure `deriveScore` fold.
 */
export class HeadToHeadScoringFormat implements ScoringFormat {
  /**
   * @param events - Match events for the fixture.
   * @param context - Fixture-specific context.
   * @returns The derived score summary.
   */
  derive(events: MatchEvent[], context: ScoringContext): DerivedScore {
    return deriveScore(
      events,
      context.homeTeamId,
      context.awayTeamId,
      context.config,
    );
  }
}
