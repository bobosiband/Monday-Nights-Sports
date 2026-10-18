// -----------------------------------------------------------------------------
// events/index.ts
//
// Entry point for the events (draw-builder) service. Supabase requires
// this file to be named index.ts. All routing lives in EventsRouter.ts.
// -----------------------------------------------------------------------------

import { EventsRouter } from "./EventsRouter.ts";

Deno.serve((request) => new EventsRouter().handle(request));
