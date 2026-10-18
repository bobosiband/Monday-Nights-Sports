// -----------------------------------------------------------------------------
// match-access/index.ts
//
// Entry point for the match-access service. Supabase requires this file
// to be named index.ts. All routing lives in MatchAccessRouter.ts.
// -----------------------------------------------------------------------------

import { MatchAccessRouter } from "./MatchAccessRouter.ts";

Deno.serve((request) => new MatchAccessRouter().handle(request));
