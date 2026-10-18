// -----------------------------------------------------------------------------
// teams/TeamsRouter.ts
//
// Router for the teams service. Dispatches method + path to a handler.
// Every route is organiser-gated.
//
// Routes (all require Authorization: Bearer <jwt>):
//   OPTIONS   *                            204 CORS preflight
//   GET       /teams?season=<uuid>         list teams for a season
//   POST      /teams                       create a team
//   POST      /teams/bulk                  bulk-add teams
//   PATCH     /teams/:id                   rename a team
//   DELETE    /teams/:id                   remove a team
//   anything else                          405 or 404 JSON
// -----------------------------------------------------------------------------

import { handlePreflight, jsonResponse } from "./lib/Cors.ts";
import { subPath } from "./lib/HttpHelpers.ts";
import { isUuid } from "./lib/InputValidation.ts";
import { isAuthFailure, requireOrganiser } from "./lib/OrganiserAuthGuard.ts";
import {
  SupabaseTeamsRepository,
  type TeamsRepository,
} from "./data/TeamsRepository.ts";
import { ListTeamsHandler } from "./handlers/ListTeamsHandler.ts";
import { CreateTeamHandler } from "./handlers/CreateTeamHandler.ts";
import { BulkAddTeamsHandler } from "./handlers/BulkAddTeamsHandler.ts";
import { RenameTeamHandler } from "./handlers/RenameTeamHandler.ts";
import { DeleteTeamHandler } from "./handlers/DeleteTeamHandler.ts";

/** Dispatcher for the teams service. */
export class TeamsRouter {
  private readonly repo: TeamsRepository;

  /**
   * @param repo - Teams data access. Defaults to the Supabase-backed
   * implementation; tests may inject a stub.
   */
  constructor(repo: TeamsRepository = new SupabaseTeamsRepository()) {
    this.repo = repo;
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

    const auth = await requireOrganiser(request);
    if (isAuthFailure(auth)) return auth;

    const segments = subPath(request, "teams");

    try {
      if (segments.length === 0) {
        if (request.method === "GET") {
          return await new ListTeamsHandler(this.repo).handle(request);
        }
        if (request.method === "POST") {
          return await new CreateTeamHandler(this.repo).handle(request);
        }
        return jsonResponse({ error: "Method not allowed" }, 405);
      }

      if (segments.length === 1 && segments[0] === "bulk") {
        if (request.method !== "POST") {
          return jsonResponse({ error: "Method not allowed" }, 405);
        }
        return await new BulkAddTeamsHandler(this.repo).handle(request);
      }

      const [id, action] = segments;
      if (!isUuid(id)) return jsonResponse({ error: "Invalid team id" }, 400);
      if (action) return jsonResponse({ error: "Unknown action" }, 404);

      if (request.method === "PATCH") {
        return await new RenameTeamHandler(this.repo).handle(request, id);
      }
      if (request.method === "DELETE") {
        return await new DeleteTeamHandler(this.repo).handle(id);
      }
      return jsonResponse({ error: "Method not allowed" }, 405);
    } catch (error) {
      console.error("teams error:", error);
      return jsonResponse({ error: "Internal server error" }, 500);
    }
  }
}
