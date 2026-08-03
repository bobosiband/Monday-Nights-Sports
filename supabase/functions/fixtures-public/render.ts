// -----------------------------------------------------------------------------
// fixtures-public/render.ts
//
// Pure rendering for the public fixtures response. Extracted from the HTTP
// handler so the HTML / text / JSON shapes can be exercised with unit tests
// (no DB, no Deno APIs used here).
//
// The public response now surfaces:
//   - `status` per fixture (scheduled / live / complete / cancelled) so a
//     viewer can see a "LIVE" badge on in-progress games.
//   - Current score for live / complete fixtures (from fixture_live_state
//     or results — merged by the caller).
//
// Accessibility note: the LIVE badge is high-contrast AND has a text label
// ("LIVE") so users who can't see the colour still get the signal. Do not
// change this to a colour-only indicator without adding an aria-label.
// -----------------------------------------------------------------------------

/**
 * Slot info attached to every fixture. All fields optional so a fixture
 * whose slot join failed still renders sanely.
 */
export interface SlotInfo {
  slot_number: number;
  starts_at: string;
  pitch: string | null;
}

/**
 * Optional score attached to a fixture. Present for `live` and `complete`
 * fixtures; omitted for `scheduled` / `cancelled`.
 */
export interface ScorePair {
  home: number;
  away: number;
}

/**
 * The public shape of a fixture that the renderers consume. The DB layer
 * shapes the row into this before calling in.
 */
export interface PublicFixture {
  id: string;
  sport: string;
  status: "scheduled" | "live" | "complete" | "cancelled";
  slot: SlotInfo | null;
  home_team_name: string | null;
  away_team_name: string | null;
  score: ScorePair | null;
}

export interface PublicEvent {
  id: string;
  event_date: string;
  season_name: string | null;
}

// ---------- shared helpers ------------------------------------------------

/**
 * Escape a string for safe HTML interpolation.
 *
 * @param value - Raw string.
 * @returns HTML-escaped string.
 */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Format a status for the text/HTML labels. Returns an empty string for
 * `scheduled` — the default pre-match state doesn't need decoration.
 *
 * @param status - The fixture's status.
 * @returns Human label or empty string.
 */
function statusLabel(status: PublicFixture["status"]): string {
  switch (status) {
    case "live":
      return "LIVE";
    case "complete":
      return "FT";
    case "cancelled":
      return "CANCELLED";
    default:
      return "";
  }
}

// ---------- text renderer -------------------------------------------------

/**
 * Format a fixture as a single plain-text line. Chat-friendly.
 *
 * Examples:
 *   Slot 1 — 18:00 @ Pitch A — soccer: Reds 2–1 Blues  [LIVE]
 *   Slot 2 — 18:45 — netball: Greens vs Yellows
 *   Slot 3 — 19:30 — soccer: Purples (bye)
 *
 * @param fixture - Public fixture.
 * @returns The one-line string.
 */
export function fixtureAsTextLine(fixture: PublicFixture): string {
  const slot = fixture.slot;
  const time = slot ? slot.starts_at.slice(0, 5) : "??:??";
  const pitch = slot?.pitch ? ` @ ${slot.pitch}` : "";
  const home = fixture.home_team_name ?? "TBD";
  const away = fixture.away_team_name;

  const badge = statusLabel(fixture.status);
  const badgeSuffix = badge ? `  [${badge}]` : "";

  let match: string;
  if (!away) {
    match = `${home} (bye)`;
  } else if (
    fixture.score &&
    (fixture.status === "live" || fixture.status === "complete")
  ) {
    // Use an en-dash between scores so it's not confused with a range
    // separator or a hyphenated word.
    match = `${home} ${fixture.score.home}–${fixture.score.away} ${away}`;
  } else {
    match = `${home} vs ${away}`;
  }

  return `Slot ${
    slot?.slot_number ?? "?"
  } — ${time}${pitch} — ${fixture.sport}: ${match}${badgeSuffix}`;
}

/**
 * Render the whole event as plain text — header + fixtures. The trailing
 * newline is intentional so pasting into a chat app never loses the last
 * line to a redraw.
 *
 * @param event - The event.
 * @param fixtures - Ordered fixtures.
 * @returns A UTF-8 string ready for a text/plain response.
 */
export function renderText(
  event: PublicEvent,
  fixtures: PublicFixture[],
): string {
  const seasonName = event.season_name ?? "Season";
  const header = `${seasonName} — ${event.event_date}\nTonight's draw\n`;
  const body = fixtures.map(fixtureAsTextLine).join("\n");
  return `${header}\n${body}\n`;
}

// ---------- HTML renderer -------------------------------------------------

/**
 * Render one fixture's `<li>` card. Kept as its own function so the
 * template is easy to eyeball.
 *
 * @param fixture - Public fixture.
 * @returns HTML for the card.
 */
export function renderFixtureCard(fixture: PublicFixture): string {
  const slot = fixture.slot;
  const time = slot ? slot.starts_at.slice(0, 5) : "??:??";
  const pitch = slot?.pitch ? escapeHtml(slot.pitch) : "";
  const home = escapeHtml(fixture.home_team_name ?? "TBD");
  const awayName = fixture.away_team_name
    ? escapeHtml(fixture.away_team_name)
    : null;

  let matchHtml: string;
  if (!awayName) {
    matchHtml = `${home} <em>(bye)</em>`;
  } else if (
    fixture.score &&
    (fixture.status === "live" || fixture.status === "complete")
  ) {
    matchHtml =
      `${home} <span class="score">${fixture.score.home}–${fixture.score.away}</span> ${awayName}`;
  } else {
    matchHtml = `${home} <span class="v">vs</span> ${awayName}`;
  }

  const badgeClass = fixture.status === "live"
    ? "badge badge-live"
    : fixture.status === "complete"
    ? "badge badge-final"
    : fixture.status === "cancelled"
    ? "badge badge-cancelled"
    : "";
  const badge = badgeClass
    ? `<span class="${badgeClass}" role="status" aria-label="${
      statusLabel(fixture.status)
    }">${statusLabel(fixture.status)}</span>`
    : "";

  return `
        <li class="card">
          <div class="slot">Slot ${slot?.slot_number ?? "?"} ${badge}</div>
          <div class="time">${time}${pitch ? ` · ${pitch}` : ""}</div>
          <div class="sport">${escapeHtml(fixture.sport)}</div>
          <div class="match">${matchHtml}</div>
        </li>`;
}

/**
 * Render the whole event as an HTML document.
 *
 * @param event - The event.
 * @param fixtures - Ordered fixtures.
 * @returns Full HTML document.
 */
export function renderHtml(
  event: PublicEvent,
  fixtures: PublicFixture[],
): string {
  const seasonName = event.season_name ?? "Season";
  const title = `${escapeHtml(seasonName)} — ${escapeHtml(event.event_date)}`;
  const rows = fixtures.map(renderFixtureCard).join("");

  // Badge styling: high contrast on the dark background, plus a text
  // label so users who can't see the colour still read "LIVE". The pulse
  // animation only runs when prefers-reduced-motion is *not* set — a
  // constant-flashing dot is disorienting for some users.
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    :root { color-scheme: dark; }
    body { margin: 0; font-family: system-ui, -apple-system, sans-serif;
      background: #0b0f14; color: #e6edf3; }
    header { padding: 1.25rem 1rem; border-bottom: 1px solid #1f2937; }
    header h1 { margin: 0; font-size: 1.1rem; font-weight: 600; }
    header p { margin: 0.25rem 0 0; color: #94a3b8; font-size: 0.9rem; }
    ul { list-style: none; margin: 0; padding: 1rem; display: grid; gap: 0.75rem; }
    .card { background: #111827; border: 1px solid #1f2937; border-radius: 12px;
      padding: 0.9rem 1rem; display: grid; gap: 0.15rem; }
    .slot { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.08em;
      color: #38bdf8; font-weight: 600; display: flex; align-items: center;
      justify-content: space-between; gap: 0.5rem; }
    .time { color: #94a3b8; font-size: 0.85rem; }
    .sport { font-size: 0.85rem; color: #cbd5e1; }
    .match { font-size: 1.05rem; font-weight: 600; }
    .v { color: #64748b; font-weight: 400; padding: 0 0.4rem; }
    .score { color: #f8fafc; font-weight: 700; padding: 0 0.35rem; }
    .badge { display: inline-block; font-size: 0.7rem; font-weight: 800;
      letter-spacing: 0.1em; padding: 0.15rem 0.5rem; border-radius: 999px;
      border: 1px solid transparent; }
    .badge-live { background: #dc2626; color: #fff; border-color: #ef4444; }
    @media (prefers-reduced-motion: no-preference) {
      .badge-live::before { content: "● "; animation: pulse 1.4s infinite; }
      @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
    }
    .badge-final { background: #1f2937; color: #e6edf3; border-color: #374151; }
    .badge-cancelled { background: #374151; color: #9ca3af; border-color: #4b5563;
      text-decoration: line-through; }
    footer { padding: 1rem; color: #64748b; font-size: 0.8rem; text-align: center; }
  </style>
</head>
<body>
  <header>
    <h1>${title}</h1>
    <p>Tonight's draw</p>
  </header>
  <ul>${rows}</ul>
  <footer>Monday Night Sports</footer>
</body>
</html>`;
}
