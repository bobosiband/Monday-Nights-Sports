// -----------------------------------------------------------------------------
// scoring/handlers/DerivedResponse.ts
//
// Shared response helper for scoring handlers. Loads events plus config,
// runs them through the configured scoring format, upserts the realtime
// projection, and builds the standard `DerivedResponse` envelope.
//
// Projection failures are logged but never propagate: the event log is
// the source of truth and `scripts/rebuild-live-state.sql` can regenerate
// the projection from scratch.
// -----------------------------------------------------------------------------

import { jsonResponse } from "../lib/Cors.ts";
import type { ScoringRepository } from "../data/ScoringRepository.ts";
import type { ScoringFormat } from "../domain/ScoringFormat.ts";
import type { DerivedScore } from "../domain/ScoreCalculator.ts";
import type { FixtureStatus } from "../domain/ScoringActions.ts";
import type {
  DerivedResponse,
  FixtureContext,
} from "../domain/ScoringTypes.ts";

/**
 * Load the fixture's events and sport config, run them through the
 * scoring format, mirror the result into the realtime projection, and
 * build the response envelope.
 *
 * @param repo - Scoring data access.
 * @param format - Scoring format.
 * @param fixture - The fixture context.
 * @param overrideStatus - When the caller has just changed the fixture
 * status in-flight, pass the new value so the response reflects it
 * without a re-query.
 * @returns A JSON response with `{ fixture_id, fixture_status, derived }`.
 */
export async function respondDerived(
  repo: ScoringRepository,
  format: ScoringFormat,
  fixture: FixtureContext,
  overrideStatus?: FixtureStatus,
): Promise<Response> {
  const [events, config] = await Promise.all([
    repo.loadEvents(fixture.id),
    repo.loadSportConfig(fixture.season_id, fixture.sport),
  ]);
  const derived = format.derive(events, {
    homeTeamId: fixture.home_team_id,
    awayTeamId: fixture.away_team_id,
    config,
  });
  const effectiveStatus: FixtureStatus = overrideStatus ?? fixture.status;

  let lastEventAt: string | null = null;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].voided_at === null) {
      lastEventAt = events[i].created_at;
      break;
    }
  }

  await writeLiveState(repo, fixture.id, derived, effectiveStatus, lastEventAt);

  const body: DerivedResponse = {
    fixture_id: fixture.id,
    fixture_status: effectiveStatus,
    derived,
  };
  return jsonResponse(body);
}

/**
 * Upsert the fixture_live_state row. Non-fatal: logs and swallows errors
 * so a projection glitch never fails the scoring write.
 *
 * @param repo - Scoring data access.
 * @param fixtureId - Fixture id.
 * @param derived - The derived score summary.
 * @param status - The fixture's current status (post-update).
 * @param lastEventAt - ISO timestamp of the most recent non-voided event.
 */
export async function writeLiveState(
  repo: ScoringRepository,
  fixtureId: string,
  derived: DerivedScore,
  status: FixtureStatus,
  lastEventAt: string | null,
): Promise<void> {
  try {
    await repo.upsertLiveState({
      fixture_id: fixtureId,
      home_score: derived.home,
      away_score: derived.away,
      fouls: derived.foulsByTeam,
      current_period: derived.currentPeriod,
      status,
      last_event_at: lastEventAt,
    });
  } catch (error) {
    console.warn(
      `[scoring] fixture_live_state upsert failed for ${fixtureId}; ` +
        `event log is still authoritative:`,
      error,
    );
  }
}
