#!/usr/bin/env bash
#
# smoke-live.sh — end-to-end smoke test for the Sprint C/D/E chunk.
#
# Walks the full operator + viewer arc against a local Supabase stack:
#
#   1.  Mint an operator match code for the seeded soccer fixture
#   2.  POST /scoring/:id/start
#   3.  POST /scoring/:id/period {intent:start,period:1}
#   4.  Record a home goal, then an away goal
#   5.  Undo the away goal
#   6.  GET /live/:id — verify the score reflects the state above
#   7.  POST /scoring/:id/period {intent:end,period:1}
#   8.  POST /scoring/:id/finalize
#   9.  GET /standings?season=<seasonId>
#  10.  GET /results-public?season=<seasonId>
#  11.  Revoke the operator code
#  12.  Confirm the next scoring call now returns 401
#
# Idempotent: safe to re-run against the same fixture (uses unique event
# UUIDs per attempt, and the scoring service is idempotent on event id).
# Assumes `supabase start` is running and `supabase db reset` has been run
# recently.
#
# Requires: bash, curl, jq. Windows users: see docs/local-setup.md for a
# PowerShell walk-through.

set -uo pipefail

# ---- constants ------------------------------------------------------------
BASE=http://127.0.0.1:54321/functions/v1
FIXTURE=f0111111-1111-1111-1111-111111111111
SEASON=11111111-1111-1111-1111-111111111111
HOME_TEAM=a1111111-1111-1111-1111-111111111111
AWAY_TEAM=a2222222-2222-2222-2222-222222222222

pass=0
fail=0

# ---- helpers --------------------------------------------------------------

# Colour helpers when the terminal supports it; else plain text.
if [[ -t 1 ]]; then
  green=$'\033[0;32m'; red=$'\033[0;31m'; dim=$'\033[2m'; reset=$'\033[0m'
else
  green=""; red=""; dim=""; reset=""
fi

step() {
  echo
  echo "${dim}=== $* ===${reset}"
}

ok() {
  pass=$((pass + 1))
  echo "${green}PASS${reset}: $*"
}

bad() {
  fail=$((fail + 1))
  echo "${red}FAIL${reset}: $*"
}

# Portable UUID generator — falls back to /proc on systems without uuidgen.
uuid() {
  if command -v uuidgen >/dev/null 2>&1; then
    uuidgen | tr '[:upper:]' '[:lower:]'
  else
    cat /proc/sys/kernel/random/uuid
  fi
}

# Read a required env var with a helpful error.
require_env() {
  local name=$1
  local value=${!name-}
  if [[ -z "$value" ]]; then
    echo "${red}error${reset}: $name not set. Read from \`supabase status\` and export it." >&2
    exit 2
  fi
  echo "$value"
}

# Wait for a JSON field to have an expected value on a URL. Used sparingly.
assert_json_eq() {
  local body=$1 jqpath=$2 want=$3 label=$4
  local got
  got=$(echo "$body" | jq -r "$jqpath")
  if [[ "$got" == "$want" ]]; then
    ok "$label ($jqpath == $want)"
  else
    bad "$label — expected $want, got $got"
    echo "$body" | jq . || echo "$body"
  fi
}

# ---- prerequisites --------------------------------------------------------

step "Checking prerequisites"

for tool in curl jq; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "${red}error${reset}: $tool is required." >&2
    exit 2
  fi
done

# ORGANISER_JWT is needed for the mint / revoke steps. See docs/sprint-1.md
# for how to grab one from Supabase Auth. SUPABASE_ANON_KEY is optional but
# some Supabase installs require it as an `apikey` header even for
# verify_jwt=false functions — send it when present.
ORGANISER_JWT=$(require_env ORGANISER_JWT)
APIKEY=${SUPABASE_ANON_KEY:-}
apikey_header=(-H "apikey: ${APIKEY}")

echo "${dim}Using base URL: $BASE${reset}"
echo "${dim}Fixture: $FIXTURE (seeded soccer, Reds vs Blues)${reset}"

# ---- 1. Mint a code --------------------------------------------------------

step "1. Mint an operator match code"
mint_body=$(jq -nc \
  --arg f "$FIXTURE" \
  --arg l "smoke test" \
  '{fixture_id: $f, ttl_minutes: 60, label: $l}')
mint_res=$(curl -s "${apikey_header[@]}" -X POST \
  -H "authorization: Bearer $ORGANISER_JWT" \
  -H "content-type: application/json" \
  -d "$mint_body" \
  "$BASE/match-access")
CODE=$(echo "$mint_res" | jq -r '.code // empty')
CODE_ID=$(echo "$mint_res" | jq -r '.id // empty')
if [[ -z "$CODE" || -z "$CODE_ID" ]]; then
  bad "mint — no code returned"
  echo "$mint_res" | jq . || echo "$mint_res"
  echo "${red}Aborting: no code to test with.${reset}"
  exit 1
fi
ok "mint returned code (id=$CODE_ID)"

MATCH_AUTH="authorization: Bearer $CODE"

# ---- 2. Start --------------------------------------------------------------

step "2. POST /scoring/$FIXTURE/start"
start_res=$(curl -s "${apikey_header[@]}" -X POST -H "$MATCH_AUTH" \
  "$BASE/scoring/$FIXTURE/start")
assert_json_eq "$start_res" '.fixture_status' 'live' 'fixture flipped to live'

# ---- 3. Open period 1 ------------------------------------------------------

step "3. Open period 1"
period_open=$(curl -s "${apikey_header[@]}" -X POST -H "$MATCH_AUTH" \
  -H "content-type: application/json" \
  -d '{"intent":"start","period":1}' \
  "$BASE/scoring/$FIXTURE/period")
assert_json_eq "$period_open" '.derived.currentPeriod' '1' 'currentPeriod == 1'

# ---- 4. Score home + away --------------------------------------------------

step "4. Record home goal, then away goal"
HOME_EVT=$(uuid); AWAY_EVT=$(uuid)
home_res=$(curl -s "${apikey_header[@]}" -X POST -H "$MATCH_AUTH" \
  -H "content-type: application/json" \
  -d "{\"id\":\"$HOME_EVT\",\"type\":\"score\",\"team_id\":\"$HOME_TEAM\",\"value\":1}" \
  "$BASE/scoring/$FIXTURE/events")
assert_json_eq "$home_res" '.derived.home' '1' 'home score 1 after home goal'

away_res=$(curl -s "${apikey_header[@]}" -X POST -H "$MATCH_AUTH" \
  -H "content-type: application/json" \
  -d "{\"id\":\"$AWAY_EVT\",\"type\":\"score\",\"team_id\":\"$AWAY_TEAM\",\"value\":1}" \
  "$BASE/scoring/$FIXTURE/events")
assert_json_eq "$away_res" '.derived.away' '1' 'away score 1 after away goal'

# ---- 5. Undo the away goal -------------------------------------------------

step "5. Undo the away goal"
undo_res=$(curl -s "${apikey_header[@]}" -X POST -H "$MATCH_AUTH" \
  -H "content-type: application/json" \
  -d "{\"event_id\":\"$AWAY_EVT\"}" \
  "$BASE/scoring/$FIXTURE/undo")
assert_json_eq "$undo_res" '.derived.away' '0' 'away score back to 0 after undo'

# ---- 6. GET /live/:id ------------------------------------------------------

step "6. GET /live/$FIXTURE reflects derived state"
live_res=$(curl -s "${apikey_header[@]}" "$BASE/live/$FIXTURE")
assert_json_eq "$live_res" '.status' 'live' 'live: status=live'
assert_json_eq "$live_res" '.home.score' '1' 'live: home score = 1'
assert_json_eq "$live_res" '.away.score' '0' 'live: away score = 0'

# ---- 7. Close period 1 -----------------------------------------------------

step "7. Close period 1"
period_close=$(curl -s "${apikey_header[@]}" -X POST -H "$MATCH_AUTH" \
  -H "content-type: application/json" \
  -d '{"intent":"end","period":1}' \
  "$BASE/scoring/$FIXTURE/period")
assert_json_eq "$period_close" '.derived.currentPeriod' 'null' 'no open period after close'

# ---- 8. Finalize -----------------------------------------------------------

step "8. Finalize (reopen=true to keep the smoke idempotent)"
final_res=$(curl -s "${apikey_header[@]}" -X POST -H "$MATCH_AUTH" \
  -H "content-type: application/json" \
  -d '{"decided_by":"normal","reopen":true}' \
  "$BASE/scoring/$FIXTURE/finalize")
assert_json_eq "$final_res" '.fixture_status' 'complete' 'fixture complete after finalize'
assert_json_eq "$final_res" '.result.home_score' '1' 'result.home_score = 1'

# ---- 9. Standings ----------------------------------------------------------

step "9. GET /standings?season=$SEASON"
standings_res=$(curl -s "${apikey_header[@]}" "$BASE/standings?season=$SEASON")
if echo "$standings_res" | jq -e '.standings_by_sport.soccer | length > 0' >/dev/null; then
  ok "standings: soccer table populated"
else
  bad "standings: soccer table empty"
  echo "$standings_res" | jq .
fi

# ---- 10. Archive ----------------------------------------------------------

step "10. GET /results-public?season=$SEASON"
archive_res=$(curl -s "${apikey_header[@]}" "$BASE/results-public?season=$SEASON")
if echo "$archive_res" | jq -e '.events[0].fixtures | length > 0' >/dev/null; then
  ok "archive: at least one event with finalized fixtures"
else
  bad "archive: no finalized fixtures visible"
  echo "$archive_res" | jq .
fi

# ---- 11. Revoke the code ---------------------------------------------------

step "11. Revoke the operator code"
revoke_res=$(curl -s "${apikey_header[@]}" -X POST \
  -H "authorization: Bearer $ORGANISER_JWT" \
  "$BASE/match-access/$CODE_ID/revoke")
if echo "$revoke_res" | jq -e '.revoked_at' >/dev/null; then
  ok "revoke returned a revoked_at timestamp"
else
  bad "revoke did not return a revoked_at"
  echo "$revoke_res" | jq .
fi

# ---- 12. Post-revoke: scoring writes 401 ----------------------------------

step "12. Post-revoke: /scoring should 401"
# HTTP status is what we care about here.
post_status=$(curl -s "${apikey_header[@]}" -o /dev/null -w '%{http_code}' \
  -X POST -H "$MATCH_AUTH" "$BASE/scoring/$FIXTURE/start")
if [[ "$post_status" == "401" ]]; then
  ok "revoked code cannot score (HTTP $post_status)"
else
  bad "expected 401 after revoke, got $post_status"
fi

# ---- summary ---------------------------------------------------------------
echo
echo "===================="
echo "PASS: $pass   FAIL: $fail"
if [[ $fail -gt 0 ]]; then
  exit 1
fi
