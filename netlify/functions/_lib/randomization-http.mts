import { randomUUID } from "node:crypto";
import metadata from "../../randomization/public-schedule-metadata.json" with {
  type: "json",
};
import {
  allocationUnavailable,
  collectionClosed,
  invalidRequest,
  RandomizationError,
} from "./randomization-errors.mts";
import type {
  AllocationResult,
  RandomizationRepository,
} from "./randomization-types.mts";
import {
  CATALOG_HASH,
  MAX_REQUEST_BYTES,
  parseAllocateBody,
  parseReconcileBody,
  STIMULUS_SET_VERSION,
  tokenHmac,
} from "./randomization-validation.mts";

type RepositoryFactory = () => RandomizationRepository;

const JSON_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
};

function identifier(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

async function requestJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw invalidRequest("Content-Type must be application/json.");
  }
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_REQUEST_BYTES) {
    throw invalidRequest("The request body is too large.");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw invalidRequest("The request body is not valid JSON.");
  }
}

function successBody(
  result: AllocationResult,
  clientToken: string,
) {
  return {
    participant_id: result.record.participantId,
    client_token: clientToken,
    format_assignment: result.record.formatAssignment,
    session_id: result.record.sessionId,
    is_returning: result.isReturning,
    dataset_classification: "formal",
    formal_collection_allowed: true,
    stimulus_set_version: STIMULUS_SET_VERSION,
    catalog_hash: CATALOG_HASH,
    allocation_id: result.record.allocationId,
    randomization_version: metadata.randomization_version,
    allocation_method: result.record.allocationMethod,
    allocation_status: result.record.allocationStatus,
    assigned_at: result.record.assignedAt,
    fallback_reason_code: result.record.fallbackReasonCode,
    fallback_reconciled_at: result.record.fallbackReconciledAt,
  };
}

function errorResponse(error: unknown): Response {
  if (error instanceof RandomizationError) {
    return new Response(JSON.stringify({
      error: {
        code: error.code,
        message: error.message,
      },
    }), {
      status: error.status,
      headers: JSON_HEADERS,
    });
  }
  console.error("[mmq-randomization] allocation request failed", error);
  const unavailable = allocationUnavailable();
  return new Response(JSON.stringify({
    error: {
      code: unavailable.code,
      message: unavailable.message,
    },
  }), {
    status: unavailable.status,
    headers: JSON_HEADERS,
  });
}

function hmacSecret(): string {
  const secret = process.env.MMQ_RANDOMIZATION_HMAC_SECRET;
  if (!secret) {
    throw new Error("MMQ_RANDOMIZATION_HMAC_SECRET is not configured.");
  }
  return secret;
}

function assertFormalCollectionOpen(): void {
  if (process.env.MMQ_FORMAL_COLLECTION_OPEN !== "true") {
    throw collectionClosed();
  }
}

export function createAllocateHandler(
  repositoryFactory: RepositoryFactory,
) {
  return async (request: Request): Promise<Response> => {
    try {
      if (request.method !== "POST") {
        throw invalidRequest("Only POST requests are accepted.");
      }
      assertFormalCollectionOpen();
      const body = parseAllocateBody(await requestJson(request));
      const now = new Date().toISOString();
      const result = await repositoryFactory().allocate({
        randomizationVersion: metadata.randomization_version,
        scheduleSha256: metadata.schedule_sha256,
        tokenHmac: tokenHmac(body.client_token, hmacSecret()),
        allocationId: identifier("allocation"),
        participantId: identifier("participant"),
        sessionId: body.session_id,
        now,
      });
      return new Response(
        JSON.stringify(successBody(result, body.client_token)),
        { status: 200, headers: JSON_HEADERS },
      );
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export function createReconcileHandler(
  repositoryFactory: RepositoryFactory,
) {
  return async (request: Request): Promise<Response> => {
    try {
      if (request.method !== "POST") {
        throw invalidRequest("Only POST requests are accepted.");
      }
      assertFormalCollectionOpen();
      const body = parseReconcileBody(await requestJson(request));
      const reconciledAt = new Date().toISOString();
      const result = await repositoryFactory().reconcile({
        randomizationVersion: metadata.randomization_version,
        scheduleSha256: metadata.schedule_sha256,
        tokenHmac: tokenHmac(body.client_token, hmacSecret()),
        allocationId: body.allocation_id,
        participantId: body.participant_id,
        sessionId: body.session_id,
        formatAssignment: body.format_assignment,
        assignedAt: body.assigned_at,
        fallbackReasonCode: body.fallback_reason_code,
        reconciledAt,
      });
      return new Response(
        JSON.stringify(successBody(result, body.client_token)),
        { status: 200, headers: JSON_HEADERS },
      );
    } catch (error) {
      return errorResponse(error);
    }
  };
}
