-- =============================================================================
-- 0001_core_schema.sql
--
-- Core schema for Monday Night Sports.
--
-- Domain model (top-down): a season contains teams (which contain players) and
-- events. An event is one Monday night; each event has slots (the four time
-- windows) and fixtures (a match between two teams in a given slot for a given
-- sport). A fixture eventually gets a single result row.
--
-- Access model: public read on published data (published events and everything
-- reachable from them); organiser writes for everything. Organiser = any
-- authenticated user for Sprint 1; a proper role table can slot in later
-- without touching table shapes.
-- =============================================================================

-- pgcrypto gives us gen_random_uuid(); Supabase enables it by default but we
-- assert it here so `db reset` on a bare Postgres also works.
create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- Shared updated_at trigger
--
-- Kept as one function attached per-table so every write path bumps the
-- timestamp without callers remembering to.
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- seasons
--
-- A season is the outer container. `sports` is an array so a season can span
-- more than one sport (soccer + netball on the same Monday night). Only one
-- season can be `is_active` at a time — the partial unique index enforces
-- that at the DB level, so the API layer can't accidentally allow two.
-- -----------------------------------------------------------------------------
create table if not exists public.seasons (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  sports text[] not null default '{}',
  starts_on date not null,
  ends_on date not null,
  is_active boolean not null default false,
  is_archived boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seasons_dates_ordered check (ends_on >= starts_on)
);

-- Only one active season is allowed at a time.
create unique index if not exists ux_seasons_only_one_active
  on public.seasons (is_active)
  where is_active = true;

drop trigger if exists trg_seasons_set_updated_at on public.seasons;
create trigger trg_seasons_set_updated_at
  before update on public.seasons
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- teams
--
-- Teams belong to a specific season. Names are unique per season (case-folded
-- via a functional unique index) so "Reds" and "reds" don't both exist in the
-- same competition.
-- -----------------------------------------------------------------------------
create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ux_teams_season_name_lower
  on public.teams (season_id, lower(name));

drop trigger if exists trg_teams_set_updated_at on public.teams;
create trigger trg_teams_set_updated_at
  before update on public.teams
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- players
--
-- Players belong to a team. Notes is free-text — this table intentionally
-- stays minimal for Sprint 1; richer profile fields can be added without
-- breaking existing reads.
-- -----------------------------------------------------------------------------
create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_players_set_updated_at on public.players;
create trigger trg_players_set_updated_at
  before update on public.players
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- events
--
-- One row per Monday night. `is_published` gates public visibility — the
-- organiser can build a draw privately and flip publication as a single
-- action. `unique(season_id, event_date)` prevents duplicate nights.
-- -----------------------------------------------------------------------------
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  event_date date not null,
  is_published boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ux_events_season_date unique (season_id, event_date)
);

drop trigger if exists trg_events_set_updated_at on public.events;
create trigger trg_events_set_updated_at
  before update on public.events
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- slots
--
-- The evening's time windows. `slot_number` is the human-facing order
-- (Slot 1 → Slot 4); `starts_at` is the wall-clock start. `pitch` is
-- optional free-text (e.g. "Court A") — a lookup table would be over-fit
-- for Sprint 1's four-slots-per-night reality.
-- -----------------------------------------------------------------------------
create table if not exists public.slots (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  slot_number int not null check (slot_number > 0),
  starts_at time not null,
  pitch text,
  created_at timestamptz not null default now(),
  constraint ux_slots_event_number unique (event_id, slot_number)
);

-- -----------------------------------------------------------------------------
-- fixtures
--
-- A match between two teams in a slot for a specific sport. `away_team_id`
-- is nullable so an odd team count can be modelled as a bye (home team,
-- no opponent). The self-match check prevents a team playing itself.
-- -----------------------------------------------------------------------------
create table if not exists public.fixtures (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  slot_id uuid not null references public.slots(id) on delete restrict,
  home_team_id uuid not null references public.teams(id) on delete restrict,
  away_team_id uuid references public.teams(id) on delete restrict,
  sport text not null check (length(trim(sport)) > 0),
  status text not null default 'scheduled'
    check (status in ('scheduled', 'live', 'complete', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fixtures_teams_distinct check (
    away_team_id is null or home_team_id <> away_team_id
  )
);

create index if not exists ix_fixtures_event on public.fixtures(event_id);
create index if not exists ix_fixtures_slot on public.fixtures(slot_id);

drop trigger if exists trg_fixtures_set_updated_at on public.fixtures;
create trigger trg_fixtures_set_updated_at
  before update on public.fixtures
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- results
--
-- One row per completed fixture. `unique(fixture_id)` guarantees at most one
-- final result per match — corrections happen by updating this row, not by
-- inserting a second one.
-- -----------------------------------------------------------------------------
create table if not exists public.results (
  id uuid primary key default gen_random_uuid(),
  fixture_id uuid not null unique references public.fixtures(id) on delete cascade,
  home_score int not null check (home_score >= 0),
  away_score int not null check (away_score >= 0),
  confirmed_at timestamptz not null default now(),
  confirmed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_results_set_updated_at on public.results;
create trigger trg_results_set_updated_at
  before update on public.results
  for each row execute function public.set_updated_at();

-- =============================================================================
-- Row-Level Security
--
-- Sprint 1 model: anyone can read published events (and everything reachable
-- from a published event); any authenticated user (organiser) can write. A
-- future migration can narrow the write side to a role table without
-- disturbing readers.
-- =============================================================================

alter table public.seasons  enable row level security;
alter table public.teams    enable row level security;
alter table public.players  enable row level security;
alter table public.events   enable row level security;
alter table public.slots    enable row level security;
alter table public.fixtures enable row level security;
alter table public.results  enable row level security;

-- seasons: non-archived seasons are public; writes require auth.
drop policy if exists seasons_public_read on public.seasons;
create policy seasons_public_read on public.seasons
  for select using (is_archived = false);

drop policy if exists seasons_organiser_write on public.seasons;
create policy seasons_organiser_write on public.seasons
  for all to authenticated
  using (true) with check (true);

-- teams: readable when their season is (non-archived).
drop policy if exists teams_public_read on public.teams;
create policy teams_public_read on public.teams
  for select using (
    exists (
      select 1 from public.seasons s
      where s.id = teams.season_id and s.is_archived = false
    )
  );

drop policy if exists teams_organiser_write on public.teams;
create policy teams_organiser_write on public.teams
  for all to authenticated
  using (true) with check (true);

-- players: readable when their team's season is (non-archived).
drop policy if exists players_public_read on public.players;
create policy players_public_read on public.players
  for select using (
    exists (
      select 1
      from public.teams t
      join public.seasons s on s.id = t.season_id
      where t.id = players.team_id and s.is_archived = false
    )
  );

drop policy if exists players_organiser_write on public.players;
create policy players_organiser_write on public.players
  for all to authenticated
  using (true) with check (true);

-- events: only published events are readable to the public.
drop policy if exists events_public_read on public.events;
create policy events_public_read on public.events
  for select using (is_published = true);

drop policy if exists events_organiser_write on public.events;
create policy events_organiser_write on public.events
  for all to authenticated
  using (true) with check (true);

-- slots / fixtures / results: readable when their parent event is published.
drop policy if exists slots_public_read on public.slots;
create policy slots_public_read on public.slots
  for select using (
    exists (select 1 from public.events e where e.id = slots.event_id and e.is_published)
  );

drop policy if exists slots_organiser_write on public.slots;
create policy slots_organiser_write on public.slots
  for all to authenticated
  using (true) with check (true);

drop policy if exists fixtures_public_read on public.fixtures;
create policy fixtures_public_read on public.fixtures
  for select using (
    exists (select 1 from public.events e where e.id = fixtures.event_id and e.is_published)
  );

drop policy if exists fixtures_organiser_write on public.fixtures;
create policy fixtures_organiser_write on public.fixtures
  for all to authenticated
  using (true) with check (true);

drop policy if exists results_public_read on public.results;
create policy results_public_read on public.results
  for select using (
    exists (
      select 1
      from public.fixtures f
      join public.events e on e.id = f.event_id
      where f.id = results.fixture_id and e.is_published
    )
  );

drop policy if exists results_organiser_write on public.results;
create policy results_organiser_write on public.results
  for all to authenticated
  using (true) with check (true);
