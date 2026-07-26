// -----------------------------------------------------------------------------
// scoring/types.ts
//
// Request/response types local to the scoring service. Shared shapes
// (MatchEvent, SportConfig, DerivedScore) live in `_shared/score.ts` and are
// re-exported here so handlers only pull from one place.
// -----------------------------------------------------------------------------

import type {
  DerivedScore,
  MatchEvent,
  MatchEventType,
  SportConfig,
} from "../_shared/score.ts";
import type { MatchAccessContext } from "./guard.ts";
import type { DecidedBy, FixtureStatus } from "./constants.ts";

export type {
  DerivedScore,
  MatchAccessContext,
  MatchEvent,
  MatchEventType,
  SportConfig,
};

/**
 * Parsed URL context resolved by the router. Passed through the guard into
 * the handler so no handler re-parses the path.
 */
export interface RouteContext {
  fixtureId: string;
  action: string;
}

/**
 * Fixture context loaded once at the start of a handler and threaded into
 * DB / derivation calls.
 */
export interface FixtureContext {
  id: string;
  event_id: string;
  season_id: string;
  home_team_id: string;
  away_team_id: string | null;
  sport: string;
  status: FixtureStatus;
}

// ---------- request bodies ---------- ------------------------------------

/**
 * Body accepted by POST /:fixtureId/events. `id` is client-supplied so the
 * insert is idempotent under retry.
 */
export interface RecordEventBody {
  id?: unknown;
  type?: unknown;
  team_id?: unknown;
  player_id?: unknown;
  value?: unknown;
  period?: unknown;
  match_clock_ms?: unknown;
}

/**
 * Body accepted by POST /:fixtureId/undo. Targets a specific event id so
 * retries and out-of-order queue drains stay unambiguous.
 */
export interface UndoBody {
  event_id?: unknown;
}

/**
 * Body accepted by POST /:fixtureId/period. `intent` is `start` or `end`;
 * `period` names the period number the intent applies to.
 */
export interface PeriodBody {
  intent?: unknown;
  period?: unknown;
  match_clock_ms?: unknown;
}

/**
 * Body accepted by POST /:fixtureId/finalize. `decided_by` defaults to
 * `'normal'`; `reopen` allows re-finalizing a fixture whose result was
 * already snapshotted (organiser correction path).
 */
export interface FinalizeBody {
  decided_by?: unknown;
  reopen?: unknown;
}

// ---------- response payloads --------------------------------------------

/**
 * Response returned by record/undo/period/finalize routes. Includes the
 * post-write derived score so an optimistic client can reconcile.
 */
export interface DerivedResponse {
  fixture_id: string;
  fixture_status: FixtureStatus;
  derived: DerivedScore;
}

/**
 * Response returned specifically by record — echoes what the caller sent
 * so a retried insert (idempotent) still tells them which event id landed.
 */
export interface RecordEventResponse extends DerivedResponse {
  event_id: string;
  inserted: boolean;
}

/**
 * Response returned by finalize — additionally carries the snapshot that
 * was written to `results`.
 */
export interface FinalizeResponse extends DerivedResponse {
  result: {
    home_score: number;
    away_score: number;
    periods: PeriodBreakdown[];
    decided_by: DecidedBy;
  };
}

/**
 * A period-by-period breakdown row, persisted into `results.periods`.
 */
export interface PeriodBreakdown {
  period: number;
  home: number;
  away: number;
}
