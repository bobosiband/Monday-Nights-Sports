// -----------------------------------------------------------------------------
// live/LiveRouter.ts
//
// Router for the public live-score endpoint.
//
// Routes (no authentication; RLS gates on `events.is_published = true`):
//   OPTIONS   *                           204 CORS preflight
//   GET       /live/:fixtureId            one fixture's live summary
//   GET       /live?event=<uuid>          every fixture in a published event
//   any other method                      405 JSON
//
// Each JSON response includes a `realtime` object naming the Supabase
// Realtime channel/filter a client should subscribe to; see
// `docs/realtime.md` for the full protocol.
// -----------------------------------------------------------------------------

import { handlePreflight, jsonResponse } from "./lib/Cors.ts";
import { subPath } from "./lib/HttpHelpers.ts";
import {
  type LiveRepository,
  SupabaseLiveRepository,
} from "./data/LiveRepository.ts";
import { GetFixtureLiveHandler } from "./handlers/GetFixtureLiveHandler.ts";
import { GetEventLiveHandler } from "./handlers/GetEventLiveHandler.ts";

/** Dispatcher for the live service. */
export class LiveRouter {
  private readonly repo: LiveRepository;

  /**
   * @param repo - Live data access. Defaults to the Supabase-backed
   * implementation; tests may inject a stub.
   */
  constructor(repo: LiveRepository = new SupabaseLiveRepository()) {
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

    const segments = subPath(request, "live");
    try {
      if (segments.length === 1) {
        return await new GetFixtureLiveHandler(this.repo).handle(segments[0]);
      }
      if (segments.length === 0) {
        const eventId = new URL(request.url).searchParams.get("event");
        if (!eventId) {
          return jsonResponse(
            { error: "Provide /live/:fixtureId or /live?event=<uuid>" },
            400,
          );
        }
        return await new GetEventLiveHandler(this.repo).handle(eventId);
      }
      return jsonResponse({ error: "Not found" }, 404);
    } catch (error) {
      console.error("live error:", error);
      return jsonResponse({ error: "Internal server error" }, 500);
    }
  }
}
