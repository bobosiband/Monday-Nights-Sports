# Local development setup

Everything you need to run the Monday Night Sports backend on your own machine
and exercise the scoring service end-to-end.

Covers **macOS, Windows (PowerShell + WSL2), and Linux**. Look for the tab-like
headings under each install step.

New to the project? Start with [`overview.md`](overview.md), then come back
here.

---

## What you're setting up

- **Postgres 15** (in Docker, via the Supabase CLI) — seasons, teams, events,
  fixtures, match_events, results, etc.
- **Edge Functions runtime** — Deno-based, serves the code under
  `supabase/functions/` at `http://127.0.0.1:54321/functions/v1/`.
- **Studio** at `http://127.0.0.1:54323` — a web UI for inspecting the DB and
  running SQL. Use this liberally while you're learning the schema.

You do **not** need a hosted Supabase account for local dev.

---

## Prerequisites (all platforms)

| Tool          | Why                                    | Version    |
| ------------- | -------------------------------------- | ---------- |
| Docker        | Supabase runs its stack in containers  | Any recent |
| Supabase CLI  | Boots the stack, migrations, functions | ≥ 2.109    |
| Deno          | Runs the unit tests                    | ≥ 2        |
| git, curl, jq | Basic dev tooling                      | Any recent |

Windows users: install everything **inside WSL2 (Ubuntu)** if you can — it's the
most compatible path. Native-Windows notes are included where they differ, but
Docker + Supabase behaves best on Linux/macOS.

---

## Installing Docker

### macOS

Install **Docker Desktop**: https://docs.docker.com/desktop/install/mac-install/
Start it from Launchpad. Verify:

```bash
docker info | head -5   # look for "Server Version"
```

### Windows

Install **Docker Desktop with WSL2 backend**:
https://docs.docker.com/desktop/install/windows-install/ Enable WSL2 integration
for your Ubuntu distro in Docker Desktop settings → Resources → WSL Integration.
Verify from inside WSL2:

```bash
docker info | head -5
```

### Linux (Ubuntu/Debian)

```bash
# https://docs.docker.com/engine/install/ubuntu/
sudo apt-get install docker.io   # or the official docker-ce package
sudo usermod -aG docker $USER
newgrp docker                    # or log out and back in
docker info | head -5            # should print "Server Version"
```

### Linux (Fedora / Arch / others)

Use your distro's package (`dnf install moby-engine`, `pacman -S docker`, etc.),
enable + start the daemon (`sudo systemctl enable --now docker`), add yourself
to the `docker` group.

---

## Installing the Supabase CLI

Version 2.109+ ships as a shim (`supabase`) **plus** a Go binary (`supabase-go`)
that must live in the same directory. Moving just the shim onto PATH will fail
with `Could not find the supabase-go binary`. Use one of the paths below — each
keeps the pair together.

### macOS (recommended: Homebrew)

```bash
brew install supabase/tap/supabase
supabase --version
```

### Windows (recommended: Scoop or WSL2)

**Scoop:**

```powershell
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
scoop install supabase
supabase --version
```

**Inside WSL2** — use the Linux tarball steps below.

### Linux (tarball, no package manager)

```bash
mkdir -p ~/.local/share/supabase
VERSION=v2.109.1   # or latest from https://github.com/supabase/cli/releases/latest
curl -fsSL -o /tmp/supabase.tar.gz \
  "https://github.com/supabase/cli/releases/download/${VERSION}/supabase_${VERSION#v}_linux_amd64.tar.gz"
tar -xzf /tmp/supabase.tar.gz -C ~/.local/share/supabase
mkdir -p ~/.local/bin
ln -sf ~/.local/share/supabase/supabase ~/.local/bin/supabase
# Make sure ~/.local/bin is on PATH (most distros already do this).
echo "$PATH" | tr ':' '\n' | grep -q "$HOME/.local/bin" || \
  echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
supabase --version
```

### Linux (Arch)

```bash
yay -S supabase-bin   # or paru, whichever AUR helper you use
```

---

## Installing Deno

### macOS

```bash
brew install deno
```

or use the universal installer:

```bash
curl -fsSL https://deno.land/install.sh | sh
```

### Windows

**PowerShell:**

```powershell
irm https://deno.land/install.ps1 | iex
```

Or `scoop install deno` / `winget install DenoLand.Deno`.

Inside WSL2: use the Linux installer.

### Linux

```bash
curl -fsSL https://deno.land/install.sh | sh
# Restart your shell (or `source ~/.bashrc`) so `deno` is on PATH.
deno --version
```

---

## First-time setup

Once Docker is running and the CLI is on PATH, from the repo root:

```bash
supabase start        # boots the stack; first run pulls containers (~1–2 min)
supabase db reset     # applies migrations 0001–0004 + seed.sql
supabase status       # prints ANON_KEY / SERVICE_ROLE_KEY / API URLs
```

`supabase start` also serves the Edge Functions automatically — the routes under
`supabase/functions/*` are live at
`http://127.0.0.1:54321/functions/v1/<function-name>`. You usually **do not**
need to run `supabase functions serve` unless you're actively editing a function
and want hot-reload.

### Windows note

On native Windows PowerShell, use `curl.exe` (or `Invoke-RestMethod`) for the
smoke test — the built-in `curl` alias points to `Invoke-WebRequest` and takes
different flags. The examples below assume a bash-style shell (macOS Terminal,
WSL2, Linux). Windows equivalents follow.

---

## Running the unit tests

Pure-logic tests — no DB required. Same command on every platform:

```bash
deno test --allow-net supabase/functions/_tests/
```

You should see roughly:

```
ok | ~100 passed | 0 failed
```

Coverage (Sprints 1 → C/D/E):

- `_tests/shared/score.test.ts` — the `deriveScore` fold.
- `_tests/shared/score-mixed.test.ts` — scores + fouls + cards together.
- `_tests/shared/match-token.test.ts` — code generator, normalisation, SHA-256
  hasher, bearer extractor.
- `_tests/shared/standings.test.ts` — points / tiebreakers / byes / config
  permutations.
- `_tests/scoring/validate-event.test.ts` — request-body validation.
- `_tests/scoring/period-state.test.ts` — `periodIsOpen` helper.
- `_tests/scoring/period-breakdown.test.ts` — finalize's period fold.
- `_tests/scoring/guard.test.ts` — verifyMatchToken: expired / revoked /
  wrong-fixture / happy path.
- `_tests/fixtures-public/render.test.ts` — LIVE badge and score rendering.
- `_tests/sport-configs/validate-config.test.ts` — strict shape validation for
  the sport-configs body.
- `_tests/shared/round-robin.test.ts` — pure round-robin generator (all-pairs,
  bye distribution, determinism).

```bash
deno test --allow-net supabase/functions/_tests/
```

Type-check the whole service (no execution):

```bash
deno check supabase/functions/scoring/index.ts
```

---

## Smoke-testing the scoring routes

The seed inserts a soccer fixture (Reds vs Blues) with id
`f0111111-1111-1111-1111-111111111111` **and** a long-lived operator match code
hashed into `match_access`. The raw code is:

```
DEVCODE1
```

This walkthrough drives that fixture from `scheduled` to `complete`.

### One-line end-to-end

The full arc (mint → score → live → finalize → standings → revoke → confirm 401)
has a scripted walkthrough:

```bash
export ORGANISER_JWT=<your organiser JWT — see docs/sprint-1.md>
export SUPABASE_ANON_KEY=$(supabase status -o json | jq -r .API.ANON_KEY)
./scripts/smoke-live.sh
```

Every step prints PASS / FAIL; the summary line at the bottom is the overall
verdict.

### Manual walkthrough — bash / zsh (macOS, Linux, WSL2)

```bash
FIXTURE=f0111111-1111-1111-1111-111111111111
HOME=a1111111-1111-1111-1111-111111111111   # Reds
AWAY=a2222222-2222-2222-2222-222222222222   # Blues
BASE=http://127.0.0.1:54321/functions/v1/scoring/$FIXTURE
AUTH='authorization: Bearer DEVCODE1'

# Cross-platform UUID generator — pick the one that works:
uuid() { uuidgen 2>/dev/null | tr '[:upper:]' '[:lower:]' \
         || cat /proc/sys/kernel/random/uuid; }

# --- flip status to live ---
curl -s -X POST -H "$AUTH" $BASE/start | jq .

# --- open period 1 (do this before recording scores if you want them
#     in the finalize period breakdown) ---
curl -s -X POST -H "$AUTH" -H 'content-type: application/json' \
  -d '{"intent":"start","period":1}' $BASE/period | jq .

# --- record a home goal (client-supplied UUID → idempotent replay) ---
EVID=$(uuid)
curl -s -X POST -H "$AUTH" -H 'content-type: application/json' \
  -d "{\"id\":\"$EVID\",\"type\":\"score\",\"team_id\":\"$HOME\",\"value\":1}" \
  $BASE/events | jq .

# --- replay same event: 200 inserted:false, score unchanged ---
curl -s -X POST -H "$AUTH" -H 'content-type: application/json' \
  -d "{\"id\":\"$EVID\",\"type\":\"score\",\"team_id\":\"$HOME\",\"value\":1}" \
  $BASE/events | jq .

# --- soccer disallows value 2 → 400 ---
curl -s -X POST -H "$AUTH" -H 'content-type: application/json' \
  -d "{\"id\":\"$(uuid)\",\"type\":\"score\",\"team_id\":\"$HOME\",\"value\":2}" \
  $BASE/events

# --- foul + undo it ---
FOUL=$(uuid)
curl -s -X POST -H "$AUTH" -H 'content-type: application/json' \
  -d "{\"id\":\"$FOUL\",\"type\":\"foul\",\"team_id\":\"$HOME\"}" \
  $BASE/events | jq .
curl -s -X POST -H "$AUTH" -H 'content-type: application/json' \
  -d "{\"event_id\":\"$FOUL\"}" $BASE/undo | jq .

# --- end period 1 ---
curl -s -X POST -H "$AUTH" -H 'content-type: application/json' \
  -d '{"intent":"end","period":1}' $BASE/period | jq .

# --- ending a period that never opened → 409 ---
curl -s -X POST -H "$AUTH" -H 'content-type: application/json' \
  -d '{"intent":"end","period":9}' $BASE/period

# --- finalize: writes to results, flips fixtures.status='complete' ---
curl -s -X POST -H "$AUTH" -H 'content-type: application/json' \
  -d '{"decided_by":"normal"}' $BASE/finalize | jq .

# --- re-finalize without reopen=true → 409 ---
curl -s -X POST -H "$AUTH" -H 'content-type: application/json' \
  -d '{"decided_by":"normal"}' $BASE/finalize
```

### Windows PowerShell (native)

```powershell
$FIXTURE = 'f0111111-1111-1111-1111-111111111111'
$HOME_TEAM = 'a1111111-1111-1111-1111-111111111111'
$BASE = "http://127.0.0.1:54321/functions/v1/scoring/$FIXTURE"
$Headers = @{ Authorization = 'Bearer DEVCODE1' }

# flip live
Invoke-RestMethod -Method Post -Uri "$BASE/start" -Headers $Headers | ConvertTo-Json -Depth 5

# open period 1
$body = @{ intent = 'start'; period = 1 } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "$BASE/period" -Headers $Headers -ContentType 'application/json' -Body $body

# record a home goal
$evid = [guid]::NewGuid().ToString()
$body = @{ id = $evid; type = 'score'; team_id = $HOME_TEAM; value = 1 } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "$BASE/events" -Headers $Headers -ContentType 'application/json' -Body $body

# replay same event (inserted should be false)
Invoke-RestMethod -Method Post -Uri "$BASE/events" -Headers $Headers -ContentType 'application/json' -Body $body

# finalize
$body = @{ decided_by = 'normal' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "$BASE/finalize" -Headers $Headers -ContentType 'application/json' -Body $body
```

### Inspecting state in the DB

Studio (`http://127.0.0.1:54323`) → **SQL editor** is the easiest, works
identically on every platform.

From the command line:

```bash
docker exec supabase_db_monday-night-sports psql -U postgres -c \
  "SELECT id, status FROM fixtures WHERE id='f0111111-1111-1111-1111-111111111111';"

docker exec supabase_db_monday-night-sports psql -U postgres -c \
  "SELECT home_score, away_score, decided_by, periods FROM results;"

docker exec supabase_db_monday-night-sports psql -U postgres -c \
  "SELECT type, value, team_id, voided_at IS NOT NULL AS voided
   FROM match_events ORDER BY created_at;"
```

The container password if psql asks: `postgres`.

---

## Everyday commands (cross-platform)

```bash
supabase start        # boot the stack
supabase stop         # shut it down (containers stopped, data preserved)
supabase stop --backup=false   # ... and drop the DB volume too
supabase status       # print URLs + keys of the running stack
supabase db reset     # drop DB, reapply all migrations + seed
deno test --allow-net supabase/functions/_tests/
```

---

## Troubleshooting

### `Could not find the supabase-go binary`

You've got just the shim on PATH without its Go sibling. Reinstall using the
platform-specific instructions above — the tarball / brew / scoop paths all keep
the two binaries paired.

### `permission denied for table fixtures` (SQLSTATE 42501) in Edge Function logs

Postgres denied a DML query before RLS even saw it — the tables need `GRANT`s to
`service_role` / `authenticated` / `anon`. Migration `0003_grants.sql` handles
this. Verify it's applied:

```bash
docker exec supabase_db_monday-night-sports psql -U postgres -c \
  "\dp public.fixtures" | head
# service_role should show arwdDxt (all privileges).
```

If it's missing, run `supabase db reset`.

### `supabase db reset` fails with `runc did not terminate successfully: ... permission denied`

Kernel-level issue (usually AppArmor on Ubuntu 24.04+) where the Docker runtime
can't signal running containers. Workaround that almost always succeeds:

```bash
supabase stop && supabase start
```

If it still fails, the fix is AppArmor / userns config on your host — not
something the project can patch. Falling back to a hosted Supabase project
(`supabase link --project-ref <ref>` → `supabase db push`) also works and gives
you the same routes at a real URL.

### `Conflict. The container name "/supabase_..." is already in use`

The stack is already running. Either use it (`supabase status` for the URLs) or
restart cleanly: `supabase stop && supabase start`.

### Port already in use (54321 / 54322 / 54323 / 54324)

Something else on your machine is bound to those ports. Either free them or edit
`supabase/config.toml` to shift the numbers.

### 401 from every scoring route

The scoring guard hashes the bearer and looks it up in `match_access`. Either
mint a real code (`POST /match-access`) or use the seeded dev code `DEVCODE1` —
anything else 401s. There is no pass-through mode; every scoring write is
cryptographically bound to a `match_access` row.

### 500 from a scoring route, no obvious body

Check the Edge Function logs:

```bash
docker logs supabase_edge_runtime_monday-night-sports | tail -30
```

The scoring service logs every caught exception as `scoring error: ...`.

### macOS: "Docker daemon not running" but Docker Desktop is open

Docker Desktop's socket sometimes lags behind the UI. Wait 30s after opening it,
or restart it. `docker info` should print a "Server Version" line once it's
fully up.

### Windows: `docker` works in PowerShell but `supabase start` fails from WSL2

Enable WSL2 integration for your distro in Docker Desktop → Settings → Resources
→ WSL Integration, then restart the WSL shell.

### Apple Silicon (M1/M2/M3/M4)

Everything runs natively via arm64 images — no Rosetta needed. If you see "no
matching manifest for linux/arm64/v8", update Docker Desktop and `supabase` to
the latest.

---

## API documentation (Swagger UI)

When the stack is up, an interactive Swagger UI is served by the `api-docs` Edge
Function:

- Browse: <http://127.0.0.1:54321/functions/v1/api-docs>
- Raw spec: <http://127.0.0.1:54321/functions/v1/api-docs/openapi.yaml>

Every route on the backend (fixtures-public, seasons, teams, scoring,
match-access, sport-configs, live, standings, results-public) is documented
there, including request/response schemas and the two auth schemes
(`organiserBearer`, `matchToken`). Use the "Try it out" button to hit routes
directly from the browser.

**Editing the spec:** the source of truth lives at
[`docs/openapi.yaml`](openapi.yaml). After you edit it, run:

```bash
./scripts/sync-openapi.sh
```

to copy the updated yaml into the function folder so the served UI stays in
sync. `supabase functions deploy api-docs` needs the same step before release.

## Where to go next

- [`overview.md`](overview.md) — what the whole system does, at a product level.
- [`scoring-viewing-backend-plan.md`](scoring-viewing-backend-plan.md) — live
  spec for the scoring/viewing backend (Sprints A–E).
- [`sprint-1.md`](sprint-1.md) — how the Sprint 1 services (fixtures-public,
  seasons, teams) work and how to exercise them.
- [`sprints-c-d-e.md`](sprints-c-d-e.md) — the operator access + live viewing +
  standings + archive chunk (Sprints C/D/E).
- [`realtime.md`](realtime.md) — client-side protocol for the
  `fixture_live_state` realtime channel.
- [`decisions/`](decisions/) — the ADRs behind the C/D/E design.
- [`production-deploy-checklist.md`](production-deploy-checklist.md) — what to
  verify before pushing to a hosted Supabase project.
