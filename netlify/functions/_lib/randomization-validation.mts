import { createHmac } from "node:crypto";
import {
  catalogMismatch,
  invalidRequest,
} from "./randomization-errors.mts";
import type {
  FallbackReasonCode,
  StimulusFormat,
} from "./randomization-types.mts";

export const STIMULUS_SET_VERSION = "mmq-stimuli-2026-07-r1";
export const CATALOG_HASH =
  "e435368f72846b356aa2f5106b47dfe1c35dbc65012125eefa199ed53e93a7ec";
export const MAX_REQUEST_BYTES = 8_192;

const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/;
const CLIENT_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,255}$/;
const FORMATS = new Set<StimulusFormat>(["table", "graph", "video"]);
const FALLBACK_REASONS = new Set<FallbackReasonCode>([
  "allocation_timeout",
  "allocation_network_error",
  "allocation_server_error",
]);

export interface AllocateRequestBody {
  client_token: string;
  session_id: string;
  catalog_hash: string;
  stimulus_set_version: string;
}

export interface ReconcileRequestBody extends AllocateRequestBody {
  allocation_id: string;
  participant_id: string;
  session_id: string;
  format_assignment: StimulusFormat;
  assigned_at: string;
  fallback_reason_code: FallbackReasonCode;
}

function recordValue(body: unknown, key: string): unknown {
  return body && typeof body === "object"
    ? (body as Record<string, unknown>)[key]
    : undefined;
}

function requiredString(
  body: unknown,
  key: string,
  pattern?: RegExp,
): string {
  const value = recordValue(body, key);
  if (
    typeof value !== "string"
    || value.length === 0
    || (pattern && !pattern.test(value))
  ) {
    throw invalidRequest(`'${key}' is missing or invalid.`);
  }
  return value;
}

function validateRelease(
  catalogHash: string,
  stimulusSetVersion: string,
): void {
  if (
    catalogHash !== CATALOG_HASH
    || stimulusSetVersion !== STIMULUS_SET_VERSION
  ) {
    throw catalogMismatch();
  }
}

export function parseAllocateBody(body: unknown): AllocateRequestBody {
  const clientToken = requiredString(body, "client_token", CLIENT_TOKEN);
  const catalogHash = requiredString(body, "catalog_hash");
  const stimulusSetVersion = requiredString(body, "stimulus_set_version");
  validateRelease(catalogHash, stimulusSetVersion);
  return {
    client_token: clientToken,
    session_id: requiredString(body, "session_id", SAFE_IDENTIFIER),
    catalog_hash: catalogHash,
    stimulus_set_version: stimulusSetVersion,
  };
}

export function parseReconcileBody(body: unknown): ReconcileRequestBody {
  const release = parseAllocateBody(body);
  const formatAssignment = requiredString(body, "format_assignment");
  if (!FORMATS.has(formatAssignment as StimulusFormat)) {
    throw invalidRequest("'format_assignment' is invalid.");
  }
  const fallbackReasonCode = requiredString(body, "fallback_reason_code");
  if (!FALLBACK_REASONS.has(fallbackReasonCode as FallbackReasonCode)) {
    throw invalidRequest("'fallback_reason_code' is invalid.");
  }
  const assignedAt = requiredString(body, "assigned_at");
  const assignedAtMs = Date.parse(assignedAt);
  if (!Number.isFinite(assignedAtMs)) {
    throw invalidRequest("'assigned_at' must be an ISO-8601 timestamp.");
  }

  return {
    ...release,
    allocation_id: requiredString(body, "allocation_id", SAFE_IDENTIFIER),
    participant_id: requiredString(body, "participant_id", SAFE_IDENTIFIER),
    session_id: requiredString(body, "session_id", SAFE_IDENTIFIER),
    format_assignment: formatAssignment as StimulusFormat,
    assigned_at: new Date(assignedAtMs).toISOString(),
    fallback_reason_code: fallbackReasonCode as FallbackReasonCode,
  };
}

export function tokenHmac(clientToken: string, secret: string): string {
  if (Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error(
      "MMQ_RANDOMIZATION_HMAC_SECRET must contain at least 32 UTF-8 bytes.",
    );
  }
  return createHmac("sha256", secret).update(clientToken, "utf8").digest("hex");
}
