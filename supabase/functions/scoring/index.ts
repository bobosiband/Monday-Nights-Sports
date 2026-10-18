// -----------------------------------------------------------------------------
// scoring/index.ts
//
// Entry point for the scoring service. Supabase requires this file to be
// named index.ts. All routing lives in ScoringRouter.ts.
// -----------------------------------------------------------------------------

import { ScoringRouter } from "./ScoringRouter.ts";

Deno.serve((request) => new ScoringRouter().handle(request));
