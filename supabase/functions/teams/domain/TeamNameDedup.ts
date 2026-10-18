// -----------------------------------------------------------------------------
// teams/domain/TeamNameDedup.ts
//
// Pure helper: case-insensitive dedupe for a proposed list of team names.
// Lives in `domain/` because it is the one piece of business logic the
// teams service owns (every team name is unique within a season, and the
// bulk-add path has to tell the organiser what was dropped and why).
// -----------------------------------------------------------------------------

/** Result of a case-insensitive dedupe pass. */
export interface DedupeResult {
  /** The deduped names, in input order, with the first casing preserved. */
  unique: string[];
  /** Case-preserved duplicates that were dropped. */
  dropped: string[];
}

/**
 * Dedupe a list of proposed team names case-insensitively while preserving
 * the caller's chosen casing for the first occurrence. Returns both the
 * deduped list and any duplicates dropped so the response can echo them.
 *
 * @param names - Raw candidate names.
 * @returns Both the unique list and the dropped duplicates.
 */
export function dedupeCaseInsensitive(names: string[]): DedupeResult {
  const seen = new Set<string>();
  const unique: string[] = [];
  const dropped: string[] = [];
  for (const n of names) {
    const key = n.toLowerCase();
    if (seen.has(key)) {
      dropped.push(n);
      continue;
    }
    seen.add(key);
    unique.push(n);
  }
  return { unique, dropped };
}
