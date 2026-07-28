// -----------------------------------------------------------------------------
// scoring/guard.ts
//
// Match-code verification for the scoring service. Every write route funnels
// through `verifyMatchToken` before touching the DB.
//
// Verification is a single indexed lookup on `match_access.code_hash`:
//
//   1. Pull the bearer value off the Authorization header.
//   2. Normalise (upper-case, strip whitespace/dashes) and SHA-256 hash it.
//   3. Look the hash up in `match_access`.
//   4. Reject with the right status:
//        - missing / malformed header      → 401
//        - no match, expired, or revoked   → 401
//        - row found but wrong fixture     → 403
//   5. On success, return `{ fixture_id, access_id }` and fire-and-forget
//      an update of `last_used_at` — we do NOT let that write's latency or
//      failure delay the scoring response.
//
// No escape hatch: every write path is cryptographically bound to a real
// `match_access` row. Local development mints codes via the seeded
// `DEVCODE1` (see supabase/seed.sql) or via POST /match-access.
// -----------------------------------------------------------------------------

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { createServiceClient } from "../_shared/supabase-client.ts";
import { extractBearer, hashMatchCode } from "../_shared/match-token.ts";
import { forbidden, unauthorized } from "./errors.ts";

/**
 * The row returned by verification on the happy path. Exposes only the
 * ids the handlers need — never the code hash.
 */
export interface MatchAccessContext {
  /** The fixture the token authorises writes for. */
  fixture_id: string;
  /** The match_access row id — for future attribution on match_events. */
  access_id: string;
}

/** DB row shape used internally. */
interface MatchAccessRow {
  id: string;
  fixture_id: string;
  expires_at: string;
  revoked_at: string | null;
}

/**
 * Verify the caller's match code against the DB. On success returns the
 * access context; on failure returns a `Response` the router should return
 * unchanged.
 *
 * The `lookup` seam is a testing hook — production always uses the real
 * DB lookup. Tests supply a fake so they don't need a live Postgres.
 *
 * @param request - The incoming request.
 * @param fixtureId - The fixture id the URL claims to target.
 * @param lookup - Injectable code-hash lookup. Defaults to the DB path.
 * @returns The access context on success, or a `Response` on failure.
 */
export async function verifyMatchToken(
  request: Request,
  fixtureId: string,
  lookup: (codeHash: string) => Promise<MatchAccessRow | null> =
    defaultLookup,
): Promise<MatchAccessContext | Response> {
  const bearer = extractBearer(request);
  if (!bearer) return unauthorized("Missing match code");

  const codeHash = await hashMatchCode(bearer);
  const row = await lookup(codeHash);
  if (!row) return unauthorized("Invalid match code");

  const now = Date.now();
  if (row.revoked_at !== null) return unauthorized("Match code revoked");
  if (new Date(row.expires_at).getTime() <= now) {
    return unauthorized("Match code expired");
  }

  // Fixture scope check: a valid code for fixture A must NOT be usable
  // against fixture B. Anything else is a 403 — the credential is real,
  // just not for this resource.
  if (row.fixture_id !== fixtureId) {
    return forbidden("Match code does not authorise this fixture");
  }

  // Fire-and-forget last-used bump. The scoring write's success does NOT
  // depend on this landing, and we swallow errors — this is telemetry,
  // not a serialisation point.
  void touchLastUsed(row.id).catch((err) => {
    console.warn("match_access last_used_at update failed:", err);
  });

  return { fixture_id: row.fixture_id, access_id: row.id };
}

/**
 * Default lookup: real DB read against `match_access`.
 *
 * @param codeHash - SHA-256 hex of the normalised code.
 * @returns The row, or null when no code matches.
 */
async function defaultLookup(
  codeHash: string,
): Promise<MatchAccessRow | null> {
  const supabase = createServiceClient();
  return await lookupCode(supabase, codeHash);
}

/**
 * Query `match_access` by `code_hash`. Extracted so tests can share the
 * shape without duplicating the SQL.
 *
 * @param supabase - Service-role client.
 * @param codeHash - SHA-256 hex.
 * @returns Row or null.
 */
async function lookupCode(
  supabase: SupabaseClient,
  codeHash: string,
): Promise<MatchAccessRow | null> {
  const { data, error } = await supabase
    .from("match_access")
    .select("id, fixture_id, expires_at, revoked_at")
    .eq("code_hash", codeHash)
    .maybeSingle();
  if (error) throw error;
  return (data as MatchAccessRow | null) ?? null;
}

/**
 * Bump `last_used_at` on the access row. Runs after a successful verify
 * without blocking the response.
 *
 * @param accessId - Match_access row id.
 */
async function touchLastUsed(accessId: string): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("match_access")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", accessId);
  if (error) throw error;
}
