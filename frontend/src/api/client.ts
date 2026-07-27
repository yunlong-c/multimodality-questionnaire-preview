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
const AUTHORITATIVE_SUBMISSION =
  typeof __MMQ_AUTHORITATIVE_SUBMISSION__ !== "undefined" &&
  __MMQ_AUTHORITATIVE_SUBMISSION__;
export const LEGACY_NETLIFY_FORM_NAME = "mmq-submission-v1";
export const NETLIFY_FORM_NAMES = {
  formal: "mmq-submission-v2-formal",
  test: "mmq-submission-v2-test",
} as const;
const CLIENT_TOKEN_KEY = "multimodality_client_token";
const STATIC_PARTICIPANT_ID_KEY =
  "multimodality_github_preview_participant_id";
const STATIC_FORMAT_KEY =
  "multimodality_github_preview_format_assignment";
const STATIC_SUBMISSION_PREFIX =
  "multimodality_github_preview_submission_";
export const PENDING_SUBMISSION_STORAGE_KEY =
  "multimodality_pending_submission_v2";
const AUTHORITATIVE_SUBMIT_ENDPOINT = "/api/submit";
const AUTHORITATIVE_RETRY_DELAY_MS = 350;
const AUTHORITATIVE_ATTEMPT_TIMEOUT_MS = 12_000;

export interface FrozenNetlifyPayload {
  payloadJson: string;
  payloadSha256: string;
  payloadSnapshot: ExperimentPayload;
}

export interface PendingSubmissionRecord {
  schema_version: 2;
  client_token: string;
  session_id: string;
  participant_id: string;
  dataset_classification: DatasetClassification;
  payload_json: string;
  payload_sha256: string;
  created_at: string;
  attempt_count: number;
  previous_attempt_latency_ms: number | null;
  emergency_form_sent_at: string | null;
}

export interface AuthoritativeSubmissionReceipt {
  receiptId: string;
  sessionId: string;
  participantId: string;
  datasetClassification: DatasetClassification;
  payloadSha256: string;
  storedAt: string;
  isReplay: boolean;
  authority: "netlify_database";
  mirrorStatus: "pending" | "accepted" | "failed";
}

export type SubmissionResult =
  | {
      status: "confirmed";
      receipt: AuthoritativeSubmissionReceipt;
    }
  | {
      status: "local_preview";
      payloadSha256: string;
    };

type SubmissionStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

export class AuthoritativeSubmissionError extends Error {
  readonly status: number | null;
  readonly code: string;
  readonly retryable: boolean;

  constructor(
    message: string,
    options: {
      status?: number | null;
      code: string;
      retryable: boolean;
      cause?: unknown;
    },
  ) {
    super(message);
    this.name = "AuthoritativeSubmissionError";
    this.status = options.status ?? null;
    this.code = options.code;
    this.retryable = options.retryable;
    if (options.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
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

export function usesAuthoritativeSubmissionTransport(): boolean {
  return AUTHORITATIVE_SUBMISSION;
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
  options: {
    clientToken?: string;
    receipt?: AuthoritativeSubmissionReceipt | null;
    mirrorSource?: "client_emergency" | "authority_queue";
  } = {},
): NetlifyFormSubmission {
  const {
    payloadJson,
    payloadSha256,
    payloadSnapshot,
  } = frozenPayload;
  const session = payloadSnapshot.session;
  const formName = NETLIFY_FORM_NAMES[session.dataset_classification];
  const receipt = options.receipt ?? null;
  const body = new URLSearchParams({
    "form-name": formName,
    session_id: session.session_id,
    participant_id: session.participant_id,
    client_token: options.clientToken ?? "",
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
    receipt_id: receipt?.receiptId ?? "",
    authoritative_stored_at: receipt?.storedAt ?? "",
    submission_authority: receipt?.authority ?? "",
    mirror_status: receipt?.mirrorStatus ?? "emergency_unconfirmed",
    mirror_source: options.mirrorSource ?? "client_emergency",
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

export function createPendingSubmissionRecord(
  frozenPayload: FrozenNetlifyPayload,
  clientToken: string,
  now: () => Date = () => new Date(),
): PendingSubmissionRecord {
  const session = frozenPayload.payloadSnapshot.session;
  return {
    schema_version: 2,
    client_token: clientToken,
    session_id: session.session_id,
    participant_id: session.participant_id,
    dataset_classification: session.dataset_classification,
    payload_json: frozenPayload.payloadJson,
    payload_sha256: frozenPayload.payloadSha256,
    created_at: now().toISOString(),
    attempt_count: 0,
    previous_attempt_latency_ms: null,
    emergency_form_sent_at: null,
  };
}

export function persistPendingSubmission(
  pending: PendingSubmissionRecord,
  storageOverride?: SubmissionStorage | null,
): void {
  const storage = resolveSubmissionStorage(storageOverride);
  if (!storage) {
    return;
  }
  try {
    storage.setItem(
      PENDING_SUBMISSION_STORAGE_KEY,
      JSON.stringify(pending),
    );
  } catch {
    // The in-memory submission can still be attempted and downloaded.
  }
}

export function readPendingSubmission(
  storageOverride?: SubmissionStorage | null,
): PendingSubmissionRecord | null {
  const storage = resolveSubmissionStorage(storageOverride);
  if (!storage) {
    return null;
  }

  let raw: string | null;
  try {
    raw = storage.getItem(PENDING_SUBMISSION_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) {
    return null;
  }

  try {
    const value: unknown = JSON.parse(raw);
    if (isPendingSubmissionRecord(value)) {
      return value;
    }
  } catch {
    // Corrupt local state is removed below.
  }

  try {
    storage.removeItem(PENDING_SUBMISSION_STORAGE_KEY);
  } catch {
    // Ignore inaccessible storage.
  }
  return null;
}

export function clearPendingSubmission(
  payloadSha256: string,
  storageOverride?: SubmissionStorage | null,
): void {
  const storage = resolveSubmissionStorage(storageOverride);
  if (!storage) {
    return;
  }
  const current = readPendingSubmission(storage);
  if (!current || current.payload_sha256 !== payloadSha256) {
    return;
  }
  try {
    storage.removeItem(PENDING_SUBMISSION_STORAGE_KEY);
  } catch {
    // A stale confirmed record is harmless and can be replayed idempotently.
  }
}

export async function loadRecoverablePendingSubmission(
  storageOverride?: SubmissionStorage | null,
): Promise<{
  sessionId: string;
  participantId: string;
  payload: ExperimentPayload;
} | null> {
  if (!usesAuthoritativeSubmissionTransport()) {
    return null;
  }
  const pending = readPendingSubmission(storageOverride);
  if (!pending) {
    return null;
  }
  const savedClientToken = getSavedClientToken();
  if (savedClientToken && pending.client_token !== savedClientToken) {
    return null;
  }
  if (!savedClientToken) {
    saveClientToken(pending.client_token);
  }

  const computedHash = await sha256Hex(pending.payload_json);
  if (computedHash !== pending.payload_sha256) {
    clearPendingSubmission(pending.payload_sha256, storageOverride);
    return null;
  }

  let payload: ExperimentPayload;
  try {
    payload = JSON.parse(pending.payload_json) as ExperimentPayload;
  } catch {
    clearPendingSubmission(pending.payload_sha256, storageOverride);
    return null;
  }
  if (
    payload.session.session_id !== pending.session_id ||
    payload.session.participant_id !== pending.participant_id ||
    payload.session.dataset_classification !==
      pending.dataset_classification
  ) {
    clearPendingSubmission(pending.payload_sha256, storageOverride);
    return null;
  }

  return {
    sessionId: pending.session_id,
    participantId: pending.participant_id,
    payload,
  };
}

export async function reconcilePendingFallbackForAuthority(
  pending: PendingSubmissionRecord,
  clientToken: string,
  reconciliation: (
    payload: ExperimentPayload,
    clientToken: string,
  ) => Promise<void> = reconcileFallbackBeforeSubmit,
  storageOverride?: SubmissionStorage | null,
): Promise<{
  pending: PendingSubmissionRecord;
  readyForAuthority: boolean;
  hashUpdated: boolean;
}> {
  const originalPayload = JSON.parse(
    pending.payload_json,
  ) as ExperimentPayload;
  if (!isUnreconciledFallback(originalPayload)) {
    return {
      pending,
      readyForAuthority: true,
      hashUpdated: false,
    };
  }

  const reconciledPayload = JSON.parse(
    pending.payload_json,
  ) as ExperimentPayload;
  await reconciliation(reconciledPayload, clientToken);
  if (isUnreconciledFallback(reconciledPayload)) {
    return {
      pending,
      readyForAuthority: false,
      hashUpdated: false,
    };
  }
  assertOnlyFallbackAuditWasReconciled(
    originalPayload,
    reconciledPayload,
  );

  const reconciledFrozen = await freezeNetlifyPayload(
    reconciledPayload,
  );
  const updated: PendingSubmissionRecord = {
    ...pending,
    payload_json: reconciledFrozen.payloadJson,
    payload_sha256: reconciledFrozen.payloadSha256,
    emergency_form_sent_at:
      reconciledFrozen.payloadSha256 === pending.payload_sha256
        ? pending.emergency_form_sent_at
        : null,
  };
  persistPendingSubmission(updated, storageOverride);
  return {
    pending: updated,
    readyForAuthority: true,
    hashUpdated:
      updated.payload_sha256 !== pending.payload_sha256,
  };
}

export async function postAuthoritativeSubmission(
  pending: PendingSubmissionRecord,
  fetchImplementation: typeof fetch = fetch,
): Promise<AuthoritativeSubmissionReceipt> {
  let response: Response;
  const startedAt = performance.now();
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(
    () => controller.abort(),
    AUTHORITATIVE_ATTEMPT_TIMEOUT_MS,
  );
  pending.attempt_count += 1;
  persistPendingSubmission(pending);
  try {
    response = await fetchImplementation(AUTHORITATIVE_SUBMIT_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        schema_version: 1,
        client_token: pending.client_token,
        payload_json: pending.payload_json,
        payload_sha256: pending.payload_sha256,
        transport: {
          client_attempt_count: pending.attempt_count,
          previous_attempt_latency_ms:
            pending.previous_attempt_latency_ms,
        },
      }),
      signal: controller.signal,
    });
  } catch (error) {
    globalThis.clearTimeout(timeout);
    pending.previous_attempt_latency_ms = elapsedMilliseconds(startedAt);
    persistPendingSubmission(pending);
    throw new AuthoritativeSubmissionError(
      "The authoritative submission endpoint could not be reached.",
      {
        code: controller.signal.aborted
          ? "SUBMISSION_TIMEOUT"
          : "SUBMISSION_NETWORK_ERROR",
        retryable: true,
        cause: error,
      },
    );
  }

  pending.previous_attempt_latency_ms = elapsedMilliseconds(startedAt);
  persistPendingSubmission(pending);

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    throw new AuthoritativeSubmissionError(
      "The authoritative submission endpoint returned invalid JSON.",
      {
        status: response.status,
        code: "INVALID_SUBMISSION_RESPONSE",
        retryable: response.ok || response.status >= 500,
        cause: error,
      },
    );
  } finally {
    globalThis.clearTimeout(timeout);
  }

  if (!response.ok) {
    const parsedError = readSubmissionError(body);
    throw new AuthoritativeSubmissionError(
      parsedError.message ??
        `Authoritative submit failed: ${response.status}.`,
      {
        status: response.status,
        code: parsedError.code ?? "SUBMISSION_REJECTED",
        retryable:
          parsedError.retryable ??
          (response.status === 429 || response.status >= 500),
      },
    );
  }

  return parseAuthoritativeReceipt(body, pending);
}

async function submitPendingWithRetry(
  pending: PendingSubmissionRecord,
  fetchImplementation: typeof fetch = fetch,
): Promise<AuthoritativeSubmissionReceipt> {
  try {
    return await postAuthoritativeSubmission(
      pending,
      fetchImplementation,
    );
  } catch (error) {
    if (
      !(error instanceof AuthoritativeSubmissionError) ||
      !error.retryable
    ) {
      throw error;
    }
    await delay(AUTHORITATIVE_RETRY_DELAY_MS);
    return postAuthoritativeSubmission(pending, fetchImplementation);
  }
}

async function sendEmergencyFormOnce(
  pending: PendingSubmissionRecord,
  fetchImplementation: typeof fetch = fetch,
): Promise<void> {
  if (pending.emergency_form_sent_at) {
    return;
  }

  const payloadSnapshot = JSON.parse(
    pending.payload_json,
  ) as ExperimentPayload;
  const frozenPayload: FrozenNetlifyPayload = {
    payloadJson: pending.payload_json,
    payloadSha256: pending.payload_sha256,
    payloadSnapshot,
  };
  const submission = buildNetlifyFormSubmissionFromFrozen(
    frozenPayload,
    pending.attempt_count,
    pending.previous_attempt_latency_ms,
    {
      clientToken: pending.client_token,
      receipt: null,
      mirrorSource: "client_emergency",
    },
  );
  await postNetlifyForm(submission, fetchImplementation);
  pending.emergency_form_sent_at = new Date().toISOString();
  persistPendingSubmission(pending);
}

function parseAuthoritativeReceipt(
  value: unknown,
  pending: PendingSubmissionRecord,
): AuthoritativeSubmissionReceipt {
  if (!isRecord(value)) {
    throw invalidReceipt();
  }
  const mirrorStatus = value.mirror_status;
  if (
    !isNonEmptyString(value.receipt_id) ||
    value.session_id !== pending.session_id ||
    value.participant_id !== pending.participant_id ||
    value.dataset_classification !==
      pending.dataset_classification ||
    value.payload_sha256 !== pending.payload_sha256 ||
    !isNonEmptyString(value.stored_at) ||
    typeof value.is_replay !== "boolean" ||
    value.authority !== "netlify_database" ||
    (mirrorStatus !== "pending" &&
      mirrorStatus !== "accepted" &&
      mirrorStatus !== "failed")
  ) {
    throw invalidReceipt();
  }

  return {
    receiptId: value.receipt_id,
    sessionId: value.session_id,
    participantId: value.participant_id,
    datasetClassification: value.dataset_classification,
    payloadSha256: value.payload_sha256,
    storedAt: value.stored_at,
    isReplay: value.is_replay,
    authority: "netlify_database",
    mirrorStatus,
  };
}

function invalidReceipt(): AuthoritativeSubmissionError {
  return new AuthoritativeSubmissionError(
    "The authoritative receipt did not match the frozen submission.",
    {
      code: "INVALID_SUBMISSION_RECEIPT",
      retryable: true,
    },
  );
}

function readSubmissionError(value: unknown): {
  code: string | null;
  message: string | null;
  retryable: boolean | null;
} {
  if (!isRecord(value) || !isRecord(value.error)) {
    return { code: null, message: null, retryable: null };
  }
  return {
    code:
      typeof value.error.code === "string"
        ? value.error.code
        : null,
    message:
      typeof value.error.message === "string"
        ? value.error.message
        : null,
    retryable:
      typeof value.error.retryable === "boolean"
        ? value.error.retryable
        : null,
  };
}

function isUnreconciledFallback(
  payload: ExperimentPayload,
): boolean {
  return (
    payload.session.allocation_method === "client_fallback" &&
    payload.session.allocation_status === "unreconciled"
  );
}

function assertOnlyFallbackAuditWasReconciled(
  original: ExperimentPayload,
  reconciled: ExperimentPayload,
): void {
  const expected = JSON.parse(
    JSON.stringify(original),
  ) as ExperimentPayload;
  expected.session.allocation_status = "confirmed";
  expected.session.fallback_reconciled_at =
    reconciled.session.fallback_reconciled_at;
  if (
    !reconciled.session.fallback_reconciled_at ||
    JSON.stringify(expected) !== JSON.stringify(reconciled)
  ) {
    throw new AuthoritativeSubmissionError(
      "Fallback reconciliation changed frozen questionnaire data.",
      {
        code: "INVALID_RECONCILIATION_UPDATE",
        retryable: false,
      },
    );
  }
}

function isPendingSubmissionRecord(
  value: unknown,
): value is PendingSubmissionRecord {
  return (
    isRecord(value) &&
    value.schema_version === 2 &&
    isNonEmptyString(value.client_token) &&
    isNonEmptyString(value.session_id) &&
    isNonEmptyString(value.participant_id) &&
    (value.dataset_classification === "formal" ||
      value.dataset_classification === "test") &&
    isNonEmptyString(value.payload_json) &&
    /^[a-f0-9]{64}$/.test(String(value.payload_sha256)) &&
    isNonEmptyString(value.created_at) &&
    Number.isInteger(value.attempt_count) &&
    Number(value.attempt_count) >= 0 &&
    (value.previous_attempt_latency_ms === null ||
      (Number.isInteger(value.previous_attempt_latency_ms) &&
        Number(value.previous_attempt_latency_ms) >= 0)) &&
    (value.emergency_form_sent_at === null ||
      isNonEmptyString(value.emergency_form_sent_at))
  );
}

function resolveSubmissionStorage(
  override?: SubmissionStorage | null,
): SubmissionStorage | null {
  if (override !== undefined) {
    return override;
  }
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function elapsedMilliseconds(startedAt: number): number {
  return Math.round(
    Math.max(0, performance.now() - startedAt),
  );
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) =>
    globalThis.setTimeout(resolve, milliseconds)
  );
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
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
): Promise<SubmissionResult> {
  if (!usesAuthoritativeSubmissionTransport()) {
    const frozen = await freezeNetlifyPayload(payload);
    saveStaticSubmission(
      sessionId,
      participantId,
      frozen.payloadSnapshot,
    );
    return {
      status: "local_preview",
      payloadSha256: frozen.payloadSha256,
    };
  }

  const clientToken = getSavedClientToken();
  if (!clientToken) {
    throw new AuthoritativeSubmissionError(
      "The browser client token is missing.",
      {
        code: "CLIENT_TOKEN_MISSING",
        retryable: false,
      },
    );
  }

  const state =
    submissionTransportState.get(sessionId) ??
    createNetlifySubmissionTransportState();
  submissionTransportState.set(sessionId, state);
  let pending = readPendingSubmission();

  try {
    if (pending) {
      if (
        pending.session_id !== sessionId ||
        pending.participant_id !== participantId ||
        pending.client_token !== clientToken
      ) {
        throw new AuthoritativeSubmissionError(
          "Another frozen questionnaire submission is awaiting confirmation.",
          {
            code: "PENDING_SUBMISSION_CONFLICT",
            retryable: false,
          },
        );
      }
      const reconciliation =
        await reconcilePendingFallbackForAuthority(
          pending,
          clientToken,
        );
      pending = reconciliation.pending;
      if (!reconciliation.readyForAuthority) {
        throw fallbackReconciliationPending();
      }
    } else {
      const frozen = await prepareFrozenPayload(
        state,
        payload,
        async () => {
          await reconcileFallbackBeforeSubmit(payload, clientToken);
        },
      );
      pending = createPendingSubmissionRecord(
        frozen,
        clientToken,
      );
      persistPendingSubmission(pending);
      if (isUnreconciledFallback(frozen.payloadSnapshot)) {
        throw fallbackReconciliationPending();
      }
    }

    const payloadSnapshot = JSON.parse(
      pending.payload_json,
    ) as ExperimentPayload;
    state.frozenPayload = {
      payloadJson: pending.payload_json,
      payloadSha256: pending.payload_sha256,
      payloadSnapshot,
    };
    const receipt = await submitPendingWithRetry(pending);
    clearPendingSubmission(receipt.payloadSha256);
    return { status: "confirmed", receipt };
  } catch (error) {
    if (
      pending &&
      error instanceof AuthoritativeSubmissionError &&
      error.retryable
    ) {
      try {
        await sendEmergencyFormOnce(pending);
      } catch {
        // The pending authoritative payload remains available for retry.
      }
    }
    throw error;
  }
}

function fallbackReconciliationPending(): AuthoritativeSubmissionError {
  return new AuthoritativeSubmissionError(
    "Fallback allocation reconciliation is still pending.",
    {
      code: "FALLBACK_RECONCILIATION_PENDING",
      retryable: true,
    },
  );
}

async function prepareFrozenPayload(
  state: NetlifySubmissionTransportState,
  payload: ExperimentPayload,
  preSubmitReconciliation: () => Promise<void>,
): Promise<FrozenNetlifyPayload> {
  if (!state.preparationPromise) {
    state.preparationPromise = (async () => {
      await preSubmitReconciliation();
      return freezeNetlifyPayload(payload);
    })();
  }
  const frozen = await state.preparationPromise;
  state.frozenPayload = frozen;
  return frozen;
}
