import type { StimulusFormat } from "../data/manifestTypes";
import {
  catalogHash,
  stimulusSetVersion,
} from "../data/releaseInfo";
import type {
  DatasetClassification,
  ExperimentPayload,
} from "../experiment/experimentTypes";

const API_BASE = "/api";
export const NETLIFY_FORM_NAME = "mmq-submission-v1";
const CLIENT_TOKEN_KEY = "multimodality_client_token";
const STATIC_PARTICIPANT_ID_KEY =
  "multimodality_github_preview_participant_id";
const STATIC_FORMAT_KEY =
  "multimodality_github_preview_format_assignment";
const STATIC_SUBMISSION_PREFIX =
  "multimodality_github_preview_submission_";
const submissionTransportState = new Map<
  string,
  {
    attemptCount: number;
    lastCompletedAttemptLatencyMs: number | null;
  }
>();

export interface BootstrapResponse {
  participant_id: string;
  client_token: string;
  format_assignment: StimulusFormat;
  session_id: string;
  is_returning: boolean;
  dataset_classification?: "formal" | "test";
  formal_collection_allowed?: boolean;
  stimulus_set_version?: string;
  catalog_hash?: string;
}

export function getSavedClientToken(): string | null {
  try {
    return localStorage.getItem(CLIENT_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function saveClientToken(token: string): void {
  try {
    localStorage.setItem(CLIENT_TOKEN_KEY, token);
  } catch {
    // localStorage unavailable — continue without persistence
  }
}

function isStaticPreview(): boolean {
  return import.meta.env.VITE_STATIC_PREVIEW === "true";
}

function configuredStaticDatasetClassification(): DatasetClassification {
  return import.meta.env.VITE_DEFAULT_DATASET_CLASSIFICATION === "formal"
    ? "formal"
    : "test";
}

function isNetlifyFormsMode(): boolean {
  return (
    isStaticPreview() &&
    configuredStaticDatasetClassification() === "formal"
  );
}

export function resolveStaticCollectionState(
  requestedClassification: "test" | undefined,
  defaultClassification: DatasetClassification
): {
  datasetClassification: DatasetClassification;
  formalCollectionAllowed: boolean;
} {
  const datasetClassification =
    requestedClassification ?? defaultClassification;
  return {
    datasetClassification,
    formalCollectionAllowed: datasetClassification === "formal",
  };
}

function randomIdentifier(prefix: string): string {
  const value =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${value}`;
}

function getOrCreateLocalValue(
  key: string,
  createValue: () => string,
): string {
  try {
    const current = localStorage.getItem(key);
    if (current) {
      return current;
    }
    const created = createValue();
    localStorage.setItem(key, created);
    return created;
  } catch {
    return createValue();
  }
}

function getOrCreateStaticFormat(): StimulusFormat {
  const formats: readonly StimulusFormat[] = [
    "table",
    "graph",
    "video",
  ];
  const stored = getOrCreateLocalValue(STATIC_FORMAT_KEY, () => {
    const index = Math.floor(Math.random() * formats.length);
    return formats[index];
  });
  return stored === "table" || stored === "graph" || stored === "video"
    ? stored
    : "table";
}

export async function apiBootstrap(
  datasetClassification?: "test"
): Promise<BootstrapResponse> {
  if (isStaticPreview()) {
    const collectionState = resolveStaticCollectionState(
      datasetClassification,
      configuredStaticDatasetClassification(),
    );
    const clientToken = getOrCreateLocalValue(
      CLIENT_TOKEN_KEY,
      () => randomIdentifier("preview-client"),
    );
    const participantId = getOrCreateLocalValue(
      STATIC_PARTICIPANT_ID_KEY,
      () => randomIdentifier("preview-participant"),
    );
    saveClientToken(clientToken);
    return {
      participant_id: participantId,
      client_token: clientToken,
      format_assignment: getOrCreateStaticFormat(),
      session_id: randomIdentifier("preview-session"),
      is_returning: true,
      dataset_classification: collectionState.datasetClassification,
      formal_collection_allowed: collectionState.formalCollectionAllowed,
      stimulus_set_version: stimulusSetVersion,
      catalog_hash: catalogHash,
    };
  }

  const clientToken = getSavedClientToken();
  const res = await fetch(`${API_BASE}/bootstrap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_token: clientToken,
      dataset_classification: datasetClassification,
    }),
  });

  if (!res.ok) {
    throw new Error(`Bootstrap failed: ${res.status}`);
  }

  const data: BootstrapResponse = await res.json();
  saveClientToken(data.client_token);
  return data;
}

export interface NetlifyFormSubmission {
  payloadJson: string;
  payloadSha256: string;
  body: URLSearchParams;
}

export async function sha256Hex(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Web Crypto SHA-256 is unavailable in this browser.");
  }

  const encoded = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

export async function buildNetlifyFormSubmission(
  payload: ExperimentPayload,
  submitAttemptCount: number,
  previousAttemptLatencyMs: number | null
): Promise<NetlifyFormSubmission> {
  const payloadJson = JSON.stringify(payload);
  const payloadSha256 = await sha256Hex(payloadJson);
  const body = new URLSearchParams({
    "form-name": NETLIFY_FORM_NAME,
    session_id: payload.session.session_id,
    participant_id: payload.session.participant_id,
    format_assignment: payload.session.format_assignment,
    dataset_classification: payload.session.dataset_classification,
    stimulus_set_version: payload.session.stimulus_set_version,
    catalog_hash: payload.session.catalog_hash,
    submitted_at: payload.session.submitted_at,
    payload_sha256: payloadSha256,
    payload_json: payloadJson,
    submit_attempt_count: String(submitAttemptCount),
    submit_latency_ms:
      previousAttemptLatencyMs === null
        ? ""
        : String(previousAttemptLatencyMs),
    submit_latency_scope: "previous_completed_attempt",
  });

  return { payloadJson, payloadSha256, body };
}

export async function postNetlifyForm(
  submission: NetlifyFormSubmission,
  fetchImplementation: typeof fetch = fetch
): Promise<void> {
  const response = await fetchImplementation("/", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: submission.body.toString(),
  });
  if (!response.ok) {
    throw new Error(`Netlify Forms submit failed: ${response.status}`);
  }
}

function saveStaticSubmission(
  sessionId: string,
  participantId: string,
  payload: ExperimentPayload
): void {
  try {
    localStorage.setItem(
      `${STATIC_SUBMISSION_PREFIX}${sessionId}`,
      JSON.stringify({
        session_id: sessionId,
        participant_id: participantId,
        payload,
        saved_at: new Date().toISOString(),
      }),
    );
  } catch {
    // Participant downloads remain available if localStorage is unavailable.
  }
}

export async function apiSubmit(
  sessionId: string,
  participantId: string,
  payload: ExperimentPayload
): Promise<void> {
  if (isStaticPreview()) {
    if (isNetlifyFormsMode()) {
      const state = submissionTransportState.get(sessionId) ?? {
        attemptCount: 0,
        lastCompletedAttemptLatencyMs: null,
      };
      state.attemptCount += 1;
      submissionTransportState.set(sessionId, state);
      const submission = await buildNetlifyFormSubmission(
        payload,
        state.attemptCount,
        state.lastCompletedAttemptLatencyMs,
      );
      const startedAt = performance.now();
      try {
        await postNetlifyForm(submission);
      } finally {
        state.lastCompletedAttemptLatencyMs = Math.round(
          Math.max(0, performance.now() - startedAt),
        );
      }
      saveStaticSubmission(sessionId, participantId, payload);
      return;
    }

    saveStaticSubmission(sessionId, participantId, payload);
    return;
  }

  const res = await fetch(`${API_BASE}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session_id: sessionId,
      participant_id: participantId,
      payload,
    }),
  });

  if (!res.ok) {
    throw new Error(`Submit failed: ${res.status}`);
  }
}
