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
 * Sign up (or sign back in) a Supabase Auth user and return an access token.
 * Local Supabase has `enable_confirmations = false`, so a plain signup on the
 * anon endpoint yields a confirmed user with an access token in a single call.
 * If the user already exists from a prior run we fall back to password grant.
 *
 * The existing `requireOrganiser` guard treats any authenticated user as an
 * organiser (see _shared/auth.ts), so no role plumbing is required.
 *
 * @param env - Integration env bundle from `integrationEnv()`.
 * @param label - Short slug used to build a stable email so parallel test
 *                files don't collide.
 * @returns A short-lived access token usable as `Bearer <jwt>`.
 */
export async function organiserJwt(
  env: { url: string; anonKey: string; serviceRoleKey: string },
  label: string,
): Promise<string> {
  const email = `test-${label}@example.com`;
  const password = "integration-test-password-1";

  const signupRes = await fetch(`${env.url}/auth/v1/signup`, {
    method: "POST",
    headers: {
      "apikey": env.anonKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });
  const signupBody = await signupRes.json().catch(() => ({}));

  if (signupRes.ok && signupBody?.access_token) {
    return signupBody.access_token as string;
  }

  // Signup rejected (usually because the user already exists from a previous
  // run in this same DB) — fall back to password grant.
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
  const signInText = await signInRes.text();
  if (!signInRes.ok) {
    throw new Error(
      `organiser sign-in failed: ${signInRes.status} ${signInText}` +
        ` (signup response was: ${signupRes.status} ${
          JSON.stringify(signupBody)
        })`,
    );
  }
  const parsed = JSON.parse(signInText) as { access_token?: string };
  if (!parsed.access_token) {
    throw new Error(
      `organiser sign-in returned no access_token: ${signInText}`,
    );
  }
  return parsed.access_token;
}

/**
 * Response wrapper that consumes the body exactly once and exposes it as both
 * text and (lazily) parsed JSON. Solves the "Body already consumed" trap when
 * a test wants the raw text in an assertion message *and* the parsed JSON on
 * success.
 */
export interface CapturedResponse {
  status: number;
  text: string;
  /** Parses `text` as JSON. Throws with the raw body on parse failure. */
  json<T = unknown>(): T;
}

/**
 * Wrapper around fetch that attaches the anon apikey header and captures the
 * response body immediately.
 *
 * @param env - Integration env bundle.
 * @param path - Path under `/functions/v1`, e.g. `/scoring/<uuid>/start`.
 * @param init - Standard `fetch` options; `headers` are merged with `apikey`.
 * @returns A `CapturedResponse` with the body already read.
 */
export async function apiFetch(
  env: { url: string; anonKey: string },
  path: string,
  init: RequestInit = {},
): Promise<CapturedResponse> {
  const headers = new Headers(init.headers);
  headers.set("apikey", env.anonKey);
  const res = await fetch(`${env.url}/functions/v1${path}`, {
    ...init,
    headers,
  });
  const text = await res.text();
  return {
    status: res.status,
    text,
    json<T = unknown>(): T {
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new Error(`Response was not JSON: ${text}`);
      }
    },
  };
}

/** UUID v4 for event ids the scoring service can dedupe on. */
export function uuid(): string {
  return crypto.randomUUID();
}
