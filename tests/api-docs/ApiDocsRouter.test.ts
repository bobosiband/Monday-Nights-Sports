// -----------------------------------------------------------------------------
// tests/api-docs/ApiDocsRouter.test.ts
//
// Guards the two things the deployed api-docs function has to get right:
//
//   1. GET / redirects (302) to a hosted Swagger UI with our openapi.yaml URL
//      in the `?url=` query parameter. We cannot render HTML in-line because
//      the hosted Supabase gateway sanitises any HTML-looking response.
//   2. GET /openapi.yaml returns 200 with a yaml content-type plus
//      charset=utf-8 and a body that starts with `openapi:`, so browsers,
//      Swagger UI, and any spec validator can consume it.
//
// Pure request/response checks: no live Supabase, no DB.
// -----------------------------------------------------------------------------

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ApiDocsRouter } from "../../supabase/functions/api-docs/ApiDocsRouter.ts";

/** Fresh router per test keeps the setup explicit at the call site. */
function route(request: Request): Response {
  return new ApiDocsRouter().handle(request);
}

Deno.test("GET / returns 302 to Swagger UI carrying our openapi.yaml URL", () => {
  const res = route(
    new Request("http://localhost/functions/v1/api-docs"),
  );
  // Consume the body so Deno's async-ops sanitiser stays happy.
  res.body?.cancel();

  assertEquals(res.status, 302);
  const location = res.headers.get("location") ?? "";
  assertStringIncludes(location, "swagger");
  // Absolute URL to our own spec, url-encoded onto the ?url= parameter.
  // This is the contract the target Swagger UI relies on.
  assertStringIncludes(
    location,
    encodeURIComponent(
      "http://localhost/functions/v1/api-docs/openapi.yaml",
    ),
  );
});

Deno.test("hosted request: spec URL is upgraded to https via x-forwarded-proto", () => {
  const res = route(
    new Request(
      "http://baqvcnotpcovsirmlaek.supabase.co/functions/v1/api-docs",
      { headers: { "x-forwarded-proto": "https" } },
    ),
  );
  res.body?.cancel();
  assertEquals(res.status, 302);
  const location = res.headers.get("location") ?? "";
  assertStringIncludes(
    location,
    encodeURIComponent(
      "https://baqvcnotpcovsirmlaek.supabase.co/functions/v1/api-docs/openapi.yaml",
    ),
  );
});

Deno.test("hosted request: .supabase.co host falls back to https even without the header", () => {
  const res = route(
    new Request(
      "http://baqvcnotpcovsirmlaek.supabase.co/functions/v1/api-docs",
    ),
  );
  res.body?.cancel();
  const location = res.headers.get("location") ?? "";
  assertStringIncludes(location, encodeURIComponent("https://"));
});

Deno.test("GET /openapi.yaml returns YAML content-type plus body starting with `openapi:`", async () => {
  const res = route(
    new Request("http://localhost/functions/v1/api-docs/openapi.yaml"),
  );
  assertEquals(res.status, 200);
  const ct = res.headers.get("content-type") ?? "";
  assert(
    ct.includes("yaml"),
    `expected a yaml content-type, got: ${ct}`,
  );
  assertStringIncludes(ct, "charset=utf-8");

  const body = await res.text();
  assert(
    body.trimStart().startsWith("openapi:"),
    `openapi.yaml body must start with 'openapi:', got: ${body.slice(0, 60)}`,
  );
  // The em dash in the API title is the exact character that was mangled
  // in the pre-fix hosted deploy. Guard against a regression to latin-1.
  assertStringIncludes(body, "Monday Night Sports — Backend API");
});

Deno.test("non-GET methods return 405 JSON", () => {
  const res = route(
    new Request("http://localhost/functions/v1/api-docs", { method: "POST" }),
  );
  res.body?.cancel();
  assertEquals(res.status, 405);
  assertStringIncludes(
    res.headers.get("content-type") ?? "",
    "application/json",
  );
});

Deno.test("OPTIONS preflight returns 204 with CORS headers", () => {
  const res = route(
    new Request("http://localhost/functions/v1/api-docs", {
      method: "OPTIONS",
    }),
  );
  res.body?.cancel();
  assertEquals(res.status, 204);
  assertEquals(res.headers.get("access-control-allow-origin"), "*");
});
