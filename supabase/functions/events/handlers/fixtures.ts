// -----------------------------------------------------------------------------
// events/handlers/fixtures.ts
//
// Nested fixture routes on `/events/:id/fixtures`:
//   POST   /events/:id/fixtures              create one fixture
//   PATCH  /events/:id/fixtures/:fid         move/reassign/cancel
//   DELETE /events/:id/fixtures/:fid         delete a fixture with no match_events
//
// Cross-row checks (team ∈ season, sport ∈ seasons.sports, slot ∈ event)
// live in this handler because they need DB reads that the pure body
// validator has no business doing.
// -----------------------------------------------------------------------------

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { jsonResponse } from "../../_shared/cors.ts";
import { readJson } from "../../_shared/validate.ts";
import { badRequest, conflict, notFound } from "../../_shared/errors.ts";
import {
  countMatchEventsForFixture,
  deleteFixture,
  insertFixture,
  listTeamIdsInSeason,
  loadEvent,
  loadFixtureInEvent,
  loadSeason,
  loadSlotInEvent,
  updateFixture,
} from "../db.ts";
import {
  type CreateFixtureBody,
  type UpdateFixtureBody,
  validateCreateFixture,
  validateUpdateFixture,
} from "../validate-body.ts";

/**
 * `POST /events/:id/fixtures` — create a single fixture.
 *
 * Cross-checks (all 409 if they fail):
 *   - slot_id belongs to this event
 *   - sport is declared on the season's sports array
 *   - home_team_id + away_team_id (if not null) both belong to the season
 *
 * @param supabase - Supabase client.
 * @param eventId - Parent event id.
 * @param request - Incoming request.
 * @returns 201 with `{ fixture }`, or 400/404/409.
 */
export async function handleCreateFixture(
  supabase: SupabaseClient,
  eventId: string,
  request: Request,
): Promise<Response> {
  const event = await loadEvent(supabase, eventId);
  if (!event) return notFound("Event not found");

  const body = await readJson<CreateFixtureBody>(request);
  const parsed = validateCreateFixture(body);
  if (!parsed.ok) return badRequest(parsed.error);

  const { slot_id, sport, home_team_id, away_team_id } = parsed.value;

  const slot = await loadSlotInEvent(supabase, eventId, slot_id);
  if (!slot) return conflict("slot_id does not belong to this event");

  const season = await loadSeason(supabase, event.season_id);
  if (!season) return notFound("Owning season not found");
  if (!season.sports.includes(sport)) {
    return conflict(
      `sport '${sport}' is not declared on this season (${
        season.sports.join(", ") || "none"
      })`,
    );
  }

  const teamIds = await listTeamIdsInSeason(supabase, event.season_id);
  const set = new Set(teamIds);
  if (!set.has(home_team_id)) {
    return conflict("home_team_id is not a team in this season");
  }
  if (away_team_id !== null && !set.has(away_team_id)) {
    return conflict("away_team_id is not a team in this season");
  }

  const fixture = await insertFixture(supabase, {
    event_id: eventId,
    slot_id,
    sport,
    home_team_id,
    away_team_id,
  });
  return jsonResponse({ fixture }, 201);
}

/**
 * `PATCH /events/:id/fixtures/:fid` — sparse update.
 *
 * Cross-checks kick in only for fields the caller is actually changing:
 * moving to a new slot re-checks slot ownership; changing teams re-checks
 * membership; changing sport re-checks the season's sports list.
 *
 * @param supabase - Supabase client.
 * @param eventId - Parent event id.
 * @param fixtureId - Fixture id.
 * @param request - Incoming request.
 * @returns 200 with `{ fixture }`, or 400/404/409.
 */
export async function handleUpdateFixture(
  supabase: SupabaseClient,
  eventId: string,
  fixtureId: string,
  request: Request,
): Promise<Response> {
  const existing = await loadFixtureInEvent(supabase, eventId, fixtureId);
  if (!existing) return notFound("Fixture not found on this event");

  const body = await readJson<UpdateFixtureBody>(request);
  const parsed = validateUpdateFixture(body);
  if (!parsed.ok) return badRequest(parsed.error);

  const patch = parsed.value;

  // Slot move — must land in a slot on the same event.
  if (typeof patch.slot_id === "string" && patch.slot_id !== existing.slot_id) {
    const slot = await loadSlotInEvent(
      supabase,
      eventId,
      patch.slot_id,
    );
    if (!slot) return conflict("slot_id does not belong to this event");
  }

  // Sport/team changes — need the owning season to cross-check.
  const needsSeasonCheck = patch.sport !== undefined ||
    patch.home_team_id !== undefined || patch.away_team_id !== undefined;
  if (needsSeasonCheck) {
    const event = await loadEvent(supabase, eventId);
    if (!event) return notFound("Event not found");
    const season = await loadSeason(supabase, event.season_id);
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
        await listTeamIdsInSeason(supabase, event.season_id),
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

  const fixture = await updateFixture(supabase, fixtureId, patch);
  if (!fixture) return notFound("Fixture not found");
  return jsonResponse({ fixture });
}

/**
 * `DELETE /events/:id/fixtures/:fid` — delete only when no match_events
 * reference the fixture. Prevents an accidental "clear the draw" from
 * cascading through a scored match's audit trail.
 *
 * @param supabase - Supabase client.
 * @param eventId - Parent event id.
 * @param fixtureId - Fixture id.
 * @returns 200 with `{ deleted }`, or 404/409.
 */
export async function handleDeleteFixture(
  supabase: SupabaseClient,
  eventId: string,
  fixtureId: string,
): Promise<Response> {
  const existing = await loadFixtureInEvent(supabase, eventId, fixtureId);
  if (!existing) return notFound("Fixture not found on this event");

  const eventCount = await countMatchEventsForFixture(supabase, fixtureId);
  if (eventCount > 0) {
    return conflict(
      `Cannot delete: fixture has ${eventCount} match event(s). ` +
        `Cancel it instead to keep the audit trail`,
    );
  }

  const deleted = await deleteFixture(supabase, fixtureId);
  if (!deleted) return notFound("Fixture not found");
  return jsonResponse({ deleted });
}
