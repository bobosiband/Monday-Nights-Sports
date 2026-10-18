# draw-generator (Java 21 Lambda starter)

A stateless Java 21 implementation of the Monday Night Sports round-robin draw
generator. Written to run on AWS Lambda, with SnapStart; wired to build, test
and run locally today but **not deployed by any script in this repo**.

Live scoring is on Supabase and must stay there. This service exists so a future
initiative can experiment with Lambda for one well-isolated piece without
touching anything users already rely on. See
[ADR 0007](../../docs/decisions/0007-service-ownership-and-layout.md).

## What it does

Takes team ids and slot ids as JSON, returns proposed fixtures as JSON. No
database access, no network calls, no secrets.

```
POST /
  { "teamIds": ["A","B","C","D"], "slotIds": ["S1","S2","S3","S4"] }
->
  200 { "fixtures": [{ "round": 1, "slotId": "S1", "homeTeamId": "A",
                        "awayTeamId": "D" }, ...] }
```

Validation errors return 400 with `{ "error": "..." }`. Wrong HTTP method
returns 405. Unexpected failures return 500 without leaking a stack trace.

## Parity with the TypeScript side

Draw generation already runs in TypeScript inside `supabase/functions/events/`
(see [ADR 0006](../../docs/decisions/0006-draw-generation.md)). This service is
a parallel implementation of the same algorithm so it can later replace or sit
beside the TypeScript one; wiring `events` to call it is out of scope today.

Parity is enforced by shared JSON fixtures under `src/test/resources/parity/`.
Both sides read the same files:

- `ParityFixturesTest` on the Java side.
- `tests/events/DrawParity.test.ts` on the Deno side.

If the two implementations drift, both tests fail at the same fixture.

## Build and test

Requirements: Java 21 and Maven on your PATH.

```bash
cd services/draw-generator
mvn verify       # format check + compile + unit tests
mvn spotless:apply   # reformat sources (uses google-java-format)
```

Spotless runs `check` on the `verify` phase, so unformatted Java fails the
build. CI runs `mvn -B verify` on every push and pull request (see the
`draw-generator` job in `.github/workflows/ci.yml`).

Optional local invoke (requires the AWS SAM CLI):

```bash
sam build
echo '{"body":"{\"teamIds\":[\"A\",\"B\"],\"slotIds\":[\"S1\"]}",
       "isBase64Encoded":false,
       "requestContext":{"http":{"method":"POST"}}}' \
  | sam local invoke DrawGeneratorFunction --event -
```

## Deployment: manual, with a budget alert first

**Nothing in this repo deploys this service.** Deploy is a manual step an
operator must perform after they have:

1. **Created an AWS Budgets alert at 5 USD.** Open AWS Budgets, create a monthly
   cost budget scoped to the deployment account, set the amount to 5 USD, and
   add an alert at 80 percent. Do this before the first deploy, not after. The
   service's cost guards are good but they are not a substitute for an alert.
2. **Checked the SAM template.** Read `template.yaml` and confirm
   `ReservedConcurrentExecutions` is 2, SnapStart is on published versions,
   memory is 512 MB, and the HTTP API is throttled (burst 5, rate 2 per second).
   Do not add a public function URL.

Then, from a shell with AWS credentials configured:

```bash
cd services/draw-generator
sam build
sam deploy --guided           # first time only, pick a stack name
```

Live scoring stays on Supabase. Do not move live-scoring routes to this service,
and do not switch the SAM template to pay-per-request without a revised budget.

## Layout

```
services/draw-generator/
├── pom.xml                     # Java 21, JUnit 5, Spotless with google-java-format
├── template.yaml               # SAM template with cost guards (not deployed)
├── README.md                   # this file
├── .env.example                # no env vars needed to run or test
├── src/main/java/com/mondaynightsports/drawgenerator/
│   ├── DrawGeneratorHandler.java            Lambda entry point
│   ├── api/
│   │   ├── GenerateDrawRequest.java         record: teamIds, slotIds
│   │   ├── GenerateDrawResponse.java        record: fixtures
│   │   ├── ProposedFixture.java             record: round, slotId, homeTeamId, awayTeamId
│   │   └── ErrorResponse.java
│   ├── domain/
│   │   ├── DrawStrategy.java                open/closed seam
│   │   ├── RoundRobinDrawStrategy.java      circle method
│   │   ├── Pairing.java                     record: round, homeTeamId, awayTeamId
│   │   ├── SlotAssigner.java                open/closed seam
│   │   └── WrapAroundSlotAssigner.java      round r goes to slots[(r - 1) % n]
│   └── validation/
│       └── DrawRequestValidator.java
└── src/test/
    ├── java/com/mondaynightsports/drawgenerator/
    │   ├── DrawGeneratorHandlerTest.java
    │   ├── domain/
    │   │   ├── RoundRobinDrawStrategyTest.java
    │   │   ├── WrapAroundSlotAssignerTest.java
    │   │   └── ParityFixturesTest.java
    │   └── validation/DrawRequestValidatorTest.java
    └── resources/parity/
        ├── four-teams-four-slots.json
        ├── three-teams-two-slots-with-byes.json
        ├── six-teams-three-slots-wrap.json
        ├── two-teams-one-slot.json
        └── five-teams-four-slots.json
```

## Conventions

- Java 21, Google Java Style enforced on `mvn verify` by the Spotless plugin +
  google-java-format.
- JSON keys are camelCase. The Java service has no legacy snake_case contract to
  honour.
- Every public class and method carries a Javadoc comment; every file starts
  with a short header explaining its job.
- Pure domain logic (round-robin, slot assignment) sits in `domain/` and is
  testable without the Lambda runtime, Jackson or the AWS SDK.
