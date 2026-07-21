> **⚠ Superseded — kept for history only.**
>
> This document described a generic Node.js / Express / bcrypt / SSE
> architecture (`College`, `CollegeAccount`, hand-rolled JWTs, SSE for
> real-time). The build that actually shipped is Supabase-native: Postgres +
> RLS + Auth + Realtime, with Deno/TypeScript Edge Functions and the domain
> model `seasons` / `teams` / `events` / `slots` / `fixtures` / `results`.
>
> **Do not use this file as a spec.** Start at
> [`../overview.md`](../overview.md) and the live plan at
> [`../scoring-viewing-backend-plan.md`](../scoring-viewing-backend-plan.md).
> Retained here so the ideas behind the original planning (event-sourced
> scoring, sport-config-driven semantics, etc.) remain readable — many of
> them survived, just implemented differently.

---

# Development planning — Monday Night Sports

This document is written for developers of all experience levels. If you're new to the project, read this before touching any code. It explains not just *what* to build but *why* things are ordered the way they are and what to watch out for at each stage.

> **How to use this document**
> Each sprint is roughly 1–2 weeks of work for a small team. They're intentionally ordered so that earlier sprints create the foundation later ones depend on. Don't skip ahead — a decision made in Sprint 1 will affect every sprint after it.

---

## Before you start: things every developer should understand

### What "novice-friendly" means here
This planning doc assumes you know how to write code but may not have built a full production app before. We'll flag the parts that are easy to get wrong and explain the reasoning behind decisions, not just the decisions themselves.

### The three user experiences
Always keep these three people in mind when making decisions:

1. **The student on their phone** checking the score at halftime. They need fast load times and a dead-simple interface. They have no account and want zero friction.
2. **The event manager** setting up a season at the start of term. They use the app maybe once a week and need it to be straightforward without a manual.
3. **The score operator** on the sideline with a phone in one hand. They need large tap targets, instant feedback, and they cannot afford the app to crash or freeze during a match.

Every feature decision should pass the test: does this make life better for at least one of these people without making life worse for the others?

### Data that must never be wrong
Match scores and league standings are the core of the app. Getting these wrong — even briefly — damages trust. Design your data layer and sync logic with this in mind. A small delay is fine. A wrong score is not.

---

## Sprint 1 — Foundation: data model and project setup

**Goal:** Everyone on the team can run the project locally, and the core data structure is agreed on and in place.

### What to build
- Set up the repo, folder structure, linting, and a shared `.env.example`
- Design and implement the initial database schema (see below)
- Basic API server that connects to the database and returns a health check
- A simple seed script that populates the database with fake colleges, a sport, and some fixtures so developers can work with realistic data immediately

### The core data model
This is the most important decision in the whole project. Get it wrong and you'll be rewriting it for months. Spend time on this.

Key entities to think through:

**College** — name, short code (e.g. "COL"), primary colour (hex), secondary colour, logo URL

**Season** — a single competition period (e.g. "Semester 1 2026"). Has a sport type and configuration. A college can participate in many seasons.

**SportConfig** — belongs to a Season. Stores all the rules: period count, period duration in minutes, scoring options (array of increment values), points for win/draw/loss, tiebreaker order, extra time rules. This should be stored as structured JSON so it's flexible.

**Fixture** — a scheduled match between two colleges in a season. Has a week number, scheduled date/time, venue, and status (scheduled / in progress / completed / postponed).

**MatchResult** — belongs to a Fixture. Stores the final score for each team, period-by-period scores, and a reference to the full event log.

**MatchEvent** — individual timestamped events during a match: goal scored, period ended, etc. Belongs to a Fixture. This is what the scoring screen writes to in real time.

**CollegeAccount** — login credentials for an event manager. One per college. Stores a hashed password (never plain text — see Sprint 2).

> **Common mistake:** Don't store the "current score" as a field on Fixture. Derive it by summing MatchEvents. Storing it as a field creates a sync problem — the "live" event log and the stored score can disagree. Derive, don't duplicate.

### Definition of done
- [ ] All team members can clone the repo and run `npm run dev` successfully
- [ ] Database schema is in a migration file (not manually created)
- [ ] Seed script creates enough data to develop against
- [ ] A `GET /health` endpoint returns 200

### Things to watch out for
Timezone handling. Match times are stored in UTC. Display them in local time. If you ignore this in Sprint 1, it will cause subtle bugs for months. Pick a convention now and document it.

---

## Sprint 2 — College accounts and authentication

**Goal:** Event managers can log in to their college account and have a protected area of the app.

### What to build
- College account login (email + password per college)
- JWT token issued on login, required for protected API routes
- A basic event manager dashboard (doesn't need to do much yet — just prove auth works end to end)
- Password hashing with bcrypt (never store plain text passwords)
- Match PIN generation — a short-lived (e.g. 6-hour) PIN that an event manager generates and hands to a score operator. The PIN grants access to the scoring screen for one specific fixture only.

### Why the PIN system instead of a second account type
Score operators don't need persistent accounts. They show up for one game, score it, and leave. Giving them a PIN that expires means no account management overhead, no forgotten passwords, and the event manager stays in control of who can score their games.

### How auth should work
The match PIN should be a separate, short JWT scoped to a single `fixtureId`. When the scoring screen loads, it reads the PIN from the URL or a QR code, validates it against the API, and gets back a scoped token. That token only allows score writes to that fixture.

### Definition of done
- [ ] `POST /auth/login` returns a JWT on valid credentials
- [ ] Protected routes return 401 without a valid token
- [ ] `POST /fixtures/:id/pin` generates a match PIN (event manager only)
- [ ] Match PIN can be validated by the scoring screen
- [ ] Passwords are bcrypt-hashed in the database

### Things to watch out for
Don't roll your own crypto. Use `bcrypt` for passwords and a well-tested JWT library. The most common auth security mistakes come from people writing their own implementations.

---

## Sprint 3 — Fixture management (event manager side)

**Goal:** Event managers can create, edit, and publish fixtures. The public can see upcoming matches.

### What to build
- Create fixture form (pick two colleges, date/time, venue, week number)
- Edit and cancel fixtures
- Auto-generate round-robin schedule: given a list of participating colleges and a season, generate all fixtures across 9 weeks (skipping Week 6). Each college plays every other college once. If there's an odd number of colleges, one gets a bye each week.
- Public fixture list — no auth required, shows upcoming matches by week
- Basic fixture detail page — teams, time, venue, current status

### Round-robin algorithm
A round-robin scheduler for N teams can be implemented cleanly with the "circle method": fix one team, rotate the rest. Search for "round robin scheduling algorithm" — there are clear explanations with pseudocode. The output is a list of (teamA, teamB) pairs per week. Your job is then to map those pairs to Fixture records with real dates.

If there's an odd number of colleges, add a dummy "bye" team. Any fixture involving the bye team is simply not created.

### Definition of done
- [ ] Event manager can create a fixture manually
- [ ] Event manager can trigger auto-schedule generation for a season
- [ ] Generated fixtures are saved to the database and can be reviewed/edited before publishing
- [ ] Public can view upcoming fixtures (no login)
- [ ] Fixture shows college names, date/time, venue

### Things to watch out for
The auto-scheduler should generate fixtures in a *draft* state. The event manager reviews and publishes them. Never auto-publish — there may be venue conflicts, college availability issues, etc.

---

## Sprint 4 — Live scoring screen

**Goal:** A score operator with a match PIN can open a scoring screen and record goals in real time.

### What to build
- Scoring screen UI — two-colour split screen (college A colour top, college B colour bottom), large score display, +/− buttons, running timer, period management
- `POST /fixtures/:id/events` — authenticated endpoint (match PIN) to record a score event
- Undo last event — removes the most recent MatchEvent for this fixture
- Match event log — scrollable list of events with timestamps
- Timer logic — runs client-side (don't rely on the server for the clock), records the match time with each event
- End period / start next period flow
- Mark fixture as "in progress" when scoring starts, "completed" when the operator submits the final result

### The scoring screen is the most critical UI in the app
A few design requirements to keep in mind:

- Buttons must be large enough to tap reliably under pressure (minimum 44×44px touch target)
- Visual confirmation on every tap (brief flash or scale animation) so the operator knows it registered
- The undo button should be prominent but not accidentally tappable — consider requiring a confirm for undo during active play
- The screen must work with the phone screen locked on landscape or portrait
- Test on a real phone, not just browser DevTools

### Offline handling
The scoring screen must work when the venue wifi drops. Implement a local queue: score events are written to `localStorage` immediately, then synced to the API. If the API call fails, the event stays in the queue and retries. When the connection comes back, the queue drains. The local score display should always reflect the local queue state, not wait for the API response.

### Definition of done
- [ ] Score operator can open the scoring screen with a valid match PIN
- [ ] +/− buttons record events to the API
- [ ] Timer runs from 0, can be paused/resumed
- [ ] Undo removes the last event (with confirmation)
- [ ] Events display in a log with match time
- [ ] Fixture status changes to "in progress" on first event
- [ ] Offline: events queue locally and sync when connection returns

---

## Sprint 5 — Public live scores and real-time updates

**Goal:** Students watching from elsewhere see the score update live without refreshing.

### What to build
- Public match detail page with live score display
- Real-time update mechanism — when the scoring screen posts a new event, all viewers of that fixture's page see the score update within a few seconds
- "LIVE" badge on in-progress fixtures in the fixture list
- Score derived from MatchEvents (not stored separately — see Sprint 1 note)

### Choosing a real-time approach
Two good options:

**Server-sent events (SSE)** — the client opens a persistent HTTP connection and the server pushes updates. Simpler to implement than WebSockets, works well for one-way data (server → client). Good choice if the only real-time need is score updates.

**WebSockets** — full two-way connection. More complex, but necessary if you later want chat, reactions, or two-way communication. Overkill for just score updates.

For this project, SSE is probably the right choice to start. You can always upgrade to WebSockets later.

### How it should work
When the scoring screen posts a new event, the server broadcasts the updated score for that fixture to all SSE subscribers watching that fixture. The client receives the update and re-renders the score without a page refresh.

Don't broadcast the raw event data to public viewers. Broadcast the current score summary (team A score, team B score, current period, match time). Public viewers don't need the full event log.

### Definition of done
- [ ] Public match page shows live score
- [ ] Score updates appear within 3 seconds of being recorded on the scoring screen
- [ ] No manual refresh needed
- [ ] "LIVE" badge shows on in-progress fixtures
- [ ] If no one is watching, updates still work when they open the page

---

## Sprint 6 — League standings tables

**Goal:** Students can view a standings table for the current season, styled appropriately for the sport.

### What to build
- Standings calculation service — takes all completed fixtures in a season and computes the table
- Standing table UI per sport type:
  - Soccer: played / won / drawn / lost / GF / GA / GD / points (sorted by points, then GD, then GF)
  - Basketball: won / lost / win% / last 10 / streak
  - Generic: configurable columns based on SportConfig
- The table should auto-update after each fixture is completed

### The standings calculation is business logic, not SQL
Don't try to calculate the standings table with a single complex SQL query. Write a service function that:
1. Fetches all completed fixtures for the season
2. Loops through them and tallies wins/draws/losses/goals per college
3. Sorts by the SportConfig tiebreaker rules
4. Returns an ordered array of college standings

This is much easier to test and modify than a complex SQL query, and performance won't be an issue at this scale.

### Definition of done
- [ ] Standings table shows all colleges in the season
- [ ] Table updates after each match is completed
- [ ] Soccer table shows correct GD and points
- [ ] Tiebreaker rules from SportConfig are applied correctly
- [ ] At least one unit test for the standings calculation logic

---

## Sprint 7 — Sport configuration system

**Goal:** Event managers can configure any sport from scratch without a developer touching the code.

### What to build
- Sport setup wizard UI — step-by-step form: sport name → periods → scoring → standings → extra time rules
- SportConfig stored as JSON in the database
- The scoring screen reads SportConfig to determine: how many periods, what +/− options to show (single value vs picker), whether the timer counts up or down
- The standings table reads SportConfig to determine which columns to show and how to sort
- Validation — catch invalid configs before they're published (e.g. zero periods, no scoring options)

### Why a wizard and not a single form
A flat form with 20 fields is overwhelming. A wizard that asks one thing at a time and shows a preview of what the scoring screen / standings table will look like gives the event manager confidence they've set it up correctly. Build the wizard UI as a multi-step component, not separate pages.

### Definition of done
- [ ] Event manager can create a sport config through the wizard
- [ ] Scoring screen adapts to the sport config (period count, score picker vs single)
- [ ] Standings table adapts to the sport config (correct columns)
- [ ] Existing sports (soccer, basketball) are migrated to use sport configs
- [ ] Invalid configs are caught and explained clearly

---

## Sprint 8 — College profiles and season stats

**Goal:** Each college has a profile page showing their season performance, roster, and history.

### What to build
- College profile page — name, colours, logo, current season summary
- Season stats: matches played, win/loss/draw record, goals/points for and against, top scorers (if tracked)
- Head-to-head record between two colleges (shown on the fixture detail page)
- Past seasons archive — previous season tables and results

### Note on player/scorer tracking
The current system tracks team scores, not individual player goals. If you want top scorers, the scoring screen needs a way to record *who* scored, not just that a goal happened. This is a scope increase — discuss with the team before implementing. It can be added to MatchEvent as an optional `playerId` field.

### Definition of done
- [ ] College profile page shows current season stats
- [ ] Head-to-head record shows on fixture page
- [ ] Past seasons are accessible from the college profile
- [ ] College colours are used consistently throughout (not just on the scoring screen)

---

## Sprint 9 — Admin tools and season management

**Goal:** A system admin can manage colleges, create new seasons, and handle edge cases.

### What to build
- Admin panel — separate from the event manager portal, higher privilege
- Manage colleges (add, edit, deactivate)
- Create and configure seasons — set participating colleges, sport, start date
- Manually override standings (for situations like forfeits, walkovers, or rule disputes)
- Postpone or reschedule fixtures
- Export season data as CSV (for record keeping)

### Admin vs event manager permissions
Be precise about what each role can do:

| Action | Event manager | Admin |
|---|---|---|
| Create fixture for their college | Yes | Yes |
| Edit another college's fixture | No | Yes |
| Configure their sport settings | Yes | Yes |
| Create a new season | No | Yes |
| Add or remove colleges | No | Yes |
| Override standings | No | Yes |
| Export data | No | Yes |

Implement this as a role field on accounts (or a separate admin account type). Enforce it in the API, not just the UI.

### Definition of done
- [ ] Admin can create a new season and assign colleges
- [ ] Admin can postpone/reschedule any fixture
- [ ] Admin can manually adjust standings
- [ ] CSV export works for a completed season
- [ ] Role-based access control is enforced at the API level

---

## Sprint 10 — Push notifications and engagement features

**Goal:** Students can opt in to notifications for their college's matches.

### What to build
- Browser push notifications (Web Push API) — opt-in only
- Notification triggers: match starting in 30 minutes, score update during a match, match completed
- User notification preferences — choose which college to follow (can follow multiple)
- In-app notification bell for users who haven't enabled push

### Push notifications are more complex than they look
Web Push requires a service worker, VAPID keys, and a subscription management system. Don't underestimate the implementation time. A simpler starting point is email notifications (if students have accounts) or just an in-app feed — push can come later.

### Definition of done
- [ ] Students can opt in to push notifications for a college
- [ ] Notification fires when a match is about to start
- [ ] Notification fires when a final score is recorded
- [ ] Opt-out works reliably
- [ ] No notifications are sent to users who haven't opted in

---

## Sprint 11 — Penalty shootout tracker

**Goal:** Score operators can run a penalty shootout from the app.

### What to build
- Penalty shootout screen — triggered from the scoring screen's extra time menu
- Alternating kicks: Team A kick, Team B kick, repeat
- Record each kick as scored or missed (large tap targets)
- Auto-detect when a winner is mathematically confirmed (e.g. Team A is 3-0 up after 3 kicks, Team B can only reach 3 — Team A wins)
- Sudden death mode after 5 kicks each if still level
- Result recorded as part of the MatchResult with a note that it was decided by penalties

### Definition of done
- [ ] Shootout screen is accessible from the extra time menu
- [ ] Each kick is recorded and displayed
- [ ] Winner is detected and confirmed automatically
- [ ] Result is saved correctly as a penalty win (not a score draw)

---

## Ongoing: things that apply to every sprint

### Testing
Every sprint should include tests for any business logic written. At minimum:
- Unit tests for calculation functions (standings, score derivation, round-robin generation)
- Integration tests for critical API endpoints (score submission, auth)
- Manual testing on a real phone before each sprint is considered done

### Documentation
If you make a non-obvious decision — a data model choice, an algorithm, an API design — write a short note in `docs/decisions/` explaining what you chose and why. Future developers (including future you) will thank you.

### Performance
The app will have 400+ simultaneous viewers during popular matches. At that scale, PostgreSQL and a basic Node server will handle it fine — don't over-engineer. The one thing to watch is the standings calculation: if it's running on every page load, add a simple cache (recalculate only when a fixture is completed, not on every request).

### Accessibility
The scoring screen is used under pressure in poor lighting. Use high contrast, large text, and large touch targets throughout. The public app should work on cheap Android phones on slow connections. Test on real devices.

### Security checklist (check every sprint)
- All user input is validated and sanitised before hitting the database
- No SQL queries built from raw string concatenation (use parameterised queries / ORM)
- Auth tokens are not stored in `localStorage` on the admin portal (use `httpOnly` cookies)
- Match PIN tokens are scoped and short-lived
- HTTPS everywhere in production

---

## Open questions (decide before you build that sprint)

These are things that haven't been decided yet and will affect implementation. Flag them early.

- **Do players have individual accounts, or is it college-level only?** Affects whether you can track top scorers.
- **What happens to historical data when a college leaves the competition?** Their past results should be preserved. Their account should be deactivable, not deletable.
- **Who is the system admin?** One person? A shared account? This affects account management.
- **Is there a fixture for every college every week, or can a college have a bye?** Odd college counts require byes — the round-robin generator needs to handle this.
- **What counts as a "season"?** Is it per semester, per year? Can there be multiple concurrent seasons (e.g. soccer and basketball running at the same time)?
- **Should the app support multiple campuses or is it one competition only?**

---

## Glossary

| Term | Meaning |
|---|---|
| Fixture | A scheduled match between two colleges |
| Season | A single competition period with one sport and a set of participating colleges |
| SportConfig | The ruleset for a season: periods, scoring, standings, tiebreakers |
| Match PIN | A short-lived access code for a score operator to access the scoring screen |
| Score operator | The person on the sideline recording the score during a match |
| Event manager | The college representative who manages fixtures and settings |
| Round robin | A scheduling format where every team plays every other team once |
| MatchEvent | A single timestamped action during a match (goal, period end, etc.) |
| GD | Goal difference (goals scored minus goals conceded) — used in soccer standings |
| Bye | A week where a college has no match (occurs when there's an odd number of colleges) |