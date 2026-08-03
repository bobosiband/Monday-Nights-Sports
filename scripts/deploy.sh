#!/usr/bin/env bash
#
# deploy.sh — one-command deploy to a hosted Supabase project.
#
# Idempotent. Safe to re-run per work item: it only pushes new migrations,
# only redeploys functions whose bundles changed, and always resyncs the
# generated OpenAPI blob so /api-docs never lags behind docs/openapi.yaml.
#
# Usage:
#   PROJECT_REF=abcd1234 ./scripts/deploy.sh
#   PROJECT_REF=abcd1234 NO_VERIFY_JWT=1 ./scripts/deploy.sh
#
# NO_VERIFY_JWT=1 appends `--no-verify-jwt` to every function deploy — needed
# on older Supabase CLI versions that don't honour the `verify_jwt = false`
# entries in supabase/config.toml (public endpoints would otherwise return 401
# on the hosted project). Leave unset on newer CLIs.
#
# --use-api is passed unconditionally: it tells the CLI to bundle the function
# server-side instead of shelling out to a local Docker-based eszip pipeline.
# The Docker path fails with "failed to open eszip: ENOENT" on some CLI
# versions (observed on 2.109.1). Server-side bundling is also faster.
#
# Everything this script needs assumes the operator has already run
# `supabase login` in a browser at least once — the CLI can't do that itself.

set -euo pipefail

PROJECT_REF="${PROJECT_REF:-}"
if [[ -z "$PROJECT_REF" ]]; then
  echo "error: PROJECT_REF is required (grab it from your Supabase dashboard URL)" >&2
  exit 1
fi

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

# Single source of truth for what gets deployed. Add a new entry here AND a
# matching `[functions.<name>]` block in supabase/config.toml.
FUNCTIONS=(
  fixtures-public
  seasons
  teams
  scoring
  match-access
  sport-configs
  standings
  live
  results-public
  api-docs
)

DEPLOY_FLAGS=(--use-api)
if [[ "${NO_VERIFY_JWT:-}" == "1" ]]; then
  DEPLOY_FLAGS+=(--no-verify-jwt)
  echo "note: NO_VERIFY_JWT=1 — appending --no-verify-jwt to every function deploy"
fi

echo "=== syncing OpenAPI spec into api-docs ==="
./scripts/sync-openapi.sh

echo
echo "=== linking to project $PROJECT_REF ==="
supabase link --project-ref "$PROJECT_REF"

echo
echo "=== pushing migrations ==="
# db push is idempotent — it applies only migrations not yet on the hosted
# project. On failure, STOP: fix forward with a new numbered migration, do
# NOT edit one that's already applied on the remote.
supabase db push

echo
echo "=== deploying ${#FUNCTIONS[@]} functions ==="
for fn in "${FUNCTIONS[@]}"; do
  echo "--- $fn"
  supabase functions deploy "$fn" "${DEPLOY_FLAGS[@]+"${DEPLOY_FLAGS[@]}"}"
done

echo
echo "done. Base URL: https://${PROJECT_REF}.supabase.co/functions/v1"
echo "Swagger UI:    https://${PROJECT_REF}.supabase.co/functions/v1/api-docs"
