// -----------------------------------------------------------------------------
// fixtures-public/index.ts
//
// Entry point for the fixtures-public service. Supabase requires this file
// to be named index.ts. All routing lives in FixturesPublicRouter.ts.
// -----------------------------------------------------------------------------

import { FixturesPublicRouter } from "./FixturesPublicRouter.ts";

Deno.serve((request) => new FixturesPublicRouter().handle(request));
