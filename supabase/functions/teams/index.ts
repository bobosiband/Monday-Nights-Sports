// -----------------------------------------------------------------------------
// teams/index.ts
//
// Entry point for the teams service. Supabase requires this file to be
// named index.ts. All routing lives in TeamsRouter.ts.
// -----------------------------------------------------------------------------

import { TeamsRouter } from "./TeamsRouter.ts";

Deno.serve((request) => new TeamsRouter().handle(request));
