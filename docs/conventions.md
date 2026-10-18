# Conventions

What good code in this repo looks like. Short enough to keep in your head,
specific enough to settle an argument.

Base style is the
[Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html)
for TypeScript and the
[Google Java Style Guide](https://google.github.io/styleguide/javaguide.html)
for Java. This document lists only our local differences and the per-service
ownership rules introduced by
[ADR 0007](decisions/0007-service-ownership-and-layout.md).

## Naming

| Thing                           | Convention                                  | Example                       |
| ------------------------------- | ------------------------------------------- | ----------------------------- |
| TypeScript source files         | PascalCase                                  | `ScoreCalculator.ts`          |
| TypeScript test files           | PascalCase + `.test.ts`                     | `ScoreCalculator.test.ts`     |
| Service entry point             | `index.ts` (Supabase requirement)           | `index.ts`                    |
| Service folders                 | existing deployed names, kebab-case         | `match-access`                |
| Layer folders                   | lowercase single word                       | `handlers`, `domain`          |
| Classes, interfaces, types      | PascalCase                                  | `ScoringRouter`               |
| Functions, variables, fields    | camelCase                                   | `deriveScore`, `fixtureId`    |
| Module-level constants          | camelCase, or UPPER_CASE for true constants | `SCORING_ACTIONS`             |
| Java packages, classes, methods | Google Java Style                           | `RoundRobinDrawStrategy`      |
| Docs, scripts, SQL files        | kebab-case                                  | `conventions.md`, `deploy.sh` |

`snake_case` is allowed only where something outside our control requires it:

- Postgres table and column names, and the SQL and query-builder calls that
  reference them.
- TypeScript types whose fields mirror a database row or a published API payload
  one for one. `home_team_id` stays `home_team_id`.
- Supabase migration file names (`0001_core_schema.sql`).
- Environment variable names (`SUPABASE_URL`).

Everything else is camelCase or PascalCase.

## Formatting

Set in `deno.json` so the style is written down rather than implied:

- `lineWidth: 80`
- `indentWidth: 2`
- `semiColons: true`
- `singleQuote: false`

Other rules not covered by the formatter:

- One blank line between top-level declarations.
- One blank line between import groups: remote `https://` or `jsr:` imports
  first, then local imports.
- Inside functions, use blank lines to separate logical steps (validate, load,
  compute, respond). No walls of code, and no double blank lines.
- One exported class, or one cohesive group of functions, per file. If a file is
  doing two different jobs, split it.

## Characters we do not use

- **No emojis anywhere.** Not in code, comments, documentation, commit messages,
  log lines, test names or script output. If a historical file still has one,
  replace it when you touch that line.
- **No em dashes (`U+2014`) or en dashes (`U+2013`) anywhere** in anything you
  write: code, comments, docs, commit messages, PR text. Use a comma, a colon,
  parentheses or a new sentence instead. Leave existing dashes in files you are
  not otherwise editing; replace them in any line you touch.

A CI check (`scripts/check-service-boundaries.sh`) fails the build on any emoji
outside `docs/archive/`.

## Comments and documentation

- Every source file starts with a short header: what the file is for and, for
  routers, the routes it serves.
- Every exported function, class, method and interface gets a doc comment: one
  line of purpose, `@param` for each parameter, `@returns` where it returns
  something.
- Private helpers get a doc comment only when the purpose is not obvious from
  the name.
- Inline comments explain why, never what. Delete comments that just restate the
  code. Keep comments that explain a non-obvious invariant, workaround or
  ambiguity.

## SOLID in this codebase

- **Single responsibility.** Routers route, handlers handle one action,
  repositories talk to the database, domain files hold pure logic. The file name
  says the job.
- **Open/closed.** The three rule-bearing services expose their rules behind an
  interface with one implementation today:
  - `scoring`: `ScoringFormat` with `HeadToHeadScoringFormat`.
  - `standings`: `StandingsRules` with `PointsTableRules`.
  - `events`: `DrawStrategy` with `RoundRobinDrawStrategy`. Adding a format
    later is a new class, not an edit.
- **Liskov and interface segregation.** Keep interfaces small. Only put on an
  interface the methods the caller actually uses.
- **Dependency inversion.** Handlers receive the repository (and anything else
  with side effects) through their constructor, typed as an interface, so tests
  pass a fake. Pure domain functions stay as exported functions; do not wrap
  pure logic in a class just for style.

## Per-service ownership (from ADR 0007)

- No file under `supabase/functions/<service>/` may import from another service
  folder. Services talk to each other through the database or over HTTP.
- Each service copies only the helpers it actually uses from the `lib/` layer
  pattern (`Cors.ts`, `HttpErrors.ts`, `HttpHelpers.ts`, `InputValidation.ts`,
  `SupabaseClientFactory.ts`, `OrganiserAuthGuard.ts`).
- Business rules belong to exactly one owner:
  - **scoring** owns score derivation.
  - **standings** owns the points scheme and tiebreakers; it carries its own
    config type covering only the fields it reads.
  - **events** owns draw generation (round-robin plus slot spread).
- The match-token hash is a contract between `match-access` (mint) and `scoring`
  (verify). Each service carries its own copy of the hasher with a contract
  comment at the top and a fixed test vector in its tests. The two test files
  must agree on the vector; if they diverge, CI fails.

## Tests

- Tests live under the top-level `tests/` folder, mirroring
  `supabase/functions/`. Example: `tests/scoring/ScoreCalculator.test.ts` tests
  `supabase/functions/scoring/domain/ScoreCalculator.ts`.
- Integration tests gate themselves on `INTEGRATION=1` and live under
  `tests/integration/`.
- A test file imports the service it tests by relative path. Tests never import
  from a service they are not testing.

## Java (from Task 16)

- Java 21, Maven, Google Java Style (enforced by Spotless on `mvn verify`).
- JSON keys in Java-side request and response bodies are camelCase. The Java
  service has no legacy snake_case contract to honour.
- Every public class and method gets a Javadoc comment; every file starts with a
  short header explaining its job.
- No cloud deploy is wired up in this repo. The service is defined by a SAM
  template with cost guards (SnapStart, `ReservedConcurrentExecutions:
  2`, no
  public function URL, throttled HTTP API if any) but is not deployed by any
  script here.

## What this repo does not do

- No feature flags or compatibility shims for code paths we control.
- No "just in case" error handling at internal boundaries. Trust the framework;
  validate at the system edge.
- No speculative abstractions. Three similar lines beat a premature helper.
- No `// removed X` or `// deprecated` markers for code we have actually
  deleted. Git history is the record.
