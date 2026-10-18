// -----------------------------------------------------------------------------
// results-public/domain/PublicResultsShaper.ts
//
// Pure reshaping from the DB rows to the JSON shape callers see. Fixtures
// without a result are pruned (an unfinalised game does not belong in the
// public archive). Testable without a database.
// -----------------------------------------------------------------------------

import type {
  EventRow,
  FixtureWithResultRow,
  ResultRow,
} from "../data/ResultsPublicRepository.ts";

/** The public shape of a fixture inside the archive view. */
export interface PublicArchiveFixture {
  id: string;
  sport: string;
  home_team_name: string | null;
  away_team_name: string | null;
  home_score: number;
  away_score: number;
  periods: Array<{ period: number; home: number; away: number }>;
  decided_by: string;
  confirmed_at: string;
}

/** The public shape of an event inside the archive view. */
export interface PublicArchiveEvent {
  id: string;
  event_date: string;
  season_name: string | null;
  fixtures: PublicArchiveFixture[];
}

/**
 * Reshape event rows and fixture-with-result rows into the public archive
 * shape. Groups fixtures under their parent event and prunes fixtures
 * without results.
 *
 * @param events - Event rows.
 * @param fixtures - Fixtures with their result join.
 * @returns Public-shaped event objects, each carrying its fixtures.
 */
export function shapeArchive(
  events: EventRow[],
  fixtures: FixtureWithResultRow[],
): PublicArchiveEvent[] {
  const byEvent = new Map<string, PublicArchiveFixture[]>();
  for (const f of fixtures) {
    const result = Array.isArray(f.results) ? f.results[0] : f.results;
    if (!result) continue;
    const shaped = toPublicFixture(f, result);
    const list = byEvent.get(f.event_id);
    if (list) list.push(shaped);
    else byEvent.set(f.event_id, [shaped]);
  }

  return events.map((e) => {
    const seasonName = Array.isArray(e.seasons)
      ? e.seasons[0]?.name ?? null
      : e.seasons?.name ?? null;
    return {
      id: e.id,
      event_date: e.event_date,
      season_name: seasonName,
      fixtures: byEvent.get(e.id) ?? [],
    };
  });
}

/**
 * Shape one fixture plus its result row into the public form.
 *
 * @param f - Fixture row with result join.
 * @param result - The chosen result row.
 * @returns The public fixture shape.
 */
function toPublicFixture(
  f: FixtureWithResultRow,
  result: ResultRow,
): PublicArchiveFixture {
  return {
    id: f.id,
    sport: f.sport,
    home_team_name: f.home_team?.name ?? null,
    away_team_name: f.away_team?.name ?? null,
    home_score: result.home_score,
    away_score: result.away_score,
    periods: result.periods ?? [],
    decided_by: result.decided_by,
    confirmed_at: result.confirmed_at,
  };
}
