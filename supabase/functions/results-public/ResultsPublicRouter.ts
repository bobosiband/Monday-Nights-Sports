// -----------------------------------------------------------------------------
// results-public/ResultsPublicRouter.ts
//
// Router for the results-public service.
//
// Routes (no authentication; RLS gates on `events.is_published = true`):
//   OPTIONS   *                                        204 CORS preflight
//   GET       /results-public?event=<uuid>             one event's archive
//   GET       /results-public?season=<uuid>&limit=&before=
//                                                     paginated season archive
//   any other method                                   405 JSON
// -----------------------------------------------------------------------------

import { handlePreflight, jsonResponse } from "./lib/Cors.ts";
import {
  type ResultsPublicRepository,
  SupabaseResultsPublicRepository,
} from "./data/ResultsPublicRepository.ts";
import { GetEventResultsHandler } from "./handlers/GetEventResultsHandler.ts";
import { GetSeasonArchiveHandler } from "./handlers/GetSeasonArchiveHandler.ts";

/** Dispatcher for the results-public service. */
export class ResultsPublicRouter {
  private readonly repo: ResultsPublicRepository;

  /**
   * @param repo - Results-public data access. Defaults to the Supabase-
   * backed implementation; tests may inject a stub.
   */
  constructor(
    repo: ResultsPublicRepository = new SupabaseResultsPublicRepository(),
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

    if (request.method !== "GET") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const url = new URL(request.url);
    const eventId = url.searchParams.get("event");
    const seasonId = url.searchParams.get("season");

    try {
      if (eventId) {
        return await new GetEventResultsHandler(this.repo).handle(eventId);
      }
      return await new GetSeasonArchiveHandler(this.repo).handle(
        seasonId,
        url.searchParams.get("limit"),
        url.searchParams.get("before"),
      );
    } catch (error) {
      console.error("results-public error:", error);
      return jsonResponse({ error: "Internal server error" }, 500);
    }
  }
}
