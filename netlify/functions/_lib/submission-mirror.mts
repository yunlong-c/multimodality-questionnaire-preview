import { getDatabase } from "@netlify/database";
import type {
  SubmissionMirrorRow,
} from "./submission-types.mts";

type DatabasePool = ReturnType<typeof getDatabase>["pool"];
type DatabaseClient = {
  query: (text: string, values?: unknown[]) => Promise<{
    rows: Record<string, unknown>[];
    rowCount: number | null;
  }>;
  release: () => void;
};

const MIRROR_TIMEOUT_MS = 10_000;
const MIRROR_ERROR_LIMIT = 1_000;

function timestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const milliseconds = Date.parse(String(value));
  if (!Number.isFinite(milliseconds)) {
    throw new Error("Database returned an invalid mirror timestamp.");
  }
  return new Date(milliseconds).toISOString();
}

function nullableTimestamp(value: unknown): string | null {
  return value === null || value === undefined ? null : timestamp(value);
}

function mirrorRow(
  row: Record<string, unknown>,
  attemptCount: number,
): SubmissionMirrorRow {
  return {
    mirrorId: String(row.mirror_id),
    receiptId: String(row.receipt_id),
    formName: String(row.form_name),
    attemptCount,
    payloadJson: String(row.payload_json),
    payloadSha256: String(row.payload_sha256),
    sessionId: String(row.session_id),
    participantId: String(row.participant_id),
    datasetClassification:
      row.dataset_classification as SubmissionMirrorRow["datasetClassification"],
    formatAssignment:
      row.format_assignment as SubmissionMirrorRow["formatAssignment"],
    stimulusSetVersion: String(row.stimulus_set_version),
    catalogHash: String(row.catalog_hash),
    submittedAt: timestamp(row.submitted_at),
    allocationId:
      row.allocation_id === null ? null : String(row.allocation_id),
    randomizationVersion:
      row.randomization_version === null
        ? null
        : String(row.randomization_version),
    allocationMethod:
      row.allocation_method as SubmissionMirrorRow["allocationMethod"],
    allocationStatus:
      row.allocation_status as SubmissionMirrorRow["allocationStatus"],
    assignedAt: nullableTimestamp(row.assigned_at),
    fallbackReasonCode:
      row.fallback_reason_code as SubmissionMirrorRow["fallbackReasonCode"],
    fallbackReconciledAt:
      nullableTimestamp(row.fallback_reconciled_at),
    clientAttemptCount: Number(row.client_attempt_count),
    previousAttemptLatencyMs:
      row.previous_attempt_latency_ms === null
        ? null
        : Number(row.previous_attempt_latency_ms),
  };
}

async function rollbackQuietly(client: DatabaseClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Preserve the original mirror error.
  }
}

async function claimMirrors(
  pool: DatabasePool,
  limit: number,
  receiptId: string | null,
): Promise<SubmissionMirrorRow[]> {
  const client = await pool.connect() as unknown as DatabaseClient;
  await client.query("BEGIN");
  try {
    const result = await client.query(
      `SELECT mirror.*, submission.*
         FROM mmq_submission_form_mirrors AS mirror
         JOIN mmq_submissions AS submission
           ON submission.receipt_id = mirror.receipt_id
        WHERE mirror.state <> 'accepted'
          AND (
            (
              mirror.state IN ('pending', 'failed')
              AND mirror.next_attempt_at <= NOW()
            )
            OR
            (
              mirror.state = 'processing'
              AND mirror.lease_expires_at <= NOW()
            )
          )
          AND ($1::text IS NULL OR mirror.receipt_id = $1)
        ORDER BY mirror.created_at
        LIMIT $2
        FOR UPDATE OF mirror SKIP LOCKED`,
      [receiptId, limit],
    );
    const claimed: SubmissionMirrorRow[] = [];
    for (const row of result.rows) {
      const nextAttemptCount = Number(row.attempt_count) + 1;
      await client.query(
        `UPDATE mmq_submission_form_mirrors
            SET state = 'processing',
                attempt_count = $2,
                last_attempt_at = NOW(),
                lease_expires_at = NOW() + INTERVAL '2 minutes',
                updated_at = NOW()
          WHERE mirror_id = $1`,
        [row.mirror_id, nextAttemptCount],
      );
      claimed.push(mirrorRow(row, nextAttemptCount));
    }
    await client.query("COMMIT");
    return claimed;
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }
}

export function submissionMirrorEndpoint(
  endpointUrl?: string,
): URL {
  const raw =
    endpointUrl?.trim()
    || process.env.MMQ_FORMS_ENDPOINT?.trim()
    || process.env.DEPLOY_PRIME_URL?.trim()
    || process.env.URL?.trim();
  if (!raw) {
    throw new Error(
      "A request origin or MMQ_FORMS_ENDPOINT is required for "
      + "Netlify Forms mirroring.",
    );
  }
  const url = new URL("/", raw);
  if (url.protocol !== "https:") {
    throw new Error("The Netlify Forms mirror endpoint must use HTTPS.");
  }
  return url;
}

export function buildSubmissionMirrorFormBody(
  row: SubmissionMirrorRow,
): URLSearchParams {
  return new URLSearchParams({
    "form-name": row.formName,
    receipt_id: row.receiptId,
    submission_authority: "netlify_database",
    session_id: row.sessionId,
    participant_id: row.participantId,
    format_assignment: row.formatAssignment,
    dataset_classification: row.datasetClassification,
    stimulus_set_version: row.stimulusSetVersion,
    catalog_hash: row.catalogHash,
    submitted_at: row.submittedAt,
    payload_sha256: row.payloadSha256,
    payload_json: row.payloadJson,
    allocation_id: row.allocationId ?? "",
    randomization_version: row.randomizationVersion ?? "",
    allocation_method: row.allocationMethod ?? "",
    allocation_status: row.allocationStatus ?? "",
    assigned_at: row.assignedAt ?? "",
    fallback_reason_code: row.fallbackReasonCode ?? "",
    fallback_reconciled_at: row.fallbackReconciledAt ?? "",
    submit_attempt_count: String(row.clientAttemptCount),
    submit_latency_ms:
      row.previousAttemptLatencyMs === null
        ? ""
        : String(row.previousAttemptLatencyMs),
    submit_latency_scope: "previous_completed_attempt",
  });
}

async function postMirror(
  row: SubmissionMirrorRow,
  fetchImplementation: typeof fetch,
  endpointUrl?: string,
): Promise<number> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(
    () => controller.abort(),
    MIRROR_TIMEOUT_MS,
  );
  try {
    const response = await fetchImplementation(
      submissionMirrorEndpoint(endpointUrl),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        body: buildSubmissionMirrorFormBody(row).toString(),
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      throw Object.assign(
        new Error(`Netlify Forms returned HTTP ${response.status}.`),
        { httpStatus: response.status },
      );
    }
    return response.status;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

export function mirrorRetryDelayMinutes(attemptCount: number): number {
  return Math.min(24 * 60, 15 * (2 ** Math.min(7, attemptCount - 1)));
}

async function markAccepted(
  pool: DatabasePool,
  row: SubmissionMirrorRow,
  httpStatus: number,
): Promise<void> {
  await pool.query(
    `UPDATE mmq_submission_form_mirrors
        SET state = 'accepted',
            accepted_at = NOW(),
            lease_expires_at = NULL,
            last_http_status = $2,
            last_error = NULL,
            updated_at = NOW()
      WHERE mirror_id = $1
        AND state = 'processing'
        AND attempt_count = $3`,
    [row.mirrorId, httpStatus, row.attemptCount],
  );
}

async function markFailed(
  pool: DatabasePool,
  row: SubmissionMirrorRow,
  error: unknown,
): Promise<void> {
  const status =
    typeof error === "object"
    && error !== null
    && "httpStatus" in error
    && Number.isInteger((error as { httpStatus?: unknown }).httpStatus)
      ? Number((error as { httpStatus: number }).httpStatus)
      : null;
  const message = (
    error instanceof Error ? error.message : String(error)
  ).slice(0, MIRROR_ERROR_LIMIT);
  await pool.query(
    `UPDATE mmq_submission_form_mirrors
        SET state = 'failed',
            next_attempt_at =
              NOW() + ($2::text || ' minutes')::interval,
            lease_expires_at = NULL,
            last_http_status = $3,
            last_error = $4,
            updated_at = NOW()
      WHERE mirror_id = $1
        AND state = 'processing'
        AND attempt_count = $5`,
    [
      row.mirrorId,
      mirrorRetryDelayMinutes(row.attemptCount),
      status,
      message,
      row.attemptCount,
    ],
  );
}

export interface ProcessMirrorOptions {
  pool?: DatabasePool;
  fetchImplementation?: typeof fetch;
  endpointUrl?: string;
  limit?: number;
  receiptId?: string | null;
}

export async function processSubmissionMirrors({
  pool = getDatabase().pool,
  fetchImplementation = fetch,
  endpointUrl,
  limit = 50,
  receiptId = null,
}: ProcessMirrorOptions = {}): Promise<{
  claimed: number;
  accepted: number;
  failed: number;
}> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("Mirror batch limit must be an integer from 1 to 100.");
  }
  const rows = await claimMirrors(pool, limit, receiptId);
  let accepted = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const status = await postMirror(
        row,
        fetchImplementation,
        endpointUrl,
      );
      await markAccepted(pool, row, status);
      accepted += 1;
    } catch (error) {
      await markFailed(pool, row, error);
      failed += 1;
    }
  }
  return { claimed: rows.length, accepted, failed };
}

export async function processSubmissionMirrorReceipt(
  receiptId: string,
  endpointUrl?: string,
): Promise<void> {
  await processSubmissionMirrors({
    receiptId,
    endpointUrl,
    limit: 1,
  });
}
