// -----------------------------------------------------------------------------
// events/handlers/slots.ts
//
// Nested slot routes on `/events/:id/slots`:
//   POST   /events/:id/slots              create a slot
//   PATCH  /events/:id/slots/:slotId      update a slot
//   DELETE /events/:id/slots/:slotId      delete a slot with no fixtures
//
// All routes scope the slot to the parent event id so a caller can't reach
// across events by guessing an id.
// -----------------------------------------------------------------------------

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { jsonResponse } from "../../_shared/cors.ts";
import { readJson } from "../../_shared/validate.ts";
import { badRequest, conflict, notFound } from "../../_shared/errors.ts";
import {
  countFixturesInSlot,
  deleteSlot,
  insertSlot,
  loadEvent,
  loadSlotInEvent,
  updateSlot,
} from "../db.ts";
import {
  type CreateSlotBody,
  type UpdateSlotBody,
  validateCreateSlot,
  validateUpdateSlot,
} from "../validate-body.ts";

/**
 * `POST /events/:id/slots` — create a slot on this event.
 *
 * @param supabase - Supabase client.
 * @param eventId - Parent event id.
 * @param request - Incoming request.
 * @returns 201 with `{ slot }`, or 400/404/409.
 */
export async function handleCreateSlot(
  supabase: SupabaseClient,
  eventId: string,
  request: Request,
): Promise<Response> {
  const event = await loadEvent(supabase, eventId);
  if (!event) return notFound("Event not found");

  const body = await readJson<CreateSlotBody>(request);
  const parsed = validateCreateSlot(body);
  if (!parsed.ok) return badRequest(parsed.error);

  try {
    const slot = await insertSlot(supabase, {
      event_id: eventId,
      ...parsed.value,
    });
    return jsonResponse({ slot }, 201);
  } catch (error) {
    const code = (error as { code?: string }).code ?? "";
    const message = (error as { message?: string }).message ?? "";
    if (code === "23505" || /duplicate key/i.test(message)) {
      return conflict(
        `slot_number ${parsed.value.slot_number} already exists on this event`,
      );
    }
    throw error;
  }
}

/**
 * `PATCH /events/:id/slots/:slotId` — sparse update.
 *
 * @param supabase - Supabase client.
 * @param eventId - Parent event id.
 * @param slotId - Slot id.
 * @param request - Incoming request.
 * @returns 200 with `{ slot }`, or 400/404/409.
 */
export async function handleUpdateSlot(
  supabase: SupabaseClient,
  eventId: string,
  slotId: string,
  request: Request,
): Promise<Response> {
  const existing = await loadSlotInEvent(supabase, eventId, slotId);
  if (!existing) return notFound("Slot not found on this event");

  const body = await readJson<UpdateSlotBody>(request);
  const parsed = validateUpdateSlot(body);
  if (!parsed.ok) return badRequest(parsed.error);

  try {
    const slot = await updateSlot(supabase, slotId, parsed.value);
    if (!slot) return notFound("Slot not found");
    return jsonResponse({ slot });
  } catch (error) {
    const code = (error as { code?: string }).code ?? "";
    const message = (error as { message?: string }).message ?? "";
    if (code === "23505" || /duplicate key/i.test(message)) {
      return conflict(
        "Another slot on this event already uses that slot_number",
      );
    }
    throw error;
  }
}

/**
 * `DELETE /events/:id/slots/:slotId` — delete a slot only if no fixtures
 * reference it. The FK is `on delete restrict` at the schema level, but
 * pre-checking gives us a 409 with a meaningful message instead of a raw
 * DB error surface.
 *
 * @param supabase - Supabase client.
 * @param eventId - Parent event id.
 * @param slotId - Slot id.
 * @returns 200 with `{ deleted }`, or 404/409.
 */
export async function handleDeleteSlot(
  supabase: SupabaseClient,
  eventId: string,
  slotId: string,
): Promise<Response> {
  const existing = await loadSlotInEvent(supabase, eventId, slotId);
  if (!existing) return notFound("Slot not found on this event");

  const fixtureCount = await countFixturesInSlot(supabase, slotId);
  if (fixtureCount > 0) {
    return conflict(
      `Cannot delete: ${fixtureCount} fixture(s) still reference this slot. ` +
        `Move or delete them first`,
    );
  }

  const deleted = await deleteSlot(supabase, slotId);
  if (!deleted) return notFound("Slot not found");
  return jsonResponse({ deleted });
}
