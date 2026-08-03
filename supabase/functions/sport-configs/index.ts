// -----------------------------------------------------------------------------
// sport-configs/index.ts
//
// Organiser-only CRUD for `sport_configs`. Lets an organiser configure a
// sport (increments, period structure, standings rules) without a
// migration. Validation is deliberately strict: a bad config accepted here
// corrupts BOTH the scoring screen (via deriveScore/validate-event) and
// the standings table (via computeStandings), so it's much cheaper to
// reject on the write path than to debug the read path later.
//
// Routes (all require Authorization: Bearer <jwt>):
//   GET    /sport-configs?season=<uuid>
//   POST   /sport-configs                  Upsert on (season_id, sport)
//   PATCH  /sport-configs/:id              Partial update of the config
//   DELETE /sport-configs/:id
// -----------------------------------------------------------------------------

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { createServiceClient } from "../_shared/supabase-client.ts";
import { isAuthFailure, requireOrganiser } from "../_shared/auth.ts";
import { isUuid, nonEmptyString, readJson } from "../_shared/validate.ts";
import { validateConfig } from "./validate-config.ts";

/** Body of a POST /sport-configs (upsert on season+sport). */
interface UpsertBody {
  season_id?: unknown;
  sport?: unknown;
  config?: unknown;
}

/** Body of a PATCH /sport-configs/:id (partial). */
interface PatchBody {
  sport?: unknown;
  config?: unknown;
}

/**
 * Split the URL path relative to this function's mount point.
 *
 * @param request - The incoming request.
 * @returns Path segments after `sport-configs`.
 */
function subPath(request: Request): string[] {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  const idx = parts.lastIndexOf("sport-configs");
  return idx >= 0 ? parts.slice(idx + 1) : parts;
}

serve(async (request) => {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireOrganiser(request);
  if (isAuthFailure(auth)) return auth;

  const supabase = createServiceClient();
  const segments = subPath(request);

  try {
    // Collection: /sport-configs
    if (segments.length === 0) {
      if (request.method === "GET") {
        const seasonId = new URL(request.url).searchParams.get("season");
        if (!seasonId || !isUuid(seasonId)) {
          return jsonResponse({
            error: "Query param 'season' (uuid) is required",
          }, 400);
        }
        const { data, error } = await supabase
          .from("sport_configs")
          .select("id, season_id, sport, config, created_at, updated_at")
          .eq("season_id", seasonId)
          .order("sport", { ascending: true });
        if (error) throw error;
        return jsonResponse({ sport_configs: data });
      }

      if (request.method === "POST") {
        const body = await readJson<UpsertBody>(request);
        if (!body) {
          return jsonResponse({ error: "Request body must be JSON" }, 400);
        }
        if (!isUuid(body.season_id)) {
          return jsonResponse({ error: "season_id must be a UUID" }, 400);
        }
        const sport = nonEmptyString(body.sport, 60);
        if (!sport) {
          return jsonResponse(
            { error: "sport must be a non-empty string" },
            400,
          );
        }
        const parsed = validateConfig(body.config);
        if (!parsed.ok) return jsonResponse({ error: parsed.error }, 400);

        const { data, error } = await supabase
          .from("sport_configs")
          .upsert(
            {
              season_id: body.season_id as string,
              sport,
              config: parsed.value,
            },
            { onConflict: "season_id,sport" },
          )
          .select()
          .single();
        if (error) throw error;
        return jsonResponse({ sport_config: data }, 201);
      }

      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    // Item: /sport-configs/:id
    const [id] = segments;
    if (!isUuid(id)) {
      return jsonResponse({ error: "Invalid sport_config id" }, 400);
    }

    if (request.method === "PATCH") {
      const body = await readJson<PatchBody>(request);
      if (!body) {
        return jsonResponse({ error: "Request body must be JSON" }, 400);
      }

      const patch: Record<string, unknown> = {};
      if (body.sport !== undefined) {
        const s = nonEmptyString(body.sport, 60);
        if (!s) return jsonResponse({ error: "sport must be non-empty" }, 400);
        patch.sport = s;
      }
      if (body.config !== undefined) {
        const parsed = validateConfig(body.config);
        if (!parsed.ok) return jsonResponse({ error: parsed.error }, 400);
        patch.config = parsed.value;
      }
      if (Object.keys(patch).length === 0) {
        return jsonResponse({ error: "No updatable fields provided" }, 400);
      }

      const { data, error } = await supabase
        .from("sport_configs")
        .update(patch)
        .eq("id", id)
        .select()
        .maybeSingle();
      if (error) throw error;
      if (!data) return jsonResponse({ error: "Sport config not found" }, 404);
      return jsonResponse({ sport_config: data });
    }

    if (request.method === "DELETE") {
      const { data, error } = await supabase
        .from("sport_configs")
        .delete()
        .eq("id", id)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!data) return jsonResponse({ error: "Sport config not found" }, 404);
      return jsonResponse({ deleted: data.id });
    }

    return jsonResponse({ error: "Method not allowed" }, 405);
  } catch (error) {
    console.error("sport-configs error:", error);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
