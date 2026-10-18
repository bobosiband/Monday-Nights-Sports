// -----------------------------------------------------------------------------
// match-access/MatchAccessRouter.ts
//
// Router for the match-access service. Every route is organiser-gated.
//
// Routes (all require Authorization: Bearer <jwt>):
//   OPTIONS   *                                      204 CORS preflight
//   POST      /match-access                          mint a code
//   POST      /match-access/:id/revoke               revoke a code
//   GET       /match-access?fixture=<uuid>           list codes for a fixture
//   anything else                                    404/405 JSON
//
// The raw code is returned exactly once by the mint response and never
// persisted; see docs/decisions/0002-operator-access-model-v2.md.
// -----------------------------------------------------------------------------

import { handlePreflight, jsonResponse } from "./lib/Cors.ts";
import { subPath } from "./lib/HttpHelpers.ts";
import { isAuthFailure, requireOrganiser } from "./lib/OrganiserAuthGuard.ts";
import {
  type MatchAccessRepository,
  SupabaseMatchAccessRepository,
} from "./data/MatchAccessRepository.ts";
import { MintMatchCodeHandler } from "./handlers/MintMatchCodeHandler.ts";
import { RevokeMatchCodeHandler } from "./handlers/RevokeMatchCodeHandler.ts";
import { ListMatchCodesHandler } from "./handlers/ListMatchCodesHandler.ts";

/** Dispatcher for the match-access service. */
export class MatchAccessRouter {
  private readonly repo: MatchAccessRepository;

  /**
   * @param repo - Match-access data access.
   */
  constructor(
    repo: MatchAccessRepository = new SupabaseMatchAccessRepository(),
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

    const segments = subPath(request, "match-access");

    try {
      if (segments.length === 0) {
        if (request.method === "GET") {
          const fixture = new URL(request.url).searchParams.get("fixture");
          return await new ListMatchCodesHandler(this.repo).handle(fixture);
        }
        if (request.method === "POST") {
          return await new MintMatchCodeHandler(this.repo).handle(
            request,
            auth.id,
          );
        }
        return jsonResponse({ error: "Method not allowed" }, 405);
      }

      if (
        segments.length === 2 && segments[1] === "revoke" &&
        request.method === "POST"
      ) {
        return await new RevokeMatchCodeHandler(this.repo).handle(
          segments[0],
        );
      }

      return jsonResponse({ error: "Not found" }, 404);
    } catch (error) {
      console.error("match-access error:", error);
      return jsonResponse({ error: "Internal server error" }, 500);
    }
  }
}
