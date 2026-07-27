import type { StimulusFormat } from "../data/manifestTypes";
import {
  catalogHash,
  stimulusSetVersion,
} from "../data/releaseInfo";
import type {
  AllocationMetadata,
  DatasetClassification,
  ExperimentPayload,
} from "../experiment/experimentTypes";
import {
  allocateFormalParticipant,
  reconcileFallbackBeforeSubmit,
} from "./formalAllocation";
import type { BootstrapResponse } from "./types";

const STATIC_PREVIEW =
  typeof __MMQ_STATIC_PREVIEW__ !== "undefined" &&
  __MMQ_STATIC_PREVIEW__;
export const NETLIFY_FORM_NAME = "mmq-submission-v1";
const CLIENT_TOKEN_KEY = "multimodality_client_token";
const STATIC_PARTICIPANT_ID_KEY =
  "multimodality_github_preview_participant_id";
const STATIC_FORMAT_KEY =
  "multimodality_github_preview_format_assignment";
const STATIC_SUBMISSION_PREFIX =
  "multimodality_github_preview_submission_";

interface FrozenNetlifyPayload {
  payloadJson: string;
  payloadSha256: string;
  payloadSnapshot: ExperimentPayload;
}

export interface NetlifySubmissionTransportState {
  attemptCount: number;
  lastCompletedAttemptLatencyMs: number | null;
  preparationPromise: Promise<FrozenNetlifyPayload> | null;
  frozenPayload: FrozenNetlifyPayload | null;
}

const submissionTransportState = new Map<
  string,
  NetlifySubmissionTransportState
>();

export type { BootstrapResponse } from "./types";

export const EMPTY_ALLOCATION_METADATA: AllocationMetadata = {
  allocation_id: null,
  randomization_version: null,
  allocation_method: null,
  allocation_status: null,
  assigned_at: null,
  fallback_reason_code: null,
  fallback_reconciled_at: null,
};

export function allocationMetadataFromBootstrap(
  bootstrap: BootstrapResponse,
): AllocationMetadata {
  return {
    allocation_id: bootstrap.allocation_id ?? null,
    randomization_version: bootstrap.randomization_version ?? null,
    allocation_method: bootstrap.allocation_method ?? null,
    allocation_status: bootstrap.allocation_status ?? null,
    assigned_at: bootstrap.assigned_at ?? null,
    fallback_reason_code: bootstrap.fallback_reason_code ?? null,
    fallback_reconciled_at: bootstrap.fallback_reconciled_at ?? null,
  };
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
  return STATIC_PREVIEW;
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
    saveClientToken(clientToken);
    if (collectionState.datasetClassification === "formal") {
      return allocateFormalParticipant(clientToken);
    }
    const participantId = getOrCreateLocalValue(
      STATIC_PARTICIPANT_ID_KEY,
      () => randomIdentifier("preview-participant"),
    );
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
      ...EMPTY_ALLOCATION_METADATA,
    };
  }

  const { bootstrapFromServer } = await import("./serverClient");
  const data = await bootstrapFromServer(
    datasetClassification,
    getSavedClientToken(),
  );
  saveClientToken(data.client_token);
  return data;
}

export interface NetlifyFormSubmission {
  payloadJson: string;
  payloadSha256: string;
  body: URLSearchParams;
}

export function createNetlifySubmissionTransportState(): NetlifySubmissionTransportState {
  return {
    attemptCount: 0,
    lastCompletedAttemptLatencyMs: null,
    preparationPromise: null,
    frozenPayload: null,
  };
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
  const frozenPayload = await freezeNetlifyPayload(payload);
  return buildNetlifyFormSubmissionFromFrozen(
    frozenPayload,
    submitAttemptCount,
    previousAttemptLatencyMs,
  );
}

export async function prepareNetlifyFormAttempt(
  state: NetlifySubmissionTransportState,
  payload: ExperimentPayload,
  preSubmitReconciliation: () => Promise<void>,
): Promise<NetlifyFormSubmission> {
  if (!state.preparationPromise) {
    state.preparationPromise = (async () => {
      await preSubmitReconciliation();
      return freezeNetlifyPayload(payload);
    })();
  }

  const frozenPayload = await state.preparationPromise;
  state.frozenPayload = frozenPayload;
  state.attemptCount += 1;
  return buildNetlifyFormSubmissionFromFrozen(
    frozenPayload,
    state.attemptCount,
    state.lastCompletedAttemptLatencyMs,
  );
}

async function freezeNetlifyPayload(
  payload: ExperimentPayload,
): Promise<FrozenNetlifyPayload> {
  const payloadJson = JSON.stringify(payload);
  const payloadSha256 = await sha256Hex(payloadJson);
  return {
    payloadJson,
    payloadSha256,
    payloadSnapshot: JSON.parse(payloadJson) as ExperimentPayload,
  };
}

function buildNetlifyFormSubmissionFromFrozen(
  frozenPayload: FrozenNetlifyPayload,
  submitAttemptCount: number,
  previousAttemptLatencyMs: number | null,
): NetlifyFormSubmission {
  const {
    payloadJson,
    payloadSha256,
    payloadSnapshot,
  } = frozenPayload;
  const session = payloadSnapshot.session;
  const body = new URLSearchParams({
    "form-name": NETLIFY_FORM_NAME,
    session_id: session.session_id,
    participant_id: session.participant_id,
    format_assignment: session.format_assignment,
    dataset_classification: session.dataset_classification,
    stimulus_set_version: session.stimulus_set_version,
    catalog_hash: session.catalog_hash,
    submitted_at: session.submitted_at,
    payload_sha256: payloadSha256,
    payload_json: payloadJson,
    allocation_id: session.allocation_id ?? "",
    randomization_version: session.randomization_version ?? "",
    allocation_method: session.allocation_method ?? "",
    allocation_status: session.allocation_status ?? "",
    assigned_at: session.assigned_at ?? "",
    fallback_reason_code: session.fallback_reason_code ?? "",
    fallback_reconciled_at: session.fallback_reconciled_at ?? "",
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
      const state =
        submissionTransportState.get(sessionId) ??
        createNetlifySubmissionTransportState();
      submissionTransportState.set(sessionId, state);
      const submission = await prepareNetlifyFormAttempt(
        state,
        payload,
        async () => {
          const clientToken = getSavedClientToken();
          if (clientToken) {
            await reconcileFallbackBeforeSubmit(payload, clientToken);
          }
        },
      );
      const startedAt = performance.now();
      try {
        await postNetlifyForm(submission);
      } finally {
        state.lastCompletedAttemptLatencyMs = Math.round(
          Math.max(0, performance.now() - startedAt),
        );
      }
      saveStaticSubmission(
        sessionId,
        participantId,
        state.frozenPayload?.payloadSnapshot ?? payload,
      );
      return;
    }

    saveStaticSubmission(sessionId, participantId, payload);
    return;
  }

  const { submitToServer } = await import("./serverClient");
  await submitToServer(sessionId, participantId, payload);
}
