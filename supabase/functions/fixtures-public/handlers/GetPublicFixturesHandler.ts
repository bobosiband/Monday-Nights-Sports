// -----------------------------------------------------------------------------
// fixtures-public/handlers/GetPublicFixturesHandler.ts
//
// Handles GET /fixtures-public?event=<uuid>[&format=html|text|json].
// -----------------------------------------------------------------------------

import { corsHeaders, jsonResponse } from "../lib/Cors.ts";
import type { FixturesPublicRepository } from "../data/FixturesPublicRepository.ts";
import { renderHtml, renderText } from "../rendering/FixturesRenderer.ts";

/** Handler for `GET /fixtures-public`. */
export class GetPublicFixturesHandler {
  /**
   * @param repo - Fixtures-public data access.
   */
  constructor(private readonly repo: FixturesPublicRepository) {}

  /**
   * @param request - Incoming request. Reads `event` and optional `format`
   * from the query string.
   * @returns One of: 200 HTML, 200 text, 200 JSON, 400 missing param,
   * 404 not-found/unpublished.
   */
  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const eventId = url.searchParams.get("event");
    const format = url.searchParams.get("format") ?? "html";

    if (!eventId) {
      return jsonResponse(
        { error: "Missing required query param: event" },
        400,
      );
    }

    const result = await this.repo.loadPublicEvent(eventId);
    if (!result) {
      return jsonResponse(
        { error: "Event not found or not published" },
        404,
      );
    }

    if (format === "json") {
      return jsonResponse({
        event: result.event,
        fixtures: result.fixtures,
      });
    }

    if (format === "text") {
      return new Response(renderText(result.event, result.fixtures), {
        status: 200,
        headers: {
          ...corsHeaders,
          "content-type": "text/plain; charset=utf-8",
        },
      });
    }

    return new Response(renderHtml(result.event, result.fixtures), {
      status: 200,
      headers: {
        ...corsHeaders,
        "content-type": "text/html; charset=utf-8",
      },
    });
  }
}
