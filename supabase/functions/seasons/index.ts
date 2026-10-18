// -----------------------------------------------------------------------------
// seasons/index.ts
//
// Entry point for the seasons service. Supabase requires this file to be
// named index.ts. All routing lives in SeasonsRouter.ts.
// -----------------------------------------------------------------------------

import { SeasonsRouter } from "./SeasonsRouter.ts";

Deno.serve((request) => new SeasonsRouter().handle(request));
