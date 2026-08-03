// -----------------------------------------------------------------------------
// _tests/scoring/guard.test.ts
//
// Pure-logic tests for the scoring guard. We inject a fake `lookup` so the
// suite stays offline — the DB shape is checked at the integration layer
// (docs/local-setup.md smoke script), not here.
//
// Cases:
//   - missing / malformed Authorization      → 401
//   - unknown code                            → 401
//   - expired code                            → 401
//   - revoked code                            → 401
//   - valid code, wrong fixture               → 403
//   - valid code, right fixture               → passes (returns access_id)
//
// Run with: `deno test --allow-net supabase/functions/_tests/`
// -----------------------------------------------------------------------------

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { verifyMatchToken } from "../../scoring/guard.ts";
import { hashMatchCode } from "../../_shared/match-token.ts";

const FIXTURE = "f0111111-1111-1111-1111-111111111111";
const OTHER_FIXTURE = "f9999999-9999-9999-9999-999999999999";
const ACCESS_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const CODE = "DEVCODE1";

/**
 * Build a Request with a bearer header set. If `code` is undefined, no
 * header is attached — used for the "missing header" case.
 *
 * @param code - Optional bearer value.
 * @returns A Request suitable for the guard.
 */
function req(code?: string): Request {
  const headers: Record<string, string> = {};
  if (code !== undefined) headers.authorization = `Bearer ${code}`;
  return new Request("http://test/scoring/f/start", {
    method: "POST",
    headers,
  });
}

/** A convenience: build a `lookup` that returns a fixed row for one hash. */
function lookupFor(
  expectedHash: string,
  row: {
    id: string;
    fixture_id: string;
    expires_at: string;
    revoked_at: string | null;
  } | null,
): (hash: string) => Promise<typeof row> {
  return (hash) => Promise.resolve(hash === expectedHash ? row : null);
}

// ---------- 401 paths ------------------------------------------------------

Deno.test("guard: missing Authorization header → 401", async () => {
  const res = await verifyMatchToken(
    req(),
    FIXTURE,
    () => Promise.resolve(null),
  );
  if (!(res instanceof Response)) throw new Error("expected Response");
  assertEquals(res.status, 401);
});

Deno.test("guard: malformed header (non-Bearer) → 401", async () => {
  const r = new Request("http://t/", {
    method: "POST",
    headers: { authorization: "Basic dXNlcjpwYXNz" },
  });
  const res = await verifyMatchToken(r, FIXTURE, () => Promise.resolve(null));
  if (!(res instanceof Response)) throw new Error("expected Response");
  assertEquals(res.status, 401);
});

Deno.test("guard: unknown code (hash miss) → 401", async () => {
  const res = await verifyMatchToken(
    req("NOTACODE"),
    FIXTURE,
    () => Promise.resolve(null),
  );
  if (!(res instanceof Response)) throw new Error("expected Response");
  assertEquals(res.status, 401);
});

Deno.test("guard: expired code → 401", async () => {
  const hash = await hashMatchCode(CODE);
  const res = await verifyMatchToken(
    req(CODE),
    FIXTURE,
    lookupFor(hash, {
      id: ACCESS_ID,
      fixture_id: FIXTURE,
      // 1 minute in the past
      expires_at: new Date(Date.now() - 60_000).toISOString(),
      revoked_at: null,
    }),
  );
  if (!(res instanceof Response)) throw new Error("expected Response");
  assertEquals(res.status, 401);
});

Deno.test("guard: revoked code → 401", async () => {
  const hash = await hashMatchCode(CODE);
  const res = await verifyMatchToken(
    req(CODE),
    FIXTURE,
    lookupFor(hash, {
      id: ACCESS_ID,
      fixture_id: FIXTURE,
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      revoked_at: new Date().toISOString(),
    }),
  );
  if (!(res instanceof Response)) throw new Error("expected Response");
  assertEquals(res.status, 401);
});

// ---------- 403 path -------------------------------------------------------

Deno.test("guard: valid code minted for a different fixture → 403", async () => {
  const hash = await hashMatchCode(CODE);
  const res = await verifyMatchToken(
    req(CODE),
    FIXTURE,
    lookupFor(hash, {
      id: ACCESS_ID,
      fixture_id: OTHER_FIXTURE,
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      revoked_at: null,
    }),
  );
  if (!(res instanceof Response)) throw new Error("expected Response");
  assertEquals(res.status, 403);
});

// ---------- happy path -----------------------------------------------------

Deno.test("guard: valid code for the right fixture → passes with access_id", async () => {
  const hash = await hashMatchCode(CODE);
  const res = await verifyMatchToken(
    req(CODE),
    FIXTURE,
    lookupFor(hash, {
      id: ACCESS_ID,
      fixture_id: FIXTURE,
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      revoked_at: null,
    }),
  );
  if (res instanceof Response) {
    throw new Error(`expected context, got Response ${res.status}`);
  }
  assertEquals(res.fixture_id, FIXTURE);
  assertEquals(res.access_id, ACCESS_ID);
});
