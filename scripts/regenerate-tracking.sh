#!/usr/bin/env bash
#
# regenerate-tracking.sh — Create Sprint A–E labels, milestones, epics, stories.
#
# Assumes stale issues #1–#18 and milestones #1–#4 are already closed.
# Safe to re-run: labels/milestones/issues are checked-then-created.

set -euo pipefail

REPO="bobosiband/Monday-Nights-Sports"

log()  { printf '\033[1;34m▸\033[0m %s\n' "$*" >&2; }
ok()   { printf '\033[1;32m✓\033[0m %s\n' "$*" >&2; }
skip() { printf '\033[1;33m•\033[0m %s\n' "$*" >&2; }

# ---------- labels ----------
create_label() {
  local name="$1" color="$2" desc="$3"
  if gh label list --repo "$REPO" --limit 200 --json name -q '.[].name' | grep -Fxq "$name"; then
    skip "label $name"
  else
    gh label create "$name" --repo "$REPO" --color "$color" --description "$desc" >/dev/null
    ok "label $name"
  fi
}

log "Creating labels…"
create_label "epic"           "5319E7" "Umbrella issue tracking a body of stories"
create_label "story"          "1F8B4C" "User-facing story issue"
create_label "task"           "CFD3D7" "Sub-task under a story"
create_label "backend"        "1D76DB" "Backend work"
create_label "db"             "0E8A16" "Schema / migration"
create_label "realtime"       "D93F0B" "Realtime distribution"
create_label "auth"           "FBCA04" "Auth / access control"
create_label "needs-decision" "B60205" "Blocked on a design decision"

# ---------- milestones ----------
milestone_number_for() {
  gh api "repos/$REPO/milestones?state=all&per_page=100" \
    --jq ".[] | select(.title == \"$1\") | .number" | head -n1
}

create_milestone() {
  local title="$1" desc="$2"
  local num; num="$(milestone_number_for "$title")"
  if [[ -n "$num" ]]; then
    skip "milestone $title (#$num)"
  else
    num="$(gh api -X POST "repos/$REPO/milestones" -f title="$title" -f description="$desc" --jq .number)"
    ok "milestone $title (#$num)"
  fi
  echo "$num"
}

log "Creating milestones…"
MSA="$(create_milestone "Sprint A — Scoring foundation" \
  "Append-only match_events + sport_configs + score derivation. The data-model layer for live scoring.")"
MSB="$(create_milestone "Sprint B — Scoring service" \
  "The scoring Edge Function: start, record, undo, period, fouls/cards, finalize. Bound to match tokens.")"
MSC="$(create_milestone "Sprint C — Operator access" \
  "Scoped match tokens/PINs so a sideline operator can score one fixture without a full account.")"
MSD="$(create_milestone "Sprint D — Live viewing" \
  "Public realtime distribution: a viewer sees the score update within a few seconds without refreshing.")"
MSE="$(create_milestone "Sprint E — Standings & archive" \
  "Config-driven standings per (season, sport) and a public archive of past events + results.")"

# ---------- issue helpers ----------
issue_number_for() {
  gh issue list --repo "$REPO" --state all --search "\"$1\" in:title" \
    --json number,title --jq ".[] | select(.title == \"$1\") | .number" | head -n1
}

# create_issue <title> <milestone_title> <body> <label...>
create_issue() {
  local title="$1"; shift
  local milestone="$1"; shift
  local body="$1"; shift
  local existing; existing="$(issue_number_for "$title")"
  if [[ -n "$existing" ]]; then
    skip "issue $title (#$existing)"
    echo "$existing"
    return
  fi
  local label_args=()
  for lbl in "$@"; do label_args+=("--label" "$lbl"); done
  local url; url="$(gh issue create --repo "$REPO" \
    --title "$title" --body "$body" --milestone "$milestone" "${label_args[@]}")"
  local num="${url##*/}"
  ok "issue $title (#$num)"
  echo "$num"
}

story_body() {
  local goal="$1" ac="$2" tables="$3" functions="$4" epic="$5"
  cat <<EOF
**Goal:** $goal

**Acceptance criteria**
$ac

**Touches**
- Tables: $tables
- Functions: $functions

Epic: #$epic
EOF
}

# ---------- epic issues ----------
log "Creating epic issues…"

E1=$(create_issue "Epic: Match event model" \
  "Sprint A — Scoring foundation" \
  "**Goal:** Ship the append-only \`match_events\` log, \`sport_configs\`, extended \`results\`, and a pure score-derivation library — the data-model layer every later scoring/standings feature reads from.

Stories are added as a task list once they are filed." \
  "epic" "db" "backend")

E2=$(create_issue "Epic: Live scoring API" \
  "Sprint B — Scoring service" \
  "**Goal:** Ship the \`scoring\` Edge Function: start, record, undo, period, fouls/cards, finalize. Every write is bound to a match token; the running score is always derivable from the event log.

Stories are added as a task list once they are filed." \
  "epic" "backend")

E3=$(create_issue "Epic: Scoped match access" \
  "Sprint C — Operator access" \
  "**Goal:** Give sideline operators a short-lived credential scoped to a single fixture (PIN table or signed short JWT — TBD). Organiser mints and revokes; scoring validates.

Stories are added as a task list once they are filed." \
  "epic" "auth" "backend")

E4=$(create_issue "Epic: Realtime score distribution" \
  "Sprint D — Live viewing" \
  "**Goal:** Public viewers see the score update within a few seconds without refreshing. Supabase Realtime channels per fixture; broadcast a derived summary, not raw events.

Stories are added as a task list once they are filed." \
  "epic" "realtime" "backend")

E5=$(create_issue "Epic: Standings & results" \
  "Sprint E — Standings & archive" \
  "**Goal:** Config-driven standings per (season, sport), plus a public archive of past events and their results.

Stories are added as a task list once they are filed." \
  "epic" "backend")

# ---------- stories ----------
log "Creating stories for Sprint A (Epic #$E1)…"

S_A1=$(create_issue "Story: match_events migration + RLS" \
  "Sprint A — Scoring foundation" \
  "$(story_body \
    "Append-only, idempotent event log that powers live-score derivation and undo." \
    "- [ ] Table with columns: client-suppliable \`id uuid\`, \`fixture_id\`, \`type\` (score/foul/card/timeout/period_start/period_end/note), \`team_id\`, \`player_id\`, \`value\`, \`period\`, \`match_clock_ms\`, \`voided_at\`, \`voided_by\`, \`created_by\`, \`created_at\`
- [ ] Index on \`(fixture_id, created_at)\`
- [ ] RLS: public read where parent event is published; authenticated write
- [ ] \`on conflict (id) do nothing\` behaviour verified" \
    "\`match_events\` (new)" \
    "_none — DB-only story_" \
    "$E1")" \
  "story" "db" "backend")

S_A2=$(create_issue "Story: sport_configs migration + RLS + seed for soccer/netball" \
  "Sprint A — Scoring foundation" \
  "$(story_body \
    "Per (season, sport) JSONB config that drives scoring increments, periods, and standings rules." \
    "- [ ] Table with \`(season_id, sport)\` unique
- [ ] \`config jsonb\` with periods / score_increments / track_fouls / standings sub-objects
- [ ] RLS matches existing public-read / authenticated-write model
- [ ] \`seed.sql\` includes rows for soccer and netball" \
    "\`sport_configs\` (new); \`seed.sql\`" \
    "_none — DB-only story_" \
    "$E1")" \
  "story" "db" "backend")

S_A3=$(create_issue "Story: score-derivation library (_shared/score.ts) + unit tests" \
  "Sprint A — Scoring foundation" \
  "$(story_body \
    "Pure function that folds a match_events list into a derived score/fouls/current-period summary." \
    "- [ ] \`deriveScore(events, config)\` returns \`{ home, away, foulsByTeam, currentPeriod }\`
- [ ] Ignores voided events
- [ ] Unit tests: score sums, foul counting, current period detection, undo semantics" \
    "reads \`match_events\`" \
    "\`supabase/functions/_shared/score.ts\` + test file" \
    "$E1")" \
  "story" "backend")

S_A4=$(create_issue "Story: extend results (periods, decided_by)" \
  "Sprint A — Scoring foundation" \
  "$(story_body \
    "Additive migration so a finalised result can carry a period-by-period breakdown and how it was decided." \
    "- [ ] Adds \`periods jsonb null\` and \`decided_by text default 'normal'\` with a check for normal/penalties/forfeit
- [ ] Existing rows unaffected
- [ ] RLS unchanged" \
    "\`results\` (alter, additive)" \
    "_none — DB-only story_" \
    "$E1")" \
  "story" "db" "backend")

log "Creating stories for Sprint B (Epic #$E2)…"

S_B1=$(create_issue "Story: scoring function skeleton + match-token guard hook" \
  "Sprint B — Scoring service" \
  "$(story_body \
    "Land the scoring Edge Function skeleton with route switch and a token guard integration point." \
    "- [ ] Function \`supabase/functions/scoring/index.ts\` exists with routes: \`/start\`, \`/events\`, \`/undo\`, \`/period\`, \`/finalize\`
- [ ] Match-token guard invoked at the top of every write route (stubbed until Epic #$E3 lands the real one)
- [ ] Registered in \`supabase/config.toml\` with \`verify_jwt = false\`" \
    "_none this story_" \
    "\`supabase/functions/scoring/\` (new)" \
    "$E2")" \
  "story" "backend" "auth")

S_B2=$(create_issue "Story: start / first-event flips fixtures.status to live" \
  "Sprint B — Scoring service" \
  "$(story_body \
    "Marking a fixture as live is a side-effect of scoring starting — either explicit /start or the first accepted event." \
    "- [ ] Explicit POST /start sets \`fixtures.status = 'live'\` and is idempotent
- [ ] First accepted event on a scheduled fixture also flips it
- [ ] No effect on already-live or already-complete fixtures" \
    "\`fixtures.status\`, \`match_events\`" \
    "\`supabase/functions/scoring/\`" \
    "$E2")" \
  "story" "backend")

S_B3=$(create_issue "Story: record event returns derived score (idempotent)" \
  "Sprint B — Scoring service" \
  "$(story_body \
    "Enable optimistic offline-safe scoring: the client supplies an event UUID and the server insert is idempotent." \
    "- [ ] Accepts client-supplied \`id\`; inserts with \`on conflict (id) do nothing\`
- [ ] Validates \`value\` against sport_config's allowed score_increments
- [ ] Response includes the derived score after the event
- [ ] 400 on unknown event type or malformed payload" \
    "\`match_events\`" \
    "\`supabase/functions/scoring/\`" \
    "$E2")" \
  "story" "backend")

S_B4=$(create_issue "Story: undo — soft-void by event id" \
  "Sprint B — Scoring service" \
  "$(story_body \
    "Undo never deletes; it sets voided_at so the audit trail is preserved and derivations skip the event." \
    "- [ ] Targets a specific event id (not \"the last one on the server\")
- [ ] Sets \`voided_at\`, \`voided_by\`
- [ ] Already-voided returns 200 (no-op)
- [ ] 404 for unknown event id" \
    "\`match_events\`" \
    "\`supabase/functions/scoring/\`" \
    "$E2")" \
  "story" "backend")

S_B5=$(create_issue "Story: period start/end events" \
  "Sprint B — Scoring service" \
  "$(story_body \
    "The event log carries period boundaries so derivations can report the current period." \
    "- [ ] POST /period accepts \`start\` and \`end\` intents; records \`period_start\`/\`period_end\` events with the \`period\` field
- [ ] Derivation exposes \`currentPeriod\` (latest period_start without a matching period_end)
- [ ] Guards against ending a period that never started" \
    "\`match_events\`" \
    "\`supabase/functions/scoring/\`" \
    "$E2")" \
  "story" "backend")

S_B6=$(create_issue "Story: fouls and cards event types" \
  "Sprint B — Scoring service" \
  "$(story_body \
    "Add non-score event types the scoring screen already needs to record." \
    "- [ ] \`type='foul'\` accepted per team; counted in derivation
- [ ] \`type='card'\` accepted with severity in \`value\`
- [ ] sport_config.track_fouls gates whether the derived summary exposes foul counts" \
    "\`match_events\`" \
    "\`supabase/functions/scoring/\`" \
    "$E2")" \
  "story" "backend")

S_B7=$(create_issue "Story: finalize — snapshot results and set fixtures.status=complete" \
  "Sprint B — Scoring service" \
  "$(story_body \
    "Locks the final score in a results row so standings/archive reads never re-fold the event log." \
    "- [ ] Derives final score + \`periods\` breakdown from events
- [ ] Upserts \`results\`, sets \`decided_by\`
- [ ] Sets \`fixtures.status='complete'\`
- [ ] Refuses to finalize a completed fixture unless explicitly reopened" \
    "\`results\`, \`fixtures.status\`, \`match_events\`" \
    "\`supabase/functions/scoring/\`" \
    "$E2")" \
  "story" "backend")

log "Creating stories for Sprint C (Epic #$E3)…"

S_C1=$(create_issue "Story: decide operator access model (PIN table vs signed scoped JWT) and implement" \
  "Sprint C — Operator access" \
  "$(story_body \
    "Pick one model for the scoped operator credential and land the primitive it needs." \
    "- [ ] Decision recorded under \`docs/decisions/\`
- [ ] Chosen model implemented (either \`match_access\` table with \`token_hash\`, \`expires_at\`, \`revoked_at\`; or signed short JWT with \`fixtureId\` claim)
- [ ] Trade-offs (revocation list vs no DB write) documented alongside the decision" \
    "\`match_access\` (new, if table chosen)" \
    "helpers under \`supabase/functions/_shared/\`" \
    "$E3")" \
  "story" "auth" "backend" "needs-decision")

S_C2=$(create_issue "Story: match-access organiser function (mint / revoke)" \
  "Sprint C — Operator access" \
  "$(story_body \
    "Organiser can mint a scoped token for a specific fixture and revoke it before expiry." \
    "- [ ] POST /match-access mints for a given fixture with a configurable TTL; raw token returned once
- [ ] POST /match-access/:id/revoke revokes an active token
- [ ] Organiser-only via existing auth guard
- [ ] Validation: fixture must exist; TTL bounded" \
    "\`match_access\` (if used)" \
    "\`supabase/functions/match-access/\` (new)" \
    "$E3")" \
  "story" "backend" "auth")

S_C3=$(create_issue "Story: token validation in scoring, bound to fixture" \
  "Sprint C — Operator access" \
  "$(story_body \
    "Replace the guard stub from Epic #$E2 with the real token validation." \
    "- [ ] scoring verifies the match token
- [ ] Every write is bound to the token's fixture; a mismatched body \`fixture_id\` is rejected 403
- [ ] 401 on missing/invalid/expired/revoked" \
    "\`match_access\` (read)" \
    "\`supabase/functions/scoring/\`" \
    "$E3")" \
  "story" "backend" "auth")

S_C4=$(create_issue "Story: expiry + revocation tests" \
  "Sprint C — Operator access" \
  "$(story_body \
    "Automated tests cover the token failure modes so a regression is loud." \
    "- [ ] Expired token → 401
- [ ] Revoked token → 401
- [ ] Wrong-fixture body → 403
- [ ] Tests run under \`deno test\` (or repo-standard test runner)" \
    "reads \`match_access\`" \
    "test files under \`supabase/functions/\`" \
    "$E3")" \
  "story" "backend" "auth")

log "Creating stories for Sprint D (Epic #$E4)…"

S_D1=$(create_issue "Story: Realtime channel design + score-summary broadcast" \
  "Sprint D — Live viewing" \
  "$(story_body \
    "Design the channel naming and payload shape so viewers get a derived summary, not raw event rows." \
    "- [ ] Channel naming documented (e.g. \`fixture:<uuid>\`)
- [ ] Postgres Changes / broadcast filter limits leakage to the correct fixture
- [ ] Broadcast payload = derived summary (home, away, currentPeriod, clock, status)
- [ ] Documented in \`docs/\`" \
    "\`match_events\` (channel filter); \`fixtures.status\`" \
    "docs; helper in \`_shared/\` if useful" \
    "$E4")" \
  "story" "realtime" "backend")

S_D2=$(create_issue "Story: GET /live/:fixtureId public derived score" \
  "Sprint D — Live viewing" \
  "$(story_body \
    "Non-realtime fallback so a fresh page-load or a client without websockets can still get the current derived score." \
    "- [ ] Unauth GET returns \`{ home, away, foulsByTeam, currentPeriod, status }\`
- [ ] Only for fixtures whose event is published
- [ ] 404 otherwise" \
    "reads \`match_events\`, \`fixtures\`, \`events\`" \
    "\`supabase/functions/live/\` (new) or extend \`fixtures-public\`" \
    "$E4")" \
  "story" "backend" "realtime")

S_D3=$(create_issue "Story: LIVE status surfaced in fixtures-public" \
  "Sprint D — Live viewing" \
  "$(story_body \
    "The share link students already have shows a LIVE badge on in-progress matches." \
    "- [ ] HTML / text / JSON views mark a fixture as LIVE when \`fixtures.status='live'\`
- [ ] Unit tests for the rendering across formats" \
    "reads \`fixtures.status\`" \
    "\`supabase/functions/fixtures-public/\`" \
    "$E4")" \
  "story" "backend")

log "Creating stories for Sprint E (Epic #$E5)…"

S_E1=$(create_issue "Story: standings calc library (config-driven) + unit tests" \
  "Sprint E — Standings & archive" \
  "$(story_body \
    "Pure TS calculator so standings behaviour is testable independently of the DB." \
    "- [ ] \`computeStandings(resultsForSeasonSport, sportConfig)\` tallies played/won/lost/drawn, points per config, sorts by tiebreakers
- [ ] Computed per (season, sport)
- [ ] Unit tests for tie-breakers and empty seasons" \
    "reads \`results\`, \`sport_configs\`" \
    "\`supabase/functions/_shared/standings.ts\` + tests" \
    "$E5")" \
  "story" "backend")

S_E2=$(create_issue "Story: GET /standings?season= public" \
  "Sprint E — Standings & archive" \
  "$(story_body \
    "Public endpoint students hit to see league tables." \
    "- [ ] Unauth GET returns standings grouped by sport for the given season
- [ ] 400 on missing/invalid \`season\`
- [ ] 200 with an empty table if no completed fixtures" \
    "reads \`results\`, \`sport_configs\`, \`fixtures\`" \
    "\`supabase/functions/standings/\` (new)" \
    "$E5")" \
  "story" "backend")

S_E3=$(create_issue "Story: results-public past events archive" \
  "Sprint E — Standings & archive" \
  "$(story_body \
    "Browsable history so a student can look back at last week's results without hunting through Messenger." \
    "- [ ] Unauth listing of past published events with their fixtures + final results, for a season
- [ ] Ordered newest first
- [ ] Simple cap / pagination for large archives" \
    "reads \`events\`, \`fixtures\`, \`results\`" \
    "\`supabase/functions/results-public/\` (new)" \
    "$E5")" \
  "story" "backend")

# ---------- edit epic bodies to include story task lists ----------
log "Adding story checklists to epic bodies…"

update_epic_body() {
  local epic="$1"; shift
  local title="$1"; shift
  local goal="$1"; shift
  local checklist=""
  for pair in "$@"; do
    local num="${pair%%:*}"
    local name="${pair#*:}"
    checklist+=$'\n'"- [ ] #$num — $name"
  done
  local body="**Goal:** $goal
$checklist"
  gh issue edit "$epic" --repo "$REPO" --body "$body" >/dev/null
  ok "epic body updated: #$epic ($title)"
}

update_epic_body "$E1" "Match event model" \
  "Ship the append-only match_events log, sport_configs, extended results, and a pure score-derivation library — the data-model layer every later scoring/standings feature reads from." \
  "$S_A1:match_events migration + RLS" \
  "$S_A2:sport_configs migration + RLS + seed" \
  "$S_A3:score-derivation library + tests" \
  "$S_A4:extend results (periods, decided_by)"

update_epic_body "$E2" "Live scoring API" \
  "Ship the scoring Edge Function: start, record, undo, period, fouls/cards, finalize. Every write is bound to a match token; the running score is always derivable from the event log." \
  "$S_B1:scoring skeleton + guard hook" \
  "$S_B2:start / first-event → live" \
  "$S_B3:record event (idempotent)" \
  "$S_B4:undo (soft-void by event id)" \
  "$S_B5:period start/end events" \
  "$S_B6:fouls and cards event types" \
  "$S_B7:finalize → snapshot results"

update_epic_body "$E3" "Scoped match access" \
  "Give sideline operators a short-lived credential scoped to a single fixture. Organiser mints and revokes; scoring validates." \
  "$S_C1:decide access model + implement" \
  "$S_C2:match-access organiser function" \
  "$S_C3:token validation in scoring" \
  "$S_C4:expiry + revocation tests"

update_epic_body "$E4" "Realtime score distribution" \
  "Public viewers see the score update within a few seconds without refreshing. Supabase Realtime channels per fixture; broadcast a derived summary, not raw events." \
  "$S_D1:Realtime channel design + summary broadcast" \
  "$S_D2:GET /live/:fixtureId public derived score" \
  "$S_D3:LIVE status in fixtures-public"

update_epic_body "$E5" "Standings & results" \
  "Config-driven standings per (season, sport), plus a public archive of past events and their results." \
  "$S_E1:standings calc library + tests" \
  "$S_E2:GET /standings?season= public" \
  "$S_E3:results-public past events archive"

log "Done."
echo
echo "Milestones:  A=$MSA B=$MSB C=$MSC D=$MSD E=$MSE"
echo "Epics:       #$E1 #$E2 #$E3 #$E4 #$E5"
echo "Sprint A:    #$S_A1 #$S_A2 #$S_A3 #$S_A4"
echo "Sprint B:    #$S_B1 #$S_B2 #$S_B3 #$S_B4 #$S_B5 #$S_B6 #$S_B7"
echo "Sprint C:    #$S_C1 #$S_C2 #$S_C3 #$S_C4"
echo "Sprint D:    #$S_D1 #$S_D2 #$S_D3"
echo "Sprint E:    #$S_E1 #$S_E2 #$S_E3"
