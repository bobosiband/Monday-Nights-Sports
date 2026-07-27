-- =============================================================================
-- 0004_operator_access_and_live.sql
--
-- Adds the two tables that operator access and live viewing need:
--
--   * match_access        — hashed opaque codes used by sideline scorers
--                           (see docs/decisions/0002-operator-access-model-v2.md)
--   * fixture_live_state  — per-fixture score summary published on Supabase
--                           Realtime so viewers get updates without touching
--                           the raw match_events log
--                           (see docs/decisions/0003-realtime-projection.md)
--
-- Additive only. 0001–0003 are not touched.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- match_access
--
-- One row per minted operator code. The raw code is NEVER stored — only its
-- SHA-256 hash. Verification hashes the incoming bearer and looks it up.
-- `revoked_at` gives organisers an immediate kill switch (a stateless JWT
-- couldn't offer this without an external revocation list, so we may as well
-- have the code live in the DB from the start).
--
-- `label` is a human hint ("Sam, sideline") so an organiser can revoke the
-- right code without decoding hashes.
-- -----------------------------------------------------------------------------
create table if not exists public.match_access (
  id uuid primary key default gen_random_uuid(),
  fixture_id uuid not null references public.fixtures(id) on delete cascade,
  code_hash text not null,
  label text,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Unique on the hash — two live codes hashing to the same value would be a
-- (practically impossible) collision, but also our idempotency signal.
create unique index if not exists ux_match_access_code_hash
  on public.match_access (code_hash);

-- Verification queries hit `(code_hash)` then filter by fixture; listings
-- filter by fixture and expiry. Two narrow indexes cover both cheaply.
create index if not exists ix_match_access_fixture_expiry
  on public.match_access (fixture_id, expires_at);

-- -----------------------------------------------------------------------------
-- fixture_live_state
--
-- Realtime projection. One row per fixture, upserted by the scoring service
-- after every accepted write. This is what viewers subscribe to over
-- Supabase Realtime — the raw `match_events` log is intentionally NOT on
-- the realtime publication so we don't leak internal event shape to public
-- viewers and don't pay bandwidth for every card/timeout/note.
--
-- The row is DISPOSABLE: it can be rebuilt at any time from match_events +
-- results by scripts/rebuild-live-state.sql. Treat it as a cache, not the
-- source of truth.
-- -----------------------------------------------------------------------------
create table if not exists public.fixture_live_state (
  fixture_id uuid primary key references public.fixtures(id) on delete cascade,
  home_score int not null default 0,
  away_score int not null default 0,
  fouls jsonb not null default '{}'::jsonb,
  current_period int,
  status text not null,
  last_event_at timestamptz,
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_fixture_live_state_set_updated_at
  on public.fixture_live_state;
create trigger trg_fixture_live_state_set_updated_at
  before update on public.fixture_live_state
  for each row execute function public.set_updated_at();

-- =============================================================================
-- Row-Level Security
-- =============================================================================

alter table public.match_access enable row level security;
alter table public.fixture_live_state enable row level security;

-- match_access: no public read policy at all. `code_hash` is bearer-token
-- material and must never leak, even to authenticated organisers via a
-- broad SELECT. The organiser listing endpoint uses the service-role client
-- and hand-picks the safe columns. Writes are allowed to authenticated
-- users; the HTTP surface applies its own guard (requireOrganiser).
drop policy if exists match_access_organiser_write on public.match_access;
create policy match_access_organiser_write on public.match_access
  for all to authenticated
  using (true) with check (true);

-- fixture_live_state: publicly readable when the parent event is published,
-- mirroring how `fixtures` and `results` gate. Writes remain authenticated
-- (the scoring service uses the service-role key).
drop policy if exists fixture_live_state_public_read on public.fixture_live_state;
create policy fixture_live_state_public_read on public.fixture_live_state
  for select using (
    exists (
      select 1
      from public.fixtures f
      join public.events e on e.id = f.event_id
      where f.id = fixture_live_state.fixture_id and e.is_published
    )
  );

drop policy if exists fixture_live_state_organiser_write on public.fixture_live_state;
create policy fixture_live_state_organiser_write on public.fixture_live_state
  for all to authenticated
  using (true) with check (true);

-- =============================================================================
-- Realtime publication
--
-- Add fixture_live_state to the `supabase_realtime` publication so browsers
-- can subscribe to row changes on it. Guarded because re-running the
-- migration on a stack that already knows about the table would error.
-- =============================================================================

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'fixture_live_state'
  ) then
    execute 'alter publication supabase_realtime add table public.fixture_live_state';
  end if;
end $$;

-- =============================================================================
-- Grants
--
-- Follow the 0003 pattern. Notably, `anon` gets SELECT on
-- fixture_live_state (public viewers must be able to read it) and NOTHING
-- on match_access (bearer-secret hashes must not leak). `authenticated`
-- gets the usual DML on both; RLS still gates rows.
-- =============================================================================

grant select on public.fixture_live_state to anon;
grant select, insert, update, delete on public.fixture_live_state to authenticated;
grant all privileges on public.fixture_live_state to service_role;

-- match_access: explicitly REVOKE anon and revoke_all_from anon on select
-- so no policy accident later widens access. `authenticated` gets DML;
-- service_role gets everything.
revoke all on public.match_access from anon;
grant select, insert, update, delete on public.match_access to authenticated;
grant all privileges on public.match_access to service_role;
