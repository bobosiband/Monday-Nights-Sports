// -----------------------------------------------------------------------------
// teams/index.ts
//
// Organiser-only management of teams within a season. Every route is gated
// by `requireOrganiser`. Player management is deferred to Sprint 4 (optional
// scorer attribution only); the `players` table stays in the schema as a
// dormant hook.
//
// Routes (all require Authorization: Bearer <jwt>):
//   POST   /teams                          Create a team in a season
//   GET    /teams?season=<uuid>            List teams for a season
//   PATCH  /teams/:id                      Rename a team
//   DELETE /teams/:id                      Remove a team
//   POST   /teams/bulk                     Bulk-add teams from a pasted list
// -----------------------------------------------------------------------------

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { createServiceClient } from "../_shared/supabase-client.ts";
import { isAuthFailure, requireOrganiser } from "../_shared/auth.ts";

interface CreateTeamBody {
  season_id?: unknown;
  name?: unknown;
}

interface RenameTeamBody {
  name?: unknown;
}

interface BulkAddBody {
  season_id?: unknown;
  names?: unknown;
}

/**
 * Split the URL pathname into the sub-path relative to this function.
 * Anchors on the `teams` segment so mount-point differences don't matter.
 *
 * @param request - The incoming request.
 * @returns The path segments after `teams` (empty for the collection).
 */
function subPath(request: Request): string[] {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  const idx = parts.lastIndexOf("teams");
  return idx >= 0 ? parts.slice(idx + 1) : parts;
}

/**
 * Parse a JSON body defensively.
 *
 * @param request - The incoming request.
 * @returns The parsed body or `null`.
 */
async function readJson<T>(request: Request): Promise<T | null> {
  try {
    if (!request.body) return null;
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Non-empty trimmed string validator.
 *
 * @param value - Any value.
 * @param max - Maximum length after trim.
 * @returns Trimmed string, or `null`.
 */
function nonEmptyString(value: unknown, max = 120): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

/**
 * UUID (v4-ish) validator.
 *
 * @param value - Any value.
 * @returns `true` if the string looks like a UUID.
 */
function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
      .test(value);
}

/**
 * Dedupe a list of proposed team names case-insensitively while preserving
 * the caller's chosen casing for the first occurrence. Returns both the
 * deduped list and any duplicates dropped so the response can echo them.
 *
 * @param names - Raw candidate names.
 * @returns `{ unique, dropped }` — `dropped` is the case-preserved names
 *          that were duplicates of earlier entries.
 */
function dedupeCaseInsensitive(
  names: string[],
): { unique: string[]; dropped: string[] } {
  const seen = new Set<string>();
  const unique: string[] = [];
  const dropped: string[] = [];
  for (const n of names) {
    const key = n.toLowerCase();
    if (seen.has(key)) {
      dropped.push(n);
      continue;
    }
    seen.add(key);
    unique.push(n);
  }
  return { unique, dropped };
}

serve(async (request) => {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireOrganiser(request);
  if (isAuthFailure(auth)) return auth;

  const supabase = createServiceClient();
  const segments = subPath(request);

  try {
    // Collection routes: /teams
    if (segments.length === 0) {
      if (request.method === "GET") {
        const seasonId = new URL(request.url).searchParams.get("season");
        if (!seasonId || !isUuid(seasonId)) {
          return jsonResponse({
            error: "Query param 'season' (uuid) is required",
          }, 400);
        }
        const { data, error } = await supabase
          .from("teams")
          .select("id, season_id, name, created_at")
          .eq("season_id", seasonId)
          .order("name", { ascending: true });
        if (error) throw error;
        return jsonResponse({ teams: data });
      }

      if (request.method === "POST") {
        const body = await readJson<CreateTeamBody>(request);
        if (!body) {
          return jsonResponse({ error: "Request body must be JSON" }, 400);
        }
        if (!isUuid(body.season_id)) {
          return jsonResponse({ error: "season_id must be a uuid" }, 400);
        }
        const name = nonEmptyString(body.name);
        if (!name) return jsonResponse({ error: "name is required" }, 400);

        // Pre-check duplicates so we return a clean 409 instead of the raw
        // DB unique-constraint error surface.
        const { data: dupe, error: dupeErr } = await supabase
          .from("teams")
          .select("id")
          .eq("season_id", body.season_id)
          .ilike("name", name)
          .maybeSingle();
        if (dupeErr) throw dupeErr;
        if (dupe) {
          return jsonResponse({
            error: `Team '${name}' already exists in this season`,
          }, 409);
        }

        const { data, error } = await supabase
          .from("teams")
          .insert({ season_id: body.season_id, name })
          .select()
          .single();
        if (error) throw error;
        return jsonResponse({ team: data }, 201);
      }

      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    // Bulk route: /teams/bulk
    if (segments.length === 1 && segments[0] === "bulk") {
      if (request.method !== "POST") {
        return jsonResponse({ error: "Method not allowed" }, 405);
      }
      const body = await readJson<BulkAddBody>(request);
      if (!body) {
        return jsonResponse({ error: "Request body must be JSON" }, 400);
      }
      if (!isUuid(body.season_id)) {
        return jsonResponse({ error: "season_id must be a uuid" }, 400);
      }
      if (!Array.isArray(body.names) || body.names.length === 0) {
        return jsonResponse({
          error: "names must be a non-empty array of strings",
        }, 400);
      }

      const cleaned: string[] = [];
      for (const n of body.names) {
        const c = nonEmptyString(n);
        if (!c) {
          return jsonResponse({
            error: "Every name must be a non-empty string",
          }, 400);
        }
        cleaned.push(c);
      }

      const { unique, dropped: droppedInInput } = dedupeCaseInsensitive(
        cleaned,
      );

      const { data: existingRows, error: existingErr } = await supabase
        .from("teams")
        .select("name")
        .eq("season_id", body.season_id);
      if (existingErr) throw existingErr;
      const existingLower = new Set(
        (existingRows ?? []).map((r) =>
          (r as { name: string }).name.toLowerCase()
        ),
      );

      const toInsert: string[] = [];
      const droppedExisting: string[] = [];
      for (const n of unique) {
        if (existingLower.has(n.toLowerCase())) {
          droppedExisting.push(n);
        } else {
          toInsert.push(n);
        }
      }

      let inserted: unknown[] = [];
      if (toInsert.length > 0) {
        const rows = toInsert.map((name) => ({
          season_id: body.season_id as string,
          name,
        }));
        const { data, error } = await supabase.from("teams").insert(rows)
          .select();
        if (error) throw error;
        inserted = data ?? [];
      }

      return jsonResponse({
        inserted,
        skipped_duplicates_in_input: droppedInInput,
        skipped_existing_in_season: droppedExisting,
      }, 201);
    }

    // Item routes: /teams/:id
    const [id, action] = segments;
    if (!isUuid(id)) return jsonResponse({ error: "Invalid team id" }, 400);
    if (action) return jsonResponse({ error: "Unknown action" }, 404);

    if (request.method === "PATCH") {
      const body = await readJson<RenameTeamBody>(request);
      const name = body ? nonEmptyString(body.name) : null;
      if (!name) return jsonResponse({ error: "name is required" }, 400);

      const { data: current, error: currentErr } = await supabase
        .from("teams")
        .select("id, season_id, name")
        .eq("id", id)
        .maybeSingle();
      if (currentErr) throw currentErr;
      if (!current) return jsonResponse({ error: "Team not found" }, 404);

      if (current.name.toLowerCase() !== name.toLowerCase()) {
        const { data: dupe, error: dupeErr } = await supabase
          .from("teams")
          .select("id")
          .eq("season_id", current.season_id)
          .ilike("name", name)
          .maybeSingle();
        if (dupeErr) throw dupeErr;
        if (dupe) {
          return jsonResponse({
            error: `Team '${name}' already exists in this season`,
          }, 409);
        }
      }

      const { data, error } = await supabase
        .from("teams")
        .update({ name })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return jsonResponse({ team: data });
    }

    if (request.method === "DELETE") {
      const { data, error } = await supabase
        .from("teams")
        .delete()
        .eq("id", id)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!data) return jsonResponse({ error: "Team not found" }, 404);
      return jsonResponse({ deleted: data.id });
    }

    return jsonResponse({ error: "Method not allowed" }, 405);
  } catch (error) {
    console.error("teams error:", error);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
