// -----------------------------------------------------------------------------
// standings/StandingsRouter.ts
//
// Router for the public standings endpoint.
//
// Routes (no authentication; season liveness checked at the application
// layer, not just RLS):
//   OPTIONS   *                                       204 CORS preflight
//   GET       /standings?season=<uuid>                grouped by sport
//   GET       /standings?season=<uuid>&sport=<name>   single sport
//   any other method                                  405 JSON
// -----------------------------------------------------------------------------

import { handlePreflight, jsonResponse } from "./lib/Cors.ts";
import {
  type StandingsRepository,
  SupabaseStandingsRepository,
} from "./data/StandingsRepository.ts";
import { GetStandingsHandler } from "./handlers/GetStandingsHandler.ts";

/** Dispatcher for the standings service. */
export class StandingsRouter {
  private readonly repo: StandingsRepository;

  /**
   * @param repo - Standings data access. Defaults to the Supabase-backed
   * implementation; tests may inject a stub.
   */
  constructor(repo: StandingsRepository = new SupabaseStandingsRepository()) {
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

    if (request.method !== "GET") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    try {
      return await new GetStandingsHandler(this.repo).handle(request);
    } catch (error) {
      console.error("standings error:", error);
      return jsonResponse({ error: "Internal server error" }, 500);
    }
  }
}
