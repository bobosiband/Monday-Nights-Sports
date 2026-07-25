-- =============================================================================
-- 0004_match_access.sql
--
-- Revocation list for match tokens (see docs/decisions/0001-operator-access-model.md).
--
-- A match token is a signed JWT with a `jti` claim; it exists purely by
-- virtue of being signed by MATCH_TOKEN_SECRET. This table exists only to
-- pull tokens back before their natural expiry: **rows are inserted only
-- when a token is revoked**. A valid, unrevoked JWT has no row here.
--
-- The verify path (`_shared/match-token.ts`) checks this table with a
-- single indexed lookup on `id`; if a row exists, the token is rejected.
--
-- Note: the plan doc originally suggested this file be numbered 0003, but
-- 0003_grants.sql already exists (fixing an RLS-vs-GRANT bug surfaced
-- during Sprint B smoke-testing). Bumping to 0004 keeps ordering intact.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- match_access
--
-- Primary key = the revoked token's `jti`. `fixture_id` scopes revocations
-- so an organiser can see what they've pulled back for a given fixture; the
-- ON DELETE CASCADE means deleting a fixture also drops its revocation
-- history (that's fine — the fixture itself is gone). `reason` is optional
-- free-text so an organiser can note why (rare, useful for audit).
-- -----------------------------------------------------------------------------
create table if not exists public.match_access (
  id uuid primary key,
  fixture_id uuid not null references public.fixtures(id) on delete cascade,
  revoked_at timestamptz not null default now(),
  revoked_by uuid references auth.users(id) on delete set null,
  reason text
);

create index if not exists ix_match_access_fixture
  on public.match_access(fixture_id);

-- No updated_at column: a revocation is a point-in-time event, not a mutable
-- record. If a mistake is made, delete the row (the JWT is then re-honoured
-- until natural expiry).

-- =============================================================================
-- Row-Level Security
--
-- Deliberately narrow: the `jti` is a bearer-token component and MUST NOT
-- leak to anon or authenticated readers. Only service_role reads the table,
-- via _shared/match-token.ts's verify path.
--
-- An organiser-facing "list my revocations" endpoint (story #37) will use
-- the service-role client and enforce its own authorisation, rather than
-- opening a broad SELECT policy here.
-- =============================================================================

alter table public.match_access enable row level security;

-- Writes: any authenticated user (organiser) can insert a revocation. The
-- HTTP surface (match-access function, story #37) applies its own guard;
-- this policy is the last-line-of-defence at the DB.
drop policy if exists match_access_organiser_write on public.match_access;
create policy match_access_organiser_write on public.match_access
  for all to authenticated
  using (true) with check (true);

-- No SELECT policy for anon / authenticated: revocation rows are read only
-- via the service-role client. RLS with no matching policy denies by default,
-- which is what we want.
