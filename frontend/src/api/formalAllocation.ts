import type { StimulusFormat } from "../data/manifestTypes";
import {
  catalogHash,
  stimulusSetVersion,
} from "../data/releaseInfo";
import type {
  AllocationMethod,
  AllocationStatus,
  ExperimentPayload,
  FallbackReasonCode,
} from "../experiment/experimentTypes";
import type { BootstrapResponse } from "./types";

export const RANDOMIZATION_VERSION = "mmq-randomization-2026-07-v1";
export const FORMAL_ASSIGNMENT_STORAGE_KEY =
  "multimodality_formal_assignment_v1";

const ALLOCATE_ENDPOINT = "/api/allocate";
const RECONCILE_ENDPOINT = "/api/allocate/reconcile";
const DEFAULT_ATTEMPT_TIMEOUT_MS = 3_000;
const DEFAULT_RETRY_DELAYS_MS = [250, 500] as const;
const FORMATS = ["table", "graph", "video"] as const;

type AllocationStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type AllocationCrypto = Pick<Crypto, "getRandomValues"> &
  Partial<Pick<Crypto, "randomUUID">>;

interface StoredFormalAssignment {
  schema_version: 1;
  client_token: string;
  participant_id: string;
  format_assignment: StimulusFormat;
  allocation_id: string;
  randomization_version: string;
  allocation_method: AllocationMethod;
  allocation_status: AllocationStatus;
  assigned_at: string;
  fallback_reason_code: FallbackReasonCode | null;
  fallback_reconciled_at: string | null;
  stimulus_set_version: string;
  catalog_hash: string;
}

export interface FormalAllocationDependencies {
  fetchImplementation?: typeof fetch;
  storage?: AllocationStorage | null;
  cryptoImplementation?: AllocationCrypto;
  attemptTimeoutMs?: number;
  retryDelaysMs?: readonly number[];
  now?: () => Date;
}

type AllocationFailureKind =
  | FallbackReasonCode
  | "non_retryable"
  | "invalid_response";

export class FormalAllocationError extends Error {
  readonly kind: AllocationFailureKind;
  readonly status: number | null;
  readonly code: string | null;

  constructor(
    message: string,
    options: {
      kind: AllocationFailureKind;
      status?: number | null;
      code?: string | null;
      cause?: unknown;
    },
  ) {
    super(message);
    if (options.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
    this.name = "FormalAllocationError";
    this.kind = options.kind;
    this.status = options.status ?? null;
    this.code = options.code ?? null;
  }

  get canUseLocalFallback(): boolean {
    return (
      this.kind === "allocation_timeout" ||
      this.kind === "allocation_network_error" ||
      this.kind === "allocation_server_error"
    );
  }
}

export async function allocateFormalParticipant(
  clientToken: string,
  dependencies: FormalAllocationDependencies = {},
): Promise<BootstrapResponse> {
  const allocationSessionId = secureIdentifier(
    "session",
    resolveCrypto(dependencies),
  );
  const stored = readStoredAssignment(clientToken, dependencies.storage);

  if (
    stored?.allocation_method === "client_fallback" &&
    stored.allocation_status === "unreconciled"
  ) {
    try {
      const reconciled = await requestAllocation(
        RECONCILE_ENDPOINT,
        buildReconcileRequest(stored, allocationSessionId),
        clientToken,
        dependencies,
      );
      assertResponseSession(allocationSessionId, reconciled);
      assertSameAssignment(stored, reconciled);
      saveStoredAssignment(reconciled, dependencies.storage);
      return reconciled;
    } catch (error) {
      const allocationError = asAllocationError(error);
      if (!allocationError.canUseLocalFallback) {
        throw allocationError;
      }
      return bootstrapFromStoredAssignment(
        stored,
        allocationSessionId,
        true,
      );
    }
  }

  try {
    const allocated = await requestAllocation(
      ALLOCATE_ENDPOINT,
      {
        client_token: clientToken,
        catalog_hash: catalogHash,
        stimulus_set_version: stimulusSetVersion,
        session_id: allocationSessionId,
      },
      clientToken,
      dependencies,
    );
    assertResponseSession(allocationSessionId, allocated);
    if (stored) {
      assertSameAssignment(stored, allocated);
    }
    saveStoredAssignment(allocated, dependencies.storage);
    return allocated;
  } catch (error) {
    const allocationError = asAllocationError(error);
    if (!allocationError.canUseLocalFallback) {
      throw allocationError;
    }

    if (stored) {
      return bootstrapFromStoredAssignment(
        stored,
        allocationSessionId,
        true,
      );
    }

    if (!isFallbackReasonCode(allocationError.kind)) {
      throw allocationError;
    }
    const provisional = createFallbackAssignment(
      clientToken,
      allocationError.kind,
      secureIdentifier(
        "fallback-session",
        resolveCrypto(dependencies),
      ),
      dependencies,
    );
    saveStoredAssignment(provisional, dependencies.storage);
    return provisional;
  }
}

export async function reconcileFallbackBeforeSubmit(
  payload: ExperimentPayload,
  clientToken: string,
  dependencies: FormalAllocationDependencies = {},
): Promise<void> {
  const session = payload.session;
  if (
    session.dataset_classification !== "formal" ||
    session.allocation_method !== "client_fallback" ||
    session.allocation_status !== "unreconciled" ||
    !session.allocation_id ||
    !session.assigned_at ||
    !session.fallback_reason_code
  ) {
    return;
  }

  const stored = readStoredAssignment(clientToken, dependencies.storage);
  const requestBody = {
    client_token: clientToken,
    catalog_hash: catalogHash,
    stimulus_set_version: stimulusSetVersion,
    allocation_id: session.allocation_id,
    participant_id: session.participant_id,
    session_id: session.session_id,
    format_assignment: session.format_assignment,
    assigned_at: session.assigned_at,
    fallback_reason_code: session.fallback_reason_code,
  };

  try {
    const reconciled = await requestAllocationOnce(
      RECONCILE_ENDPOINT,
      requestBody,
      clientToken,
      dependencies,
    );
    if (stored) {
      assertSameAssignment(stored, reconciled);
    }
    if (
      reconciled.allocation_id !== session.allocation_id ||
      reconciled.participant_id !== session.participant_id ||
      reconciled.session_id !== session.session_id ||
      reconciled.format_assignment !== session.format_assignment ||
      reconciled.allocation_method !== "client_fallback"
    ) {
      throw invalidResponse(
        "Reconciliation changed a provisional assignment.",
      );
    }

    session.allocation_status = "confirmed";
    session.fallback_reconciled_at = reconciled.fallback_reconciled_at;
    saveStoredAssignment(
      {
        ...reconciled,
        session_id: session.session_id,
      },
      dependencies.storage,
    );
  } catch {
    // Reconciliation is deliberately best effort. The Forms submission must
    // still preserve the participant's completed answers and unreconciled flag.
  }
}

export function randomFormatWithWebCrypto(
  cryptoImplementation: Pick<Crypto, "getRandomValues">,
): StimulusFormat {
  const values = new Uint32Array(1);
  const range = 0x1_0000_0000;
  const rejectionLimit = range - (range % FORMATS.length);

  do {
    cryptoImplementation.getRandomValues(values);
  } while (values[0] >= rejectionLimit);

  return FORMATS[values[0] % FORMATS.length];
}

function createFallbackAssignment(
  clientToken: string,
  reason: FallbackReasonCode,
  sessionId: string,
  dependencies: FormalAllocationDependencies,
): BootstrapResponse {
  const cryptoImplementation = resolveCrypto(dependencies);
  const now = (dependencies.now ?? (() => new Date()))().toISOString();
  return {
    participant_id: secureIdentifier(
      "fallback-participant",
      cryptoImplementation,
    ),
    client_token: clientToken,
    format_assignment: randomFormatWithWebCrypto(cryptoImplementation),
    session_id: sessionId,
    is_returning: false,
    dataset_classification: "formal",
    formal_collection_allowed: true,
    stimulus_set_version: stimulusSetVersion,
    catalog_hash: catalogHash,
    allocation_id: secureIdentifier(
      "fallback-allocation",
      cryptoImplementation,
    ),
    randomization_version: RANDOMIZATION_VERSION,
    allocation_method: "client_fallback",
    allocation_status: "unreconciled",
    assigned_at: now,
    fallback_reason_code: reason,
    fallback_reconciled_at: null,
  };
}

async function requestAllocation(
  endpoint: string,
  body: Record<string, unknown>,
  clientToken: string,
  dependencies: FormalAllocationDependencies,
): Promise<BootstrapResponse> {
  const retryDelays =
    dependencies.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  let lastError: FormalAllocationError | null = null;

  for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
    try {
      return await requestAllocationOnce(
        endpoint,
        body,
        clientToken,
        dependencies,
      );
    } catch (error) {
      const allocationError = asAllocationError(error);
      if (!allocationError.canUseLocalFallback) {
        throw allocationError;
      }
      lastError = allocationError;
      if (attempt < retryDelays.length) {
        await delay(retryDelays[attempt]);
      }
    }
  }

  throw (
    lastError ??
    new FormalAllocationError("Formal allocation failed.", {
      kind: "allocation_network_error",
    })
  );
}

async function requestAllocationOnce(
  endpoint: string,
  body: Record<string, unknown>,
  clientToken: string,
  dependencies: FormalAllocationDependencies,
): Promise<BootstrapResponse> {
  const fetchImplementation = dependencies.fetchImplementation ?? fetch;
  const controller = new AbortController();
  const attemptTimeoutMs =
    dependencies.attemptTimeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS;
  const timeout = globalThis.setTimeout(
    () => controller.abort(),
    attemptTimeoutMs,
  );

  let response: Response;
  try {
    response = await fetchImplementation(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    globalThis.clearTimeout(timeout);
    if (controller.signal.aborted) {
      throw new FormalAllocationError("Formal allocation timed out.", {
        kind: "allocation_timeout",
        cause: error,
      });
    }
    throw new FormalAllocationError(
      "Formal allocation could not reach the server.",
      {
        kind: "allocation_network_error",
        cause: error,
      },
    );
  }

  try {
    if (response.status >= 500) {
      throw new FormalAllocationError(
        `Formal allocation server failed: ${response.status}.`,
        {
          kind: "allocation_server_error",
          status: response.status,
          code: await readErrorCode(response),
        },
      );
    }

    if (!response.ok) {
      throw new FormalAllocationError(
        `Formal allocation was rejected: ${response.status}.`,
        {
          kind: "non_retryable",
          status: response.status,
          code: await readErrorCode(response),
        },
      );
    }

    let value: unknown;
    try {
      value = await response.json();
    } catch (error) {
      if (controller.signal.aborted) {
        throw new FormalAllocationError(
          "Formal allocation timed out while reading the response.",
          {
            kind: "allocation_timeout",
            cause: error,
          },
        );
      }
      throw invalidResponse(
        "Formal allocation returned invalid JSON.",
        error,
      );
    }
    return parseBootstrapResponse(value, clientToken);
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

function parseBootstrapResponse(
  value: unknown,
  clientToken: string,
): BootstrapResponse {
  if (!isRecord(value)) {
    throw invalidResponse("Formal allocation response is not an object.");
  }

  const formatAssignment = value.format_assignment;
  const allocationMethod = value.allocation_method;
  const allocationStatus = value.allocation_status;
  const fallbackReason = value.fallback_reason_code;
  const fallbackReconciledAt = value.fallback_reconciled_at;

  if (
    !isNonEmptyString(value.participant_id) ||
    value.client_token !== clientToken ||
    !isStimulusFormat(formatAssignment) ||
    !isNonEmptyString(value.session_id) ||
    typeof value.is_returning !== "boolean" ||
    value.dataset_classification !== "formal" ||
    value.formal_collection_allowed !== true ||
    value.stimulus_set_version !== stimulusSetVersion ||
    value.catalog_hash !== catalogHash ||
    !isNonEmptyString(value.allocation_id) ||
    value.randomization_version !== RANDOMIZATION_VERSION ||
    !isAllocationMethod(allocationMethod) ||
    allocationStatus !== "confirmed" ||
    !isNonEmptyString(value.assigned_at)
  ) {
    throw invalidResponse(
      "Formal allocation response failed schema validation.",
    );
  }

  if (
    allocationMethod === "variable_block" &&
    (fallbackReason !== null || fallbackReconciledAt !== null)
  ) {
    throw invalidResponse(
      "A variable-block allocation included fallback metadata.",
    );
  }

  if (
    allocationMethod === "client_fallback" &&
    (!isFallbackReasonCode(fallbackReason) ||
      !isNonEmptyString(fallbackReconciledAt))
  ) {
    throw invalidResponse(
      "A reconciled fallback allocation omitted audit metadata.",
    );
  }

  return {
    participant_id: value.participant_id,
    client_token: value.client_token,
    format_assignment: formatAssignment,
    session_id: value.session_id,
    is_returning: value.is_returning,
    dataset_classification: "formal",
    formal_collection_allowed: true,
    stimulus_set_version: stimulusSetVersion,
    catalog_hash: catalogHash,
    allocation_id: value.allocation_id,
    randomization_version: RANDOMIZATION_VERSION,
    allocation_method: allocationMethod,
    allocation_status: "confirmed",
    assigned_at: value.assigned_at,
    fallback_reason_code:
      allocationMethod === "client_fallback"
        ? (fallbackReason as FallbackReasonCode)
        : null,
    fallback_reconciled_at:
      allocationMethod === "client_fallback"
        ? (fallbackReconciledAt as string)
        : null,
  };
}

function buildReconcileRequest(
  stored: StoredFormalAssignment,
  sessionId: string,
): Record<string, unknown> {
  return {
    client_token: stored.client_token,
    catalog_hash: catalogHash,
    stimulus_set_version: stimulusSetVersion,
    allocation_id: stored.allocation_id,
    participant_id: stored.participant_id,
    session_id: sessionId,
    format_assignment: stored.format_assignment,
    assigned_at: stored.assigned_at,
    fallback_reason_code: stored.fallback_reason_code,
  };
}

function bootstrapFromStoredAssignment(
  stored: StoredFormalAssignment,
  sessionId: string,
  isReturning: boolean,
): BootstrapResponse {
  return {
    participant_id: stored.participant_id,
    client_token: stored.client_token,
    format_assignment: stored.format_assignment,
    session_id: sessionId,
    is_returning: isReturning,
    dataset_classification: "formal",
    formal_collection_allowed: true,
    stimulus_set_version: stimulusSetVersion,
    catalog_hash: catalogHash,
    allocation_id: stored.allocation_id,
    randomization_version: stored.randomization_version,
    allocation_method: stored.allocation_method,
    allocation_status: stored.allocation_status,
    assigned_at: stored.assigned_at,
    fallback_reason_code: stored.fallback_reason_code,
    fallback_reconciled_at: stored.fallback_reconciled_at,
  };
}

function readStoredAssignment(
  clientToken: string,
  storageOverride: AllocationStorage | null | undefined,
): StoredFormalAssignment | null {
  const storage = resolveStorage(storageOverride);
  if (!storage) {
    return null;
  }

  let raw: string | null;
  try {
    raw = storage.getItem(FORMAL_ASSIGNMENT_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) {
    return null;
  }

  try {
    const value: unknown = JSON.parse(raw);
    if (!isStoredAssignment(value, clientToken)) {
      storage.removeItem(FORMAL_ASSIGNMENT_STORAGE_KEY);
      return null;
    }
    return value;
  } catch {
    try {
      storage.removeItem(FORMAL_ASSIGNMENT_STORAGE_KEY);
    } catch {
      // Ignore inaccessible local storage.
    }
    return null;
  }
}

function saveStoredAssignment(
  assignment: BootstrapResponse,
  storageOverride: AllocationStorage | null | undefined,
): void {
  if (
    !assignment.allocation_id ||
    !assignment.randomization_version ||
    !assignment.allocation_method ||
    !assignment.allocation_status ||
    !assignment.assigned_at
  ) {
    return;
  }

  const storage = resolveStorage(storageOverride);
  if (!storage) {
    return;
  }

  const stored: StoredFormalAssignment = {
    schema_version: 1,
    client_token: assignment.client_token,
    participant_id: assignment.participant_id,
    format_assignment: assignment.format_assignment,
    allocation_id: assignment.allocation_id,
    randomization_version: assignment.randomization_version,
    allocation_method: assignment.allocation_method,
    allocation_status: assignment.allocation_status,
    assigned_at: assignment.assigned_at,
    fallback_reason_code: assignment.fallback_reason_code,
    fallback_reconciled_at: assignment.fallback_reconciled_at,
    stimulus_set_version: stimulusSetVersion,
    catalog_hash: catalogHash,
  };

  try {
    storage.setItem(
      FORMAL_ASSIGNMENT_STORAGE_KEY,
      JSON.stringify(stored),
    );
  } catch {
    // The active page can still finish even when persistence is unavailable.
  }
}

function isStoredAssignment(
  value: unknown,
  clientToken: string,
): value is StoredFormalAssignment {
  if (!isRecord(value)) {
    return false;
  }

  const method = value.allocation_method;
  const status = value.allocation_status;
  return (
    value.schema_version === 1 &&
    value.client_token === clientToken &&
    isNonEmptyString(value.participant_id) &&
    isStimulusFormat(value.format_assignment) &&
    isNonEmptyString(value.allocation_id) &&
    value.randomization_version === RANDOMIZATION_VERSION &&
    isAllocationMethod(method) &&
    isAllocationStatus(status) &&
    isNonEmptyString(value.assigned_at) &&
    value.stimulus_set_version === stimulusSetVersion &&
    value.catalog_hash === catalogHash &&
    (method === "variable_block"
      ? status === "confirmed" &&
        value.fallback_reason_code === null &&
        value.fallback_reconciled_at === null
      : isFallbackReasonCode(value.fallback_reason_code) &&
        (status === "unreconciled"
          ? value.fallback_reconciled_at === null
          : isNonEmptyString(value.fallback_reconciled_at)))
  );
}

function assertSameAssignment(
  stored: StoredFormalAssignment,
  response: BootstrapResponse,
): void {
  if (
    stored.participant_id !== response.participant_id ||
    stored.format_assignment !== response.format_assignment ||
    stored.allocation_id !== response.allocation_id ||
    stored.allocation_method !== response.allocation_method ||
    stored.assigned_at !== response.assigned_at
  ) {
    throw invalidResponse(
      "The server attempted to change an existing formal assignment.",
    );
  }
}

function assertResponseSession(
  requestedSessionId: string,
  response: BootstrapResponse,
): void {
  if (response.session_id !== requestedSessionId) {
    throw invalidResponse(
      "The server returned a different session identifier.",
    );
  }
}

function resolveStorage(
  override: AllocationStorage | null | undefined,
): AllocationStorage | null {
  if (override !== undefined) {
    return override;
  }
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function resolveCrypto(
  dependencies: FormalAllocationDependencies,
): AllocationCrypto {
  const cryptoImplementation =
    dependencies.cryptoImplementation ?? globalThis.crypto;
  if (
    !cryptoImplementation ||
    typeof cryptoImplementation.getRandomValues !== "function"
  ) {
    throw new FormalAllocationError(
      "Web Crypto is unavailable for local fallback.",
      { kind: "non_retryable" },
    );
  }
  return cryptoImplementation;
}

function secureIdentifier(
  prefix: string,
  cryptoImplementation: AllocationCrypto,
): string {
  if (typeof cryptoImplementation.randomUUID === "function") {
    return `${prefix}-${cryptoImplementation.randomUUID()}`;
  }

  const bytes = new Uint8Array(16);
  cryptoImplementation.getRandomValues(bytes);
  const value = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${prefix}-${value}`;
}

async function readErrorCode(response: Response): Promise<string | null> {
  try {
    const value: unknown = await response.json();
    if (
      isRecord(value) &&
      isRecord(value.error) &&
      typeof value.error.code === "string"
    ) {
      return value.error.code;
    }
  } catch {
    // The HTTP status remains authoritative when no JSON error is available.
  }
  return null;
}

function asAllocationError(error: unknown): FormalAllocationError {
  return error instanceof FormalAllocationError
    ? error
    : new FormalAllocationError("Unexpected formal allocation failure.", {
        kind: "non_retryable",
        cause: error,
      });
}

function invalidResponse(
  message: string,
  cause?: unknown,
): FormalAllocationError {
  return new FormalAllocationError(message, {
    kind: "invalid_response",
    cause,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isStimulusFormat(value: unknown): value is StimulusFormat {
  return value === "table" || value === "graph" || value === "video";
}

function isAllocationMethod(value: unknown): value is AllocationMethod {
  return value === "variable_block" || value === "client_fallback";
}

function isAllocationStatus(value: unknown): value is AllocationStatus {
  return value === "confirmed" || value === "unreconciled";
}

function isFallbackReasonCode(
  value: unknown,
): value is FallbackReasonCode {
  return (
    value === "allocation_timeout" ||
    value === "allocation_network_error" ||
    value === "allocation_server_error"
  );
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, milliseconds);
  });
}
