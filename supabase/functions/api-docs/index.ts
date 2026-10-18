// -----------------------------------------------------------------------------
// api-docs/index.ts
//
// Entry point for the api-docs service. Supabase requires this file to be
// named index.ts. All routing lives in ApiDocsRouter.ts.
// -----------------------------------------------------------------------------

import { ApiDocsRouter } from "./ApiDocsRouter.ts";

Deno.serve((request) => new ApiDocsRouter().handle(request));
