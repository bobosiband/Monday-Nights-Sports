-- =============================================================================
-- seed.sql
--
-- Local development seed. `supabase db reset` runs this after applying every
-- migration, giving every service concrete data to hit — one active season,
-- six teams, and one published Monday-night event with four slots and six
-- fixtures across two sports.
--
-- Player rows are intentionally not seeded: player management is deferred to
-- Sprint 4 (optional scorer attribution only). The `players` table stays in
-- the schema as a dormant hook.
--
-- Static UUIDs are used deliberately so docs and curl examples can reference
-- them without a lookup step. Do not reuse this file in production.
-- =============================================================================

-- Season -----------------------------------------------------------------------
insert into public.seasons (id, name, sports, starts_on, ends_on, is_active)
values (
  '11111111-1111-1111-1111-111111111111',
  'Autumn 2026',
  array['soccer', 'netball'],
  date '2026-07-06',
  date '2026-09-28',
  true
)
on conflict (id) do nothing;

-- Teams ------------------------------------------------------------------------
insert into public.teams (id, season_id, name) values
  ('a1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'Reds'),
  ('a2222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Blues'),
  ('a3333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'Greens'),
  ('a4444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', 'Yellows'),
  ('a5555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111', 'Purples'),
  ('a6666666-6666-6666-6666-666666666666', '11111111-1111-1111-1111-111111111111', 'Oranges')
on conflict (id) do nothing;

-- Event (one published Monday night) ------------------------------------------
insert into public.events (id, season_id, event_date, is_published, published_at)
values (
  'ef111111-1111-1111-1111-111111111111',
  '11111111-1111-1111-1111-111111111111',
  date '2026-07-20',
  true,
  now()
)
on conflict (id) do nothing;

-- Slots (the classic four evening windows) ------------------------------------
insert into public.slots (id, event_id, slot_number, starts_at, pitch) values
  ('51111111-1111-1111-1111-111111111111', 'ef111111-1111-1111-1111-111111111111', 1, time '18:00', 'Pitch A'),
  ('52222222-2222-2222-2222-222222222222', 'ef111111-1111-1111-1111-111111111111', 2, time '18:45', 'Pitch A'),
  ('53333333-3333-3333-3333-333333333333', 'ef111111-1111-1111-1111-111111111111', 3, time '19:30', 'Pitch A'),
  ('54444444-4444-4444-4444-444444444444', 'ef111111-1111-1111-1111-111111111111', 4, time '20:15', 'Pitch A')
on conflict (id) do nothing;

-- Fixtures --------------------------------------------------------------------
-- Six fixtures across the four slots, spanning both sports. A given team may
-- appear more than once across the night (they play different opponents in
-- different slots) but never twice in the same slot.
insert into public.fixtures (id, event_id, slot_id, home_team_id, away_team_id, sport, status) values
  -- Slot 1
  ('f0111111-1111-1111-1111-111111111111', 'ef111111-1111-1111-1111-111111111111',
   '51111111-1111-1111-1111-111111111111',
   'a1111111-1111-1111-1111-111111111111', 'a2222222-2222-2222-2222-222222222222',
   'soccer', 'scheduled'),
  ('f0122222-2222-2222-2222-222222222222', 'ef111111-1111-1111-1111-111111111111',
   '51111111-1111-1111-1111-111111111111',
   'a3333333-3333-3333-3333-333333333333', 'a4444444-4444-4444-4444-444444444444',
   'netball', 'scheduled'),
  -- Slot 2
  ('f0211111-1111-1111-1111-111111111111', 'ef111111-1111-1111-1111-111111111111',
   '52222222-2222-2222-2222-222222222222',
   'a5555555-5555-5555-5555-555555555555', 'a6666666-6666-6666-6666-666666666666',
   'soccer', 'scheduled'),
  -- Slot 3
  ('f0311111-1111-1111-1111-111111111111', 'ef111111-1111-1111-1111-111111111111',
   '53333333-3333-3333-3333-333333333333',
   'a1111111-1111-1111-1111-111111111111', 'a3333333-3333-3333-3333-333333333333',
   'netball', 'scheduled'),
  ('f0322222-2222-2222-2222-222222222222', 'ef111111-1111-1111-1111-111111111111',
   '53333333-3333-3333-3333-333333333333',
   'a2222222-2222-2222-2222-222222222222', 'a5555555-5555-5555-5555-555555555555',
   'soccer', 'scheduled'),
  -- Slot 4
  ('f0411111-1111-1111-1111-111111111111', 'ef111111-1111-1111-1111-111111111111',
   '54444444-4444-4444-4444-444444444444',
   'a4444444-4444-4444-4444-444444444444', 'a6666666-6666-6666-6666-666666666666',
   'soccer', 'scheduled')
on conflict (id) do nothing;
