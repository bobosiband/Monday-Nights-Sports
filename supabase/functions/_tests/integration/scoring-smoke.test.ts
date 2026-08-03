// -----------------------------------------------------------------------------
// _tests/integration/scoring-smoke.test.ts
//
// End-to-end walkthrough of the scoring + viewing arc against a live local
// Supabase stack. Mirrors scripts/smoke-live.sh so the CI job proves the
// same happy path a developer runs by hand.
//
// Preconditions (all handled by the CI database job):
//   - `supabase start` has booted the local stack
//   - `supabase db reset` has applied migrations + seed
//   - INTEGRATION=1
//   - SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY exported
//
// Skipped (green) when INTEGRATION is unset, so `deno task test` stays fast
// and DB-free.
// -----------------------------------------------------------------------------

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  apiFetch,
  organiserJwt,
  skipUnlessIntegration,
  uuid,
} from "./helpers.ts";

// Seeded soccer fixture — see supabase/seed.sql
const FIXTURE = "f0111111-1111-1111-1111-111111111111";
const SEASON = "11111111-1111-1111-1111-111111111111";
const HOME_TEAM = "a1111111-1111-1111-1111-111111111111";
const AWAY_TEAM = "a2222222-2222-2222-2222-222222222222";

Deno.test("scoring smoke — mint, score, undo, live, finalize, replay guard", async (t) => {
  const env = skipUnlessIntegration(t);
  if (!env) return;

  const jwt = await organiserJwt(env, "scoring-smoke");
  const organiserHeaders = {
    "authorization": `Bearer ${jwt}`,
    "content-type": "application/json",
  };

  let code = "";
  let matchHeaders: Record<string, string> = {};

  await t.step("mint an operator code", async () => {
    const res = await apiFetch(env, "/match-access", {
      method: "POST",
      headers: organiserHeaders,
      body: JSON.stringify({ fixture_id: FIXTURE, ttl_minutes: 60 }),
    });
    assertEquals(res.status, 201, await res.text());
    const body = await res.json() as { code: string };
    assert(body.code, "mint returned no code");
    code = body.code;
    matchHeaders = {
      "authorization": `Bearer ${code}`,
      "content-type": "application/json",
    };
  });

  await t.step("start flips fixture to live", async () => {
    const res = await apiFetch(env, `/scoring/${FIXTURE}/start`, {
      method: "POST",
      headers: matchHeaders,
    });
    assertEquals(res.status, 200, await res.text());
    const body = await res.json() as { fixture_status: string };
    assertEquals(body.fixture_status, "live");
  });

  await t.step("open period 1", async () => {
    const res = await apiFetch(env, `/scoring/${FIXTURE}/period`, {
      method: "POST",
      headers: matchHeaders,
      body: JSON.stringify({ intent: "start", period: 1 }),
    });
    assertEquals(res.status, 200, await res.text());
    const body = await res.json() as { derived: { currentPeriod: number } };
    assertEquals(body.derived.currentPeriod, 1);
  });

  const homeEvt = uuid();
  await t.step("record home goal", async () => {
    const res = await apiFetch(env, `/scoring/${FIXTURE}/events`, {
      method: "POST",
      headers: matchHeaders,
      body: JSON.stringify({
        id: homeEvt,
        type: "score",
        team_id: HOME_TEAM,
        value: 1,
      }),
    });
    assertEquals(res.status, 200, await res.text());
    const body = await res.json() as {
      inserted: boolean;
      derived: { home: number };
    };
    assertEquals(body.inserted, true);
    assertEquals(body.derived.home, 1);
  });

  await t.step(
    "replaying the same event is idempotent — score unchanged",
    async () => {
      const res = await apiFetch(env, `/scoring/${FIXTURE}/events`, {
        method: "POST",
        headers: matchHeaders,
        body: JSON.stringify({
          id: homeEvt,
          type: "score",
          team_id: HOME_TEAM,
          value: 1,
        }),
      });
      assertEquals(res.status, 200, await res.text());
      const body = await res.json() as {
        inserted: boolean;
        derived: { home: number };
      };
      assertEquals(body.inserted, false, "replay must not re-insert");
      assertEquals(body.derived.home, 1, "score must stay at 1");
    },
  );

  const foulEvt = uuid();
  await t.step("record a foul", async () => {
    const res = await apiFetch(env, `/scoring/${FIXTURE}/events`, {
      method: "POST",
      headers: matchHeaders,
      body: JSON.stringify({
        id: foulEvt,
        type: "foul",
        team_id: AWAY_TEAM,
      }),
    });
    assertEquals(res.status, 200, await res.text());
  });

  await t.step("undo the foul", async () => {
    const res = await apiFetch(env, `/scoring/${FIXTURE}/undo`, {
      method: "POST",
      headers: matchHeaders,
      body: JSON.stringify({ event_id: foulEvt }),
    });
    assertEquals(res.status, 200, await res.text());
  });

  await t.step("GET /live reflects derived state", async () => {
    const res = await apiFetch(env, `/live/${FIXTURE}`);
    assertEquals(res.status, 200, await res.text());
    const body = await res.json() as {
      status: string;
      home: { score: number };
      away: { score: number };
    };
    assertEquals(body.status, "live");
    assertEquals(body.home.score, 1);
    assertEquals(body.away.score, 0);
  });

  await t.step("close period 1", async () => {
    const res = await apiFetch(env, `/scoring/${FIXTURE}/period`, {
      method: "POST",
      headers: matchHeaders,
      body: JSON.stringify({ intent: "end", period: 1 }),
    });
    assertEquals(res.status, 200, await res.text());
  });

  await t.step("finalize (no reopen) → fixture complete", async () => {
    const res = await apiFetch(env, `/scoring/${FIXTURE}/finalize`, {
      method: "POST",
      headers: matchHeaders,
      body: JSON.stringify({ decided_by: "normal" }),
    });
    assertEquals(res.status, 200, await res.text());
    const body = await res.json() as {
      fixture_status: string;
      result: { home_score: number; away_score: number };
    };
    assertEquals(body.fixture_status, "complete");
    assertEquals(body.result.home_score, 1);
    assertEquals(body.result.away_score, 0);
  });

  await t.step("re-finalize without reopen → 409", async () => {
    const res = await apiFetch(env, `/scoring/${FIXTURE}/finalize`, {
      method: "POST",
      headers: matchHeaders,
      body: JSON.stringify({ decided_by: "normal" }),
    });
    assertEquals(res.status, 409, await res.text());
  });

  await t.step("standings include soccer table for the season", async () => {
    const res = await apiFetch(env, `/standings?season=${SEASON}`);
    assertEquals(res.status, 200, await res.text());
    const body = await res.json() as {
      standings_by_sport: Record<string, unknown[]>;
    };
    const soccer = body.standings_by_sport?.soccer;
    assert(
      Array.isArray(soccer) && soccer.length > 0,
      "soccer standings missing",
    );
  });
});
