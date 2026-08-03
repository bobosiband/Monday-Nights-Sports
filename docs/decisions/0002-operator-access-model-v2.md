# ADR 0002 — Operator access model: hashed opaque code in `match_access`

**Status:** Accepted, 2026-07-26. **Supersedes:**
[ADR 0001](0001-operator-access-model.md). **Related:** ADR 0003 (realtime
projection), migration 0004.

## Context

ADR 0001 proposed a signed short-JWT with a `match_access` table used as a
revocation list. That model split the credential across two systems (the JWT +
the DB row) and complicated every subsequent operator-facing story: the mint
response had to explain a JWT to volunteers; revoke had to write to the DB
anyway; verify still needed the DB on the happy path (to check for revocation),
so the "stateless" advantage never materialised.

The Sprint C build prompt reversed direction: **one DB row per minted code,
holding only the SHA-256 hash of a short human-typable string.** Verify does
exactly one indexed lookup per scoring write; revoke sets a timestamp on the
row; expiry is a column on the row.

## Decision

**Opaque code + `match_access(code_hash, expires_at, revoked_at, …)`.**

- Mint generates a random 8-character code from a Crockford-style base32
  alphabet (I/L/O/U removed). Hash it once, store the hash, return the raw code
  exactly once in the API response.
- Verify normalises + hashes the bearer, looks up `match_access.code_hash`, and
  rejects if:
  - no row (401),
  - `expires_at <= now()` (401),
  - `revoked_at is not null` (401),
  - `fixture_id` ≠ URL fixture (403).
- Revoke sets `revoked_at = now()` on the row. Idempotent.
- The raw code is a bearer secret: never logged, never re-emitted, never
  persisted server-side.

## Consequences

- **Instant revocation.** A leaked or misplaced code stops working the moment an
  organiser revokes it — no waiting for a JWT to expire.
- **Human-typable.** Sideline volunteers get an 8-character code they can read
  aloud, not a JWT. Reduced typo surface (no lowercase, no ambiguous glyphs).
- **One indexed lookup per scoring write.** Not free, but the scoring path
  already talks to Postgres several times per request; one more lookup is noise
  at our volumes.
- **`code_hash` is bearer material.** RLS on `match_access` deliberately refuses
  public and authenticated `select`. Only the service-role client (used by
  scoring/guard.ts and match-access) reads the table. The organiser listing
  endpoint never returns `code_hash`.
- **No shared secret to rotate.** A compromised Supabase project can be rotated
  by revoking all codes
  (`update match_access set revoked_at =
  now() where revoked_at is null`) — no
  MATCH_TOKEN_SECRET to change.

## Rejected alternatives (this time round)

- **The ADR 0001 JWT model.** A JWT that requires a DB lookup on every request
  is a JWT wearing a costume. If we're paying for the DB read we should pick a
  shape that makes revoke trivial (this one) rather than one that makes mint
  fast (that one). Mint is not the hot path; scoring writes are, and both models
  look identical there.
- **Client PIN + server PIN (challenge/response).** Overkill for the threat
  model — the wire is TLS, and the code is only useful against one fixture for a
  bounded time.
