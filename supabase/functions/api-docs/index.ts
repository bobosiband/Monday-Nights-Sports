// -----------------------------------------------------------------------------
// api-docs/index.ts
//
// Serves the OpenAPI spec + Swagger UI so devs can browse the API when the
// local stack is up.
//
// Routes:
//   GET /api-docs                    → Swagger UI HTML (loads the yaml below)
//   GET /api-docs/openapi.yaml       → the raw OpenAPI 3.1 document
//
// The YAML is embedded as a string constant. The source-of-truth file lives
// at `docs/openapi.yaml`; when it changes, refresh this string via the
// small sync script in `scripts/sync-openapi.sh` (or copy-paste for a
// one-off change and add a TODO).
// -----------------------------------------------------------------------------

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders, handlePreflight } from "../_shared/cors.ts";

// The OpenAPI document is loaded from a sibling file so it stays in sync
// with docs/openapi.yaml (which is copied into this folder by
// scripts/sync-openapi.sh before deploy). The dynamic import path uses
// import.meta.url so it resolves the same locally and on the platform.
const OPENAPI_YAML = await Deno.readTextFile(
  new URL("./openapi.yaml", import.meta.url),
);

/**
 * Build the Swagger UI HTML page. Uses the CDN build so we do not have
 * to bundle its assets into the function.
 *
 * @returns A complete HTML document string.
 */
function swaggerHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Monday Night Sports — API docs</title>
  <link rel="stylesheet"
    href="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui.css" />
  <style>
    body { margin: 0; background: #0b0f14; }
    .topbar { display: none; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui-bundle.js" crossorigin></script>
  <script>
    window.addEventListener("load", () => {
      window.ui = SwaggerUIBundle({
        url: "./api-docs/openapi.yaml",
        dom_id: "#swagger-ui",
        deepLinking: true,
        docExpansion: "list",
        tryItOutEnabled: true,
      });
    });
  </script>
</body>
</html>`;
}

serve((request) => {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  if (request.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  const pathname = new URL(request.url).pathname;
  if (pathname.endsWith("/openapi.yaml")) {
    return new Response(OPENAPI_YAML, {
      status: 200,
      headers: { ...corsHeaders, "content-type": "application/yaml; charset=utf-8" },
    });
  }

  return new Response(swaggerHtml(), {
    status: 200,
    headers: { ...corsHeaders, "content-type": "text/html; charset=utf-8" },
  });
});
