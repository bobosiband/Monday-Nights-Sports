# Monday Night Sports — System Overview

A one-page "what is this and what does it do" for new COSA members and
contributors. If you're new, read this first, then dive into
[`docs/scoring-viewing-backend-plan.md`](scoring-viewing-backend-plan.md) for the
part we're building now.

---

## The problem

Students in UNSW's residential colleges only find out fixtures and results
slowly — dripped out once a week at coffee night, or not at all unless you
physically go to the Village Green and watch. There's no live, shared source of
truth for what's happening across the night's games.

## What we're building

A live, FIFA/NBA-style system for college sports: fixtures published instantly,
scores tracked **live** as games happen, and a browsable history of past events.

**Why the backend comes first:** the people already running the events have to
find the organiser tooling genuinely useful, or they won't feed data into it. So
the management + scoring side has to be solid before any frontend work.

## Who it serves

Keep these three people in mind for every decision:

- **The student on their phone** — no account, zero friction, just wants live
  scores and fixtures, fast.
- **The event manager / organiser** — sets up a season, teams, and the
  Monday-night draw ~once a week; needs it straightforward, no manual.
- **The score operator** — on the sideline, phone in one hand, recording the game
  live; needs big buttons, instant feedback, and it must not crash mid-match.

## What it does, end to end

1. **Organiser setup.** An organiser signs in and creates a **season** (can span
   multiple sports on the same night, e.g. soccer + netball), adds **teams**, and
   builds the **draw** — the Monday-night **event** with its four time **slots**
   and the **fixtures** (each a match between two teams, in a slot, for a sport).
   The draw stays private until they **publish** it in a single action.

2. **Public fixtures.** Once published, anyone can open a share link and see that
   night's draw as a clean mobile page (or plain text to paste into a group chat)
   — no login. *(Already shipped.)*

3. **Live scoring.** A score operator gets a short-lived code scoped to one
   fixture (no full account needed), opens a scoring screen, and records the game
   as it happens: goals/points, fouls, cards, timeouts, period start/end — with a
   running match clock and an undo. Every action is logged as an event, so the
   score is always derivable and correctable, and it keeps working if venue wifi
   drops.

4. **Live viewing.** Students watching from anywhere see the score update live
   within a few seconds, with a "LIVE" badge on in-progress games — no refreshing.

5. **Results, standings & history.** When a match finishes, its final result is
   locked in. The system computes **standings** per sport (points, goal
   difference, tiebreakers — configurable) and keeps an **archive** of past events
   and results.

6. **Configurable per sport.** Different sports score differently (soccer's single
   goals vs basketball's 1/2/3, different period counts, different standings
   rules). A sport-config layer drives what the scoring screen and standings table
   do — the goal being that organisers can eventually set up a new sport without a
   developer.

**The full arc:** organiser builds the draw → operator scores it live → students
watch live → results and standings persist as history.

## Who's building it

**COSA** — students elected by each residential college at UNSW, who plan and
manage college sports events each term.

## Stack

Supabase-native: Postgres + Row-Level Security + Auth + Realtime, with
Deno/TypeScript Edge Functions (one microservice per folder under
`supabase/functions/`). The frontend team picks their own stack later; everything
here is a self-contained API.

## Where the build is today

- **Shipped (Sprint 1):** core database (seasons, teams, events, slots, fixtures,
  results) with public-read-on-published security; organiser sign-in; season and
  team management services; the public fixtures service.
- **Shipped (Sprints C/D/E):** operator match-code mint/revoke; real match-code
  verification in scoring; `fixture_live_state` realtime projection; public
  `live` endpoint; LIVE badge in `fixtures-public`; `standings` and
  `results-public` archive; organiser `sport-configs` CRUD.
  See [`sprints-c-d-e.md`](sprints-c-d-e.md) for the running log and
  [`decisions/`](decisions/) for the ADRs.
- **Building next:** the organiser **draw builder** — an `events` service that
  actually lets an organiser create an event, its slots, its fixtures, and
  publish the draw. Called out at the bottom of
  [`scoring-viewing-backend-plan.md`](scoring-viewing-backend-plan.md).

## Where to go next

- Building the scoring/viewing backend →
  [`docs/scoring-viewing-backend-plan.md`](scoring-viewing-backend-plan.md)
- Running it locally / Sprint 1 detail → [`README.md`](../README.md),
  [`docs/sprint-1.md`](sprint-1.md)
