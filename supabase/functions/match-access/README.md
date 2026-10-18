# match-access

Organiser-only service for minting, revoking and listing operator match codes.
The raw code is emitted exactly once (in the mint response) and never again: the
DB stores only its SHA-256 hash.

See `docs/decisions/0002-operator-access-model-v2.md` for why we hold codes in a
table rather than issuing JWTs.

## Routes

Every route requires `Authorization: Bearer <jwt>`.

| Method    | Path                           | Purpose                     |
| --------- | ------------------------------ | --------------------------- |
| `OPTIONS` | any                            | 204 CORS preflight.         |
| `POST`    | `/match-access`                | Mint a code for a fixture.  |
| `POST`    | `/match-access/:id/revoke`     | Revoke a code (idempotent). |
| `GET`     | `/match-access?fixture=<uuid>` | List codes for a fixture.   |

## Who may call it

Any authenticated organiser (any Supabase Auth user).

## Rules it owns

- The raw code is returned to the caller exactly once in the mint response; it
  is never persisted server-side.
- TTL defaults to 240 minutes (4 hours); minimum 15, maximum 720.
- Mint refuses `complete` or `cancelled` fixtures with 409.
- Revoke is idempotent; the response includes `already_revoked: true` when the
  code was already revoked, with the original timestamp.
- List never returns `code_hash` or `created_by`.
- The hasher in `security/MatchTokenHasher.ts` is a two-service contract with
  scoring. The twin lives in
  `supabase/functions/scoring/security/MatchTokenHasher.ts`. Both must share the
  pinned test vector; CI fails if they diverge.

## Environment variables

| Var                         | Purpose                                 |
| --------------------------- | --------------------------------------- |
| `SUPABASE_URL`              | Base URL for the Supabase project.      |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key; writes gated by auth. |

## Running the tests

```bash
deno test --allow-net --allow-env tests/match-access/
```

The suite exercises `MatchTokenHasher` directly: no Supabase or DB needed. The
pinned DEVCODE1 digest in the hasher tests matches the twin in `tests/scoring/`.
