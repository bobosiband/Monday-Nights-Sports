// -----------------------------------------------------------------------------
// events/handlers/FixtureCrudHandlers.ts
//
// Nested fixture handlers on `/events/:id/fixtures`. Cross-row checks
// (team belongs to season, sport in seasons.sports, slot on event) live
// in these handlers because they need DB reads the pure body validator
// has no business doing.
// -----------------------------------------------------------------------------

import { jsonResponse } from "../lib/Cors.ts";
import { readJson } from "../lib/InputValidation.ts";
import { badRequest, conflict, notFound } from "../lib/HttpErrors.ts";
import type { EventsRepository } from "../data/EventsRepository.ts";
import {
  type CreateFixtureBody,
  type UpdateFixtureBody,
  validateCreateFixture,
  validateUpdateFixture,
} from "../validation/EventBodyValidator.ts";

/** Handler for `POST /events/:id/fixtures`. */
export class CreateFixtureHandler {
  /** @param repo - Events data access. */
  constructor(private readonly repo: EventsRepository) {}

  /**
   * Cross-checks (all 409 if they fail):
   *   - slot_id belongs to this event
   *   - sport is declared on the season's sports array
   *   - home_team_id and away_team_id (if not null) belong to the season
   *
   * @param request - Incoming request.
   * @param eventId - Parent event id.
   * @returns 201 with `{ fixture }`, or 400/404/409.
   */
  async handle(request: Request, eventId: string): Promise<Response> {
    const event = await this.repo.loadEvent(eventId);
    if (!event) return notFound("Event not found");

    const body = await readJson<CreateFixtureBody>(request);
    const parsed = validateCreateFixture(body);
    if (!parsed.ok) return badRequest(parsed.error);

    const { slot_id, sport, home_team_id, away_team_id } = parsed.value;

    const slot = await this.repo.loadSlotInEvent(eventId, slot_id);
    if (!slot) return conflict("slot_id does not belong to this event");

    const season = await this.repo.loadSeason(event.season_id);
    if (!season) return notFound("Owning season not found");
    if (!season.sports.includes(sport)) {
      return conflict(
        `sport '${sport}' is not declared on this season (${
          season.sports.join(", ") || "none"
        })`,
      );
    }

    const teamIds = await this.repo.listTeamIdsInSeason(event.season_id);
    const set = new Set(teamIds);
    if (!set.has(home_team_id)) {
      return conflict("home_team_id is not a team in this season");
    }
    if (away_team_id !== null && !set.has(away_team_id)) {
      return conflict("away_team_id is not a team in this season");
    }

    const fixture = await this.repo.insertFixture({
      event_id: eventId,
      slot_id,
      sport,
      home_team_id,
      away_team_id,
    });
    return jsonResponse({ fixture }, 201);
  }
}

/** Handler for `PATCH /events/:id/fixtures/:fid`. */
export class UpdateFixtureHandler {
  /** @param repo - Events data access. */
  constructor(private readonly repo: EventsRepository) {}

  /**
   * Cross-checks kick in only for fields the caller is actually changing:
   * moving to a new slot re-checks slot ownership; changing teams re-checks
   * membership; changing sport re-checks the season's sports list.
   *
   * @param request - Incoming request.
   * @param eventId - Parent event id.
   * @param fixtureId - Fixture id.
   * @returns 200 with `{ fixture }`, or 400/404/409.
   */
  async handle(
    request: Request,
    eventId: string,
    fixtureId: string,
  ): Promise<Response> {
    const existing = await this.repo.loadFixtureInEvent(eventId, fixtureId);
    if (!existing) return notFound("Fixture not found on this event");

    const body = await readJson<UpdateFixtureBody>(request);
    const parsed = validateUpdateFixture(body);
    if (!parsed.ok) return badRequest(parsed.error);

    const patch = parsed.value;

    if (
      typeof patch.slot_id === "string" && patch.slot_id !== existing.slot_id
    ) {
      const slot = await this.repo.loadSlotInEvent(
        eventId,
        patch.slot_id,
      );
      if (!slot) return conflict("slot_id does not belong to this event");
    }

    const needsSeasonCheck = patch.sport !== undefined ||
      patch.home_team_id !== undefined || patch.away_team_id !== undefined;
    if (needsSeasonCheck) {
      const event = await this.repo.loadEvent(eventId);
      if (!event) return notFound("Event not found");
      const season = await this.repo.loadSeason(event.season_id);
      if (!season) return notFound("Owning season not found");

      if (
        typeof patch.sport === "string" && !season.sports.includes(patch.sport)
      ) {
        return conflict(
          `sport '${patch.sport}' is not declared on this season`,
        );
      }

      if (
        patch.home_team_id !== undefined || patch.away_team_id !== undefined
      ) {
        const teamIds = new Set(
          await this.repo.listTeamIdsInSeason(event.season_id),
        );
        if (
          typeof patch.home_team_id === "string" &&
          !teamIds.has(patch.home_team_id)
        ) {
          return conflict("home_team_id is not a team in this season");
        }
        if (
          typeof patch.away_team_id === "string" &&
          !teamIds.has(patch.away_team_id)
        ) {
          return conflict("away_team_id is not a team in this season");
        }
      }
    }

    // Sparse-patch distinctness: catch the case where only ONE side is being
    // changed to match the persisted value on the other side.
    const nextHome = typeof patch.home_team_id === "string"
      ? patch.home_team_id
      : existing.home_team_id;
    const nextAway = patch.away_team_id === null
      ? null
      : typeof patch.away_team_id === "string"
      ? patch.away_team_id
      : existing.away_team_id;
    if (nextAway !== null && nextHome === nextAway) {
      return badRequest("home_team_id and away_team_id must be different");
    }

    const fixture = await this.repo.updateFixture(fixtureId, patch);
    if (!fixture) return notFound("Fixture not found");
    return jsonResponse({ fixture });
  }
}

/** Handler for `DELETE /events/:id/fixtures/:fid`. */
export class DeleteFixtureHandler {
  /** @param repo - Events data access. */
  constructor(private readonly repo: EventsRepository) {}

  /**
   * Delete only when no match_events reference the fixture. Prevents an
   * accidental "clear the draw" from cascading through a scored match's
   * audit trail.
   *
   * @param eventId - Parent event id.
   * @param fixtureId - Fixture id.
   * @returns 200 with `{ deleted }`, or 404/409.
   */
  async handle(eventId: string, fixtureId: string): Promise<Response> {
    const existing = await this.repo.loadFixtureInEvent(eventId, fixtureId);
    if (!existing) return notFound("Fixture not found on this event");

    const eventCount = await this.repo.countMatchEventsForFixture(fixtureId);
    if (eventCount > 0) {
      return conflict(
        `Cannot delete: fixture has ${eventCount} match event(s). ` +
          `Cancel it instead to keep the audit trail`,
      );
    }

    const deleted = await this.repo.deleteFixture(fixtureId);
    if (!deleted) return notFound("Fixture not found");
    return jsonResponse({ deleted });
  }
}
