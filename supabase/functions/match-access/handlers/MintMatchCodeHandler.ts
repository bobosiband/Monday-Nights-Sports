// -----------------------------------------------------------------------------
// match-access/handlers/MintMatchCodeHandler.ts
//
// Handles POST /match-access: generates a new match code, stores its hash,
// and returns the raw code to the caller exactly once.
// -----------------------------------------------------------------------------

import { jsonResponse } from "../lib/Cors.ts";
import { isUuid, nonEmptyString, readJson } from "../lib/InputValidation.ts";
import type { MatchAccessRepository } from "../data/MatchAccessRepository.ts";
import {
  generateMatchCode,
  hashMatchCode,
} from "../security/MatchTokenHasher.ts";
import {
  LABEL_MAX_LEN,
  resolveTtlMinutes,
  TTL_MAX_MINUTES,
  TTL_MIN_MINUTES,
} from "../validation/MintBodyValidator.ts";

/** Fixture statuses that refuse to accept a fresh mint. */
const NON_MINTABLE_STATUSES = new Set(["complete", "cancelled"]);

/** Loose shape of a mint body. */
interface MintBody {
  fixture_id?: unknown;
  ttl_minutes?: unknown;
  label?: unknown;
}

/** Handler for `POST /match-access`. */
export class MintMatchCodeHandler {
  /**
   * @param repo - Match-access data access.
   */
  constructor(private readonly repo: MatchAccessRepository) {}

  /**
   * @param request - Incoming request.
   * @param createdBy - Organiser user id, stored on the row for audit.
   * @returns 201 with `{ id, fixture_id, code, expires_at, label }` on
   * success. 400 on validation failure. 404 when the fixture does not
   * exist. 409 when the fixture is complete or cancelled.
   */
  async handle(request: Request, createdBy: string): Promise<Response> {
    const body = await readJson<MintBody>(request);
    if (!body || typeof body !== "object") {
      return jsonResponse({ error: "Request body must be JSON" }, 400);
    }
    if (!isUuid(body.fixture_id)) {
      return jsonResponse({ error: "fixture_id must be a UUID" }, 400);
    }
    const fixtureId = body.fixture_id as string;

    const ttlMinutes = resolveTtlMinutes(body.ttl_minutes);
    if (ttlMinutes === "invalid") {
      return jsonResponse(
        {
          error:
            `ttl_minutes must be an integer in [${TTL_MIN_MINUTES}, ${TTL_MAX_MINUTES}]`,
        },
        400,
      );
    }

    let label: string | null = null;
    if (body.label !== undefined && body.label !== null) {
      const cleaned = nonEmptyString(body.label, LABEL_MAX_LEN);
      if (!cleaned) {
        return jsonResponse(
          {
            error:
              `label must be a non-empty string up to ${LABEL_MAX_LEN} chars`,
          },
          400,
        );
      }
      label = cleaned;
    }

    const fixture = await this.repo.loadFixture(fixtureId);
    if (!fixture) return jsonResponse({ error: "Fixture not found" }, 404);
    if (NON_MINTABLE_STATUSES.has(fixture.status)) {
      return jsonResponse(
        { error: `Cannot mint a code for a ${fixture.status} fixture` },
        409,
      );
    }

    // Generate the raw code, hash it, stash the hash. A statistically
    // impossible hash collision would fail on the unique index; let it
    // bubble so we see the error rather than silently paper over it.
    const code = generateMatchCode();
    const codeHash = await hashMatchCode(code);
    const expiresAt = new Date(Date.now() + ttlMinutes * 60_000)
      .toISOString();

    const inserted = await this.repo.insertAccess({
      fixture_id: fixtureId,
      code_hash: codeHash,
      label,
      expires_at: expiresAt,
      created_by: createdBy,
    });

    return jsonResponse({
      id: inserted.id,
      fixture_id: fixtureId,
      code,
      expires_at: inserted.expires_at,
      label,
    }, 201);
  }
}
