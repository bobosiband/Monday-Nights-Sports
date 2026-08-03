// -----------------------------------------------------------------------------
// _tests/fixtures-public/render.test.ts
//
// Pure-function tests for the public renderers. Covers HTML, text, JSON
// (JSON goes through as-is, so we assert on the shape the DB layer feeds
// the renderers) — plus the LIVE badge behaviour on each fixture status.
// -----------------------------------------------------------------------------

import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  escapeHtml,
  fixtureAsTextLine,
  type PublicEvent,
  type PublicFixture,
  renderFixtureCard,
  renderHtml,
  renderText,
} from "../../fixtures-public/render.ts";

const event: PublicEvent = {
  id: "ef111111-1111-1111-1111-111111111111",
  event_date: "2026-07-20",
  season_name: "Autumn 2026",
};

// Preserve explicit nulls that callers pass in — we care about the
// difference between "not set" (use default) and "set to null" (a bye,
// or a missing slot).
function fixture(over: Partial<PublicFixture> = {}): PublicFixture {
  const defaults: PublicFixture = {
    id: "f0111111-1111-1111-1111-111111111111",
    sport: "soccer",
    status: "scheduled",
    slot: { slot_number: 1, starts_at: "18:00:00", pitch: "Pitch A" },
    home_team_name: "Reds",
    away_team_name: "Blues",
    score: null,
  };
  return { ...defaults, ...over };
}

// ---------- text renderer -------------------------------------------------

Deno.test("text: scheduled shows 'vs' with no badge", () => {
  const line = fixtureAsTextLine(fixture());
  assertEquals(
    line,
    "Slot 1 — 18:00 @ Pitch A — soccer: Reds vs Blues",
  );
});

Deno.test("text: live shows the score and a [LIVE] badge", () => {
  const line = fixtureAsTextLine(
    fixture({ status: "live", score: { home: 2, away: 1 } }),
  );
  assertEquals(
    line,
    "Slot 1 — 18:00 @ Pitch A — soccer: Reds 2–1 Blues  [LIVE]",
  );
});

Deno.test("text: complete shows the score and an [FT] badge", () => {
  const line = fixtureAsTextLine(
    fixture({ status: "complete", score: { home: 3, away: 3 } }),
  );
  assertEquals(
    line,
    "Slot 1 — 18:00 @ Pitch A — soccer: Reds 3–3 Blues  [FT]",
  );
});

Deno.test("text: cancelled shows the [CANCELLED] badge without a score", () => {
  const line = fixtureAsTextLine(fixture({ status: "cancelled" }));
  assertEquals(
    line,
    "Slot 1 — 18:00 @ Pitch A — soccer: Reds vs Blues  [CANCELLED]",
  );
});

Deno.test("text: bye fixture renders '(bye)' and no score", () => {
  const line = fixtureAsTextLine(
    fixture({ away_team_name: null, status: "scheduled" }),
  );
  assertEquals(
    line,
    "Slot 1 — 18:00 @ Pitch A — soccer: Reds (bye)",
  );
});

Deno.test("text: missing slot falls back cleanly", () => {
  const line = fixtureAsTextLine(fixture({ slot: null }));
  assertEquals(
    line,
    "Slot ? — ??:?? — soccer: Reds vs Blues",
  );
});

Deno.test("renderText: begins with header + trailing newline", () => {
  const text = renderText(event, [fixture()]);
  assertStringIncludes(text, "Autumn 2026 — 2026-07-20");
  assertStringIncludes(text, "Tonight's draw");
  assertEquals(text.endsWith("\n"), true);
});

// ---------- HTML renderer -------------------------------------------------

Deno.test("html: escapes team names to prevent injection", () => {
  const html = renderFixtureCard(
    fixture({ home_team_name: `<script>alert(1)</script>` }),
  );
  assertStringIncludes(html, "&lt;script&gt;");
  assertEquals(html.includes("<script>"), false);
});

Deno.test("html: live status renders LIVE badge with accessible label", () => {
  const html = renderFixtureCard(
    fixture({ status: "live", score: { home: 2, away: 1 } }),
  );
  assertStringIncludes(html, "badge-live");
  assertStringIncludes(html, `aria-label="LIVE"`);
  assertStringIncludes(html, `>LIVE<`);
  // Score present, using en-dash separator.
  assertStringIncludes(html, `2–1`);
});

Deno.test("html: complete status renders FT badge, no LIVE class", () => {
  const html = renderFixtureCard(
    fixture({ status: "complete", score: { home: 3, away: 2 } }),
  );
  assertStringIncludes(html, "badge-final");
  assertStringIncludes(html, `>FT<`);
  assertEquals(html.includes("badge-live"), false);
});

Deno.test("html: scheduled has no badge and renders vs", () => {
  const html = renderFixtureCard(fixture({ status: "scheduled" }));
  assertEquals(html.includes("badge"), false);
  assertStringIncludes(html, "vs");
});

Deno.test("html: bye renders '(bye)' and no score/badge", () => {
  const html = renderFixtureCard(
    fixture({ away_team_name: null, status: "scheduled" }),
  );
  assertStringIncludes(html, "(bye)");
  assertEquals(html.includes("score"), false);
});

Deno.test("renderHtml: wraps every fixture card inside a single document", () => {
  const html = renderHtml(event, [
    fixture(),
    fixture({ status: "live", score: { home: 1, away: 0 } }),
  ]);
  assertStringIncludes(html, "<!doctype html>");
  assertStringIncludes(html, "Autumn 2026 — 2026-07-20");
  assertStringIncludes(html, "badge-live");
});

// ---------- escaping ------------------------------------------------------

Deno.test("escapeHtml: escapes all five entities", () => {
  assertEquals(
    escapeHtml(`<a href="x&y">'quote'</a>`),
    "&lt;a href=&quot;x&amp;y&quot;&gt;&#39;quote&#39;&lt;/a&gt;",
  );
});

// ---------- JSON shape sanity --------------------------------------------

Deno.test("JSON shape: score is null for scheduled, present for live/complete", () => {
  // The JSON route serialises the PublicFixture directly; this test just
  // documents the contract the DB layer must honour.
  const scheduled = fixture();
  assertEquals(scheduled.score, null);
  assertEquals(scheduled.status, "scheduled");

  const live = fixture({ status: "live", score: { home: 1, away: 1 } });
  assertEquals(live.score, { home: 1, away: 1 });
});
