// -----------------------------------------------------------------------------
// live/data/LiveRepository.ts
//
// Data access for the public live-score endpoint. Uses the service-role
// client, but also enforces the "event must be published" gate in the
// query itself so unpublished events return null even when the client
// bypasses RLS.
// -----------------------------------------------------------------------------

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { createServiceClient } from "../lib/SupabaseClientFactory.ts";
import type {
  FixtureForSummary,
  LiveStateForSummary,
} from "../domain/LiveSummary.ts";

/** Data access contract for the live service. */
export interface LiveRepository {
  loadFixture(fixtureId: string): Promise<FixtureForSummary | null>;
  loadLive(fixtureId: string): Promise<LiveStateForSummary | null>;
  loadEventFixtures(eventId: string): Promise<
    | Array<{ fixture: FixtureForSummary; live: LiveStateForSummary | null }>
    | null
  >;
}

/** Supabase-backed implementation of `LiveRepository`. */
export class SupabaseLiveRepository implements LiveRepository {
  private readonly client: SupabaseClient;

  /**
   * @param client - Supabase client; defaults to the service-role client.
   */
  constructor(client: SupabaseClient = createServiceClient()) {
    this.client = client;
  }

  /**
   * Load one fixture (with team names) whose parent event is published.
   *
   * @param fixtureId - UUID of the fixture.
   * @returns Fixture row or `null`.
   */
  async loadFixture(fixtureId: string): Promise<FixtureForSummary | null> {
    const { data: fixture, error } = await this.client
      .from("fixtures")
      .select(
        `id, event_id, sport, status, home_team_id, away_team_id,
         home_team:home_team_id ( name ),
         away_team:away_team_id ( name ),
         events:event_id ( is_published )`,
      )
      .eq("id", fixtureId)
      .maybeSingle();
    if (error) throw error;
    if (!fixture) return null;

    const events = (fixture as unknown as {
      events:
        | { is_published: boolean }
        | { is_published: boolean }[]
        | null;
    }).events;
    const published = Array.isArray(events)
      ? events[0]?.is_published
      : events?.is_published;
    if (!published) return null;

    return {
      id: fixture.id,
      event_id: fixture.event_id,
      sport: fixture.sport,
      status: fixture.status,
      home_team_id: fixture.home_team_id,
      away_team_id: fixture.away_team_id,
      home_team: (fixture as unknown as {
        home_team: { name: string } | null;
      }).home_team,
      away_team: (fixture as unknown as {
        away_team: { name: string } | null;
      }).away_team,
    };
  }

  /**
   * @param fixtureId - Fixture id.
   * @returns The live-state projection row, or `null` when none exists.
   */
  async loadLive(
    fixtureId: string,
  ): Promise<LiveStateForSummary | null> {
    const { data, error } = await this.client
      .from("fixture_live_state")
      .select(
        "fixture_id, home_score, away_score, fouls, current_period, status, last_event_at",
      )
      .eq("fixture_id", fixtureId)
      .maybeSingle();
    if (error) throw error;
    return (data as LiveStateForSummary | null) ?? null;
  }

  /**
   * Load every fixture for a published event, each paired with its
   * live-state row (or `null`).
   *
   * @param eventId - UUID of the event.
   * @returns Array of `{ fixture, live }` pairs, or `null` when the event
   *          is missing or unpublished.
   */
  async loadEventFixtures(eventId: string): Promise<
    | Array<{ fixture: FixtureForSummary; live: LiveStateForSummary | null }>
    | null
  > {
    const { data: event, error: eventErr } = await this.client
      .from("events")
      .select("id, is_published")
      .eq("id", eventId)
      .maybeSingle();
    if (eventErr) throw eventErr;
    if (!event || !event.is_published) return null;

    const { data: fixtures, error: fixErr } = await this.client
      .from("fixtures")
      .select(
        `id, event_id, sport, status, home_team_id, away_team_id,
         home_team:home_team_id ( name ),
         away_team:away_team_id ( name )`,
      )
      .eq("event_id", eventId);
    if (fixErr) throw fixErr;

    const fixtureRows = (fixtures ?? []) as unknown as FixtureForSummary[];
    if (fixtureRows.length === 0) return [];

    const ids = fixtureRows.map((f) => f.id);
    const { data: liveRows, error: liveErr } = await this.client
      .from("fixture_live_state")
      .select(
        "fixture_id, home_score, away_score, fouls, current_period, status, last_event_at",
      )
      .in("fixture_id", ids);
    if (liveErr) throw liveErr;

    const byFixture = new Map<string, LiveStateForSummary>();
    for (const r of (liveRows ?? []) as LiveStateForSummary[]) {
      byFixture.set(r.fixture_id, r);
    }

    return fixtureRows.map((fixture) => ({
      fixture,
      live: byFixture.get(fixture.id) ?? null,
    }));
  }
}
