// -----------------------------------------------------------------------------
// standings/index.ts
//
// Public standings endpoint — skeleton returning an empty table so callers
// can wire against the URL and payload shape. Real computation lands per
// story:
//   #43 standings calc library (config-driven) + unit tests
//   #44 GET /standings?season=<uuid> public (this file becomes real)
//
// Routes:
//   GET /standings?season=<uuid>
// -----------------------------------------------------------------------------

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";

serve((request) => {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  if (request.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const seasonId = new URL(request.url).searchParams.get("season");
  if (!seasonId) {
    return jsonResponse({ error: "Missing required query param: season" }, 400);
  }

  // TODO(#43, #44): fetch results + sport_configs for the season, run
  // computeStandings per sport, return grouped payload.
  return jsonResponse({
    season: seasonId,
    standings_by_sport: {},
  });
});
