// -----------------------------------------------------------------------------
// fixtures-public/FixturesPublicRouter.ts
//
// Router for the fixtures-public service. One live route.
//
// Routes (no authentication; RLS gates on `events.is_published = true`):
//   OPTIONS   *                              204 CORS preflight
//   GET       /fixtures-public?event=<uuid>  HTML (default)
//                                 &format=text   plain text (chat-friendly)
//                                 &format=json   JSON (debug / integrators)
//   any other method                         405 JSON
// -----------------------------------------------------------------------------

import { handlePreflight, jsonResponse } from "./lib/Cors.ts";
import {
  type FixturesPublicRepository,
  SupabaseFixturesPublicRepository,
} from "./data/FixturesPublicRepository.ts";
import { GetPublicFixturesHandler } from "./handlers/GetPublicFixturesHandler.ts";

/** Dispatcher for the fixtures-public service. */
export class FixturesPublicRouter {
  private readonly repo: FixturesPublicRepository;

  /**
   * @param repo - Fixtures-public data access. Defaults to the Supabase-
   * backed implementation; tests may inject a stub.
   */
  constructor(
    repo: FixturesPublicRepository = new SupabaseFixturesPublicRepository(),
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

    try {
      return await new GetPublicFixturesHandler(this.repo).handle(request);
    } catch (error) {
      console.error("fixtures-public error:", error);
      return jsonResponse({ error: "Internal server error" }, 500);
    }
  }
}
