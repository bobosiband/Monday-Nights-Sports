# ADR 0001 — Operator access model: signed JWT + DB revocation list

**Status:** Superseded by [ADR 0002](0002-operator-access-model-v2.md) on
2026-07-26. See that ADR for the model that actually shipped. **Stories:** #36
(decide + implement primitive), #38 (use it in scoring). **Supersedes:** the
open question in
[`../scoring-viewing-backend-plan.md`](../scoring-viewing-backend-plan.md) §8.

## Context

Sideline scoring operators need a credential to hit the scoring Edge Function
but not a full Supabase Auth account. The plan doc §8 left two options open:

- **Signed short JWT** with a `fixture_id` claim. No DB row required. Natural
  expiry.
- **`match_access` table** with `token_hash`, `expires_at`, `revoked_at`.
  Requires DB writes; revocation is trivial.

Both give the same 401/403 shape at the API boundary. The real difference is
whether a live token can be pulled back before it expires. An organiser who
hands a code to a volunteer that walks away mid-match needs that revocation.

## Decision

**Signed short JWT (HS256), plus a `match_access` table used only as a
revocation list keyed by `jti`.**

- Sign with a dedicated `MATCH_TOKEN_SECRET` (env var). **Do not** reuse the
  Supabase Auth JWT secret — separating them means a compromised match-token
  secret cannot forge Supabase Auth sessions, and rotating it invalidates only
  outstanding match tokens.
- TTL: default 6 hours, bounded max 24 hours. Enough for a Monday-night event
  (~4 slots × ~45 min = 3 h) plus slack; short enough that a leaked code
  self-heals overnight even without an explicit revoke.
- Claims: `{ fixture_id, jti, iat, exp, sub, typ: "match_token" }`. `sub` is the
  organiser user id that minted it (for audit). `typ` prevents accidental
  cross-use of a Supabase Auth JWT here (it would fail the type check even if
  the secrets somehow collided).
- **Mint does not write to the DB.** The token exists purely by virtue of being
  a valid signed JWT. Zero-DB mint means no reservation collisions and no
  clock-skew retry logic.
- **Revoke inserts a row**
  `match_access(id = jti, fixture_id, revoked_at,
  revoked_by, reason)`. The
  table is a **revocation list**: rows exist only for revoked tokens.
- Verify performs signature + expiry checks (crypto only, no DB), then a single
  indexed lookup on `match_access.id`. If a row exists → reject.

## Consequences

- **Mint is stateless and fast:** no DB writes, no collision possible.
- **Verify does one indexed lookup per call.** Happy path (nothing ever revoked
  for this jti) is a single-row miss — cheap. Not free, so a caching layer can
  be added later if profiling ever surfaces it. Not premature now: scoring load
  is ~dozens of writes per fixture per night, not a public read hot path.
- **Revocation is durable and auditable.** The row records who revoked it, when,
  and optionally why.
- **Big red button:** rotating `MATCH_TOKEN_SECRET` invalidates every
  outstanding token in a single step. Documented as the "if a laptop with active
  codes is stolen" recovery.
- **Bearer secret handling:** the raw signed token is a bearer credential. It is
  returned exactly once by the mint response and never persisted server-side.
  Treat like a password — do not log the raw string, never echo it in error
  messages, never store it in DB.
- **RLS on `match_access` denies public and authenticated reads.** The jti is a
  token component and must not leak. Only the service-role client (used by
  `_shared/match-token.ts`) reads the table.

## Alternatives considered and rejected

- **Pure JWT without any revocation.** Rejected: an operator code handed to a
  volunteer who leaves mid-match must be revokable before natural expiry. A
  short TTL alone is not enough — 6 hours is a long window mid-game.
- **Pure DB `match_access` (hash comparison on every request, no JWT).**
  Rejected: needs a DB read on the happy path with no meaningful security
  benefit over a signed JWT with a short TTL, and complicates the mint path with
  hash generation + storage. Also loses the "big red button" of rotating a
  single secret.
- **In-memory revocation cache with periodic refresh.** Rejected as premature.
  One indexed `SELECT` per scoring call is not a bottleneck for the volumes we
  care about (one score op per fixture, dozens of writes per match). Can be
  layered on later if profiling ever surfaces it.

## Test coverage this enables

- Signature/expiry checks are pure functions — unit-testable without a DB.
- Revocation semantics are exercised by injecting a fake `isRevoked` check into
  the guard, keeping the test suite fully offline.
- End-to-end coverage (mint → use → revoke → 401) lands with story #37, which
  wires the mint/revoke HTTP routes.
