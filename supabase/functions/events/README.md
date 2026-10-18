# events

Organiser draw-builder. Lets an organiser create a Monday-night event, add slots
and fixtures to it, auto-generate a round-robin draw, and publish it. Everything
in this service is organiser-gated; the public read lives in `fixtures-public`.

See `docs/decisions/0006-draw-generation.md` for the generation model, and
`docs/decisions/0007-service-ownership-and-layout.md` for why draw generation
lives in this service rather than in a shared folder.

## Routes

Every route requires `Authorization: Bearer <jwt>`.

| Method    | Path                                  | Purpose                                     |
| --------- | ------------------------------------- | ------------------------------------------- |
| `OPTIONS` | any                                   | 204 CORS preflight.                         |
| `GET`     | `/events?season=<uuid>`               | List events for a season.                   |
| `POST`    | `/events`                             | Create an event.                            |
| `GET`     | `/events/:id`                         | Event hydrated with slots and fixtures.     |
| `PATCH`   | `/events/:id`                         | Update event_date.                          |
| `DELETE`  | `/events/:id`                         | Delete an unpublished event (cascades).     |
| `POST`    | `/events/:id/slots`                   | Create a slot.                              |
| `PATCH`   | `/events/:id/slots/:slotId`           | Sparse slot update.                         |
| `DELETE`  | `/events/:id/slots/:slotId`           | Delete an empty slot.                       |
| `POST`    | `/events/:id/fixtures`                | Create a fixture.                           |
| `PATCH`   | `/events/:id/fixtures/:fid`           | Move/reassign/cancel.                       |
| `DELETE`  | `/events/:id/fixtures/:fid`           | Delete a fixture with no match events.      |
| `POST`    | `/events/:id/generate[?dry_run=true]` | Build or preview a round-robin draw.        |
| `POST`    | `/events/:id/publish`                 | Publish after `validatePublish` passes.     |
| `POST`    | `/events/:id/unpublish`               | Unpublish (requires `force: true` on live). |

## Who may call it

Any authenticated organiser (any Supabase Auth user).

## Rules it owns (ADR 0007)

- Draw generation (round-robin) and the mapping onto slots live here:
  `domain/RoundRobinGenerator.ts`, `domain/SlotSpread.ts`, and the open/closed
  seam `domain/DrawStrategy.ts` with its one implementation
  `RoundRobinDrawStrategy`.
- Publish is the structural gate: `validatePublish` refuses any draw that would
  leave a hole in the public page (missing slot, cross-season team, undeclared
  sport, self-match).
- Unpublish refuses `live`/`complete` fixtures without an explicit
  `{ "force": true }` body.
- Deletes are destructive and cross-check: a slot with fixtures and an event
  with match events both 409 instead of raw cascade errors.

## Environment variables

| Var                         | Purpose                                 |
| --------------------------- | --------------------------------------- |
| `SUPABASE_URL`              | Base URL for the Supabase project.      |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key; writes gated by auth. |

## Running the tests

```bash
deno test --allow-net --allow-env tests/events/
```

The suite covers the round-robin generator, the slot spread, the event body
validators, the publish and unpublish validators, and the parity fixtures shared
with the Java draw generator (see `services/draw-generator/`).
