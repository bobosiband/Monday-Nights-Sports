// -----------------------------------------------------------------------------
// events/index.ts
//
// Organiser draw-builder service — thin request router. Every route is
// gated by `requireOrganiser`; real behaviour lives in `handlers/`.
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

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { handlePreflight } from "../_shared/cors.ts";
import { isAuthFailure, requireOrganiser } from "../_shared/auth.ts";
import { isUuid } from "../_shared/validate.ts";
import { subPath } from "../_shared/http.ts";
import {
  badRequest,
  methodNotAllowed,
  notFound,
  serverError,
} from "../_shared/errors.ts";
import { client } from "./db.ts";
import {
  handleCreateEvent,
  handleDeleteEvent,
  handleGetEvent,
  handleListEvents,
  handleUpdateEvent,
} from "./handlers/events.ts";
import {
  handleCreateSlot,
  handleDeleteSlot,
  handleUpdateSlot,
} from "./handlers/slots.ts";
import {
  handleCreateFixture,
  handleDeleteFixture,
  handleUpdateFixture,
} from "./handlers/fixtures.ts";
import {
  handleGenerate,
  handlePublish,
  handleUnpublish,
} from "./handlers/draw.ts";

/** Path shape at `/events/:id/:action`, `slots`/`fixtures`, or an action. */
const NESTED_COLLECTIONS = new Set(["slots", "fixtures"]);
const ACTIONS = new Set(["generate", "publish", "unpublish"]);

serve(async (request) => {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireOrganiser(request);
  if (isAuthFailure(auth)) return auth;

  const supabase = client();
  const segments = subPath(request, "events");

  try {
    // ---------------------------------------------------------------------
    // /events                    (collection)
    // ---------------------------------------------------------------------
    if (segments.length === 0) {
      if (request.method === "GET") {
        return await handleListEvents(supabase, request);
      }
      if (request.method === "POST") {
        return await handleCreateEvent(supabase, request);
      }
      return methodNotAllowed();
    }

    // ---------------------------------------------------------------------
    // /events/:id                (item)
    // ---------------------------------------------------------------------
    const [eventId, second, third] = segments;
    if (!isUuid(eventId)) return badRequest("Invalid event id");

    if (segments.length === 1) {
      if (request.method === "GET") {
        return await handleGetEvent(supabase, eventId);
      }
      if (request.method === "PATCH") {
        return await handleUpdateEvent(supabase, eventId, request);
      }
      if (request.method === "DELETE") {
        return await handleDeleteEvent(supabase, eventId);
      }
      return methodNotAllowed();
    }

    // ---------------------------------------------------------------------
    // /events/:id/generate|publish|unpublish   (action)
    // ---------------------------------------------------------------------
    if (segments.length === 2 && ACTIONS.has(second)) {
      if (request.method !== "POST") return methodNotAllowed();
      if (second === "generate") {
        return await handleGenerate(supabase, eventId, request);
      }
      if (second === "publish") {
        return await handlePublish(supabase, eventId);
      }
      if (second === "unpublish") {
        return await handleUnpublish(supabase, eventId, request);
      }
    }

    // ---------------------------------------------------------------------
    // /events/:id/slots  and  /events/:id/slots/:slotId
    // /events/:id/fixtures  and  /events/:id/fixtures/:fid
    // ---------------------------------------------------------------------
    if (NESTED_COLLECTIONS.has(second)) {
      if (segments.length === 2) {
        if (request.method !== "POST") return methodNotAllowed();
        if (second === "slots") {
          return await handleCreateSlot(supabase, eventId, request);
        }
        return await handleCreateFixture(supabase, eventId, request);
      }
      if (segments.length === 3) {
        if (!isUuid(third)) {
          return badRequest(
            second === "slots" ? "Invalid slot id" : "Invalid fixture id",
          );
        }
        if (second === "slots") {
          if (request.method === "PATCH") {
            return await handleUpdateSlot(supabase, eventId, third, request);
          }
          if (request.method === "DELETE") {
            return await handleDeleteSlot(supabase, eventId, third);
          }
          return methodNotAllowed();
        }
        // fixtures
        if (request.method === "PATCH") {
          return await handleUpdateFixture(supabase, eventId, third, request);
        }
        if (request.method === "DELETE") {
          return await handleDeleteFixture(supabase, eventId, third);
        }
        return methodNotAllowed();
      }
    }

    return notFound("Not found");
  } catch (error) {
    console.error("events error:", error);
    return serverError();
  }
});
