// -----------------------------------------------------------------------------
// results-public/index.ts
//
// Entry point for the results-public service. Supabase requires this file
// to be named index.ts. All routing lives in ResultsPublicRouter.ts.
// -----------------------------------------------------------------------------

import { ResultsPublicRouter } from "./ResultsPublicRouter.ts";

Deno.serve((request) => new ResultsPublicRouter().handle(request));
