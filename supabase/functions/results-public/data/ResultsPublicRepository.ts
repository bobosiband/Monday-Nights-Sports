// -----------------------------------------------------------------------------
// results-public/data/ResultsPublicRepository.ts
//
// Data access for the public results archive. RLS gates every table on
// `events.is_published = true`, so unpublished events never leak.
// -----------------------------------------------------------------------------

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { createServiceClient } from "../lib/SupabaseClientFactory.ts";

/** Shape of an event row returned from the archive queries. */
export interface EventRow {
  id: string;
  event_date: string;
  seasons: { name: string } | { name: string }[] | null;
}

/** Shape of a fixture joined with its result for the archive view. */
export interface FixtureWithResultRow {
  id: string;
  event_id: string;
  sport: string;
  home_team: { name: string } | null;
  away_team: { name: string } | null;
  results:
    | ResultRow
    | ResultRow[]
    | null;
}

/** Shape of a result row inside the fixtures join. */
export interface ResultRow {
  home_score: number;
  away_score: number;
  periods: Array<{ period: number; home: number; away: number }> | null;
  decided_by: string;
  confirmed_at: string;
}

/** Data access contract for the results-public service. */
export interface ResultsPublicRepository {
  loadEvent(eventId: string): Promise<EventRow | null>;
  loadEventsForSeason(
    seasonId: string,
    limit: number,
    beforeDate: string | null,
  ): Promise<EventRow[]>;
  loadFixturesWithResults(eventIds: string[]): Promise<FixtureWithResultRow[]>;
}

/** Supabase-backed implementation of `ResultsPublicRepository`. */
export class SupabaseResultsPublicRepository
  implements ResultsPublicRepository {
  private readonly client: SupabaseClient;

  /**
   * @param client - Supabase client; defaults to the service-role client.
   */
  constructor(client: SupabaseClient = createServiceClient()) {
    this.client = client;
  }

  /**
   * @param eventId - UUID of the event.
   * @returns The event row or `null` when not published or not found.
   */
  async loadEvent(eventId: string): Promise<EventRow | null> {
    const { data, error } = await this.client
      .from("events")
      .select("id, event_date, is_published, seasons ( name )")
      .eq("id", eventId)
      .eq("is_published", true)
      .maybeSingle();
    if (error) throw error;
    return (data as EventRow | null) ?? null;
  }

  /**
   * @param seasonId - Season UUID.
   * @param limit - Max rows to return.
   * @param beforeDate - Optional cursor; events strictly older.
   * @returns Event rows, newest first.
   */
  async loadEventsForSeason(
    seasonId: string,
    limit: number,
    beforeDate: string | null,
  ): Promise<EventRow[]> {
    let query = this.client
      .from("events")
      .select("id, event_date, is_published, seasons ( name )")
      .eq("season_id", seasonId)
      .eq("is_published", true)
      .order("event_date", { ascending: false })
      .limit(limit);
    if (beforeDate) query = query.lt("event_date", beforeDate);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []) as EventRow[];
  }

  /**
   * @param eventIds - Event UUIDs to fetch fixtures for.
   * @returns Fixtures with their result join; `[]` for an empty input.
   */
  async loadFixturesWithResults(
    eventIds: string[],
  ): Promise<FixtureWithResultRow[]> {
    if (eventIds.length === 0) return [];
    const { data, error } = await this.client
      .from("fixtures")
      .select(
        `id, event_id, sport,
         home_team:home_team_id ( name ),
         away_team:away_team_id ( name ),
         results ( home_score, away_score, periods, decided_by, confirmed_at )`,
      )
      .in("event_id", eventIds);
    if (error) throw error;
    return (data ?? []) as unknown as FixtureWithResultRow[];
  }
}
