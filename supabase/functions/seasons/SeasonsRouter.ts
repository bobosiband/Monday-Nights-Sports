// -----------------------------------------------------------------------------
// seasons/SeasonsRouter.ts
//
// Router for the seasons service. Dispatches method + path to a handler.
// Every route is organiser-gated; there is no public read path on this
// service. The handlers hold the per-action logic; this file is the map
// from URL + method to handler.
//
// Routes (all require Authorization: Bearer <jwt>):
//   OPTIONS   *                               204 CORS preflight
//   GET       /seasons                        list seasons
//   POST      /seasons                        create a season
//   GET       /seasons/:id                    read one season
//   PATCH     /seasons/:id                    update a season
//   POST      /seasons/:id/activate           mark as the active season
//   POST      /seasons/:id/archive            soft-delete a season
//   anything else                              405 or 404 JSON
// -----------------------------------------------------------------------------

import { handlePreflight, jsonResponse } from "./lib/Cors.ts";
import { subPath } from "./lib/HttpHelpers.ts";
import { isUuid } from "./lib/InputValidation.ts";
import { isAuthFailure, requireOrganiser } from "./lib/OrganiserAuthGuard.ts";
import {
  type SeasonsRepository,
  SupabaseSeasonsRepository,
} from "./data/SeasonsRepository.ts";
import { ListSeasonsHandler } from "./handlers/ListSeasonsHandler.ts";
import { CreateSeasonHandler } from "./handlers/CreateSeasonHandler.ts";
import { GetSeasonHandler } from "./handlers/GetSeasonHandler.ts";
import { UpdateSeasonHandler } from "./handlers/UpdateSeasonHandler.ts";
import { ActivateSeasonHandler } from "./handlers/ActivateSeasonHandler.ts";
import { ArchiveSeasonHandler } from "./handlers/ArchiveSeasonHandler.ts";

/** Dispatcher for the seasons service. */
export class SeasonsRouter {
  private readonly repo: SeasonsRepository;

  /**
   * @param repo - Seasons data access. Defaults to the Supabase-backed
   * implementation; tests may inject a stub.
   */
  constructor(repo: SeasonsRepository = new SupabaseSeasonsRepository()) {
    this.repo = repo;
  }

  /**
   * Route the request. Catches unexpected errors so the service never
   * leaks a stack trace to the caller.
   *
   * @param request - The incoming request.
   * @returns The response to send to the caller.
   */
  async handle(request: Request): Promise<Response> {
    const preflight = handlePreflight(request);
    if (preflight) return preflight;

    const auth = await requireOrganiser(request);
    if (isAuthFailure(auth)) return auth;

    const segments = subPath(request, "seasons");

    try {
      if (segments.length === 0) {
        if (request.method === "GET") {
          return await new ListSeasonsHandler(this.repo).handle();
        }
        if (request.method === "POST") {
          return await new CreateSeasonHandler(this.repo).handle(
            request,
            auth,
          );
        }
        return jsonResponse({ error: "Method not allowed" }, 405);
      }

      const [id, action] = segments;
      if (!isUuid(id)) {
        return jsonResponse({ error: "Invalid season id" }, 400);
      }

      if (!action) {
        if (request.method === "GET") {
          return await new GetSeasonHandler(this.repo).handle(id);
        }
        if (request.method === "PATCH") {
          return await new UpdateSeasonHandler(this.repo).handle(request, id);
        }
        return jsonResponse({ error: "Method not allowed" }, 405);
      }

      if (request.method !== "POST") {
        return jsonResponse({ error: "Method not allowed" }, 405);
      }
      if (action === "activate") {
        return await new ActivateSeasonHandler(this.repo).handle(id);
      }
      if (action === "archive") {
        return await new ArchiveSeasonHandler(this.repo).handle(id);
      }

      return jsonResponse({ error: "Unknown action" }, 404);
    } catch (error) {
      console.error("seasons error:", error);
      return jsonResponse({ error: "Internal server error" }, 500);
    }
  }
}
