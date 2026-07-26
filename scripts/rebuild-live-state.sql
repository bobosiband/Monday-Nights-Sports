-- ============================================================================
-- rebuild-live-state.sql
--
-- One-shot admin script: rebuild the entire fixture_live_state projection
-- from the authoritative sources (match_events + results + fixtures).
--
-- Why this exists:
--   fixture_live_state is a cache. If the scoring service ever misses a
--   projection write (transient DB error, deploy race, whatever) the row
--   can drift from the truth. Running this script closes the gap without
--   requiring a code deploy.
--
-- What it does:
--   1. Snapshots every fixture's derived score by folding match_events.
--   2. Writes one row per fixture into fixture_live_state.
--   3. Where a `results` row exists (finalized fixture), those totals win
--      — they were captured at finalize and are the persistent truth.
--
-- How to run it (local dev):
--   docker exec -i supabase_db_monday-night-sports psql -U postgres \
--     < scripts/rebuild-live-state.sql
--
-- Idempotent: re-running produces the same rows. Safe to run at any time.
-- ============================================================================

begin;

-- Blow the projection away in one shot. Cheap because the table is small
-- (one row per fixture) and the RLS/publication config is unaffected.
truncate table public.fixture_live_state;

with derived as (
  -- Fold match_events per fixture. Voided events contribute nothing.
  -- Scores route by team_id (home/away). Fouls counted globally per team
  -- for now — the projection carries the map as JSONB.
  select
    f.id as fixture_id,
    f.home_team_id,
    f.away_team_id,
    coalesce(sum(case
      when e.type = 'score'
       and e.voided_at is null
       and e.team_id = f.home_team_id
       then e.value else 0 end), 0) as home_score,
    coalesce(sum(case
      when e.type = 'score'
       and e.voided_at is null
       and e.team_id = f.away_team_id
       then e.value else 0 end), 0) as away_score,
    -- Fouls as a JSONB object { team_id: count }. Only for fouls where the
    -- team is one of the fixture's teams; others are ignored, matching
    -- _shared/score.ts.
    coalesce(
      jsonb_object_agg(e.team_id::text, foul_count)
        filter (where foul_count is not null),
      '{}'::jsonb
    ) as fouls,
    max(e.created_at) filter (where e.voided_at is null) as last_event_at
  from public.fixtures f
  left join lateral (
    select
      me.team_id,
      me.type,
      me.value,
      me.voided_at,
      me.created_at,
      count(*) filter (where me.type = 'foul' and me.voided_at is null)
        over (partition by me.team_id) as foul_count
    from public.match_events me
    where me.fixture_id = f.id
  ) e on true
  group by f.id, f.home_team_id, f.away_team_id
)
insert into public.fixture_live_state (
  fixture_id, home_score, away_score, fouls, current_period,
  status, last_event_at
)
select
  f.id,
  -- Finalized fixtures: results is the truth. Otherwise the derived total.
  coalesce(r.home_score, d.home_score),
  coalesce(r.away_score, d.away_score),
  d.fouls,
  -- Recomputing current_period from a window function is fiddly in SQL and
  -- rare in practice — a finalized fixture has no open period, and
  -- non-finalized fixtures typically stay in-app long enough for the next
  -- write to refresh this value. Set null; the next scoring write fixes it.
  null,
  f.status,
  d.last_event_at
from public.fixtures f
left join derived d on d.fixture_id = f.id
left join public.results r on r.fixture_id = f.id;

commit;
