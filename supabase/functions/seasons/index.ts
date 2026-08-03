// -----------------------------------------------------------------------------
// seasons/index.ts
//
// Organiser-only management of seasons. Every route is gated by
// `requireOrganiser`; there is no public read path on this service (the
// public fixtures function reads what it needs directly via RLS).
//
// Routes (all require Authorization: Bearer <jwt>):
//   POST   /seasons                      Create a season
//   GET    /seasons                      List seasons (organiser view)
//   GET    /seasons/:id                  Get one season
//   PATCH  /seasons/:id                  Update fields
//   POST   /seasons/:id/archive          Archive (soft delete)
//   POST   /seasons/:id/activate         Mark as the active season
// -----------------------------------------------------------------------------

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { createServiceClient } from "../_shared/supabase-client.ts";
import { isAuthFailure, requireOrganiser } from "../_shared/auth.ts";

interface CreateSeasonBody {
  name?: unknown;
  sports?: unknown;
  starts_on?: unknown;
  ends_on?: unknown;
  is_active?: unknown;
}

interface UpdateSeasonBody {
  name?: unknown;
  sports?: unknown;
  starts_on?: unknown;
  ends_on?: unknown;
}

interface ValidatedCreate {
  name: string;
  sports: string[];
  starts_on: string;
  ends_on: string;
  is_active: boolean;
}

/**
 * Split the URL pathname into the sub-path relative to this function. The
 * function is mounted at `/functions/v1/seasons`, but the raw request may
 * report the path in different shapes depending on the runtime — so we
 * anchor on the `seasons` segment rather than trusting a specific prefix.
 *
 * @param request - The incoming request.
 * @returns The path segments after `seasons` (empty for the collection).
 */
function subPath(request: Request): string[] {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  const idx = parts.lastIndexOf("seasons");
  return idx >= 0 ? parts.slice(idx + 1) : parts;
}

/**
 * Parse a JSON body defensively. Returns `null` for missing / malformed
 * bodies so callers can 400 without leaking parse errors.
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
 * Check a value is a non-empty trimmed string.
 *
 * @param value - Any value.
 * @returns The trimmed string if valid, otherwise `null`.
 */
function nonEmptyString(value: unknown, max = 200): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

/**
 * ISO date (YYYY-MM-DD) validator. The Postgres `date` type accepts more
 * than this but constraining the API keeps request payloads unambiguous.
 *
 * @param value - Any value.
 * @returns The date string if valid, otherwise `null`.
 */
function isoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : value;
}

/**
 * Validate a create-season payload. Returns either the validated shape or a
 * human-readable error message suitable for a 400.
 *
 * @param body - The parsed JSON body (or `null`).
 * @returns Either `{ ok: true, value }` or `{ ok: false, error }`.
 */
function validateCreate(
  body: CreateSeasonBody | null,
): { ok: true; value: ValidatedCreate } | { ok: false; error: string } {
  if (!body) return { ok: false, error: "Request body must be JSON" };

  const name = nonEmptyString(body.name);
  if (!name) return { ok: false, error: "name is required" };

  if (!Array.isArray(body.sports) || body.sports.length === 0) {
    return { ok: false, error: "sports must be a non-empty array of strings" };
  }
  const sports: string[] = [];
  for (const s of body.sports) {
    const cleaned = nonEmptyString(s, 60);
    if (!cleaned) {
      return { ok: false, error: "sports entries must be non-empty strings" };
    }
    sports.push(cleaned);
  }

  const starts_on = isoDate(body.starts_on);
  if (!starts_on) return { ok: false, error: "starts_on must be YYYY-MM-DD" };
  const ends_on = isoDate(body.ends_on);
  if (!ends_on) return { ok: false, error: "ends_on must be YYYY-MM-DD" };
  if (ends_on < starts_on) {
    return { ok: false, error: "ends_on must be on or after starts_on" };
  }

  const is_active = typeof body.is_active === "boolean"
    ? body.is_active
    : false;

  return { ok: true, value: { name, sports, starts_on, ends_on, is_active } };
}

/**
 * Build a sparse update patch from a PATCH body. Only keys the caller
 * explicitly provided end up in the returned object — undefined fields are
 * left untouched by Postgres.
 *
 * @param body - The parsed JSON body (or `null`).
 * @returns Either `{ ok: true, patch }` or `{ ok: false, error }`.
 */
function validateUpdate(
  body: UpdateSeasonBody | null,
): { ok: true; patch: Record<string, unknown> } | { ok: false; error: string } {
  if (!body) return { ok: false, error: "Request body must be JSON" };
  const patch: Record<string, unknown> = {};

  if (body.name !== undefined) {
    const name = nonEmptyString(body.name);
    if (!name) return { ok: false, error: "name must be a non-empty string" };
    patch.name = name;
  }

  if (body.sports !== undefined) {
    if (!Array.isArray(body.sports) || body.sports.length === 0) {
      return {
        ok: false,
        error: "sports must be a non-empty array of strings",
      };
    }
    const sports: string[] = [];
    for (const s of body.sports) {
      const cleaned = nonEmptyString(s, 60);
      if (!cleaned) {
        return { ok: false, error: "sports entries must be non-empty strings" };
      }
      sports.push(cleaned);
    }
    patch.sports = sports;
  }

  if (body.starts_on !== undefined) {
    const v = isoDate(body.starts_on);
    if (!v) return { ok: false, error: "starts_on must be YYYY-MM-DD" };
    patch.starts_on = v;
  }
  if (body.ends_on !== undefined) {
    const v = isoDate(body.ends_on);
    if (!v) return { ok: false, error: "ends_on must be YYYY-MM-DD" };
    patch.ends_on = v;
  }

  if (Object.keys(patch).length === 0) {
    return { ok: false, error: "No updatable fields provided" };
  }

  return { ok: true, patch };
}

/**
 * UUID (v4-ish) validator. We only need to weed out obviously malformed
 * input before hitting Postgres; the DB will still reject invalid ids.
 *
 * @param value - Any value.
 * @returns `true` if the string looks like a UUID.
 */
function isUuid(value: string): boolean {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
    .test(value);
}

/**
 * Set exactly one season as active. Two updates: unset any currently active
 * season, then set the target. Not atomic — a race between concurrent
 * organiser calls could briefly leave zero active seasons, but the partial
 * unique index still prevents two simultaneously.
 *
 * @param id - Season id to activate.
 * @returns The activated season row, or an error response.
 */
async function activateSeason(id: string): Promise<Response> {
  const supabase = createServiceClient();

  const { data: existing, error: findErr } = await supabase
    .from("seasons")
    .select("id, is_archived")
    .eq("id", id)
    .maybeSingle();
  if (findErr) throw findErr;
  if (!existing) return jsonResponse({ error: "Season not found" }, 404);
  if (existing.is_archived) {
    return jsonResponse({ error: "Cannot activate an archived season" }, 400);
  }

  const { error: unsetErr } = await supabase
    .from("seasons")
    .update({ is_active: false })
    .eq("is_active", true)
    .neq("id", id);
  if (unsetErr) throw unsetErr;

  const { data, error } = await supabase
    .from("seasons")
    .update({ is_active: true })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;

  return jsonResponse({ season: data });
}

/**
 * Archive a season. Also clears `is_active` — an archived season is never
 * active. Idempotent: archiving an already-archived season is a no-op.
 *
 * @param id - Season id to archive.
 * @returns The archived season row, or an error response.
 */
async function archiveSeason(id: string): Promise<Response> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("seasons")
    .update({ is_archived: true, is_active: false })
    .eq("id", id)
    .select()
    .maybeSingle();
  if (error) throw error;
  if (!data) return jsonResponse({ error: "Season not found" }, 404);
  return jsonResponse({ season: data });
}

serve(async (request) => {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireOrganiser(request);
  if (isAuthFailure(auth)) return auth;

  const supabase = createServiceClient();
  const segments = subPath(request);

  try {
    // Collection routes: /seasons
    if (segments.length === 0) {
      if (request.method === "GET") {
        const { data, error } = await supabase
          .from("seasons")
          .select("*")
          .order("starts_on", { ascending: false });
        if (error) throw error;
        return jsonResponse({ seasons: data });
      }

      if (request.method === "POST") {
        const body = await readJson<CreateSeasonBody>(request);
        const parsed = validateCreate(body);
        if (!parsed.ok) return jsonResponse({ error: parsed.error }, 400);

        // If the caller asked for is_active on create, unset any current
        // active season first so the partial unique index doesn't reject.
        if (parsed.value.is_active) {
          const { error: unsetErr } = await supabase
            .from("seasons")
            .update({ is_active: false })
            .eq("is_active", true);
          if (unsetErr) throw unsetErr;
        }

        const { data, error } = await supabase
          .from("seasons")
          .insert({ ...parsed.value, created_by: auth.id })
          .select()
          .single();
        if (error) throw error;
        return jsonResponse({ season: data }, 201);
      }

      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    // Item + action routes: /seasons/:id[/action]
    const [id, action] = segments;
    if (!isUuid(id)) return jsonResponse({ error: "Invalid season id" }, 400);

    if (!action) {
      if (request.method === "GET") {
        const { data, error } = await supabase
          .from("seasons")
          .select("*")
          .eq("id", id)
          .maybeSingle();
        if (error) throw error;
        if (!data) return jsonResponse({ error: "Season not found" }, 404);
        return jsonResponse({ season: data });
      }

      if (request.method === "PATCH") {
        const body = await readJson<UpdateSeasonBody>(request);
        const parsed = validateUpdate(body);
        if (!parsed.ok) return jsonResponse({ error: parsed.error }, 400);

        const { data, error } = await supabase
          .from("seasons")
          .update(parsed.patch)
          .eq("id", id)
          .select()
          .maybeSingle();
        if (error) throw error;
        if (!data) return jsonResponse({ error: "Season not found" }, 404);
        return jsonResponse({ season: data });
      }

      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }
    if (action === "activate") return await activateSeason(id);
    if (action === "archive") return await archiveSeason(id);

    return jsonResponse({ error: "Unknown action" }, 404);
  } catch (error) {
    console.error("seasons error:", error);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
