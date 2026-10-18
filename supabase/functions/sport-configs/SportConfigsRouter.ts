// -----------------------------------------------------------------------------
// sport-configs/SportConfigsRouter.ts
//
// Router for the sport-configs service.
//
// Routes (all require Authorization: Bearer <jwt>):
//   OPTIONS   *                                   204 CORS preflight
//   GET       /sport-configs?season=<uuid>        list configs for a season
//   POST      /sport-configs                      upsert on (season_id, sport)
//   PATCH     /sport-configs/:id                  partial update
//   DELETE    /sport-configs/:id                  remove
//   anything else                                 405 or 404 JSON
// -----------------------------------------------------------------------------

import { handlePreflight, jsonResponse } from "./lib/Cors.ts";
import { subPath } from "./lib/HttpHelpers.ts";
import { isUuid } from "./lib/InputValidation.ts";
import { isAuthFailure, requireOrganiser } from "./lib/OrganiserAuthGuard.ts";
import {
  type SportConfigsRepository,
  SupabaseSportConfigsRepository,
} from "./data/SportConfigsRepository.ts";
import { ListSportConfigsHandler } from "./handlers/ListSportConfigsHandler.ts";
import { UpsertSportConfigHandler } from "./handlers/UpsertSportConfigHandler.ts";
import { UpdateSportConfigHandler } from "./handlers/UpdateSportConfigHandler.ts";
import { DeleteSportConfigHandler } from "./handlers/DeleteSportConfigHandler.ts";

/** Dispatcher for the sport-configs service. */
export class SportConfigsRouter {
  private readonly repo: SportConfigsRepository;

  /**
   * @param repo - Sport-configs data access. Defaults to the Supabase-backed
   * implementation; tests may inject a stub.
   */
  constructor(
    repo: SportConfigsRepository = new SupabaseSportConfigsRepository(),
  ) {
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

    const segments = subPath(request, "sport-configs");

    try {
      if (segments.length === 0) {
        if (request.method === "GET") {
          return await new ListSportConfigsHandler(this.repo).handle(request);
        }
        if (request.method === "POST") {
          return await new UpsertSportConfigHandler(this.repo).handle(request);
        }
        return jsonResponse({ error: "Method not allowed" }, 405);
      }

      const [id] = segments;
      if (!isUuid(id)) {
        return jsonResponse({ error: "Invalid sport_config id" }, 400);
      }

      if (request.method === "PATCH") {
        return await new UpdateSportConfigHandler(this.repo).handle(
          request,
          id,
        );
      }
      if (request.method === "DELETE") {
        return await new DeleteSportConfigHandler(this.repo).handle(id);
      }
      return jsonResponse({ error: "Method not allowed" }, 405);
    } catch (error) {
      console.error("sport-configs error:", error);
      return jsonResponse({ error: "Internal server error" }, 500);
    }
  }
}
