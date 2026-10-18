// -----------------------------------------------------------------------------
// fixtures-public/data/FixturesPublicRepository.ts
//
// Data access for the public fixtures service. RLS gates every table
// involved on `events.is_published = true`, so an unpublished event id
// returns `null` naturally without a special-case check.
// -----------------------------------------------------------------------------

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { createServiceClient } from "../lib/SupabaseClientFactory.ts";
import type {
  PublicEvent,
  PublicFixture,
} from "../rendering/FixturesRenderer.ts";

/** DB-shape row for a fixture with team and slot joins. */
interface FixtureRow {
  id: string;
  sport: string;
  status: "scheduled" | "live" | "complete" | "cancelled";
  slots:
    | { slot_number: number; starts_at: string; pitch: string | null }
    | null;
  home_team: { name: string } | null;
  away_team: { name: string } | null;
}

/** DB-shape row for an event with the season name join. */
interface EventRow {
  id: string;
  event_date: string;
  is_published: boolean;
  seasons: { name: string } | null;
}

/** DB-shape rows for the two score sources. */
interface LiveStateRow {
  fixture_id: string;
  home_score: number;
  away_score: number;
}
interface ResultRow {
  fixture_id: string;
  home_score: number;
  away_score: number;
}

/** Data access contract for the public fixtures service. */
export interface FixturesPublicRepository {
  loadPublicEvent(eventId: string): Promise<
    { event: PublicEvent; fixtures: PublicFixture[] } | null
  >;
}

/** Supabase-backed implementation of `FixturesPublicRepository`. */
export class SupabaseFixturesPublicRepository
  implements FixturesPublicRepository {
  private readonly client: SupabaseClient;

  /**
   * @param client - Supabase client; defaults to the service-role client.
   */
  constructor(client: SupabaseClient = createServiceClient()) {
    this.client = client;
  }

  /**
   * Load a published event, its fixtures and the two score sources, then
   * shape everything into the renderer-ready view model.
   *
   * @param eventId - UUID of the event.
   * @returns The rendered-ready shape, or `null` when the event is not
   *          published or does not exist.
   */
  async loadPublicEvent(eventId: string): Promise<
    { event: PublicEvent; fixtures: PublicFixture[] } | null
  > {
    const { data: event, error: eventError } = await this.client
      .from("events")
      .select("id, event_date, is_published, seasons ( name )")
      .eq("id", eventId)
      .eq("is_published", true)
      .maybeSingle<EventRow>();
    if (eventError) throw eventError;
    if (!event) return null;

    const { data: fixtures, error: fixturesError } = await this.client
      .from("fixtures")
      .select(
        `id, sport, status,
         slots:slot_id ( slot_number, starts_at, pitch ),
         home_team:home_team_id ( name ),
         away_team:away_team_id ( name )`,
      )
      .eq("event_id", eventId);
    if (fixturesError) throw fixturesError;
    const rows = (fixtures ?? []) as unknown as FixtureRow[];
    rows.sort((a, b) =>
      (a.slots?.slot_number ?? 0) - (b.slots?.slot_number ?? 0)
    );

    const ids = rows.map((r) => r.id);

    // Two parallel score lookups. Empty `ids` short-circuits so an event
    // with no fixtures still returns cleanly.
    const [liveMap, resultMap] = ids.length === 0
      ? [new Map<string, LiveStateRow>(), new Map<string, ResultRow>()]
      : await Promise.all([this.loadLiveMap(ids), this.loadResultMap(ids)]);

    const publicEvent: PublicEvent = {
      id: event.id,
      event_date: event.event_date,
      season_name: event.seasons?.name ?? null,
    };

    const publicFixtures: PublicFixture[] = rows.map((row) => {
      // Prefer results (locked-in final) over live-state (in-flight cache).
      const result = resultMap.get(row.id);
      const live = liveMap.get(row.id);
      const score = result
        ? { home: result.home_score, away: result.away_score }
        : live
        ? { home: live.home_score, away: live.away_score }
        : null;

      return {
        id: row.id,
        sport: row.sport,
        status: row.status,
        slot: row.slots
          ? {
            slot_number: row.slots.slot_number,
            starts_at: row.slots.starts_at,
            pitch: row.slots.pitch,
          }
          : null,
        home_team_name: row.home_team?.name ?? null,
        away_team_name: row.away_team?.name ?? null,
        score,
      };
    });

    return { event: publicEvent, fixtures: publicFixtures };
  }

  /**
   * Load `fixture_live_state` rows for a set of fixture ids.
   *
   * @param ids - Fixture ids to fetch.
   * @returns A map keyed by `fixture_id`.
   */
  private async loadLiveMap(
    ids: string[],
  ): Promise<Map<string, LiveStateRow>> {
    const { data, error } = await this.client
      .from("fixture_live_state")
      .select("fixture_id, home_score, away_score")
      .in("fixture_id", ids);
    if (error) throw error;
    const out = new Map<string, LiveStateRow>();
    for (const r of (data ?? []) as LiveStateRow[]) out.set(r.fixture_id, r);
    return out;
  }

  /**
   * Load `results` rows for a set of fixture ids.
   *
   * @param ids - Fixture ids to fetch.
   * @returns A map keyed by `fixture_id`.
   */
  private async loadResultMap(
    ids: string[],
  ): Promise<Map<string, ResultRow>> {
    const { data, error } = await this.client
      .from("results")
      .select("fixture_id, home_score, away_score")
      .in("fixture_id", ids);
    if (error) throw error;
    const out = new Map<string, ResultRow>();
    for (const r of (data ?? []) as ResultRow[]) out.set(r.fixture_id, r);
    return out;
  }
}
