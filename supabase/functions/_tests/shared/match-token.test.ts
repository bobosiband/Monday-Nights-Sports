// -----------------------------------------------------------------------------
// _tests/shared/match-token.test.ts
//
// Unit tests for the opaque match-code primitive. Everything under test is
// pure crypto + string handling; no DB, no network. The DB revocation +
// verification path is tested at the scoring/guard layer.
//
// Run with: `deno test supabase/functions/_tests/`
// -----------------------------------------------------------------------------

import { assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  extractBearer,
  generateMatchCode,
  hashMatchCode,
  MATCH_CODE_ALPHABET,
  MATCH_CODE_LENGTH,
  normaliseMatchCode,
} from "../../_shared/match-token.ts";

// ---------- alphabet + generation -----------------------------------------

Deno.test("alphabet: excludes the confusable characters I / L / O / U", () => {
  for (const ch of ["I", "L", "O", "U"]) {
    assertEquals(
      MATCH_CODE_ALPHABET.includes(ch),
      false,
      `alphabet must not contain ${ch}`,
    );
  }
});

Deno.test("alphabet: is all uppercase and digits, no duplicates", () => {
  const seen = new Set<string>();
  for (const ch of MATCH_CODE_ALPHABET) {
    assertEquals(
      /^[0-9A-Z]$/.test(ch),
      true,
      `unexpected alphabet char: ${ch}`,
    );
    assertEquals(seen.has(ch), false, `duplicate alphabet char: ${ch}`);
    seen.add(ch);
  }
});

Deno.test("generateMatchCode: default length matches MATCH_CODE_LENGTH", () => {
  const code = generateMatchCode();
  assertEquals(code.length, MATCH_CODE_LENGTH);
});

Deno.test("generateMatchCode: honours a custom length", () => {
  assertEquals(generateMatchCode(4).length, 4);
  assertEquals(generateMatchCode(16).length, 16);
});

Deno.test("generateMatchCode: every character is from the alphabet", () => {
  // Generate a few dozen codes so a stray sample from outside the alphabet
  // is overwhelmingly likely to surface.
  for (let i = 0; i < 40; i++) {
    const code = generateMatchCode();
    for (const ch of code) {
      assertEquals(
        MATCH_CODE_ALPHABET.includes(ch),
        true,
        `code ${code} contains out-of-alphabet char ${ch}`,
      );
    }
  }
});

Deno.test("generateMatchCode: two consecutive calls (almost never) collide", () => {
  // Not a distribution test — just a sanity check that we're actually
  // drawing entropy, not returning a constant.
  const a = generateMatchCode();
  const b = generateMatchCode();
  assertNotEquals(a, b);
});

Deno.test("generateMatchCode: refuses a non-positive length", () => {
  let threw = false;
  try {
    generateMatchCode(0);
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

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
  // If this ever drifts, the seeded dev code in supabase/seed.sql needs
  // its `code_hash` regenerated. See seed.sql for the shell command.
  const h = await hashMatchCode("DEVCODE1");
  assertEquals(
    h,
    "aad7a097044dc750d29eec9ab8f7996a43b81f6cfdd036e34254c866d576c618",
  );
});

// ---------- bearer extraction ---------------------------------------------

function requestWith(headerValue?: string): Request {
  const headers: Record<string, string> = {};
  if (headerValue !== undefined) headers.authorization = headerValue;
  return new Request("http://test/scoring/f/start", { method: "POST", headers });
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
