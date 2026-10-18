// -----------------------------------------------------------------------------
// scoring/handlers/UndoEventHandler.ts
//
// POST /:fixtureId/undo: soft-void a specific match_event id. Never
// deletes: the event stays in the log with `voided_at` set so the audit
// trail survives, and the scoring format skips it on the next fold.
//
// Targets a specific event id (not "the last event on the server") so an
// offline queue that drains out of order cannot accidentally undo the
// wrong row.
// -----------------------------------------------------------------------------

import { isUuid, readJson } from "../lib/InputValidation.ts";
import { badRequest, forbidden, notFound } from "../lib/HttpErrors.ts";
import type { ScoringRepository } from "../data/ScoringRepository.ts";
import type { ScoringFormat } from "../domain/ScoringFormat.ts";
import type {
  FixtureContext,
  MatchAccessContext,
  UndoBody,
} from "../domain/ScoringTypes.ts";
import { respondDerived } from "./DerivedResponse.ts";

/** Handler for `POST /:fixtureId/undo`. */
export class UndoEventHandler {
  /**
   * @param repo - Scoring data access.
   * @param format - Scoring format for the derived response.
   */
  constructor(
    private readonly repo: ScoringRepository,
    private readonly format: ScoringFormat,
  ) {}

  /**
   * @param request - The incoming request.
   * @param fixture - The pre-loaded fixture context.
   * @param _access - Verified match-access context; unused today.
   * @returns 400 on bad body, 404 on missing event, 403 when the event
   * belongs to a different fixture, 200 with the derived summary on
   * success (or no-op replay).
   */
  async handle(
    request: Request,
    fixture: FixtureContext,
    _access: MatchAccessContext,
  ): Promise<Response> {
    const body = await readJson<UndoBody>(request);
    if (!body || !isUuid(body.event_id)) {
      return badRequest("event_id (uuid) is required");
    }
    const eventId = body.event_id as string;

    const existing = await this.repo.findEvent(eventId);
    if (!existing) return notFound("Event not found");
    if (existing.fixture_id !== fixture.id) {
      return forbidden("Event does not belong to this fixture");
    }

    await this.repo.voidEvent(eventId, null);

    return await respondDerived(this.repo, this.format, fixture);
  }
}
