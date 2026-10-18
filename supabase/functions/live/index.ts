// -----------------------------------------------------------------------------
// live/index.ts
//
// Entry point for the live service. Supabase requires this file to be
// named index.ts. All routing lives in LiveRouter.ts.
// -----------------------------------------------------------------------------

import { LiveRouter } from "./LiveRouter.ts";

Deno.serve((request) => new LiveRouter().handle(request));
