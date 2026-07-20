// -----------------------------------------------------------------------------
// _shared/supabase-client.ts
//
// Service-role Supabase client factory for Edge Functions.
//
// Every write service in this repo talks to Postgres through this client.
// The service-role key bypasses RLS, so callers must gate their own writes
// with the auth guard in `_shared/auth.ts` before touching the database.
// -----------------------------------------------------------------------------

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

/**
 * Read a required environment variable or throw with a clear message. Edge
 * Functions inject `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` automatically
 * — throwing on boot beats returning cryptic Postgrest errors at request time.
 *
 * @param name - The env var to read.
 * @returns The env var value.
 */
function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Build a Supabase client that authenticates with the service-role key. Use
 * this only inside Edge Functions where the code path has already verified
 * the caller's identity, or on genuinely public read paths that RLS gates.
 *
 * @returns A `SupabaseClient` configured for server-side use (no session
 * persistence, no auto-refresh — Edge Functions are stateless).
 */
export function createServiceClient(): SupabaseClient {
  const url = requireEnv("SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  return createClient(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
