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
 * Validation result shape used everywhere: `{ ok: true, value }` or
 * `{ ok: false, error }`. Consistent with `_shared/validate.ts`.
 */
type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Deep-validate a `config` JSONB blob before we let it into the DB. The
 * pure-scoring / pure-standings code both tolerate empty or partial
 * configs (deriveScore doesn't crash on missing keys), so we only fail
 * writes whose values are *actively wrong*. This is a tradeoff: strict
 * where a bad value would silently corrupt a table, permissive where
 * absence is fine.
 *
 * Rules:
 *   - `periods.count`   — positive integer.
 *   - `periods.minutes` — positive integer (when present).
 *   - `periods.direction` — must be 'up' or 'down' (when present).
 *   - `score_increments` — non-empty array of positive integers.
 *   - `track_fouls` — boolean (when present).
 *   - `standings.points` — object with `win`, `draw`, `loss` each a
 *     non-negative integer.
 *   - `standings.tiebreakers` — array of strings (unknown names are
 *     tolerated by the computer, so we don't gate on the specific
 *     spellings — only that the field is well-typed).
 *
 * @param raw - The `config` value from the request body.
 * @returns Either the accepted config (typed loosely as an object) or an
 *          error message suitable for a 400.
 */
function validateConfig(raw: unknown): Validated<Record<string, unknown>> {
  if (raw === null || raw === undefined || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "config must be a JSON object" };
  }
  const config = raw as Record<string, unknown>;

  if ("periods" in config) {
    const p = config.periods;
    if (!p || typeof p !== "object" || Array.isArray(p)) {
      return { ok: false, error: "periods must be an object" };
    }
    const pp = p as Record<string, unknown>;
    if (!Number.isInteger(pp.count) || (pp.count as number) <= 0) {
      return { ok: false, error: "periods.count must be a positive integer" };
    }
    if ("minutes" in pp && (!Number.isInteger(pp.minutes) || (pp.minutes as number) <= 0)) {
      return { ok: false, error: "periods.minutes must be a positive integer" };
    }
    if ("direction" in pp && pp.direction !== "up" && pp.direction !== "down") {
      return { ok: false, error: "periods.direction must be 'up' or 'down'" };
    }
  }

  if ("score_increments" in config) {
    const inc = config.score_increments;
    if (!Array.isArray(inc) || inc.length === 0) {
      return { ok: false, error: "score_increments must be a non-empty array" };
    }
    for (const v of inc) {
      if (!Number.isInteger(v) || (v as number) <= 0) {
        return { ok: false, error: "score_increments entries must be positive integers" };
      }
    }
  }

  if ("track_fouls" in config && typeof config.track_fouls !== "boolean") {
    return { ok: false, error: "track_fouls must be a boolean" };
  }

  if ("standings" in config) {
    const s = config.standings;
    if (!s || typeof s !== "object" || Array.isArray(s)) {
      return { ok: false, error: "standings must be an object" };
    }
    const ss = s as Record<string, unknown>;
    if ("points" in ss) {
      const pts = ss.points;
      if (!pts || typeof pts !== "object" || Array.isArray(pts)) {
        return { ok: false, error: "standings.points must be an object" };
      }
      for (const key of ["win", "draw", "loss"] as const) {
        const v = (pts as Record<string, unknown>)[key];
        if (!Number.isInteger(v) || (v as number) < 0) {
          return {
            ok: false,
            error: `standings.points.${key} must be a non-negative integer`,
          };
        }
      }
    }
    if ("tiebreakers" in ss) {
      const tb = ss.tiebreakers;
      if (!Array.isArray(tb) || tb.some((t) => typeof t !== "string")) {
        return { ok: false, error: "standings.tiebreakers must be an array of strings" };
      }
    }
  }

  return { ok: true, value: config };
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
        if (!body) return jsonResponse({ error: "Request body must be JSON" }, 400);
        if (!isUuid(body.season_id)) {
          return jsonResponse({ error: "season_id must be a UUID" }, 400);
        }
        const sport = nonEmptyString(body.sport, 60);
        if (!sport) {
          return jsonResponse({ error: "sport must be a non-empty string" }, 400);
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
      if (!body) return jsonResponse({ error: "Request body must be JSON" }, 400);

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
