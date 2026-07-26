// -----------------------------------------------------------------------------
// match-access/index.ts
//
// Organiser-only service for minting, revoking, and listing operator match
// codes. Every route is gated by `requireOrganiser`. The raw code is emitted
// exactly ONCE — in the mint response — and never again; the DB stores only
// its SHA-256 hash.
//
// Routes:
//   POST   /match-access                     Mint a code for a fixture
//   POST   /match-access/:id/revoke          Revoke a code (idempotent)
//   GET    /match-access?fixture=<uuid>      List codes for a fixture
//
// See docs/decisions/0002-operator-access-model-v2.md for why we hold codes
// in a table rather than issuing JWTs.
// -----------------------------------------------------------------------------

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { isAuthFailure, requireOrganiser } from "../_shared/auth.ts";
import { createServiceClient } from "../_shared/supabase-client.ts";
import { isUuid, nonEmptyString, readJson } from "../_shared/validate.ts";
import {
  generateMatchCode,
  hashMatchCode,
} from "../_shared/match-token.ts";
import {
  findAccess,
  insertAccess,
  listAccessForFixture,
  loadFixture,
  revokeAccess,
} from "./db.ts";

/** Bounds on the caller-supplied TTL (minutes). Refuses anything outside. */
const TTL_MIN_MINUTES = 15;
const TTL_MAX_MINUTES = 720; // 12 hours — plenty of slack for a Monday night
const TTL_DEFAULT_MINUTES = 240; // 4 hours

/** Max length of the human label the organiser attaches to a code. */
const LABEL_MAX_LEN = 80;

/** Fixture statuses that refuse to accept a fresh mint. */
const NON_MINTABLE_STATUSES = new Set(["complete", "cancelled"]);

interface MintBody {
  fixture_id?: unknown;
  ttl_minutes?: unknown;
  label?: unknown;
}

/**
 * Split the URL path relative to this function's mount point.
 *
 * @param request - The incoming request.
 * @returns Path segments after `match-access`.
 */
function subPath(request: Request): string[] {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  const idx = parts.lastIndexOf("match-access");
  return idx >= 0 ? parts.slice(idx + 1) : parts;
}

/**
 * Mint a new match code for a fixture. The raw code is generated, hashed,
 * and stored — then the raw form is returned to the caller in the response
 * and never persisted server-side.
 *
 * @param request - The incoming request.
 * @param createdBy - Organiser user id (from the auth guard).
 * @returns 201 with `{ id, fixture_id, code, expires_at, label }` on
 *          success; 400 on validation failure; 404 when the fixture
 *          doesn't exist; 409 when the fixture is complete/cancelled.
 */
async function handleMint(
  request: Request,
  createdBy: string,
): Promise<Response> {
  const body = await readJson<MintBody>(request);
  if (!body || typeof body !== "object") {
    return jsonResponse({ error: "Request body must be JSON" }, 400);
  }
  if (!isUuid(body.fixture_id)) {
    return jsonResponse({ error: "fixture_id must be a UUID" }, 400);
  }
  const fixtureId = body.fixture_id as string;

  const ttlMinutes = resolveTtlMinutes(body.ttl_minutes);
  if (ttlMinutes === "invalid") {
    return jsonResponse({
      error:
        `ttl_minutes must be an integer in [${TTL_MIN_MINUTES}, ${TTL_MAX_MINUTES}]`,
    }, 400);
  }

  let label: string | null = null;
  if (body.label !== undefined && body.label !== null) {
    const cleaned = nonEmptyString(body.label, LABEL_MAX_LEN);
    if (!cleaned) {
      return jsonResponse({
        error: `label must be a non-empty string up to ${LABEL_MAX_LEN} chars`,
      }, 400);
    }
    label = cleaned;
  }

  const supabase = createServiceClient();

  const fixture = await loadFixture(supabase, fixtureId);
  if (!fixture) return jsonResponse({ error: "Fixture not found" }, 404);
  if (NON_MINTABLE_STATUSES.has(fixture.status)) {
    return jsonResponse({
      error: `Cannot mint a code for a ${fixture.status} fixture`,
    }, 409);
  }

  // Generate the raw code, hash it, and stash the hash. If a caller ever
  // hits a (statistically impossible) collision, the insert will fail on
  // the unique index — we'd rather see that error than silently paper over
  // it, so we let it bubble.
  const code = generateMatchCode();
  const codeHash = await hashMatchCode(code);
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();

  const inserted = await insertAccess(supabase, {
    fixture_id: fixtureId,
    code_hash: codeHash,
    label,
    expires_at: expiresAt,
    created_by: createdBy,
  });

  return jsonResponse({
    id: inserted.id,
    fixture_id: fixtureId,
    code,
    expires_at: inserted.expires_at,
    label,
  }, 201);
}

/**
 * Revoke a code by id. Idempotent — revoking an already-revoked code
 * returns 200 with the original revoked_at timestamp; the caller does
 * not need to check ahead.
 *
 * @param id - UUID of the match_access row.
 * @returns 200 on success (whether newly revoked or already revoked);
 *          404 when the id doesn't exist; 400 for a malformed id.
 */
async function handleRevoke(id: string): Promise<Response> {
  if (!isUuid(id)) {
    return jsonResponse({ error: "Invalid match_access id" }, 400);
  }

  const supabase = createServiceClient();
  const existing = await findAccess(supabase, id);
  if (!existing) {
    return jsonResponse({ error: "Match access not found" }, 404);
  }

  const revokedAt = await revokeAccess(supabase, id);
  return jsonResponse({
    id,
    revoked_at: revokedAt,
    already_revoked: existing.revoked_at !== null,
  });
}

/**
 * List codes for a fixture. Returns metadata only — never the raw code or
 * its hash — plus a derived `active` boolean so the UI doesn't have to
 * duplicate the "not revoked and not expired" logic.
 *
 * @param fixtureId - UUID of the fixture.
 * @returns 200 with `{ codes: [...] }`; 400 when the query param is missing.
 */
async function handleList(fixtureId: string | null): Promise<Response> {
  if (!fixtureId || !isUuid(fixtureId)) {
    return jsonResponse({
      error: "Query param 'fixture' (uuid) is required",
    }, 400);
  }
  const supabase = createServiceClient();
  const rows = await listAccessForFixture(supabase, fixtureId);
  const now = Date.now();
  const codes = rows.map((r) => ({
    id: r.id,
    fixture_id: r.fixture_id,
    label: r.label,
    expires_at: r.expires_at,
    revoked_at: r.revoked_at,
    last_used_at: r.last_used_at,
    active: r.revoked_at === null && new Date(r.expires_at).getTime() > now,
  }));
  return jsonResponse({ codes });
}

/**
 * Resolve the caller-supplied `ttl_minutes` field into a validated integer.
 * Defaults to `TTL_DEFAULT_MINUTES` when omitted.
 *
 * @param raw - Any value from the request body.
 * @returns The resolved minute count, or `"invalid"` when out of range /
 *          not an integer.
 */
function resolveTtlMinutes(raw: unknown): number | "invalid" {
  if (raw === undefined || raw === null) return TTL_DEFAULT_MINUTES;
  if (typeof raw !== "number" || !Number.isInteger(raw)) return "invalid";
  if (raw < TTL_MIN_MINUTES || raw > TTL_MAX_MINUTES) return "invalid";
  return raw;
}

serve(async (request) => {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireOrganiser(request);
  if (isAuthFailure(auth)) return auth;

  const segments = subPath(request);

  try {
    // Collection: /match-access
    if (segments.length === 0) {
      if (request.method === "GET") {
        const fixture = new URL(request.url).searchParams.get("fixture");
        return await handleList(fixture);
      }
      if (request.method === "POST") {
        return await handleMint(request, auth.id);
      }
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    // Item action: /match-access/:id/revoke
    if (
      segments.length === 2 && segments[1] === "revoke" &&
      request.method === "POST"
    ) {
      return await handleRevoke(segments[0]);
    }

    return jsonResponse({ error: "Not found" }, 404);
  } catch (error) {
    console.error("match-access error:", error);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
