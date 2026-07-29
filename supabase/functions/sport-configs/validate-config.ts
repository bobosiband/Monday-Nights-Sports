// -----------------------------------------------------------------------------
// sport-configs/validate-config.ts
//
// Deep validation of the `config` JSONB blob before it enters the DB. Split
// out of index.ts so tests can import it without booting the HTTP server.
//
// Strictness rationale: an accepted-but-wrong config corrupts BOTH the
// scoring screen (via `_shared/score.ts` + `scoring/validate-event.ts`) AND
// the standings table (via `_shared/standings.ts`). It's cheaper to reject
// on the write path than to debug a wrong-looking leaderboard later.
//
// Permissive where absent is fine: `deriveScore` and `computeStandings`
// both tolerate an empty config, so we only fail writes whose values are
// *actively wrong* (wrong type, negative counts, non-integer periods,
// etc.).
// -----------------------------------------------------------------------------

/**
 * Validation result shape used by every validator: `{ ok: true, value }`
 * or `{ ok: false, error }`. Matches the convention in
 * `_shared/validate.ts` and `scoring/validate-event.ts` so callers can
 * pattern-match uniformly.
 */
export type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Validate the `config` JSONB from a `sport-configs` request body.
 *
 * Rules:
 *   - Top-level must be a JSON object.
 *   - `periods.count`       — positive integer (required inside `periods`).
 *   - `periods.minutes`     — positive integer (when present).
 *   - `periods.direction`   — must be 'up' or 'down' (when present).
 *   - `score_increments`    — non-empty array of positive integers.
 *   - `track_fouls`         — boolean (when present).
 *   - `standings.points`    — object with `win`, `draw`, `loss` each a
 *                             non-negative integer.
 *   - `standings.tiebreakers` — array of strings; unknown names are
 *                             tolerated by `computeStandings`, so we only
 *                             gate the shape, not the spelling.
 *
 * @param raw - The `config` value from the request body.
 * @returns The accepted config (typed loosely as an object) or an error
 *          message suitable for a 400.
 */
export function validateConfig(
  raw: unknown,
): Validated<Record<string, unknown>> {
  if (
    raw === null || raw === undefined || typeof raw !== "object" ||
    Array.isArray(raw)
  ) {
    return { ok: false, error: "config must be a JSON object" };
  }
  const config = raw as Record<string, unknown>;

  if ("periods" in config) {
    const p = config.periods;
    if (!p || typeof p !== "object" || Array.isArray(p)) {
      return { ok: false, error: "periods must be an object" };
    }
    const pp = p as Record<string, unknown>;
    if (!Number.isInteger(pp.count) || (pp.count as number) <= 0) {
      return { ok: false, error: "periods.count must be a positive integer" };
    }
    if (
      "minutes" in pp &&
      (!Number.isInteger(pp.minutes) || (pp.minutes as number) <= 0)
    ) {
      return { ok: false, error: "periods.minutes must be a positive integer" };
    }
    if (
      "direction" in pp && pp.direction !== "up" && pp.direction !== "down"
    ) {
      return { ok: false, error: "periods.direction must be 'up' or 'down'" };
    }
  }

  if ("score_increments" in config) {
    const inc = config.score_increments;
    if (!Array.isArray(inc) || inc.length === 0) {
      return {
        ok: false,
        error: "score_increments must be a non-empty array",
      };
    }
    for (const v of inc) {
      if (!Number.isInteger(v) || (v as number) <= 0) {
        return {
          ok: false,
          error: "score_increments entries must be positive integers",
        };
      }
    }
  }

  if ("track_fouls" in config && typeof config.track_fouls !== "boolean") {
    return { ok: false, error: "track_fouls must be a boolean" };
  }

  if ("standings" in config) {
    const s = config.standings;
    if (!s || typeof s !== "object" || Array.isArray(s)) {
      return { ok: false, error: "standings must be an object" };
    }
    const ss = s as Record<string, unknown>;
    if ("points" in ss) {
      const pts = ss.points;
      if (!pts || typeof pts !== "object" || Array.isArray(pts)) {
        return { ok: false, error: "standings.points must be an object" };
      }
      for (const key of ["win", "draw", "loss"] as const) {
        const v = (pts as Record<string, unknown>)[key];
        if (!Number.isInteger(v) || (v as number) < 0) {
          return {
            ok: false,
            error: `standings.points.${key} must be a non-negative integer`,
          };
        }
      }
    }
    if ("tiebreakers" in ss) {
      const tb = ss.tiebreakers;
      if (!Array.isArray(tb) || tb.some((t) => typeof t !== "string")) {
        return {
          ok: false,
          error: "standings.tiebreakers must be an array of strings",
        };
      }
    }
  }

  return { ok: true, value: config };
}
