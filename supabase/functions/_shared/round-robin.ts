// -----------------------------------------------------------------------------
// _shared/round-robin.ts
//
// Pure round-robin draw generator. Given a list of team ids, returns a
// single round-robin schedule where every unordered pair of teams meets
// exactly once. Odd team counts are handled by inserting a virtual bye
// slot, so each real team gets exactly one bye across the tournament.
//
// Kept dependency-free and side-effect-free — no DB access, no `Deno`
// APIs, no `Date.now()`, no `Math.random()` — so it can be unit-tested
// without any host services and safely reused wherever the organiser
// tooling needs to propose a draw. The caller controls seeding: shuffle
// the input team ids upstream if you want a randomised schedule.
//
// Algorithm: **circle method.**
//
//   1. If the input length is odd, append a `null` sentinel so the
//      working list has even length N. The sentinel represents "no
//      opponent this round" — the team paired against it gets a bye.
//   2. Fix the first team in its seat; the remaining N-1 teams rotate
//      one seat clockwise per round.
//   3. Each round pairs seat i with seat (N-1-i) for i in [0, N/2).
//   4. Total rounds = N - 1. Every unordered pair of real teams meets
//      exactly once by construction.
//
// A tiny worked example (4 teams, seats: A B C D):
//
//   Round 1: A vs D, B vs C
//   Round 2: A vs C, D vs B    (rotate B/C/D one seat: D B C)
//   Round 3: A vs B, C vs D    (rotate again: C D B)
//
// With 3 teams (odd, so we append `null`, seats: A B C _):
//
//   Round 1: A vs _   (BYE for A), B vs C
//   Round 2: A vs C,               _ vs B  → BYE for B
//   Round 3: A vs B,               C vs _  → BYE for C
//
// -----------------------------------------------------------------------------

/**
 * A single fixture in the generated schedule.
 *
 * `round` is 1-indexed so it reads naturally in UIs. `away_team_id` is
 * `null` when the home team is on a bye for that round — matches the
 * shape already used elsewhere in the codebase (`fixtures.away_team_id`
 * is nullable to signal a bye).
 */
export interface RoundRobinFixture {
  round: number;
  home_team_id: string;
  away_team_id: string | null;
}

/**
 * Generate a single round-robin schedule for a list of team ids.
 *
 * Deterministic: given the same input in the same order, the returned
 * schedule is identical. Callers that want randomised draws should
 * shuffle the input before calling — mixing randomness into the
 * scheduler would make it un-testable and would silently change every
 * generated draw between organiser reviews.
 *
 * Guarantees (all covered by the test suite):
 * - Every unordered pair of real teams appears exactly once.
 * - Total rounds = `n - 1` for even `n`; equals `n` for odd `n` (the
 *   sentinel adds one seat, so `(n + 1) - 1 = n` rounds).
 * - Each real team gets exactly one bye when `n` is odd; no team gets
 *   a bye when `n` is even.
 * - `home_team_id` in a bye fixture is always the real team; the
 *   sentinel never surfaces to callers.
 *
 * Home/away balance across rounds is **not** guaranteed — some teams
 * will land in the "home" seat more often than others by shape of the
 * rotation. Balancing is a follow-up (see the epic in the tracker).
 *
 * @param teamIds - Team ids, in the order the caller wants seated.
 *                  0-length input returns `[]`; 1-length returns `[]`
 *                  (a single team can't play itself).
 * @returns Array of fixtures, ordered by `round` ascending.
 */
export function generateRoundRobin(teamIds: string[]): RoundRobinFixture[] {
  // A single team (or none) can't fill a schedule. Return empty rather
  // than throwing so the caller can trust the return type and render
  // "no fixtures" naturally.
  if (teamIds.length < 2) return [];

  // Copy so we don't mutate the caller's array during the rotation.
  const seats: (string | null)[] = [...teamIds];
  if (seats.length % 2 === 1) {
    // Sentinel represents "no opponent" — never leaks out of this
    // module. The rotation still fills every seat.
    seats.push(null);
  }

  const n = seats.length;
  const rounds = n - 1;
  const halfRound = n / 2;
  const fixtures: RoundRobinFixture[] = [];

  for (let round = 1; round <= rounds; round++) {
    for (let i = 0; i < halfRound; i++) {
      const a = seats[i];
      const b = seats[n - 1 - i];

      // The sentinel means "bye for the real team". Reorient so
      // `home_team_id` is always the real team and `away_team_id` is
      // null — no null ever appears as a home id.
      if (a === null && b === null) continue; // impossible for n >= 2, but defensive
      if (a === null) {
        fixtures.push({ round, home_team_id: b as string, away_team_id: null });
      } else if (b === null) {
        fixtures.push({ round, home_team_id: a, away_team_id: null });
      } else {
        fixtures.push({ round, home_team_id: a, away_team_id: b });
      }
    }

    // Rotate: seat 0 stays fixed; seats 1..n-1 shift one position to
    // the right, with seat n-1 wrapping into seat 1.
    rotate(seats);
  }

  return fixtures;
}

/**
 * In-place clockwise rotation of `seats[1..n-1]` by one position, with
 * `seats[0]` left fixed. This is the "fix one, rotate the rest" step of
 * the circle method.
 *
 * Uses a manual copy loop instead of `splice`/`unshift` — those allocate
 * intermediate arrays per call, and this function runs once per round
 * for every draw generation.
 *
 * @param seats - The working seat array; mutated in place.
 */
function rotate(seats: (string | null)[]): void {
  if (seats.length <= 2) return;
  const last = seats[seats.length - 1];
  for (let i = seats.length - 1; i > 1; i--) {
    seats[i] = seats[i - 1];
  }
  seats[1] = last;
}
