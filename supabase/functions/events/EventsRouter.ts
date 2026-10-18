// -----------------------------------------------------------------------------
// events/EventsRouter.ts
//
// Router for the events (draw-builder) service. Every route is organiser-
// gated; real behaviour lives in handlers/.
//
// Routes (all require Authorization: Bearer <organiser jwt>):
//
//   GET    /events?season=<uuid>              list events for a season
//   POST   /events                            create an event
//   GET    /events/:id                        one event + slots + fixtures
//   PATCH  /events/:id                        update event_date
//   DELETE /events/:id                        delete an unpublished event
//
//   POST   /events/:id/slots                  create a slot
//   PATCH  /events/:id/slots/:slotId          update a slot
//   DELETE /events/:id/slots/:slotId          delete an empty slot
//
//   POST   /events/:id/fixtures               create a fixture
//   PATCH  /events/:id/fixtures/:fid          move/reassign/cancel a fixture
//   DELETE /events/:id/fixtures/:fid          delete a fixture with no events
//
//   POST   /events/:id/generate               build a round-robin draw
//   POST   /events/:id/publish                flip is_published=true
//   POST   /events/:id/unpublish              flip is_published=false
//
// See docs/decisions/0006-draw-generation.md for the model and rationale.
// -----------------------------------------------------------------------------

import { handlePreflight } from "./lib/Cors.ts";
import { subPath } from "./lib/HttpHelpers.ts";
import { isUuid } from "./lib/InputValidation.ts";
import { isAuthFailure, requireOrganiser } from "./lib/OrganiserAuthGuard.ts";
import {
  badRequest,
  methodNotAllowed,
  notFound,
  serverError,
} from "./lib/HttpErrors.ts";
import {
  type EventsRepository,
  SupabaseEventsRepository,
} from "./data/EventsRepository.ts";
import {
  CreateEventHandler,
  DeleteEventHandler,
  GetEventHandler,
  ListEventsHandler,
  UpdateEventHandler,
} from "./handlers/EventCrudHandlers.ts";
import {
  CreateSlotHandler,
  DeleteSlotHandler,
  UpdateSlotHandler,
} from "./handlers/SlotCrudHandlers.ts";
import {
  CreateFixtureHandler,
  DeleteFixtureHandler,
  UpdateFixtureHandler,
} from "./handlers/FixtureCrudHandlers.ts";
import {
  GenerateDrawHandler,
  PublishEventHandler,
  UnpublishEventHandler,
} from "./handlers/DrawLifecycleHandlers.ts";

/** Nested collection segments the router recognises. */
const NESTED_COLLECTIONS = new Set(["slots", "fixtures"]);
/** Lifecycle action segments at `/events/:id/<action>`. */
const ACTIONS = new Set(["generate", "publish", "unpublish"]);

/** Dispatcher for the events service. */
export class EventsRouter {
  private readonly repo: EventsRepository;

  /**
   * @param repo - Events data access. Defaults to the Supabase-backed
   * implementation; tests may inject a stub.
   */
  constructor(repo: EventsRepository = new SupabaseEventsRepository()) {
    this.repo = repo;
  }

  /**
   * Route the request.
   *
   * @param request - The incoming request.
   * @returns The response to send to the caller.
   */
  async handle(request: Request): Promise<Response> {
    const preflight = handlePreflight(request);
    if (preflight) return preflight;

    const auth = await requireOrganiser(request);
    if (isAuthFailure(auth)) return auth;

    const segments = subPath(request, "events");

    try {
      // /events (collection)
      if (segments.length === 0) {
        if (request.method === "GET") {
          return await new ListEventsHandler(this.repo).handle(request);
        }
        if (request.method === "POST") {
          return await new CreateEventHandler(this.repo).handle(request);
        }
        return methodNotAllowed();
      }

      const [eventId, second, third] = segments;
      if (!isUuid(eventId)) return badRequest("Invalid event id");

      // /events/:id (item)
      if (segments.length === 1) {
        if (request.method === "GET") {
          return await new GetEventHandler(this.repo).handle(eventId);
        }
        if (request.method === "PATCH") {
          return await new UpdateEventHandler(this.repo).handle(
            request,
            eventId,
          );
        }
        if (request.method === "DELETE") {
          return await new DeleteEventHandler(this.repo).handle(eventId);
        }
        return methodNotAllowed();
      }

      // /events/:id/<generate|publish|unpublish>
      if (segments.length === 2 && ACTIONS.has(second)) {
        if (request.method !== "POST") return methodNotAllowed();
        if (second === "generate") {
          return await new GenerateDrawHandler(this.repo).handle(
            request,
            eventId,
          );
        }
        if (second === "publish") {
          return await new PublishEventHandler(this.repo).handle(eventId);
        }
        if (second === "unpublish") {
          return await new UnpublishEventHandler(this.repo).handle(
            request,
            eventId,
          );
        }
      }

      // /events/:id/slots and /events/:id/slots/:slotId
      // /events/:id/fixtures and /events/:id/fixtures/:fid
      if (NESTED_COLLECTIONS.has(second)) {
        if (segments.length === 2) {
          if (request.method !== "POST") return methodNotAllowed();
          if (second === "slots") {
            return await new CreateSlotHandler(this.repo).handle(
              request,
              eventId,
            );
          }
          return await new CreateFixtureHandler(this.repo).handle(
            request,
            eventId,
          );
        }
        if (segments.length === 3) {
          if (!isUuid(third)) {
            return badRequest(
              second === "slots" ? "Invalid slot id" : "Invalid fixture id",
            );
          }
          if (second === "slots") {
            if (request.method === "PATCH") {
              return await new UpdateSlotHandler(this.repo).handle(
                request,
                eventId,
                third,
              );
            }
            if (request.method === "DELETE") {
              return await new DeleteSlotHandler(this.repo).handle(
                eventId,
                third,
              );
            }
            return methodNotAllowed();
          }
          if (request.method === "PATCH") {
            return await new UpdateFixtureHandler(this.repo).handle(
              request,
              eventId,
              third,
            );
          }
          if (request.method === "DELETE") {
            return await new DeleteFixtureHandler(this.repo).handle(
              eventId,
              third,
            );
          }
          return methodNotAllowed();
        }
      }

      return notFound("Not found");
    } catch (error) {
      console.error("events error:", error);
      return serverError();
    }
  }
}
