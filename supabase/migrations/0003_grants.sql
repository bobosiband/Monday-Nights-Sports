-- =============================================================================
-- 0003_grants.sql
--
-- Table & sequence privileges for Supabase's built-in roles.
--
-- 0001 and 0002 enabled RLS and added policies, but never explicitly GRANTed
-- DML privileges on the tables. Postgres denies before RLS even sees the
-- query — the local scoring smoke-test surfaced this with:
--   "permission denied for table fixtures" (SQLSTATE 42501)
--
-- Fix: grant DML to `service_role` unconditionally (bypasses RLS as
-- intended); grant SELECT to `anon` and SELECT/INSERT/UPDATE/DELETE to
-- `authenticated` so RLS policies from 0001/0002 do the actual gating.
--
-- ALTER DEFAULT PRIVILEGES makes future tables inherit the same setup so
-- any migration on top of this one doesn't need to remember the incantation.
-- =============================================================================

grant usage on schema public to anon, authenticated, service_role;

grant all privileges on all tables in schema public to service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on all tables in schema public to anon;

grant all privileges on all sequences in schema public to service_role;
grant usage, select on all sequences in schema public to anon, authenticated;

alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant select on tables to anon;

alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant usage, select on sequences to anon, authenticated;
