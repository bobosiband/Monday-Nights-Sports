# ADR 0007: Service ownership and layered layout

**Status:** Accepted, 2026-10-18. **Supersedes:** nothing. **Related:**
[`../conventions.md`](../conventions.md), [ADR 0006](0006-draw-generation.md).

## Context

Sprints 1 through F grew the backend from one organiser-only service to eleven
deployed microservices under `supabase/functions/`. During that growth, common
primitives (CORS, HTTP error helpers, Supabase service client, input validators,
JWT guard) and three pieces of pure domain logic (score derivation, standings
computation, round-robin draw generation) were parked in a single
`supabase/functions/_shared/` folder because Supabase does not deploy
underscore-prefixed folders.

That folder has become three different things wearing one coat:

1. Small cross-cutting helpers nearly every service uses (CORS, errors,
   validators, service client).
2. Domain logic that logically belongs to one owner but was placed in `_shared`
   so other services could cheaply import the `SportConfig` type or run a
   derived calculation locally.
3. The match-token hashing primitive, which is a cryptographic contract between
   exactly two services (`match-access` mints, `scoring` verifies).

Tests live inside the deployable tree at `supabase/functions/_tests/`, which
means the test tree mirrors the service tree twice (once for sources, once for
tests) and makes "jump from code to its test" less obvious than it should be.

The result is that: changes to `_shared/score.ts` can silently alter standings
through the `SportConfig` type coupling; the two sides of the match-token
contract can drift (one is normalised uppercase, one is not); and a reader
cannot tell from the file tree which service actually owns a given rule.

## Decision

### 1. Each service owns its own code and its own helpers

There is no shared folder. Every service folder is self-contained. Services copy
only the small helpers they actually use (CORS, HTTP error responses, input
validation, Supabase client factory, auth guard) and point their imports at the
local copies.

Services only communicate with each other through the database or through each
other's HTTP APIs. No file under `supabase/functions/<service>/` may import from
another service folder; a CI boundary check (added in Task 14) fails the build
if a cross-service import appears.

### 2. One owner per piece of business logic

- **scoring** owns how a derived score is folded from `match_events` (previously
  `_shared/score.ts`).
- **standings** owns the points scheme, tiebreakers and sort rules (previously
  `_shared/standings.ts`). It carries its own `StandingsConfig` type covering
  only the fields it reads, instead of importing `SportConfig` from `scoring`.
- **events** owns draw generation: the round-robin generator and the slot spread
  (previously `_shared/round-robin.ts` plus `events/spread.ts`).

If an organiser-facing read service later needs a derived score summary, it
calls scoring over HTTP or re-derives from the same event stream; it does not
import scoring's fold.

### 3. The match-token hash is a two-service contract, duplicated with intent

Both `match-access` (mint) and `scoring` (verify) carry their own copy of the
normalise-and-hash logic. Each copy opens with a comment stating that the hash
format is a contract between the two services and must change in both places
together. Each copy has its own tests, and both test files include the same
fixed test vector (a known code and its expected SHA-256 hex) so that any
accidental divergence fails CI.

The alternative, keeping it in `_shared`, costs a hidden runtime dependency and
loses the symmetry: the two services were already free to drift because nothing
cross-tests them.

### 4. Each service uses a Java-style layered layout

Supabase requires `index.ts` as the entry point. The entry point only wires
`Deno.serve` to the service's router. Everything else lives in a layer folder
named for its job: `handlers/`, `domain/`, `data/`, `security/`, `validation/`,
`rendering/`, `lib/`. Services only create the layers they actually need; a
small read-only service may only have `index.ts`, a router, `data/` and `lib/`.

File names are PascalCase and say what the file does, not what it is
(`ScoreCalculator.ts`, not `score.ts`). Folder names stay as they are because
every top-level folder under `supabase/functions/` is the deployed function name
and therefore part of the public URL.

### 5. Tests live in a top-level `tests/` mirror

`supabase/functions/_tests/` moves to a top-level `tests/` folder whose
sub-folders mirror the service folders one for one. Tests that were in
`_tests/shared/` move to the service that now owns the code they test (score to
`scoring`, standings to `standings`, round-robin to `events`, match-token to
both `match-access` and `scoring`). Tests import service code by relative path,
which keeps the dependency arrow pointing from `tests/` into
`supabase/functions/` only.

Integration tests stay as a sibling under `tests/integration/`, gated by
`INTEGRATION=1` exactly as before.

### 6. The Java draw generator is a separate, stateless service

A parallel Java implementation of the round-robin generator will live under
`services/draw-generator/`. It is a starter: it builds, tests and runs locally,
but it is not wired into the TypeScript `events` service, is not deployed, and
never touches the database. Parity with the TypeScript generator is enforced by
a shared set of JSON fixtures run on both sides.

## Consequences

- **Some deliberate duplication of small helpers.** CORS, HTTP error helpers,
  the service-client factory and the input validators each live in several
  services. Each copy is tens of lines; the cost is small and the isolation is
  real.
- **The match-token contract is explicit.** Any change to normalisation, hashing
  or the test vector fails on the opposite side's unit tests.
- **A reader can see ownership from the file tree.** The folder containing a
  rule is the service that owns it.
- **`index.ts` is empty of logic.** New routes are added by registering a
  handler in the router, not by scrolling past the entry point.
- **`SportConfig` stops being a shared surface.** `standings` carries only the
  config fields it reads; the scoring service does the same for its own types.
- **The Java service lets us try Lambda for one well-isolated piece without
  moving anything live.** Live scoring stays on Supabase.

## Rejected alternatives

- **Keep `_shared/` as it is.** Preserves the current hidden coupling between
  scoring and standings through `SportConfig`, and the match-token contract
  keeps looking like a single source rather than a two-ended contract.
- **Move `_shared/` to a sibling `common/` folder outside `supabase/`.** Only
  renames the problem. The cross-service coupling is the problem, not the folder
  name.
- **Publish a versioned shared package.** Overkill for a repo this size and adds
  a release step between a one-line fix and a function redeploy.
- **One shared source for the match-token hash, with contract tests on both
  sides.** Workable, but the two-ended duplication is cheap enough that the
  extra abstraction does not pay for itself.
- **Keep tests inside the service folders.** Supabase ignores
  underscore-prefixed folders when deploying, so this works, but it mixes test
  code into the deploy bundle's neighbourhood and makes "run only this service's
  tests" less natural than a top-level `tests/<service>/`.

## Follow-ups

- Wire `events` to call the Java draw generator over HTTP once a cost budget and
  a trigger pattern are agreed. Out of scope here.
- Replace the per-service `.env.example` files with a schema check once more
  services are added. Not needed for the current 11.
