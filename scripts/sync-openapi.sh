#!/usr/bin/env bash
#
# sync-openapi.sh — Copy docs/openapi.yaml into the api-docs function.
#
# The Edge Function reads the spec from a sibling file at request time.
# The source of truth is docs/openapi.yaml; run this after editing it,
# and again before `supabase functions deploy api-docs`.

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
SRC="$ROOT/docs/openapi.yaml"
DEST="$ROOT/supabase/functions/api-docs/openapi.yaml"

if [[ ! -f "$SRC" ]]; then
  echo "error: $SRC not found" >&2
  exit 1
fi

cp "$SRC" "$DEST"
echo "synced: $SRC → $DEST"
