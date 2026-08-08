// -----------------------------------------------------------------------------
// events/handlers/events.ts
//
// Event-level routes:
//   GET    /events?season=<uuid>   list events for a season
//   POST   /events                 create an event
//   GET    /events/:id             one event, hydrated with slots + fixtures
//   PATCH  /events/:id             update event_date
//   DELETE /events/:id             delete an unpublished event (cascade)
//
// Handlers are HTTP-shaped; validation lives in `../validate-body.ts` and DB
// access in `../db.ts`. The router (`../index.ts`) dispatches here.
// -----------------------------------------------------------------------------

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { jsonResponse } from "../../_shared/cors.ts";
import { isUuid, readJson } from "../../_shared/validate.ts";
import { badRequest, conflict, notFound } from "../../_shared/errors.ts";
import {
  deleteEvent,
  insertEvent,
  listEventsForSeason,
  listFixturesForEvent,
  listSlotsForEvent,
  loadEvent,
  loadSeason,
  updateEvent,
} from "../db.ts";
import {
  type CreateEventBody,
  type UpdateEventBody,
  validateCreateEvent,
  validateUpdateEvent,
} from "../validate-body.ts";

/**
 * `GET /events?season=<uuid>` — organiser listing for a season.
 *
 * @param supabase - Supabase client.
 * @param request - Incoming request.
 * @returns 200 with `{ events }`, 400 for a missing/invalid query.
 */
export async function handleListEvents(
  supabase: SupabaseClient,
  request: Request,
): Promise<Response> {
  const seasonId = new URL(request.url).searchParams.get("season");
  if (!seasonId || !isUuid(seasonId)) {
    return badRequest("Query param 'season' (uuid) is required");
  }
  const events = await listEventsForSeason(supabase, seasonId);
  return jsonResponse({ events });
}

/**
 * `POST /events` — create an event. Rejects when the referenced season
 * is missing or archived so a stale organiser session doesn't create
 * events under a season the students never see.
 *
 * @param supabase - Supabase client.
 * @param request - Incoming request.
 * @returns 201 with `{ event }`, or 400/404/409.
 */
export async function handleCreateEvent(
  supabase: SupabaseClient,
  request: Request,
): Promise<Response> {
  const body = await readJson<CreateEventBody>(request);
  const parsed = validateCreateEvent(body);
  if (!parsed.ok) return badRequest(parsed.error);

  const season = await loadSeason(supabase, parsed.value.season_id);
  if (!season) return notFound("Season not found");
  if (season.is_archived) {
    return conflict("Cannot create events under an archived season");
  }

  try {
    const event = await insertEvent(supabase, parsed.value);
    return jsonResponse({ event }, 201);
  } catch (error) {
    // ux_events_season_date is the only unique constraint on events; a
    // collision means the caller tried to create two events on the same
    // Monday. Translate to a friendly 409 instead of a 500.
    const message = (error as { message?: string }).message ?? "";
    const code = (error as { code?: string }).code ?? "";
    if (code === "23505" || /duplicate key/i.test(message)) {
      return conflict("An event already exists for that date in this season");
    }
    throw error;
  }
}

/**
 * `GET /events/:id` — one event hydrated with its slots and fixtures. This
 * is the "load the draw builder page" call, so slots and fixtures are
 * embedded rather than requiring two more round-trips.
 *
 * @param supabase - Supabase client.
 * @param id - Event id.
 * @returns 200 with `{ event, slots, fixtures }`, or 404.
 */
export async function handleGetEvent(
  supabase: SupabaseClient,
  id: string,
): Promise<Response> {
  const event = await loadEvent(supabase, id);
  if (!event) return notFound("Event not found");
  const [slots, fixtures] = await Promise.all([
    listSlotsForEvent(supabase, id),
    listFixturesForEvent(supabase, id),
  ]);
  return jsonResponse({ event, slots, fixtures });
}

/**
 * `PATCH /events/:id` — update event_date. Season is not movable (see the
 * comment on `validateUpdateEvent`). Rejects on a published event to
 * avoid quietly rescheduling something students have already shared.
 *
 * @param supabase - Supabase client.
 * @param id - Event id.
 * @param request - Incoming request.
 * @returns 200 with `{ event }`, or 400/404/409.
 */
export async function handleUpdateEvent(
  supabase: SupabaseClient,
  id: string,
  request: Request,
): Promise<Response> {
  const body = await readJson<UpdateEventBody>(request);
  const parsed = validateUpdateEvent(body);
  if (!parsed.ok) return badRequest(parsed.error);

  const existing = await loadEvent(supabase, id);
  if (!existing) return notFound("Event not found");
  if (existing.is_published) {
    return conflict(
      "Cannot change a published event's date — unpublish first",
    );
  }

  try {
    const event = await updateEvent(supabase, id, parsed.value);
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

/**
 * `DELETE /events/:id` — delete an unpublished event and everything under
 * it. Refuses on a published event: the archive would suddenly develop
 * holes if we cascaded past publish.
 *
 * @param supabase - Supabase client.
 * @param id - Event id.
 * @returns 200 with `{ deleted }`, or 404/409.
 */
export async function handleDeleteEvent(
  supabase: SupabaseClient,
  id: string,
): Promise<Response> {
  const existing = await loadEvent(supabase, id);
  if (!existing) return notFound("Event not found");
  if (existing.is_published) {
    return conflict("Cannot delete a published event — unpublish first");
  }
  const deleted = await deleteEvent(supabase, id);
  if (!deleted) return notFound("Event not found");
  return jsonResponse({ deleted });
}
