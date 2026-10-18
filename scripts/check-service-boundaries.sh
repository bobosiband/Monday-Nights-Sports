#!/usr/bin/env bash
#
# check-service-boundaries.sh
#
# CI guardrail for the service ownership rules in ADR 0007:
#
#  1. No file under supabase/functions/<service>/ may import from another
#     service folder. Services talk to each other through the database or
#     through each other's HTTP APIs, never through imports.
#
#  2. No .ts, .md, .sh or .yml file outside the exempted historical set
#     may contain an emoji character. Historical files that pre-date the
#     no-emojis convention are listed in HISTORICAL_PATHS below and are
#     left alone deliberately (see ADR 0007's follow-ups).
#
# Exits 1 on the first violation it finds. Prints a readable message
# naming the offending file.

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

FAIL=0

# -----------------------------------------------------------------------------
# 1. Cross-service imports
# -----------------------------------------------------------------------------

while IFS= read -r file; do
  if grep -nE "from[[:space:]]+\"\.\.(/\.\.)+/" "$file" >/dev/null 2>&1; then
    echo "cross-service import in $file:" >&2
    grep -nE "from[[:space:]]+\"\.\.(/\.\.)+/" "$file" >&2
    FAIL=1
  fi
done < <(find supabase/functions -type f -name '*.ts' -not -path '*/node_modules/*')

# -----------------------------------------------------------------------------
# 2. Emojis outside the historical set
# -----------------------------------------------------------------------------
#
# Regex covers the Unicode blocks the conventions doc calls out as "emoji":
#   U+2300-U+23FF  Miscellaneous Technical
#   U+2600-U+27BF  Miscellaneous Symbols + Dingbats (includes checkmarks,
#                  warning signs, etc.)
#   U+1F000-U+1F2FF Supplementary symbols
#   U+1F300-U+1FAFF Emoji proper (faces, objects, flags, etc.)
#
# Deliberately NOT in scope: Geometric Shapes (U+25A0-U+25FF, where ● and
# ▸ live). Those are plain typographic glyphs the renderer and scripts
# use for structure, not pictographs.

EMOJI_RE='[\x{2300}-\x{23FF}\x{2600}-\x{27BF}\x{1F000}-\x{1F2FF}\x{1F300}-\x{1FAFF}]'

# Historical files that pre-date the convention. Keep this list narrow.
is_historical() {
  case "$1" in
    docs/archive/*) return 0 ;;
    docs/sprint-1.md) return 0 ;;
    docs/sprints-c-d-e.md) return 0 ;;
    docs/decisions/0001-operator-access-model.md) return 0 ;;
    docs/decisions/0002-operator-access-model-v2.md) return 0 ;;
    docs/decisions/0003-realtime-projection.md) return 0 ;;
    docs/decisions/0004-standings-per-sport.md) return 0 ;;
    docs/decisions/0005-deferred-attribution-and-shootouts.md) return 0 ;;
    docs/decisions/0006-draw-generation.md) return 0 ;;
    scripts/regenerate-tracking.sh) return 0 ;;
  esac
  return 1
}

while IFS= read -r file; do
  # Normalise `./foo` -> `foo` so case patterns match.
  path="${file#./}"
  if is_historical "$path"; then
    continue
  fi
  if grep -nP "$EMOJI_RE" "$file" >/dev/null 2>&1; then
    echo "emoji in $path:" >&2
    grep -nP "$EMOJI_RE" "$file" >&2
    FAIL=1
  fi
done < <(find . \( -name '*.ts' -o -name '*.md' -o -name '*.sh' -o -name '*.yml' \) -not -path './.git/*' -not -path './node_modules/*' -not -path './services/draw-generator/target/*')

if [[ $FAIL -ne 0 ]]; then
  echo "" >&2
  echo "scripts/check-service-boundaries.sh: violations above." >&2
  echo "ADR 0007 forbids cross-service imports; the conventions doc forbids emojis." >&2
  exit 1
fi

echo "service boundaries OK"
