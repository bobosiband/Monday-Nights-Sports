#!/usr/bin/env bash
#
# smoke-live.sh — end-to-end smoke test AND live demo for the whole stack.
#
# Starts from an empty database (no reliance on seed.sql). Builds a season,
# teams, event, slots, and draw via the organiser HTTP APIs, publishes it,
# scores a fixture live, then verifies standings and the archive — the exact
# arc described at the top of docs/overview.md, without touching any SQL.
#
# 12-step flow:
#
#    1.  Create a season with sports=[soccer]
#    2.  Bulk-add 4 teams to the season
#    3.  Create an event on that season
#    4.  Create 4 slots on the event
#    5.  POST /events/:id/generate?dry_run=true — preview the draw
#    6.  POST /events/:id/generate — insert it
#    7.  POST /events/:id/publish — flip is_published=true
#    8.  Mint an operator code for one of the generated fixtures
#    9.  Start scoring: period, home goal, away goal, undo, live, close period, finalize
#   10.  GET /standings?season=<uuid> — soccer table has entries
#   11.  GET /results-public?season=<uuid> — archive shows the finalised fixture
#   12.  Revoke the operator code; confirm the next scoring write 401s
#
# Idempotent by construction: every run creates its own season with a
# UUID-suffixed name, so re-running against the same database doesn't
# collide with earlier runs. Cleaning up is the operator's call — a demo
# run leaves the season around for browsing; a CI run gets a fresh DB.
#
# Assumes `supabase start` is running locally. To run against the hosted
# project instead, export BASE_URL first:
#
#     export BASE_URL=https://<ref>.supabase.co/functions/v1
#     ./scripts/smoke-live.sh
#
# Requires: bash, curl, jq. Windows users: see docs/local-setup.md for a
# PowerShell walk-through.

set -uo pipefail

# ---- constants ------------------------------------------------------------

BASE=${BASE_URL:-http://127.0.0.1:54321/functions/v1}

pass=0
fail=0

# ---- helpers --------------------------------------------------------------

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

# Assert a JSON body has an expected value at a jq path.
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

# Assert an HTTP status code.
assert_status() {
  local want=$1 got=$2 label=$3
  if [[ "$got" == "$want" ]]; then
    ok "$label (HTTP $got)"
  else
    bad "$label — expected HTTP $want, got HTTP $got"
  fi
}

# Wrap curl so every hosted call carries the anon apikey header when it's
# set (some Supabase installs require it even on verify_jwt=false routes).
apikey_args=()
if [[ -n "${SUPABASE_ANON_KEY:-}" ]]; then
  apikey_args=(-H "apikey: $SUPABASE_ANON_KEY")
fi

# ---- prerequisites --------------------------------------------------------

step "Checking prerequisites"

for tool in curl jq; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "${red}error${reset}: $tool is required." >&2
    exit 2
  fi
done

ORGANISER_JWT=$(require_env ORGANISER_JWT)
ORGANISER_AUTH=(-H "authorization: Bearer $ORGANISER_JWT")

echo "${dim}Base URL: $BASE${reset}"

# ---- 1. Create a season ----------------------------------------------------

step "1. POST /seasons — create a fresh season"

# Suffix the name so re-runs against the same DB don't collide on unique
# indexes / conflict with earlier smoke runs sitting in the DB.
SEASON_NAME="Smoke Season $(date -u +%FT%TZ)"
season_body=$(jq -nc \
  --arg n "$SEASON_NAME" \
  --arg s "$(date -u +%Y-%m-%d)" \
  '{name: $n, sports: ["soccer"], starts_on: $s, ends_on: "2030-12-31", is_active: false}')
season_res=$(curl -s "${apikey_args[@]}" "${ORGANISER_AUTH[@]}" -X POST \
  -H "content-type: application/json" \
  -d "$season_body" \
  "$BASE/seasons")
SEASON=$(echo "$season_res" | jq -r '.season.id // empty')
if [[ -z "$SEASON" ]]; then
  bad "create season — no id in response"
  echo "$season_res" | jq . || echo "$season_res"
  exit 1
fi
ok "season created ($SEASON)"

# ---- 2. Bulk-add teams -----------------------------------------------------

step "2. POST /teams/bulk — add 4 teams"

teams_body=$(jq -nc --arg s "$SEASON" \
  '{season_id: $s, names: ["Reds","Blues","Greens","Yellows"]}')
teams_res=$(curl -s "${apikey_args[@]}" "${ORGANISER_AUTH[@]}" -X POST \
  -H "content-type: application/json" \
  -d "$teams_body" \
  "$BASE/teams/bulk")
readarray -t TEAM_IDS < <(echo "$teams_res" | jq -r '.inserted[].id')
if [[ ${#TEAM_IDS[@]} -ne 4 ]]; then
  bad "expected 4 teams inserted, got ${#TEAM_IDS[@]}"
  echo "$teams_res" | jq . || echo "$teams_res"
  exit 1
fi
ok "4 teams created"

# ---- 3. Create an event ----------------------------------------------------

step "3. POST /events — create the Monday-night event"

event_body=$(jq -nc --arg s "$SEASON" --arg d "$(date -u +%Y-%m-%d)" \
  '{season_id: $s, event_date: $d}')
event_res=$(curl -s "${apikey_args[@]}" "${ORGANISER_AUTH[@]}" -X POST \
  -H "content-type: application/json" \
  -d "$event_body" \
  "$BASE/events")
EVENT=$(echo "$event_res" | jq -r '.event.id // empty')
if [[ -z "$EVENT" ]]; then
  bad "create event — no id in response"
  echo "$event_res" | jq . || echo "$event_res"
  exit 1
fi
ok "event created ($EVENT)"

# ---- 4. Create slots -------------------------------------------------------

step "4. POST /events/:id/slots — 4 slots at 18:00, 19:00, 20:00, 21:00"

SLOT_IDS=()
for i in 1 2 3 4; do
  slot_body=$(jq -nc --argjson n "$i" --arg t "$((17 + i)):00" \
    '{slot_number: $n, starts_at: $t, pitch: "Village Green"}')
  slot_res=$(curl -s "${apikey_args[@]}" "${ORGANISER_AUTH[@]}" -X POST \
    -H "content-type: application/json" \
    -d "$slot_body" \
    "$BASE/events/$EVENT/slots")
  sid=$(echo "$slot_res" | jq -r '.slot.id // empty')
  if [[ -z "$sid" ]]; then
    bad "create slot $i — no id in response"
    echo "$slot_res" | jq . || echo "$slot_res"
    exit 1
  fi
  SLOT_IDS+=("$sid")
done
ok "4 slots created"

# ---- 5. Generate — dry run -------------------------------------------------

step "5. POST /events/:id/generate?dry_run=true — preview the draw"

gen_body=$(jq -nc \
  --arg s "soccer" \
  --argjson t "$(printf '%s\n' "${TEAM_IDS[@]}" | jq -R . | jq -s .)" \
  --argjson sl "$(printf '%s\n' "${SLOT_IDS[@]}" | jq -R . | jq -s .)" \
  '{sport: $s, team_ids: $t, slot_ids: $sl}')
dry_res=$(curl -s "${apikey_args[@]}" "${ORGANISER_AUTH[@]}" -X POST \
  -H "content-type: application/json" \
  -d "$gen_body" \
  "$BASE/events/$EVENT/generate?dry_run=true")
dry_count=$(echo "$dry_res" | jq -r '.preview | length // 0')
# 4 teams round-robin = 3 rounds × 2 fixtures/round = 6 fixtures.
if [[ "$dry_count" == "6" ]]; then
  ok "dry-run preview shows 6 fixtures (3 rounds × 2)"
else
  bad "dry-run preview count wrong — expected 6, got $dry_count"
  echo "$dry_res" | jq . || echo "$dry_res"
fi

# ---- 6. Generate — for real ------------------------------------------------

step "6. POST /events/:id/generate — insert the draw"

gen_res=$(curl -s "${apikey_args[@]}" "${ORGANISER_AUTH[@]}" -X POST \
  -H "content-type: application/json" \
  -d "$gen_body" \
  "$BASE/events/$EVENT/generate")
gen_count=$(echo "$gen_res" | jq -r '.inserted | length // 0')
if [[ "$gen_count" == "6" ]]; then
  ok "insert wrote 6 fixtures"
else
  bad "insert count wrong — expected 6, got $gen_count"
  echo "$gen_res" | jq . || echo "$gen_res"
  exit 1
fi

# Pick a real fixture to score against — first one returned.
FIXTURE=$(echo "$gen_res" | jq -r '.inserted[0].id')
HOME_TEAM=$(echo "$gen_res" | jq -r '.inserted[0].home_team_id')
AWAY_TEAM=$(echo "$gen_res" | jq -r '.inserted[0].away_team_id')
if [[ -z "$FIXTURE" || "$AWAY_TEAM" == "null" ]]; then
  # 4-team draw never produces byes; if we got one, the smoke needs a fix.
  bad "picked fixture has no away team — cannot score"
  exit 1
fi

# ---- 7. Publish ------------------------------------------------------------

step "7. POST /events/:id/publish"

pub_res=$(curl -s "${apikey_args[@]}" "${ORGANISER_AUTH[@]}" -X POST \
  "$BASE/events/$EVENT/publish")
assert_json_eq "$pub_res" '.event.is_published' 'true' 'event.is_published = true'

# ---- 8. Mint operator code -------------------------------------------------

step "8. POST /match-access — mint a code for the picked fixture"

mint_body=$(jq -nc \
  --arg f "$FIXTURE" \
  --arg l "smoke test" \
  '{fixture_id: $f, ttl_minutes: 60, label: $l}')
mint_res=$(curl -s "${apikey_args[@]}" "${ORGANISER_AUTH[@]}" -X POST \
  -H "content-type: application/json" \
  -d "$mint_body" \
  "$BASE/match-access")
CODE=$(echo "$mint_res" | jq -r '.code // empty')
CODE_ID=$(echo "$mint_res" | jq -r '.id // empty')
if [[ -z "$CODE" || -z "$CODE_ID" ]]; then
  bad "mint — no code returned"
  echo "$mint_res" | jq . || echo "$mint_res"
  exit 1
fi
ok "mint returned code (id=$CODE_ID)"

MATCH_AUTH="authorization: Bearer $CODE"

# ---- 9. Score the fixture --------------------------------------------------
# start → period → goals → undo → live → end → finalize

step "9a. POST /scoring/\$FIXTURE/start"
start_res=$(curl -s "${apikey_args[@]}" -X POST -H "$MATCH_AUTH" \
  "$BASE/scoring/$FIXTURE/start")
assert_json_eq "$start_res" '.fixture_status' 'live' 'fixture flipped to live'

step "9b. Open period 1"
period_open=$(curl -s "${apikey_args[@]}" -X POST -H "$MATCH_AUTH" \
  -H "content-type: application/json" \
  -d '{"intent":"start","period":1}' \
  "$BASE/scoring/$FIXTURE/period")
assert_json_eq "$period_open" '.derived.currentPeriod' '1' 'currentPeriod == 1'

step "9c. Home goal + away goal"
HOME_EVT=$(uuid); AWAY_EVT=$(uuid)
home_res=$(curl -s "${apikey_args[@]}" -X POST -H "$MATCH_AUTH" \
  -H "content-type: application/json" \
  -d "{\"id\":\"$HOME_EVT\",\"type\":\"score\",\"team_id\":\"$HOME_TEAM\",\"value\":1}" \
  "$BASE/scoring/$FIXTURE/events")
assert_json_eq "$home_res" '.derived.home' '1' 'home score 1 after home goal'
away_res=$(curl -s "${apikey_args[@]}" -X POST -H "$MATCH_AUTH" \
  -H "content-type: application/json" \
  -d "{\"id\":\"$AWAY_EVT\",\"type\":\"score\",\"team_id\":\"$AWAY_TEAM\",\"value\":1}" \
  "$BASE/scoring/$FIXTURE/events")
assert_json_eq "$away_res" '.derived.away' '1' 'away score 1 after away goal'

step "9d. Undo the away goal"
undo_res=$(curl -s "${apikey_args[@]}" -X POST -H "$MATCH_AUTH" \
  -H "content-type: application/json" \
  -d "{\"event_id\":\"$AWAY_EVT\"}" \
  "$BASE/scoring/$FIXTURE/undo")
assert_json_eq "$undo_res" '.derived.away' '0' 'away score back to 0 after undo'

step "9e. GET /live/\$FIXTURE reflects state"
live_res=$(curl -s "${apikey_args[@]}" "$BASE/live/$FIXTURE")
assert_json_eq "$live_res" '.status' 'live' 'live: status=live'
assert_json_eq "$live_res" '.home.score' '1' 'live: home score = 1'
assert_json_eq "$live_res" '.away.score' '0' 'live: away score = 0'

step "9f. Close period 1"
period_close=$(curl -s "${apikey_args[@]}" -X POST -H "$MATCH_AUTH" \
  -H "content-type: application/json" \
  -d '{"intent":"end","period":1}' \
  "$BASE/scoring/$FIXTURE/period")
assert_json_eq "$period_close" '.derived.currentPeriod' 'null' 'no open period after close'

step "9g. Finalize"
final_res=$(curl -s "${apikey_args[@]}" -X POST -H "$MATCH_AUTH" \
  -H "content-type: application/json" \
  -d '{"decided_by":"normal"}' \
  "$BASE/scoring/$FIXTURE/finalize")
assert_json_eq "$final_res" '.fixture_status' 'complete' 'fixture complete after finalize'
assert_json_eq "$final_res" '.result.home_score' '1' 'result.home_score = 1'

# ---- 10. Standings ---------------------------------------------------------

step "10. GET /standings?season=\$SEASON"
standings_res=$(curl -s "${apikey_args[@]}" "$BASE/standings?season=$SEASON")
if echo "$standings_res" | jq -e '.standings_by_sport.soccer | length > 0' >/dev/null; then
  ok "standings: soccer table populated"
else
  bad "standings: soccer table empty"
  echo "$standings_res" | jq . || echo "$standings_res"
fi

# ---- 11. Archive ----------------------------------------------------------

step "11. GET /results-public?season=\$SEASON"
archive_res=$(curl -s "${apikey_args[@]}" "$BASE/results-public?season=$SEASON")
if echo "$archive_res" | jq -e '.events[0].fixtures | length > 0' >/dev/null; then
  ok "archive: at least one event with finalised fixtures"
else
  bad "archive: no finalised fixtures visible"
  echo "$archive_res" | jq . || echo "$archive_res"
fi

# ---- 12. Revoke ------------------------------------------------------------

step "12a. Revoke the operator code"
revoke_res=$(curl -s "${apikey_args[@]}" "${ORGANISER_AUTH[@]}" -X POST \
  "$BASE/match-access/$CODE_ID/revoke")
if echo "$revoke_res" | jq -e '.revoked_at' >/dev/null; then
  ok "revoke returned a revoked_at timestamp"
else
  bad "revoke did not return a revoked_at"
  echo "$revoke_res" | jq . || echo "$revoke_res"
fi

step "12b. Post-revoke: /scoring should 401"
post_status=$(curl -s "${apikey_args[@]}" -o /dev/null -w '%{http_code}' \
  -X POST -H "$MATCH_AUTH" "$BASE/scoring/$FIXTURE/start")
assert_status 401 "$post_status" 'revoked code cannot score'

# ---- summary ---------------------------------------------------------------
echo
echo "===================="
echo "PASS: $pass   FAIL: $fail"
echo "Season: $SEASON"
echo "Event:  $EVENT (published)"
if [[ $fail -gt 0 ]]; then
  exit 1
fi
