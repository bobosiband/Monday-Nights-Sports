# scoring

Match-code-gated writes for a live-scored fixture. Every request is bound to a
`match_access` row minted by the `match-access` service.

See `docs/decisions/0002-operator-access-model-v2.md` for the auth model,
`docs/decisions/0003-realtime-projection.md` for the live-state projection, and
`docs/decisions/0007-service-ownership-and-layout.md` for why the scoring
service owns the score fold, the period helpers and the match-token hasher.

## Routes

Every route is `POST` and requires an `Authorization: Bearer <match-code>`
header.

| Path                           | Purpose                                                    |
| ------------------------------ | ---------------------------------------------------------- |
| `/scoring/:fixtureId/start`    | Flip `fixtures.status` to `live` (idempotent).             |
| `/scoring/:fixtureId/events`   | Record a match event (idempotent on client-supplied `id`). |
| `/scoring/:fixtureId/undo`     | Soft-void a specific event id.                             |
| `/scoring/:fixtureId/period`   | Record `period_start` or `period_end`.                     |
| `/scoring/:fixtureId/finalize` | Snapshot the result and mark the fixture complete.         |

## Who may call it

Any holder of a valid, unexpired, unrevoked `match_access` row for the targeted
fixture. A code minted for fixture A used against fixture B returns 403.

## Rules it owns (ADR 0007)

- Score derivation: `domain/ScoreCalculator.ts` holds the pure fold.
- Scoring format: `domain/ScoringFormat.ts` defines the open/closed seam with
  one implementation today, `HeadToHeadScoringFormat`.
- Period lifecycle helpers: `domain/PeriodState.ts` and
  `domain/PeriodBreakdown.ts`.
- Match-code verification: `security/MatchTokenGuard.ts` plus
  `security/MatchTokenHasher.ts`. The hasher is a two-service contract with
  `match-access`; the pinned DEVCODE1 digest in
  `tests/scoring/MatchTokenHasher.test.ts` must match the twin in
  `tests/match-access/`.
- Projection: every handler funnels through `handlers/DerivedResponse.ts`, which
  upserts `fixture_live_state` and swallows errors so the event log stays
  authoritative.
- Fixture lifecycle: scoring owns the `scheduled -> live` transition (first
  event or `/start`) and the `live -> complete` transition (`/finalize`). Only
  `/finalize` may re-finalize, and only with `{ "reopen": true }`.

## Environment variables

| Var                         | Purpose                            |
| --------------------------- | ---------------------------------- |
| `SUPABASE_URL`              | Base URL for the Supabase project. |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key.                  |

## Running the tests

```bash
deno test --allow-net --allow-env tests/scoring/
```

The suite covers the score calculator, the period helpers, the body validator,
the match-token guard (with an injected fake lookup) and the match-token hasher
(with the pinned DEVCODE1 digest).
