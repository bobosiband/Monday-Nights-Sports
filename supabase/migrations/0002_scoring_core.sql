-- =============================================================================
-- 0002_scoring_core.sql
--
-- Scoring-core data model additions. Additive to 0001; no existing tables or
-- columns are altered destructively.
--
-- Ships the tables/columns the scoring stack needs so the Sprint B service can
-- land against a stable schema. Final tuning (indexes, extra columns) happens
-- per story — see:
--   #25 match_events migration + RLS
--   #26 sport_configs migration + RLS + seed
--   #28 extend results (periods, decided_by)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- sport_configs
--
-- Per (season, sport) JSONB configuration that drives scoring increments,
-- periods, foul tracking and standings rules. One row per sport per season.
-- -----------------------------------------------------------------------------
create table if not exists public.sport_configs (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  sport text not null check (length(trim(sport)) > 0),
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ux_sport_configs_season_sport unique (season_id, sport)
);

drop trigger if exists trg_sport_configs_set_updated_at on public.sport_configs;
create trigger trg_sport_configs_set_updated_at
  before update on public.sport_configs
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- match_events
--
-- Append-only log of everything that happens during a match: score, foul,
-- card, timeout, period_start, period_end, note. Undo = soft-void via
-- `voided_at`, never delete — preserves the audit trail.
--
-- `id` is client-suppliable so an offline-safe queue can retry without
-- double-counting: inserts use `on conflict (id) do nothing`.
-- -----------------------------------------------------------------------------
create table if not exists public.match_events (
  id uuid primary key,
  fixture_id uuid not null references public.fixtures(id) on delete cascade,
  type text not null check (type in (
    'score', 'foul', 'card', 'timeout',
    'period_start', 'period_end', 'note'
  )),
  team_id uuid references public.teams(id) on delete restrict,
  player_id uuid references public.players(id) on delete set null,
  value int,
  period int,
  match_clock_ms int,
  voided_at timestamptz,
  voided_by uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists ix_match_events_fixture_created
  on public.match_events (fixture_id, created_at);

-- -----------------------------------------------------------------------------
-- results — additive extensions
--
-- `periods` carries a period-by-period breakdown (JSONB so it can adapt to
-- different sports without further migrations). `decided_by` records how the
-- fixture concluded so the archive can distinguish normal wins from penalties
-- or forfeits.
-- -----------------------------------------------------------------------------
alter table public.results
  add column if not exists periods jsonb;

alter table public.results
  add column if not exists decided_by text not null default 'normal'
    check (decided_by in ('normal', 'penalties', 'forfeit'));

-- =============================================================================
-- Row-Level Security
--
-- Same shape as 0001: public read only when the parent event is published;
-- authenticated write for organiser flows. Scoring writes will be gated at
-- the service layer (match-token guard) in addition to RLS.
-- =============================================================================

alter table public.sport_configs enable row level security;
alter table public.match_events  enable row level security;

-- sport_configs: readable when their season is (non-archived).
drop policy if exists sport_configs_public_read on public.sport_configs;
create policy sport_configs_public_read on public.sport_configs
  for select using (
    exists (
      select 1 from public.seasons s
      where s.id = sport_configs.season_id and s.is_archived = false
    )
  );

drop policy if exists sport_configs_organiser_write on public.sport_configs;
create policy sport_configs_organiser_write on public.sport_configs
  for all to authenticated
  using (true) with check (true);

-- match_events: readable when their fixture's event is published.
drop policy if exists match_events_public_read on public.match_events;
create policy match_events_public_read on public.match_events
  for select using (
    exists (
      select 1
      from public.fixtures f
      join public.events e on e.id = f.event_id
      where f.id = match_events.fixture_id and e.is_published
    )
  );

drop policy if exists match_events_organiser_write on public.match_events;
create policy match_events_organiser_write on public.match_events
  for all to authenticated
  using (true) with check (true);
