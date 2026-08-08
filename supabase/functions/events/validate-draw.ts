// -----------------------------------------------------------------------------
// events/validate-draw.ts
//
// Pure pre-flight for `POST /events/:id/publish`. Publishing is the safety
// boundary: RLS exposes everything under a published event to `anon`, so
// the first thing a student sees for a broken draw is a broken page. That
// makes it much cheaper to reject the publish call here than to debug why
// the public fixtures endpoint is 500ing at 6pm on a Monday.
//
// Kept pure (no DB access, no time, no randomness) so we can:
//   - reuse the same rules in the `/generate?dry_run` preview
//   - unit-test every failure mode without a Supabase client
//
// The caller (publish handler) is responsible for fetching the fixtures,
// slots, and team-membership snapshot the validator needs.
// -----------------------------------------------------------------------------

/** Fixture shape the validator needs — a subset of the DB row. */
export interface DraftFixture {
  id: string;
  slot_id: string | null;
  home_team_id: string | null;
  away_team_id: string | null;
  sport: string;
  status: string;
}

/** Slot identity (id is all the publish check needs). */
export interface DraftSlot {
  id: string;
}

/** Season sports list — the source of truth for allowed `fixtures.sport`. */
export interface DraftSeason {
  sports: string[];
}

/** Success shape returned by `validatePublish`. */
export interface PublishOk {
  ok: true;
}

/** Failure shape returned by `validatePublish`. Reason surfaces in the 409. */
export interface PublishError {
  ok: false;
  reason: string;
}

/**
 * Decide whether an event is publishable.
 *
 * Rejections are structural, not stylistic — anything that would make the
 * public fixtures page render a hole, a `null`, or a 500. Ordering games
 * awkwardly or leaving slot 4 empty is fine and stays the organiser's
 * call.
 *
 * Rules (all 409-worthy on the wire; the caller surfaces the exact reason):
 *
 *  1. **No fixtures** — publishing an empty event just shows students an
 *     empty page. The organiser almost certainly forgot to run generate;
 *     tell them so.
 *  2. **Fixture missing a slot** — the row exists but its slot pointer is
 *     null, or points at a slot that has been deleted from this event.
 *     Either way the public fixtures HTML will error out reading
 *     `slot.starts_at`.
 *  3. **Fixture missing a home team** — schema forbids it, but a stale
 *     read could still surface it, and the public renderer crashes on a
 *     null team name.
 *  4. **Team not in this season** — a fixture referencing a team from
 *     another season is a leak that public reads would render, and the
 *     name-lookup joins would be silently wrong.
 *  5. **Sport not in `seasons.sports`** — `standings` and `fixtures-public`
 *     both group by sport; a sport not declared on the season would show up
 *     as an orphan grouping.
 *  6. **Home == away** — schema check catches it, but a defence-in-depth
 *     check here means a stale/racy insert doesn't publish a "team plays
 *     itself" fixture.
 *
 * `away_team_id: null` (a bye) is allowed — it's a legal fixture shape and
 * `fixtures.away_team_id` is deliberately nullable at the schema layer.
 *
 * Fixture with `status: 'cancelled'` is allowed — cancelled fixtures are a
 * normal part of a published event, they just render struck-through.
 *
 * @param params.fixtures  - All fixtures on this event.
 * @param params.slots     - All slots on this event.
 * @param params.season    - Season the event belongs to.
 * @param params.teamIdsInSeason - Snapshot of team ids in the season, used
 *                                 to check home/away membership without
 *                                 further round-trips.
 * @returns `{ ok: true }` or `{ ok: false, reason }`.
 */
export function validatePublish(params: {
  fixtures: DraftFixture[];
  slots: DraftSlot[];
  season: DraftSeason;
  teamIdsInSeason: string[];
}): PublishOk | PublishError {
  const { fixtures, slots, season, teamIdsInSeason } = params;

  if (fixtures.length === 0) {
    return {
      ok: false,
      reason: "Event has no fixtures — run generate or add fixtures manually",
    };
  }

  const slotIds = new Set(slots.map((s) => s.id));
  const teamIds = new Set(teamIdsInSeason);
  const seasonSports = new Set(season.sports);

  for (const f of fixtures) {
    if (!f.slot_id || !slotIds.has(f.slot_id)) {
      return {
        ok: false,
        reason: `Fixture ${f.id} is not assigned to a slot in this event`,
      };
    }
    if (!f.home_team_id) {
      return { ok: false, reason: `Fixture ${f.id} has no home team` };
    }
    if (!teamIds.has(f.home_team_id)) {
      return {
        ok: false,
        reason:
          `Fixture ${f.id} home team ${f.home_team_id} is not in this season`,
      };
    }
    if (f.away_team_id !== null && !teamIds.has(f.away_team_id)) {
      return {
        ok: false,
        reason:
          `Fixture ${f.id} away team ${f.away_team_id} is not in this season`,
      };
    }
    if (
      f.away_team_id !== null && f.home_team_id === f.away_team_id
    ) {
      return {
        ok: false,
        reason: `Fixture ${f.id} has the same team on both sides`,
      };
    }
    if (!seasonSports.has(f.sport)) {
      return {
        ok: false,
        reason:
          `Fixture ${f.id} sport '${f.sport}' is not declared on the season`,
      };
    }
  }

  return { ok: true };
}

/** Fixture shape the unpublish safety check needs — just the status. */
export interface UnpublishFixture {
  id: string;
  status: string;
}

/**
 * Decide whether an event may be unpublished without `force: true`.
 *
 * Silently hiding a live match from viewers mid-game is the sort of thing
 * that ends in a Discord message asking why the score stopped updating.
 * Refuse unless the caller has thought about it and set `force`.
 *
 * @param params.fixtures - All fixtures on the event.
 * @param params.force    - Whether the caller explicitly waived the check.
 * @returns `{ ok: true }` when unpublishing is safe (or forced);
 *          `{ ok: false, reason }` otherwise.
 */
export function validateUnpublish(params: {
  fixtures: UnpublishFixture[];
  force: boolean;
}): PublishOk | PublishError {
  if (params.force) return { ok: true };

  const blocking = params.fixtures.filter(
    (f) => f.status === "live" || f.status === "complete",
  );
  if (blocking.length > 0) {
    return {
      ok: false,
      reason:
        `Cannot unpublish: ${blocking.length} fixture(s) are live or complete. ` +
        `Pass { "force": true } to hide anyway`,
    };
  }
  return { ok: true };
}
