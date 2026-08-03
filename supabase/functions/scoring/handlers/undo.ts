// -----------------------------------------------------------------------------
// scoring/handlers/undo.ts
//
// POST /:fixtureId/undo — soft-void a specific match_event id. Never
// deletes: the event stays in the log with `voided_at` set so the audit
// trail survives, and `deriveScore` skips it on the next fold.
//
// Targets a *specific* event id (not "the last event on the server") so
// an offline queue that drains out of order can't accidentally undo the
// wrong row.
// -----------------------------------------------------------------------------

import { isUuid, readJson } from "../../_shared/validate.ts";
import { badRequest, forbidden, notFound } from "../errors.ts";
import { client, findEvent, voidEvent } from "../db.ts";
import { respondDerived } from "../derive.ts";
import type { FixtureContext, MatchAccessContext, UndoBody } from "../types.ts";

/**
 * Soft-void a match_event so it stops contributing to the derived score.
 * Idempotent: undoing an already-voided event returns 200 with the current
 * derived state.
 *
 * @param request - The incoming request; JSON body: `UndoBody`.
 * @param fixture - The pre-loaded fixture context.
 * @param _access - Verified match-access context; unused today but passed
 *                  in for future operator attribution.
 * @returns 400 on bad body, 404 on missing event, 403 when the event
 *          belongs to a different fixture, 200 with the derived summary
 *          on success (or no-op replay).
 */
export async function handleUndo(
  request: Request,
  fixture: FixtureContext,
  _access: MatchAccessContext,
): Promise<Response> {
  const body = await readJson<UndoBody>(request);
  if (!body || !isUuid(body.event_id)) {
    return badRequest("event_id (uuid) is required");
  }
  const eventId = body.event_id as string;

  const supabase = client();

  const existing = await findEvent(supabase, eventId);
  if (!existing) return notFound("Event not found");
  if (existing.fixture_id !== fixture.id) {
    // Cross-fixture undo would let a compromised match token reach beyond
    // its scope. Refuse loudly rather than silently no-op.
    return forbidden("Event does not belong to this fixture");
  }

  // voidEvent is a conditional update (WHERE voided_at IS NULL); the
  // handler treats "already voided" as a successful replay.
  // TODO: attribute to `_access.access_id` once match_events grows an
  // `operator_access_id` column (voided_by references auth.users today).
  await voidEvent(supabase, eventId, null);

  return await respondDerived(supabase, fixture);
}
