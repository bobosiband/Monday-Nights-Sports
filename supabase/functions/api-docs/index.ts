// -----------------------------------------------------------------------------
// api-docs/index.ts
//
// Serves the OpenAPI spec and points browsers at a working Swagger UI.
//
// Routes:
//   GET /api-docs                    → 302 to Swagger UI, pre-loaded with
//                                       our openapi.yaml URL
//   GET /api-docs/openapi.yaml       → the raw OpenAPI 3.1 document
//
// Why the redirect: Supabase's hosted Edge Functions gateway rewrites any
// response the platform sniffs as HTML (whether declared as `text/html`,
// `application/xhtml+xml`, or served with an HTML body) to `text/plain` +
// `content-security-policy: default-src 'none'; sandbox` +
// `x-content-type-options: nosniff`. That's an anti-phishing safeguard, and
// there's no per-function opt-out. So we can't host Swagger UI's shell here.
//
// A 302 dodges the whole class of problem: the browser follows the Location
// header regardless of content-type sniffing, and the target (petstore's
// public Swagger UI host, maintained by the Swagger team) renders our spec
// via its `?url=` query parameter. Our openapi.yaml route has CORS `*` so
// the cross-origin fetch works out of the box.
//
// The YAML is embedded as a string constant in the generated `openapi.ts`
// module. Source of truth: `docs/openapi.yaml`; regenerate via
// `scripts/sync-openapi.sh` after editing.
// -----------------------------------------------------------------------------

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders, handlePreflight } from "../_shared/cors.ts";
import { OPENAPI_YAML } from "./openapi.ts";

/** Public Swagger UI host used to render any OpenAPI document by URL. */
const SWAGGER_UI_HOST = "https://petstore.swagger.io/";

/**
 * Build the absolute URL of our own openapi.yaml route so the redirect target
 * can fetch it. Uses the request's own host so it works locally
 * (`127.0.0.1:54321`) and on any hosted project without hard-coding a ref.
 *
 * Scheme resolution: Cloudflare terminates TLS and forwards a plain-HTTP
 * request to the function, so `new URL(request.url).protocol` is `http:`
 * even on the hosted project. Prefer `x-forwarded-proto`; fall back to the
 * host — anything under `.supabase.co` is HTTPS-only.
 *
 * @param request - The incoming request.
 * @returns Absolute URL to `.../functions/v1/api-docs/openapi.yaml`.
 */
function openapiUrl(request: Request): string {
  const url = new URL(request.url);
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const scheme = forwardedProto ?? (
    url.hostname.endsWith(".supabase.co") ? "https" : url.protocol.slice(0, -1)
  );
  return `${scheme}://${url.host}/functions/v1/api-docs/openapi.yaml`;
}

/**
 * Route the request. Extracted so a test can call it without spinning up an
 * HTTP server.
 *
 * @param request - The incoming request.
 * @returns The response the handler would send.
 */
export function handleApiDocs(request: Request): Response {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  if (request.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: {
        ...corsHeaders,
        "content-type": "application/json; charset=utf-8",
      },
    });
  }

  const pathname = new URL(request.url).pathname;

  if (pathname.endsWith("/openapi.yaml")) {
    return new Response(OPENAPI_YAML, {
      status: 200,
      headers: {
        ...corsHeaders,
        "content-type": "text/yaml; charset=utf-8",
      },
    });
  }

  // Everything else: bounce to the hosted Swagger UI pointed at our spec.
  const target = `${SWAGGER_UI_HOST}?url=${
    encodeURIComponent(openapiUrl(request))
  }`;
  return new Response(null, {
    status: 302,
    headers: {
      ...corsHeaders,
      location: target,
    },
  });
}

serve(handleApiDocs);
