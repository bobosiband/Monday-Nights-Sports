// -----------------------------------------------------------------------------
// standings/index.ts
//
// Entry point for the standings service. Supabase requires this file to be
// named index.ts. All routing lives in StandingsRouter.ts.
// -----------------------------------------------------------------------------

import { StandingsRouter } from "./StandingsRouter.ts";

Deno.serve((request) => new StandingsRouter().handle(request));
