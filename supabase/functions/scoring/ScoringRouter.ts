// -----------------------------------------------------------------------------
// scoring/ScoringRouter.ts
//
// Router for the live-scoring service. Real behaviour lives in the
// per-action classes under `handlers/`.
//
// Routes (all POST; all require a match code via `MatchTokenGuard`):
//   POST /scoring/:fixtureId/start
//   POST /scoring/:fixtureId/events
//   POST /scoring/:fixtureId/undo
//   POST /scoring/:fixtureId/period
//   POST /scoring/:fixtureId/finalize
// -----------------------------------------------------------------------------

import { handlePreflight } from "./lib/Cors.ts";
import { isUuid } from "./lib/InputValidation.ts";
import {
  badRequest,
  methodNotAllowed,
  notFound,
  serverError,
} from "./lib/HttpErrors.ts";
import { verifyMatchToken } from "./security/MatchTokenGuard.ts";
import {
  type ScoringRepository,
  SupabaseScoringRepository,
} from "./data/ScoringRepository.ts";
import {
  HeadToHeadScoringFormat,
  type ScoringFormat,
} from "./domain/ScoringFormat.ts";
import {
  SCORING_ACTIONS,
  type ScoringAction,
} from "./domain/ScoringActions.ts";
import { StartMatchHandler } from "./handlers/StartMatchHandler.ts";
import { RecordEventHandler } from "./handlers/RecordEventHandler.ts";
import { UndoEventHandler } from "./handlers/UndoEventHandler.ts";
import { PeriodHandler } from "./handlers/PeriodHandler.ts";
import { FinalizeMatchHandler } from "./handlers/FinalizeMatchHandler.ts";

/**
 * Parse `/scoring/:fixtureId/:action` out of the request URL. Anchoring
 * on the `scoring` segment matches the pattern used elsewhere so
 * mount-point differences do not matter.
 *
 * A bare `POST /scoring/:fixtureId` (no action segment) intentionally
 * returns 404.
 *
 * @param request - The incoming request.
 * @returns `{ fixtureId, action }` or `null` if the path does not match.
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
 * @param value - Candidate action string.
 * @returns `true` if it matches a known action.
 */
function isScoringAction(value: string): value is ScoringAction {
  return (SCORING_ACTIONS as readonly string[]).includes(value);
}

/** Dispatcher for the scoring service. */
export class ScoringRouter {
  private readonly repo: ScoringRepository;
  private readonly format: ScoringFormat;

  /**
   * @param repo - Scoring data access.
   * @param format - Scoring format. Defaults to head-to-head.
   */
  constructor(
    repo: ScoringRepository = new SupabaseScoringRepository(),
    format: ScoringFormat = new HeadToHeadScoringFormat(),
  ) {
    this.repo = repo;
    this.format = format;
  }

  /**
   * Route the request.
   *
   * @param request - The incoming request.
   * @returns The response to send to the caller.
   */
  async handle(request: Request): Promise<Response> {
    const preflight = handlePreflight(request);
    if (preflight) return preflight;

    if (request.method !== "POST") return methodNotAllowed();

    const route = parseRoute(request);
    if (!route) return notFound("Not found");
    if (!isUuid(route.fixtureId)) return badRequest("Invalid fixture id");
    if (!isScoringAction(route.action)) return notFound("Unknown action");

    // The guard both authenticates the caller and enforces the fixture-
    // scope check.
    const access = await verifyMatchToken(request, route.fixtureId);
    if (access instanceof Response) return access;

    try {
      const fixture = await this.repo.loadFixtureContext(route.fixtureId);
      if (!fixture) return notFound("Fixture not found");

      switch (route.action) {
        case "start":
          return await new StartMatchHandler(this.repo, this.format).handle(
            request,
            fixture,
            access,
          );
        case "events":
          return await new RecordEventHandler(this.repo, this.format).handle(
            request,
            fixture,
            access,
          );
        case "undo":
          return await new UndoEventHandler(this.repo, this.format).handle(
            request,
            fixture,
            access,
          );
        case "period":
          return await new PeriodHandler(this.repo, this.format).handle(
            request,
            fixture,
            access,
          );
        case "finalize":
          return await new FinalizeMatchHandler(
            this.repo,
            this.format,
          ).handle(request, fixture, access);
      }
    } catch (error) {
      console.error("scoring error:", error);
      return serverError();
    }
  }
}
