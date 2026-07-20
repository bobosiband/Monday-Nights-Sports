// -----------------------------------------------------------------------------
// fixtures-public/index.ts
//
// Public delivery of a published event's draw. No authentication required —
// this is the URL that gets dropped into the group chat.
//
// Routes:
//   GET /fixtures-public?event=<uuid>              → HTML (default)
//   GET /fixtures-public?event=<uuid>&format=text  → plain text (chat-friendly)
//   GET /fixtures-public?event=<uuid>&format=json  → JSON (debug / integrators)
//
// RLS on the underlying tables restricts reads to published events, so an
// unpublished event id returns 404 even with a valid client — no separate
// check needed here.
// -----------------------------------------------------------------------------

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  corsHeaders,
  handlePreflight,
  jsonResponse,
} from "../_shared/cors.ts";
import { createServiceClient } from "../_shared/supabase-client.ts";

interface FixtureRow {
  id: string;
  sport: string;
  status: string;
  slots: { slot_number: number; starts_at: string; pitch: string | null } | null;
  home_team: { name: string } | null;
  away_team: { name: string } | null;
}

interface EventRow {
  id: string;
  event_date: string;
  is_published: boolean;
  seasons: { name: string } | null;
}

/**
 * Load a published event and its fixtures. Returns `null` when the event
 * doesn't exist or isn't published — RLS handles the publication check.
 *
 * @param eventId - UUID of the event.
 * @returns The event row plus its fixtures ordered by slot, or `null`.
 */
async function loadPublishedEvent(eventId: string): Promise<
  { event: EventRow; fixtures: FixtureRow[] } | null
> {
  const supabase = createServiceClient();

  const { data: event, error: eventError } = await supabase
    .from("events")
    .select("id, event_date, is_published, seasons ( name )")
    .eq("id", eventId)
    .eq("is_published", true)
    .maybeSingle<EventRow>();

  if (eventError) throw eventError;
  if (!event) return null;

  const { data: fixtures, error: fixturesError } = await supabase
    .from("fixtures")
    .select(
      `id, sport, status,
       slots:slot_id ( slot_number, starts_at, pitch ),
       home_team:home_team_id ( name ),
       away_team:away_team_id ( name )`,
    )
    .eq("event_id", eventId)
    .order("slot_id", { ascending: true });

  if (fixturesError) throw fixturesError;

  const rows = (fixtures ?? []) as unknown as FixtureRow[];
  rows.sort((a, b) => (a.slots?.slot_number ?? 0) - (b.slots?.slot_number ?? 0));
  return { event, fixtures: rows };
}

/**
 * Format a fixture as a single plain-text line suitable for pasting into a
 * chat app. Byes render with a trailing "(bye)".
 *
 * @param fixture - A fixture row with slot + team relations expanded.
 * @returns The one-line string.
 */
function fixtureAsTextLine(fixture: FixtureRow): string {
  const slot = fixture.slots;
  const time = slot ? slot.starts_at.slice(0, 5) : "??:??";
  const pitch = slot?.pitch ? ` @ ${slot.pitch}` : "";
  const home = fixture.home_team?.name ?? "TBD";
  const away = fixture.away_team?.name;
  const match = away ? `${home} vs ${away}` : `${home} (bye)`;
  return `Slot ${slot?.slot_number ?? "?"} — ${time}${pitch} — ${fixture.sport}: ${match}`;
}

/**
 * Escape a string for safe interpolation into HTML. Small helper so the
 * function has no runtime template dependency.
 *
 * @param value - Raw string.
 * @returns HTML-escaped string.
 */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Render the event and its fixtures as a mobile-friendly HTML page. Kept as
 * a single string template — no framework, so the frontend team is free to
 * replace this with anything later without touching the API surface.
 *
 * @param event - The event row.
 * @param fixtures - Ordered fixtures for the event.
 * @returns Full HTML document.
 */
function renderHtml(event: EventRow, fixtures: FixtureRow[]): string {
  const seasonName = event.seasons?.name ?? "Season";
  const title = `${escapeHtml(seasonName)} — ${escapeHtml(event.event_date)}`;
  const rows = fixtures
    .map((f) => {
      const slot = f.slots;
      const time = slot ? slot.starts_at.slice(0, 5) : "??:??";
      const pitch = slot?.pitch ? escapeHtml(slot.pitch) : "";
      const home = escapeHtml(f.home_team?.name ?? "TBD");
      const away = f.away_team?.name ? escapeHtml(f.away_team.name) : null;
      const match = away ? `${home} <span class="v">vs</span> ${away}` : `${home} <em>(bye)</em>`;
      return `
        <li class="card">
          <div class="slot">Slot ${slot?.slot_number ?? "?"}</div>
          <div class="time">${time}${pitch ? ` · ${pitch}` : ""}</div>
          <div class="sport">${escapeHtml(f.sport)}</div>
          <div class="match">${match}</div>
        </li>`;
    })
    .join("");

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
      color: #38bdf8; font-weight: 600; }
    .time { color: #94a3b8; font-size: 0.85rem; }
    .sport { font-size: 0.85rem; color: #cbd5e1; }
    .match { font-size: 1.05rem; font-weight: 600; }
    .v { color: #64748b; font-weight: 400; padding: 0 0.4rem; }
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

serve(async (request) => {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  if (request.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const url = new URL(request.url);
  const eventId = url.searchParams.get("event");
  const format = url.searchParams.get("format") ?? "html";

  if (!eventId) {
    return jsonResponse({ error: "Missing required query param: event" }, 400);
  }

  try {
    const result = await loadPublishedEvent(eventId);
    if (!result) {
      return jsonResponse({ error: "Event not found or not published" }, 404);
    }

    if (format === "json") {
      return jsonResponse({ event: result.event, fixtures: result.fixtures });
    }

    if (format === "text") {
      const seasonName = result.event.seasons?.name ?? "Season";
      const header = `${seasonName} — ${result.event.event_date}\nTonight's draw\n`;
      const body = result.fixtures.map(fixtureAsTextLine).join("\n");
      return new Response(`${header}\n${body}\n`, {
        status: 200,
        headers: { ...corsHeaders, "content-type": "text/plain; charset=utf-8" },
      });
    }

    return new Response(renderHtml(result.event, result.fixtures), {
      status: 200,
      headers: { ...corsHeaders, "content-type": "text/html; charset=utf-8" },
    });
  } catch (error) {
    console.error("fixtures-public error:", error);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
