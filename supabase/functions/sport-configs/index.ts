// -----------------------------------------------------------------------------
// sport-configs/index.ts
//
// Entry point for the sport-configs service. Supabase requires this file to
// be named index.ts. All routing lives in SportConfigsRouter.ts.
// -----------------------------------------------------------------------------

import { SportConfigsRouter } from "./SportConfigsRouter.ts";

Deno.serve((request) => new SportConfigsRouter().handle(request));
