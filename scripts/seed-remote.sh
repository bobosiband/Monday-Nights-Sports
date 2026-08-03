#!/usr/bin/env bash
#
# seed-remote.sh — apply supabase/seed.sql to a hosted Supabase project.
#
# `supabase db reset` doesn't exist for hosted projects; it's a purely local
# CLI shortcut. To seed a fresh hosted project you have two choices:
#
#   1. `psql "$DATABASE_URL" -f supabase/seed.sql`  (this script)
#   2. Paste the file into the Studio SQL editor by hand
#
# Prefer this one — it's scriptable and safe to re-run because the seed
# file uses `on conflict do nothing` on the fact-table rows.
#
# Grab DATABASE_URL from Project Settings → Database → Connection string
# ("URI"). Contains the DB password — do NOT commit it, do NOT print it.
#
# Usage:
#   DATABASE_URL='postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres' \
#     ./scripts/seed-remote.sh
#
# Requires: psql (comes with the postgresql-client package).

set -euo pipefail

DATABASE_URL="${DATABASE_URL:-}"
if [[ -z "$DATABASE_URL" ]]; then
  echo "error: DATABASE_URL is required" >&2
  echo "grab it from Project Settings → Database → Connection string (URI)" >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "error: psql not found (install postgresql-client)" >&2
  exit 2
fi

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
SEED="$ROOT/supabase/seed.sql"
if [[ ! -f "$SEED" ]]; then
  echo "error: $SEED not found" >&2
  exit 1
fi

echo "applying $SEED to the target database…"
# ON_ERROR_STOP so a failed statement doesn't quietly leave the DB half-seeded.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$SEED"

echo "seed applied. Verify with:"
echo "  psql \"\$DATABASE_URL\" -c \"select id, sport, home_team_id, away_team_id, status from fixtures order by id;\""
