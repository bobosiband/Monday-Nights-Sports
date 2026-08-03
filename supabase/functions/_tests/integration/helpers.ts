// -----------------------------------------------------------------------------
// _tests/integration/helpers.ts
//
// Shared helpers for integration tests that hit a live local Supabase stack
// (`supabase start` + `supabase db reset`). They are opt-in via the
// INTEGRATION env var so `deno task test` stays DB-free and fast on the
// unit path.
//
// Env vars the helpers read (with fallbacks for the CLI's default local ports):
//
//   INTEGRATION                 must be set to run these tests at all
//   SUPABASE_URL                default http://127.0.0.1:54321
//   SUPABASE_ANON_KEY           needed as the apikey header on function calls
//   SUPABASE_SERVICE_ROLE_KEY   needed to mint an organiser via the admin API
//
// Grab the two keys from `supabase status`.
// -----------------------------------------------------------------------------

/**
 * Return the resolved integration-test env, or `null` when INTEGRATION is
 * unset. Callers that receive `null` should skip the test rather than fail —
 * the whole point is that the unit path must remain runnable without Docker.
 *
 * @returns The env bundle, or `null` when integration tests should be skipped.
 */
export function integrationEnv(): {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
} | null {
  if (Deno.env.get("INTEGRATION") !== "1") return null;

  const url = Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:54321";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!anonKey || !serviceRoleKey) {
    throw new Error(
      "Integration tests require SUPABASE_ANON_KEY and " +
        "SUPABASE_SERVICE_ROLE_KEY. Run `supabase status` to get them.",
    );
  }

  return { url, anonKey, serviceRoleKey };
}

/**
 * Skip helper for `Deno.test`. Use as:
 *
 *   const env = skipUnlessIntegration(t);
 *   if (!env) return;
 *
 * Marks the step ignored (green, but visibly skipped) when INTEGRATION isn't
 * set, so a developer running `deno task test` sees "0 failed" and knows why.
 *
 * @param t - The test context to log against.
 * @returns The integration env, or `null` when the test should return early.
 */
export function skipUnlessIntegration(
  t: Deno.TestContext,
): { url: string; anonKey: string; serviceRoleKey: string } | null {
  const env = integrationEnv();
  if (!env) {
    console.log(`[skip] ${t.name} — INTEGRATION not set`);
    return null;
  }
  return env;
}

/**
 * Create (or reuse) a Supabase Auth user and return an access token for it.
 * Uses the admin API + password grant so the test has full control of the
 * lifecycle; the existing `requireOrganiser` guard treats any authenticated
 * user as an organiser (see _shared/auth.ts).
 *
 * The email is derived from the caller-supplied label so parallel test files
 * don't collide on the same account.
 *
 * @param env - Integration env bundle from `integrationEnv()`.
 * @param label - Short slug used to build a stable email.
 * @returns A short-lived access token usable as `Bearer <jwt>`.
 */
export async function organiserJwt(
  env: { url: string; anonKey: string; serviceRoleKey: string },
  label: string,
): Promise<string> {
  const email = `test-${label}@example.com`;
  const password = "integration-test-password-1";

  // Best-effort create; ignore 4xx (user probably already exists from a prior
  // run). Auth admin endpoints are idempotent-ish but explicit is clearer.
  await fetch(`${env.url}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${env.serviceRoleKey}`,
      "apikey": env.serviceRoleKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });

  const signInRes = await fetch(
    `${env.url}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: {
        "apikey": env.anonKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({ email, password }),
    },
  );

  if (!signInRes.ok) {
    throw new Error(
      `organiser sign-in failed: ${signInRes.status} ${await signInRes.text()}`,
    );
  }
  const body = await signInRes.json() as { access_token?: string };
  if (!body.access_token) {
    throw new Error("organiser sign-in returned no access_token");
  }
  return body.access_token;
}

/** Small wrapper around fetch that attaches the anon apikey header. */
export function apiFetch(
  env: { url: string; anonKey: string },
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("apikey", env.anonKey);
  return fetch(`${env.url}/functions/v1${path}`, { ...init, headers });
}

/** UUID v4 for event ids the scoring service can dedupe on. */
export function uuid(): string {
  return crypto.randomUUID();
}
