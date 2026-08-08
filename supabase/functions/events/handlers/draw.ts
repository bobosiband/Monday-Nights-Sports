// -----------------------------------------------------------------------------
// events/handlers/draw.ts
//
// Draw-lifecycle routes:
//   POST /events/:id/generate       build a round-robin draw (dry_run optional)
//   POST /events/:id/publish        flip is_published on
//   POST /events/:id/unpublish      flip is_published off (with a safety check)
//
// `/generate` is the reason `_shared/round-robin.ts` was written. Publish is
// the safety boundary — see `../validate-draw.ts` for the reasoning.
// -----------------------------------------------------------------------------

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { jsonResponse } from "../../_shared/cors.ts";
import { readJson } from "../../_shared/validate.ts";
import { badRequest, conflict, notFound } from "../../_shared/errors.ts";
import { generateRoundRobin } from "../../_shared/round-robin.ts";
import {
  insertFixtures,
  listFixturesForEvent,
  listSlotsForEvent,
  listTeamIdsInSeason,
  loadEvent,
  loadSeason,
  updateEvent,
} from "../db.ts";
import { spreadAcrossSlots } from "../spread.ts";
import { validatePublish, validateUnpublish } from "../validate-draw.ts";
import { type GenerateBody, validateGenerate } from "../validate-body.ts";

/**
 * `POST /events/:id/generate` — build a round-robin draw and either preview
 * it (`?dry_run=true`) or insert it.
 *
 * Body: `{ sport, team_ids[], slot_ids[] }`. All ids must belong to the
 * event's season / event; the response is 409 with a specific reason on
 * mismatch so the organiser knows exactly what to fix.
 *
 * @param supabase - Supabase client.
 * @param eventId - Parent event id.
 * @param request - Incoming request.
 * @returns
 *   - 200 with `{ preview: fixtures }` when dry_run=true
 *   - 201 with `{ inserted: fixtures }` when writing
 *   - 400 for shape errors; 404 event/season not found; 409 cross-check fails
 */
export async function handleGenerate(
  supabase: SupabaseClient,
  eventId: string,
  request: Request,
): Promise<Response> {
  const dryRun = new URL(request.url).searchParams.get("dry_run") === "true";

  const event = await loadEvent(supabase, eventId);
  if (!event) return notFound("Event not found");
  if (event.is_published) {
    return conflict(
      "Cannot generate onto a published event — unpublish first",
    );
  }

  const body = await readJson<GenerateBody>(request);
  const parsed = validateGenerate(body);
  if (!parsed.ok) return badRequest(parsed.error);

  const { sport, team_ids, slot_ids } = parsed.value;

  const season = await loadSeason(supabase, event.season_id);
  if (!season) return notFound("Owning season not found");
  if (!season.sports.includes(sport)) {
    return conflict(
      `sport '${sport}' is not declared on this season (${
        season.sports.join(", ") || "none"
      })`,
    );
  }

  const seasonTeamIds = new Set(
    await listTeamIdsInSeason(supabase, event.season_id),
  );
  for (const id of team_ids) {
    if (!seasonTeamIds.has(id)) {
      return conflict(`team ${id} is not a team in this season`);
    }
  }

  const eventSlotIds = new Set(
    (await listSlotsForEvent(supabase, eventId)).map((s) => s.id),
  );
  for (const id of slot_ids) {
    if (!eventSlotIds.has(id)) {
      return conflict(`slot ${id} does not belong to this event`);
    }
  }

  const pairings = generateRoundRobin(team_ids);
  const spread = spreadAcrossSlots({ pairings, slot_ids });
  if (!spread.ok) return conflict(spread.error);

  const rows = spread.fixtures.map((f) => ({
    event_id: eventId,
    slot_id: f.slot_id,
    sport,
    home_team_id: f.home_team_id,
    away_team_id: f.away_team_id,
  }));

  if (dryRun) {
    // Preview mirrors the insert shape but keeps the round number the
    // caller can group by. No writes.
    return jsonResponse({
      dry_run: true,
      preview: spread.fixtures.map((f) => ({
        round: f.round,
        slot_id: f.slot_id,
        sport,
        home_team_id: f.home_team_id,
        away_team_id: f.away_team_id,
      })),
    });
  }

  const inserted = await insertFixtures(supabase, rows);
  return jsonResponse({ inserted }, 201);
}

/**
 * `POST /events/:id/publish` — flip `is_published=true` after the draw
 * passes the structural checks in `validatePublish`. Sets `published_at`
 * to `now()` server-side so the archive later shows when a draw went
 * live.
 *
 * @param supabase - Supabase client.
 * @param eventId - Event id.
 * @returns 200 with the updated event, 404, or 409 with a specific reason.
 */
export async function handlePublish(
  supabase: SupabaseClient,
  eventId: string,
): Promise<Response> {
  const event = await loadEvent(supabase, eventId);
  if (!event) return notFound("Event not found");
  if (event.is_published) {
    // Idempotent-style success — publishing an already-published event is
    // a no-op, no reason to 409.
    return jsonResponse({ event });
  }

  const [season, slots, fixtures] = await Promise.all([
    loadSeason(supabase, event.season_id),
    listSlotsForEvent(supabase, eventId),
    listFixturesForEvent(supabase, eventId),
  ]);
  if (!season) return notFound("Owning season not found");

  const teamIdsInSeason = await listTeamIdsInSeason(supabase, event.season_id);

  const check = validatePublish({
    fixtures,
    slots,
    season: { sports: season.sports },
    teamIdsInSeason,
  });
  if (!check.ok) return conflict(check.reason);

  const updated = await updateEvent(supabase, eventId, {
    is_published: true,
    published_at: new Date().toISOString(),
  });
  if (!updated) return notFound("Event not found");
  return jsonResponse({ event: updated });
}

/**
 * `POST /events/:id/unpublish` — flip `is_published=false`. Refuses when
 * any fixture is live/complete unless the body says `{ "force": true }`
 * (silently hiding an in-flight match from viewers is a support call
 * waiting to happen).
 *
 * @param supabase - Supabase client.
 * @param eventId - Event id.
 * @param request - Incoming request.
 * @returns 200 with the updated event, 404, or 409 with a specific reason.
 */
export async function handleUnpublish(
  supabase: SupabaseClient,
  eventId: string,
  request: Request,
): Promise<Response> {
  const event = await loadEvent(supabase, eventId);
  if (!event) return notFound("Event not found");
  if (!event.is_published) {
    return jsonResponse({ event });
  }

  const body = await readJson<{ force?: unknown }>(request);
  const force = body?.force === true;

  const fixtures = await listFixturesForEvent(supabase, eventId);
  const check = validateUnpublish({
    fixtures: fixtures.map((f) => ({ id: f.id, status: f.status })),
    force,
  });
  if (!check.ok) return conflict(check.reason);

  const updated = await updateEvent(supabase, eventId, {
    is_published: false,
    published_at: null,
  });
  if (!updated) return notFound("Event not found");
  return jsonResponse({ event: updated });
}
