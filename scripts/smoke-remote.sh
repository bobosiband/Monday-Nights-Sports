#!/usr/bin/env bash
#
# smoke-remote.sh — end-to-end walkthrough against any Supabase project.
#
# Ports the local smoke script (scripts/smoke-live.sh) into a version that
# targets a caller-supplied base URL, so the same walkthrough runs against
# the local stack, a scratch hosted project, or a demo project.
#
# WARNING: this script MUTATES data on the target. It drives the given
# fixture to `complete`, records real match_events, and consumes a real
# match_access code. Point it only at scratch / demo projects — never
# real match data.
#
# Usage:
#   ./scripts/smoke-remote.sh                                # local, seeded soccer
#   BASE_URL=https://<ref>.supabase.co/functions/v1 \
#     ORGANISER_JWT=... SUPABASE_ANON_KEY=... \
#     ./scripts/smoke-remote.sh
#
# Required env vars:
#   ORGANISER_JWT       Supabase Auth JWT for any confirmed user (see the
#                       password-grant snippet in docs/sprint-1.md).
#   SUPABASE_ANON_KEY   Sent as the `apikey` header; the platform gateway
#                       still requires it even for verify_jwt=false functions.
#
# Optional overrides (all default to the seeded soccer fixture):
#   BASE_URL, EVENT_ID, FIXTURE, SEASON, HOME_TEAM, AWAY_TEAM
#
# Exits non-zero on the first assertion failure. Requires curl and jq.

set -euo pipefail

# ---- config ---------------------------------------------------------------
BASE_URL="${BASE_URL:-http://127.0.0.1:54321/functions/v1}"
EVENT_ID="${EVENT_ID:-ef111111-1111-1111-1111-111111111111}"
FIXTURE="${FIXTURE:-f0111111-1111-1111-1111-111111111111}"
SEASON="${SEASON:-11111111-1111-1111-1111-111111111111}"
HOME_TEAM="${HOME_TEAM:-a1111111-1111-1111-1111-111111111111}"
AWAY_TEAM="${AWAY_TEAM:-a2222222-2222-2222-2222-222222222222}"

# ---- prereqs --------------------------------------------------------------
for tool in curl jq; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "error: $tool is required" >&2
    exit 2
  fi
done

if [[ -z "${ORGANISER_JWT:-}" ]]; then
  echo "error: ORGANISER_JWT is required (see docs/sprint-1.md for how to get one)" >&2
  exit 2
fi

APIKEY="${SUPABASE_ANON_KEY:-}"
apikey_header=()
if [[ -n "$APIKEY" ]]; then
  apikey_header=(-H "apikey: $APIKEY")
fi

echo "target: $BASE_URL"
echo "fixture: $FIXTURE"
echo

# ---- helpers --------------------------------------------------------------
uuid() {
  if command -v uuidgen >/dev/null 2>&1; then
    uuidgen | tr '[:upper:]' '[:lower:]'
  else
    cat /proc/sys/kernel/random/uuid
  fi
}

# One-shot request that captures body + status separately, so downstream
# assertions can inspect the JSON without re-consuming a stream.
STATUS=""
BODY=""
call() {
  local method=$1 path=$2 auth=$3 data=${4:-}
  BODY=$(curl -s "${apikey_header[@]+"${apikey_header[@]}"}" \
    -H "authorization: Bearer $auth" \
    -H "content-type: application/json" \
    ${data:+-d "$data"} \
    -w '\n%{http_code}' \
    -X "$method" "$BASE_URL$path")
  STATUS="${BODY##*$'\n'}"
  BODY="${BODY%$'\n'*}"
}

assert_status() {
  local want=$1 label=$2
  if [[ "$STATUS" != "$want" ]]; then
    echo "FAIL: $label — expected $want, got $STATUS"
    echo "$BODY" | jq . 2>/dev/null || echo "$BODY"
    exit 1
  fi
  echo "PASS: $label ($STATUS)"
}

assert_json_eq() {
  local jqpath=$1 want=$2 label=$3
  local got
  got=$(echo "$BODY" | jq -r "$jqpath")
  if [[ "$got" != "$want" ]]; then
    echo "FAIL: $label — expected $jqpath=$want, got $got"
    echo "$BODY" | jq . 2>/dev/null || echo "$BODY"
    exit 1
  fi
  echo "PASS: $label ($jqpath=$got)"
}

# ---- 0. Fixtures-public (public read) -------------------------------------
echo "=== fixtures-public ==="
call GET "/fixtures-public?event=$EVENT_ID&format=json" "$APIKEY"
assert_status 200 "GET /fixtures-public event=$EVENT_ID"
count=$(echo "$BODY" | jq -r '.fixtures | length')
if [[ "$count" -lt 1 ]]; then
  echo "FAIL: fixtures array is empty"
  exit 1
fi
echo "PASS: fixtures array has $count entries"

# ---- 1. Mint a code -------------------------------------------------------
echo
echo "=== mint match code ==="
call POST "/match-access" "$ORGANISER_JWT" \
  "$(jq -nc --arg f "$FIXTURE" '{fixture_id: $f, ttl_minutes: 60, label: "smoke-remote"}')"
assert_status 201 "POST /match-access"
CODE=$(echo "$BODY" | jq -r '.code // empty')
CODE_ID=$(echo "$BODY" | jq -r '.id // empty')
if [[ -z "$CODE" ]]; then
  echo "FAIL: mint returned no code"
  exit 1
fi
echo "PASS: minted code (id=$CODE_ID)"

# ---- 2. Start -------------------------------------------------------------
echo
echo "=== start ==="
call POST "/scoring/$FIXTURE/start" "$CODE"
assert_status 200 "POST /scoring/$FIXTURE/start"
assert_json_eq '.fixture_status' 'live' 'fixture flipped to live'

# ---- 3. Open period 1 ----------------------------------------------------
echo
echo "=== open period 1 ==="
call POST "/scoring/$FIXTURE/period" "$CODE" '{"intent":"start","period":1}'
assert_status 200 "period open"
assert_json_eq '.derived.currentPeriod' '1' 'currentPeriod=1'

# ---- 4. Home goal + idempotent replay ------------------------------------
echo
echo "=== home goal ==="
HOME_EVT=$(uuid)
call POST "/scoring/$FIXTURE/events" "$CODE" \
  "$(jq -nc --arg id "$HOME_EVT" --arg team "$HOME_TEAM" \
    '{id: $id, type: "score", team_id: $team, value: 1}')"
assert_status 201 "POST /scoring/$FIXTURE/events (insert)"
assert_json_eq '.inserted' 'true' 'inserted=true'
assert_json_eq '.derived.home' '1' 'home score = 1'

echo
echo "=== replay same event ==="
call POST "/scoring/$FIXTURE/events" "$CODE" \
  "$(jq -nc --arg id "$HOME_EVT" --arg team "$HOME_TEAM" \
    '{id: $id, type: "score", team_id: $team, value: 1}')"
assert_status 200 "POST /scoring/$FIXTURE/events (replay)"
assert_json_eq '.inserted' 'false' 'inserted=false (replay)'
assert_json_eq '.derived.home' '1' 'home score unchanged'

# ---- 5. Invalid score value -----------------------------------------------
echo
echo "=== invalid soccer score value=2 ==="
call POST "/scoring/$FIXTURE/events" "$CODE" \
  "$(jq -nc --arg id "$(uuid)" --arg team "$HOME_TEAM" \
    '{id: $id, type: "score", team_id: $team, value: 2}')"
assert_status 400 "invalid score value → 400"

# ---- 6. Foul + undo -------------------------------------------------------
echo
echo "=== foul ==="
FOUL_EVT=$(uuid)
call POST "/scoring/$FIXTURE/events" "$CODE" \
  "$(jq -nc --arg id "$FOUL_EVT" --arg team "$AWAY_TEAM" \
    '{id: $id, type: "foul", team_id: $team}')"
assert_status 201 "POST foul"

echo
echo "=== undo foul ==="
call POST "/scoring/$FIXTURE/undo" "$CODE" \
  "$(jq -nc --arg id "$FOUL_EVT" '{event_id: $id}')"
assert_status 200 "POST /undo"

# ---- 7. Close period 1, then invalid period -------------------------------
echo
echo "=== close period 1 ==="
call POST "/scoring/$FIXTURE/period" "$CODE" '{"intent":"end","period":1}'
assert_status 200 "period close"

echo
echo "=== close bogus period 9 ==="
call POST "/scoring/$FIXTURE/period" "$CODE" '{"intent":"end","period":9}'
assert_status 409 "closing a period that isn't open → 409"

# ---- 8. Finalize + re-finalize --------------------------------------------
echo
echo "=== finalize ==="
call POST "/scoring/$FIXTURE/finalize" "$CODE" '{"decided_by":"normal"}'
assert_status 200 "finalize"
assert_json_eq '.fixture_status' 'complete' 'fixture_status=complete'

echo
echo "=== re-finalize without reopen ==="
call POST "/scoring/$FIXTURE/finalize" "$CODE" '{"decided_by":"normal"}'
assert_status 409 "second finalize without reopen → 409"

# ---- 9. Standings ---------------------------------------------------------
echo
echo "=== standings ==="
call GET "/standings?season=$SEASON" "$APIKEY"
assert_status 200 "GET /standings?season=$SEASON"

echo
echo "==================="
echo "ALL SMOKE STEPS OK."
