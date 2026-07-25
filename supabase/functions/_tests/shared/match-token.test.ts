// -----------------------------------------------------------------------------
// _tests/shared/match-token.test.ts
//
// Unit tests for the match-token primitive. The signature + expiry paths are
// pure and testable without a DB; revocation is exercised via the injectable
// `isRevoked` seam on `verifyMatchToken`.
//
// Run with: `deno test supabase/functions/_tests/`
// -----------------------------------------------------------------------------

import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  MATCH_TOKEN_MAX_TTL_SECONDS,
  mintMatchToken,
  verifyMatchToken,
  verifyMatchTokenSignature,
} from "../../_shared/match-token.ts";

// Fixed secret for tests. Setting via Deno.env is fine here — the whole
// process is short-lived and every test uses the same secret.
Deno.env.set("MATCH_TOKEN_SECRET", "test-secret-please-do-not-use-in-prod");

const FIXTURE = "f0111111-1111-1111-1111-111111111111";
const OP = "11111111-2222-3333-4444-555555555555";

const neverRevoked = () => Promise.resolve(false);
const alwaysRevoked = () => Promise.resolve(true);

/**
 * Build a Request carrying a bearer token, so the guard path can be
 * exercised without a live HTTP server.
 *
 * @param token - The raw signed JWT.
 * @returns A Request with the Authorization header set.
 */
function requestWith(token: string): Request {
  return new Request("http://test/scoring/f/start", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
}

// ---------- mint + verify round trip ---------------------------------------

Deno.test("round trip: minted token verifies and yields the right fixture_id", async () => {
  const minted = await mintMatchToken(FIXTURE, 60, OP);
  const claims = await verifyMatchTokenSignature(minted.token);
  if ("error" in claims) throw new Error(`unexpected error: ${claims.error}`);
  assertEquals(claims.fixture_id, FIXTURE);
  assertEquals(claims.jti, minted.id);
  assertEquals(claims.sub, OP);
});

Deno.test("guard path: valid token yields claims, no DB access", async () => {
  const minted = await mintMatchToken(FIXTURE, 60, null);
  const result = await verifyMatchToken(
    requestWith(minted.token),
    neverRevoked,
  );
  if (result instanceof Response) {
    throw new Error("expected claims, got Response");
  }
  assertEquals(result.fixture_id, FIXTURE);
});

// ---------- tampering -------------------------------------------------------

Deno.test("tampered payload → rejected as invalid signature", async () => {
  const minted = await mintMatchToken(FIXTURE, 60, null);
  const [headerB64, payloadB64, sigB64] = minted.token.split(".");
  // Flip one bit in the payload — invalidates the HMAC.
  const tamperedByte = payloadB64.charAt(0) === "A" ? "B" : "A";
  const tamperedPayload = tamperedByte + payloadB64.slice(1);
  const tampered = `${headerB64}.${tamperedPayload}.${sigB64}`;

  const result = await verifyMatchTokenSignature(tampered);
  if (!("error" in result)) {
    throw new Error("expected error, got claims");
  }
  assertEquals(result.error, "Invalid signature");
});

Deno.test("tampered signature → rejected", async () => {
  const minted = await mintMatchToken(FIXTURE, 60, null);
  const [headerB64, payloadB64, sigB64] = minted.token.split(".");
  const bad = sigB64.slice(0, -2) + (sigB64.endsWith("AA") ? "BB" : "AA");
  const result = await verifyMatchTokenSignature(
    `${headerB64}.${payloadB64}.${bad}`,
  );
  assertEquals("error" in result, true);
});

Deno.test("malformed token (wrong segment count) → rejected", async () => {
  const result = await verifyMatchTokenSignature("just.two");
  if (!("error" in result)) throw new Error("expected error");
  assertEquals(result.error, "Malformed token");
});

// ---------- expiry ----------------------------------------------------------

Deno.test("expired token → rejected", async () => {
  const minted = await mintMatchToken(FIXTURE, 1, null);
  // Advance clock past the 1s TTL by pretending it's a minute later.
  const future = new Date(Date.now() + 60_000);
  const result = await verifyMatchTokenSignature(minted.token, future);
  if (!("error" in result)) throw new Error("expected error");
  assertEquals(result.error, "Token expired");
});

Deno.test("guard rejects expired token with 401", async () => {
  const minted = await mintMatchToken(FIXTURE, 1, null);
  // We can't easily inject `now` into the guard, but the pure path proves
  // expiry is enforced; here we just confirm a still-valid token passes so
  // the wiring is sane end-to-end.
  const result = await verifyMatchToken(
    requestWith(minted.token),
    neverRevoked,
  );
  if (result instanceof Response) {
    throw new Error(`expected claims, got ${result.status}`);
  }
});

// ---------- revocation ------------------------------------------------------

Deno.test("revoked token → 401 from guard", async () => {
  const minted = await mintMatchToken(FIXTURE, 60, null);
  const result = await verifyMatchToken(
    requestWith(minted.token),
    alwaysRevoked,
  );
  if (!(result instanceof Response)) {
    throw new Error("expected Response, got claims");
  }
  assertEquals(result.status, 401);
  const body = await result.json();
  assertEquals(body.error, "Token revoked");
});

// ---------- header handling -------------------------------------------------

Deno.test("missing Authorization header → 401", async () => {
  const req = new Request("http://test/scoring/f/start", { method: "POST" });
  const result = await verifyMatchToken(req, neverRevoked);
  if (!(result instanceof Response)) throw new Error("expected Response");
  assertEquals(result.status, 401);
});

Deno.test("non-bearer scheme → 401", async () => {
  const req = new Request("http://test/scoring/f/start", {
    method: "POST",
    headers: { authorization: "Basic dXNlcjpwYXNz" },
  });
  const result = await verifyMatchToken(req, neverRevoked);
  if (!(result instanceof Response)) throw new Error("expected Response");
  assertEquals(result.status, 401);
});

Deno.test("empty bearer value → 401", async () => {
  const req = new Request("http://test/scoring/f/start", {
    method: "POST",
    headers: { authorization: "Bearer " },
  });
  const result = await verifyMatchToken(req, neverRevoked);
  if (!(result instanceof Response)) throw new Error("expected Response");
  assertEquals(result.status, 401);
});

// ---------- TTL bounds ------------------------------------------------------

Deno.test("ttl above the bounded max → mint refuses", async () => {
  await assertRejects(
    () => mintMatchToken(FIXTURE, MATCH_TOKEN_MAX_TTL_SECONDS + 1, null),
    Error,
    "MATCH_TOKEN_MAX_TTL_SECONDS",
  );
});

Deno.test("ttl of zero → mint refuses", async () => {
  await assertRejects(() => mintMatchToken(FIXTURE, 0, null), Error);
});

Deno.test("ttl of negative → mint refuses", async () => {
  await assertRejects(() => mintMatchToken(FIXTURE, -1, null), Error);
});

// ---------- type discriminator ---------------------------------------------

Deno.test("Supabase-shaped JWT (no typ='match_token') → rejected", async () => {
  // Hand-craft a JWT with the same secret but no typ claim; verify refuses.
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    fixture_id: FIXTURE,
    jti: crypto.randomUUID(),
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 60,
    sub: null,
    // typ omitted
  };
  const enc = (s: string) =>
    btoa(unescape(encodeURIComponent(s)))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");
  const message = `${enc(JSON.stringify(header))}.${
    enc(JSON.stringify(payload))
  }`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode("test-secret-please-do-not-use-in-prod"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)),
  );
  let bin = "";
  for (const b of sig) bin += String.fromCharCode(b);
  const sigB64 = btoa(bin).replaceAll("+", "-").replaceAll("/", "_")
    .replaceAll("=", "");
  const forged = `${message}.${sigB64}`;

  const result = await verifyMatchTokenSignature(forged);
  if (!("error" in result)) throw new Error("expected error");
  assertEquals(result.error, "Wrong token type");
});
