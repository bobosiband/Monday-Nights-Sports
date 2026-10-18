// -----------------------------------------------------------------------------
// events/handlers/SlotCrudHandlers.ts
//
// Nested slot handlers on `/events/:id/slots`.
// All routes scope the slot to the parent event id so a caller cannot
// reach across events by guessing an id.
// -----------------------------------------------------------------------------

import { jsonResponse } from "../lib/Cors.ts";
import { readJson } from "../lib/InputValidation.ts";
import { badRequest, conflict, notFound } from "../lib/HttpErrors.ts";
import type { EventsRepository } from "../data/EventsRepository.ts";
import {
  type CreateSlotBody,
  type UpdateSlotBody,
  validateCreateSlot,
  validateUpdateSlot,
} from "../validation/EventBodyValidator.ts";

/** Handler for `POST /events/:id/slots`. */
export class CreateSlotHandler {
  /** @param repo - Events data access. */
  constructor(private readonly repo: EventsRepository) {}

  /**
   * @param request - Incoming request.
   * @param eventId - Parent event id.
   * @returns 201 with `{ slot }`, or 400/404/409.
   */
  async handle(request: Request, eventId: string): Promise<Response> {
    const event = await this.repo.loadEvent(eventId);
    if (!event) return notFound("Event not found");

    const body = await readJson<CreateSlotBody>(request);
    const parsed = validateCreateSlot(body);
    if (!parsed.ok) return badRequest(parsed.error);

    try {
      const slot = await this.repo.insertSlot({
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
}

/** Handler for `PATCH /events/:id/slots/:slotId`. */
export class UpdateSlotHandler {
  /** @param repo - Events data access. */
  constructor(private readonly repo: EventsRepository) {}

  /**
   * @param request - Incoming request.
   * @param eventId - Parent event id.
   * @param slotId - Slot id.
   * @returns 200 with `{ slot }`, or 400/404/409.
   */
  async handle(
    request: Request,
    eventId: string,
    slotId: string,
  ): Promise<Response> {
    const existing = await this.repo.loadSlotInEvent(eventId, slotId);
    if (!existing) return notFound("Slot not found on this event");

    const body = await readJson<UpdateSlotBody>(request);
    const parsed = validateUpdateSlot(body);
    if (!parsed.ok) return badRequest(parsed.error);

    try {
      const slot = await this.repo.updateSlot(slotId, parsed.value);
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
}

/** Handler for `DELETE /events/:id/slots/:slotId`. */
export class DeleteSlotHandler {
  /** @param repo - Events data access. */
  constructor(private readonly repo: EventsRepository) {}

  /**
   * @param eventId - Parent event id.
   * @param slotId - Slot id.
   * @returns 200 with `{ deleted }`, or 404/409.
   */
  async handle(eventId: string, slotId: string): Promise<Response> {
    const existing = await this.repo.loadSlotInEvent(eventId, slotId);
    if (!existing) return notFound("Slot not found on this event");

    const fixtureCount = await this.repo.countFixturesInSlot(slotId);
    if (fixtureCount > 0) {
      return conflict(
        `Cannot delete: ${fixtureCount} fixture(s) still reference this slot. ` +
          `Move or delete them first`,
      );
    }

    const deleted = await this.repo.deleteSlot(slotId);
    if (!deleted) return notFound("Slot not found");
    return jsonResponse({ deleted });
  }
}
