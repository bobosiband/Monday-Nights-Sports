// -----------------------------------------------------------------------------
// events/handlers/EventCrudHandlers.ts
//
// Event-level handlers (one class per action, grouped by resource):
//   GET    /events?season=<uuid>   -> ListEventsHandler
//   POST   /events                 -> CreateEventHandler
//   GET    /events/:id             -> GetEventHandler
//   PATCH  /events/:id             -> UpdateEventHandler
//   DELETE /events/:id             -> DeleteEventHandler
// -----------------------------------------------------------------------------

import { jsonResponse } from "../lib/Cors.ts";
import { isUuid, readJson } from "../lib/InputValidation.ts";
import { badRequest, conflict, notFound } from "../lib/HttpErrors.ts";
import type { EventsRepository } from "../data/EventsRepository.ts";
import {
  type CreateEventBody,
  type UpdateEventBody,
  validateCreateEvent,
  validateUpdateEvent,
} from "../validation/EventBodyValidator.ts";

/** Handler for `GET /events?season=<uuid>`. */
export class ListEventsHandler {
  /** @param repo - Events data access. */
  constructor(private readonly repo: EventsRepository) {}

  /**
   * @param request - Incoming request.
   * @returns 200 with `{ events }`, 400 for a missing/invalid query.
   */
  async handle(request: Request): Promise<Response> {
    const seasonId = new URL(request.url).searchParams.get("season");
    if (!seasonId || !isUuid(seasonId)) {
      return badRequest("Query param 'season' (uuid) is required");
    }
    const events = await this.repo.listEventsForSeason(seasonId);
    return jsonResponse({ events });
  }
}

/** Handler for `POST /events`. */
export class CreateEventHandler {
  /** @param repo - Events data access. */
  constructor(private readonly repo: EventsRepository) {}

  /**
   * @param request - Incoming request.
   * @returns 201 with `{ event }`, or 400/404/409.
   */
  async handle(request: Request): Promise<Response> {
    const body = await readJson<CreateEventBody>(request);
    const parsed = validateCreateEvent(body);
    if (!parsed.ok) return badRequest(parsed.error);

    const season = await this.repo.loadSeason(parsed.value.season_id);
    if (!season) return notFound("Season not found");
    if (season.is_archived) {
      return conflict("Cannot create events under an archived season");
    }

    try {
      const event = await this.repo.insertEvent(parsed.value);
      return jsonResponse({ event }, 201);
    } catch (error) {
      const message = (error as { message?: string }).message ?? "";
      const code = (error as { code?: string }).code ?? "";
      if (code === "23505" || /duplicate key/i.test(message)) {
        return conflict(
          "An event already exists for that date in this season",
        );
      }
      throw error;
    }
  }
}

/** Handler for `GET /events/:id`: event hydrated with slots and fixtures. */
export class GetEventHandler {
  /** @param repo - Events data access. */
  constructor(private readonly repo: EventsRepository) {}

  /**
   * @param id - Event id.
   * @returns 200 with `{ event, slots, fixtures }`, or 404.
   */
  async handle(id: string): Promise<Response> {
    const event = await this.repo.loadEvent(id);
    if (!event) return notFound("Event not found");
    const [slots, fixtures] = await Promise.all([
      this.repo.listSlotsForEvent(id),
      this.repo.listFixturesForEvent(id),
    ]);
    return jsonResponse({ event, slots, fixtures });
  }
}

/** Handler for `PATCH /events/:id`: update event_date. */
export class UpdateEventHandler {
  /** @param repo - Events data access. */
  constructor(private readonly repo: EventsRepository) {}

  /**
   * @param request - Incoming request.
   * @param id - Event id.
   * @returns 200 with `{ event }`, or 400/404/409.
   */
  async handle(request: Request, id: string): Promise<Response> {
    const body = await readJson<UpdateEventBody>(request);
    const parsed = validateUpdateEvent(body);
    if (!parsed.ok) return badRequest(parsed.error);

    const existing = await this.repo.loadEvent(id);
    if (!existing) return notFound("Event not found");
    if (existing.is_published) {
      return conflict(
        "Cannot change a published event's date, unpublish first",
      );
    }

    try {
      const event = await this.repo.updateEvent(id, parsed.value);
      if (!event) return notFound("Event not found");
      return jsonResponse({ event });
    } catch (error) {
      const message = (error as { message?: string }).message ?? "";
      const code = (error as { code?: string }).code ?? "";
      if (code === "23505" || /duplicate key/i.test(message)) {
        return conflict("Another event already exists for that date");
      }
      throw error;
    }
  }
}

/** Handler for `DELETE /events/:id`: delete an unpublished event. */
export class DeleteEventHandler {
  /** @param repo - Events data access. */
  constructor(private readonly repo: EventsRepository) {}

  /**
   * @param id - Event id.
   * @returns 200 with `{ deleted }`, or 404/409.
   */
  async handle(id: string): Promise<Response> {
    const existing = await this.repo.loadEvent(id);
    if (!existing) return notFound("Event not found");
    if (existing.is_published) {
      return conflict("Cannot delete a published event, unpublish first");
    }
    const deleted = await this.repo.deleteEvent(id);
    if (!deleted) return notFound("Event not found");
    return jsonResponse({ deleted });
  }
}
