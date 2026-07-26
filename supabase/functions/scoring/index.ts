// -----------------------------------------------------------------------------
// scoring/index.ts
//
// Live scoring service — thin request router. Real behaviour lives in the
// per-action files under `handlers/`; DB access lives in `db.ts`; validation
// helpers live in `../_shared/validate.ts` and `_shared/score.ts`.
//
// Routes (all POST; all require a match token):
//   POST /scoring/:fixtureId/start
//   POST /scoring/:fixtureId/events
//   POST /scoring/:fixtureId/undo
//   POST /scoring/:fixtureId/period
//   POST /scoring/:fixtureId/finalize
// -----------------------------------------------------------------------------

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { handlePreflight } from "../_shared/cors.ts";
import { verifyMatchToken } from "./guard.ts";
import {
  badRequest,
  methodNotAllowed,
  notFound,
  serverError,
} from "./errors.ts";
import { client, loadFixtureContext } from "./db.ts";
import { handleStart } from "./handlers/start.ts";
import { handleRecordEvent } from "./handlers/events.ts";
import { handleUndo } from "./handlers/undo.ts";
import { handlePeriod } from "./handlers/period.ts";
import { handleFinalize } from "./handlers/finalize.ts";
import { SCORING_ACTIONS, type ScoringAction } from "./constants.ts";
import { isUuid } from "../_shared/validate.ts";

/**
 * Parse `/scoring/:fixtureId/:action` out of the request URL. Anchoring on
 * the `scoring` segment matches the pattern used elsewhere in this repo so
 * mount-point differences between the platform and local dev don't matter.
 *
 * A bare `POST /scoring/:fixtureId` (no action segment) intentionally
 * returns 404: every scoring intent has a named action, so there is no
 * meaningful default. The `parts.length < idx + 3` check enforces this.
 *
 * @param request - The incoming request.
 * @returns `{ fixtureId, action }` or `null` if the path doesn't match.
 */
function parseRoute(
  request: Request,
): { fixtureId: string; action: string } | null {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  const idx = parts.lastIndexOf("scoring");
  if (idx < 0 || parts.length < idx + 3) return null;
  return { fixtureId: parts[idx + 1], action: parts[idx + 2] };
}

/**
 * Type guard: is this string one of the known scoring actions?
 *
 * @param value - The candidate action string.
 * @returns `true` if it matches a known action.
 */
function isScoringAction(value: string): value is ScoringAction {
  return (SCORING_ACTIONS as readonly string[]).includes(value);
}

serve(async (request) => {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  if (request.method !== "POST") return methodNotAllowed();

  const route = parseRoute(request);
  if (!route) return notFound("Not found");
  if (!isUuid(route.fixtureId)) return badRequest("Invalid fixture id");
  if (!isScoringAction(route.action)) return notFound("Unknown action");

  // The guard both authenticates the caller and enforces the fixture-scope
  // check — reject when a code minted for fixture A is used against
  // fixture B (403).
  const access = await verifyMatchToken(request, route.fixtureId);
  if (access instanceof Response) return access;

  try {
    const supabase = client();
    const fixture = await loadFixtureContext(supabase, route.fixtureId);
    if (!fixture) return notFound("Fixture not found");

    switch (route.action) {
      case "start":
        return await handleStart(request, fixture, access);
      case "events":
        return await handleRecordEvent(request, fixture, access);
      case "undo":
        return await handleUndo(request, fixture, access);
      case "period":
        return await handlePeriod(request, fixture, access);
      case "finalize":
        return await handleFinalize(request, fixture, access);
    }
  } catch (error) {
    console.error("scoring error:", error);
    return serverError();
  }
});
