// -----------------------------------------------------------------------------
// events/handlers/DrawLifecycleHandlers.ts
//
// Draw-lifecycle handlers:
//   POST /events/:id/generate   -> GenerateDrawHandler
//   POST /events/:id/publish    -> PublishEventHandler
//   POST /events/:id/unpublish  -> UnpublishEventHandler
//
// Publish is the safety boundary: see validation/DrawBodyValidator.ts.
// -----------------------------------------------------------------------------

import { jsonResponse } from "../lib/Cors.ts";
import { readJson } from "../lib/InputValidation.ts";
import { badRequest, conflict, notFound } from "../lib/HttpErrors.ts";
import type { EventsRepository } from "../data/EventsRepository.ts";
import {
  type DrawStrategy,
  RoundRobinDrawStrategy,
} from "../domain/DrawStrategy.ts";
import {
  type GenerateBody,
  validateGenerate,
} from "../validation/EventBodyValidator.ts";
import {
  validatePublish,
  validateUnpublish,
} from "../validation/DrawBodyValidator.ts";

/** Handler for `POST /events/:id/generate`. */
export class GenerateDrawHandler {
  /**
   * @param repo - Events data access.
   * @param strategy - Draw-generation algorithm. Defaults to round-robin;
   * tests may inject a stub.
   */
  constructor(
    private readonly repo: EventsRepository,
    private readonly strategy: DrawStrategy = new RoundRobinDrawStrategy(),
  ) {}

  /**
   * Build a round-robin draw and either preview it (`?dry_run=true`) or
   * insert it.
   *
   * @param request - Incoming request.
   * @param eventId - Parent event id.
   * @returns 200 with `{ preview }` on dry-run, 201 with `{ inserted }` on
   * insert, 400/404/409 otherwise.
   */
  async handle(request: Request, eventId: string): Promise<Response> {
    const dryRun = new URL(request.url).searchParams.get("dry_run") === "true";

    const event = await this.repo.loadEvent(eventId);
    if (!event) return notFound("Event not found");
    if (event.is_published) {
      return conflict(
        "Cannot generate onto a published event, unpublish first",
      );
    }

    const body = await readJson<GenerateBody>(request);
    const parsed = validateGenerate(body);
    if (!parsed.ok) return badRequest(parsed.error);

    const { sport, team_ids, slot_ids } = parsed.value;

    const season = await this.repo.loadSeason(event.season_id);
    if (!season) return notFound("Owning season not found");
    if (!season.sports.includes(sport)) {
      return conflict(
        `sport '${sport}' is not declared on this season (${
          season.sports.join(", ") || "none"
        })`,
      );
    }

    const seasonTeamIds = new Set(
      await this.repo.listTeamIdsInSeason(event.season_id),
    );
    for (const id of team_ids) {
      if (!seasonTeamIds.has(id)) {
        return conflict(`team ${id} is not a team in this season`);
      }
    }

    const eventSlotIds = new Set(
      (await this.repo.listSlotsForEvent(eventId)).map((s) => s.id),
    );
    for (const id of slot_ids) {
      if (!eventSlotIds.has(id)) {
        return conflict(`slot ${id} does not belong to this event`);
      }
    }

    const result = this.strategy.buildDraw({ team_ids, slot_ids });
    if (!result.ok) return conflict(result.error);

    const rows = result.fixtures.map((f) => ({
      event_id: eventId,
      slot_id: f.slot_id,
      sport,
      home_team_id: f.home_team_id,
      away_team_id: f.away_team_id,
    }));

    if (dryRun) {
      return jsonResponse({
        dry_run: true,
        preview: result.fixtures.map((f) => ({
          round: f.round,
          slot_id: f.slot_id,
          sport,
          home_team_id: f.home_team_id,
          away_team_id: f.away_team_id,
        })),
      });
    }

    const inserted = await this.repo.insertFixtures(rows);
    return jsonResponse({ inserted }, 201);
  }
}

/** Handler for `POST /events/:id/publish`. */
export class PublishEventHandler {
  /** @param repo - Events data access. */
  constructor(private readonly repo: EventsRepository) {}

  /**
   * Flip `is_published=true` after `validatePublish` passes. Idempotent on
   * an already-published event.
   *
   * @param eventId - Event id.
   * @returns 200 with the updated event, 404, or 409 with a specific reason.
   */
  async handle(eventId: string): Promise<Response> {
    const event = await this.repo.loadEvent(eventId);
    if (!event) return notFound("Event not found");
    if (event.is_published) {
      return jsonResponse({ event });
    }

    const [season, slots, fixtures] = await Promise.all([
      this.repo.loadSeason(event.season_id),
      this.repo.listSlotsForEvent(eventId),
      this.repo.listFixturesForEvent(eventId),
    ]);
    if (!season) return notFound("Owning season not found");

    const teamIdsInSeason = await this.repo.listTeamIdsInSeason(
      event.season_id,
    );

    const check = validatePublish({
      fixtures,
      slots,
      season: { sports: season.sports },
      teamIdsInSeason,
    });
    if (!check.ok) return conflict(check.reason);

    const updated = await this.repo.updateEvent(eventId, {
      is_published: true,
      published_at: new Date().toISOString(),
    });
    if (!updated) return notFound("Event not found");
    return jsonResponse({ event: updated });
  }
}

/** Handler for `POST /events/:id/unpublish`. */
export class UnpublishEventHandler {
  /** @param repo - Events data access. */
  constructor(private readonly repo: EventsRepository) {}

  /**
   * Flip `is_published=false`. Refuses when any fixture is live or
   * complete unless the body says `{ "force": true }`.
   *
   * @param request - Incoming request.
   * @param eventId - Event id.
   * @returns 200 with the updated event, 404, or 409 with a specific reason.
   */
  async handle(request: Request, eventId: string): Promise<Response> {
    const event = await this.repo.loadEvent(eventId);
    if (!event) return notFound("Event not found");
    if (!event.is_published) {
      return jsonResponse({ event });
    }

    const body = await readJson<{ force?: unknown }>(request);
    const force = body?.force === true;

    const fixtures = await this.repo.listFixturesForEvent(eventId);
    const check = validateUnpublish({
      fixtures: fixtures.map((f) => ({ id: f.id, status: f.status })),
      force,
    });
    if (!check.ok) return conflict(check.reason);

    const updated = await this.repo.updateEvent(eventId, {
      is_published: false,
      published_at: null,
    });
    if (!updated) return notFound("Event not found");
    return jsonResponse({ event: updated });
  }
}
