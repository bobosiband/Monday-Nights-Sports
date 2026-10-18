// -----------------------------------------------------------------------------
// tests/scoring/MatchTokenHasher.test.ts
//
// Unit tests for the verify-side half of the match-token contract.
// Everything under test is pure crypto plus string handling: no DB, no
// network. The mint-side twin lives in
// `tests/match-access/MatchTokenHasher.test.ts` and must pin the same test
// vector; if the two diverge, one of them is wrong.
// -----------------------------------------------------------------------------

import {
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  extractBearer,
  hashMatchCode,
  normaliseMatchCode,
} from "../../supabase/functions/scoring/security/MatchTokenHasher.ts";

// ---------- normalisation --------------------------------------------------

Deno.test("normaliseMatchCode: uppercases", () => {
  assertEquals(normaliseMatchCode("abcd1234"), "ABCD1234");
});

Deno.test("normaliseMatchCode: strips hyphens", () => {
  assertEquals(normaliseMatchCode("abcd-1234"), "ABCD1234");
});

Deno.test("normaliseMatchCode: strips whitespace and underscores", () => {
  assertEquals(normaliseMatchCode(" ab cd_12\t34\n"), "ABCD1234");
});

Deno.test("normaliseMatchCode: leaves already-canonical input untouched", () => {
  assertEquals(normaliseMatchCode("ABCD1234"), "ABCD1234");
});

// ---------- hashing --------------------------------------------------------

Deno.test("hashMatchCode: is stable across calls", async () => {
  const a = await hashMatchCode("ABCD1234");
  const b = await hashMatchCode("ABCD1234");
  assertEquals(a, b);
});

Deno.test("hashMatchCode: canonicalises before hashing (case / dashes)", async () => {
  const canonical = await hashMatchCode("ABCD1234");
  const messyCase = await hashMatchCode("abcd1234");
  const messyDash = await hashMatchCode("abcd-1234");
  const messySpace = await hashMatchCode(" ABCD 1234 ");
  assertEquals(messyCase, canonical);
  assertEquals(messyDash, canonical);
  assertEquals(messySpace, canonical);
});

Deno.test("hashMatchCode: distinct inputs produce distinct hashes", async () => {
  const a = await hashMatchCode("ABCD1234");
  const b = await hashMatchCode("ABCD1235");
  assertNotEquals(a, b);
});

Deno.test("hashMatchCode: is 64 lowercase hex characters (SHA-256)", async () => {
  const h = await hashMatchCode("ABCD1234");
  assertEquals(h.length, 64);
  assertEquals(/^[0-9a-f]{64}$/.test(h), true);
});

Deno.test("hashMatchCode: matches the seed's pinned digest for 'DEVCODE1'", async () => {
  // Contract test vector shared with tests/match-access/MatchTokenHasher.
  // If this ever drifts, the match-access-side twin must change to match
  // AND the seeded dev code's `code_hash` in supabase/seed.sql must be
  // regenerated.
  const h = await hashMatchCode("DEVCODE1");
  assertEquals(
    h,
    "aad7a097044dc750d29eec9ab8f7996a43b81f6cfdd036e34254c866d576c618",
  );
});

// ---------- bearer extraction ---------------------------------------------

/**
 * Build a Request with a given Authorization header value.
 *
 * @param headerValue - The header value to send, or undefined.
 * @returns A POST request to a dummy scoring URL.
 */
function requestWith(headerValue?: string): Request {
  const headers: Record<string, string> = {};
  if (headerValue !== undefined) headers.authorization = headerValue;
  return new Request("http://test/scoring/f/start", {
    method: "POST",
    headers,
  });
}

Deno.test("extractBearer: pulls the value after Bearer", () => {
  assertEquals(extractBearer(requestWith("Bearer ABCD1234")), "ABCD1234");
});

Deno.test("extractBearer: accepts lower-case scheme", () => {
  assertEquals(extractBearer(requestWith("bearer ABCD1234")), "ABCD1234");
});

Deno.test("extractBearer: trims leading/trailing whitespace on the value", () => {
  assertEquals(extractBearer(requestWith("Bearer   ABCD1234   ")), "ABCD1234");
});

Deno.test("extractBearer: returns null when the header is missing", () => {
  assertEquals(extractBearer(requestWith(undefined)), null);
});

Deno.test("extractBearer: returns null for a non-bearer scheme", () => {
  assertEquals(extractBearer(requestWith("Basic dXNlcjpwYXNz")), null);
});

Deno.test("extractBearer: returns null for an empty bearer value", () => {
  assertEquals(extractBearer(requestWith("Bearer   ")), null);
});
