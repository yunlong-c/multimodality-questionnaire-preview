import { getDatabase } from "@netlify/database";
import {
  submissionConflict,
  submissionIdentityMismatch,
  submissionsClosed,
} from "./submission-errors.mts";
import type {
  StoreSubmissionInput,
  SubmissionReceipt,
  SubmissionRepository,
} from "./submission-types.mts";

type DatabaseClient = {
  query: (text: string, values?: unknown[]) => Promise<{
    rows: Record<string, unknown>[];
    rowCount: number | null;
  }>;
  release: () => void;
};

function timestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const milliseconds = Date.parse(String(value));
  if (!Number.isFinite(milliseconds)) {
    throw new Error("Database returned an invalid timestamp.");
  }
  return new Date(milliseconds).toISOString();
}

function nullableTimestamp(value: unknown): string | null {
  return value === null || value === undefined ? null : timestamp(value);
}

function receipt(
  row: Record<string, unknown>,
  isReplay: boolean,
): SubmissionReceipt {
  return {
    receiptId: String(row.receipt_id),
    sessionId: String(row.session_id),
    participantId: String(row.participant_id),
    datasetClassification:
      row.dataset_classification as SubmissionReceipt["datasetClassification"],
    payloadSha256: String(row.payload_sha256),
    storedAt: timestamp(row.stored_at),
    isReplay,
    mirrorStatus:
      (row.mirror_state as SubmissionReceipt["mirrorStatus"]) ?? "pending",
  };
}

async function beginTransaction(
  pool: ReturnType<typeof getDatabase>["pool"],
): Promise<DatabaseClient> {
  const client = await pool.connect() as unknown as DatabaseClient;
  await client.query("BEGIN");
  return client;
}

async function rollbackQuietly(client: DatabaseClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Preserve the original storage error.
  }
}

function sameTimestamp(left: string | null, right: unknown): boolean {
  return left === nullableTimestamp(right);
}

function assertExistingOwner(
  existing: Record<string, unknown>,
  input: StoreSubmissionInput,
): void {
  if (
    existing.client_token_hmac !== input.clientTokenHmac
    || existing.participant_id !== input.participantId
    || existing.dataset_classification !== input.datasetClassification
  ) {
    throw submissionIdentityMismatch(
      "The session is already owned by another questionnaire identity.",
    );
  }
}

function assertFormalAllocation(
  row: Record<string, unknown> | undefined,
  input: StoreSubmissionInput,
): void {
  if (!row) {
    throw submissionIdentityMismatch(
      "The formal session does not have a confirmed allocation.",
    );
  }
  if (
    row.session_allocation_id !== input.allocationId
    || row.allocation_id !== input.allocationId
    || row.randomization_version !== input.randomizationVersion
    || row.token_hmac !== input.clientTokenHmac
    || row.participant_id !== input.participantId
    || row.format_assignment !== input.formatAssignment
    || row.allocation_method !== input.allocationMethod
    || row.allocation_status !== "confirmed"
    || !sameTimestamp(input.assignedAt, row.assigned_at)
    || (row.fallback_reason_code ?? null) !== input.fallbackReasonCode
    || !sameTimestamp(
      input.fallbackReconciledAt,
      row.fallback_reconciled_at,
    )
  ) {
    throw submissionIdentityMismatch();
  }
}

export class PostgresSubmissionRepository
implements SubmissionRepository {
  private readonly pool: ReturnType<typeof getDatabase>["pool"];

  constructor(pool = getDatabase().pool) {
    this.pool = pool;
  }

  async store(input: StoreSubmissionInput): Promise<SubmissionReceipt> {
    const client = await beginTransaction(this.pool);
    let committed = false;
    try {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`mmq-submit:${input.sessionId}`],
      );
      const existingResult = await client.query(
        `SELECT
           submission.*,
           mirror.state AS mirror_state
         FROM mmq_submissions AS submission
         LEFT JOIN mmq_submission_form_mirrors AS mirror
           ON mirror.receipt_id = submission.receipt_id
        WHERE submission.session_id = $1
        FOR UPDATE OF submission`,
        [input.sessionId],
      );
      const existing = existingResult.rows[0];
      if (existing) {
        assertExistingOwner(existing, input);
        if (existing.payload_sha256 === input.payloadSha256) {
          await client.query("COMMIT");
          committed = true;
          return receipt(existing, true);
        }
        await client.query(
          `INSERT INTO mmq_submission_conflicts (
             conflict_id,
             session_id,
             existing_receipt_id,
             attempted_payload_sha256,
             received_at,
             trusted_client_ip,
             deploy_context,
             deploy_id,
             deploy_url,
             deploy_branch,
             deploy_commit_ref
           ) VALUES (
             $1, $2, $3, $4, NOW(),
             $5, $6, $7, $8, $9, $10
           )`,
          [
            input.conflictId,
            input.sessionId,
            existing.receipt_id,
            input.payloadSha256,
            input.deploy.trustedClientIp,
            input.deploy.deployContext,
            input.deploy.deployId,
            input.deploy.deployUrl,
            input.deploy.deployBranch,
            input.deploy.deployCommitRef,
          ],
        );
        await client.query("COMMIT");
        committed = true;
        throw submissionConflict();
      }

      if (!input.submissionsOpen) {
        throw submissionsClosed();
      }

      if (input.datasetClassification === "formal") {
        const allocationResult = await client.query(
          `SELECT
             session.allocation_id AS session_allocation_id,
             assignment.*
           FROM mmq_randomization_sessions AS session
           JOIN mmq_randomization_assignments AS assignment
             ON assignment.allocation_id = session.allocation_id
          WHERE session.session_id = $1
          FOR UPDATE OF session, assignment`,
          [input.sessionId],
        );
        assertFormalAllocation(allocationResult.rows[0], input);
      }

      const insertedResult = await client.query(
        `INSERT INTO mmq_submissions (
           receipt_id,
           session_id,
           participant_id,
           dataset_classification,
           client_token_hmac,
           allocation_id,
           randomization_version,
           allocation_method,
           allocation_status,
           assigned_at,
           fallback_reason_code,
           fallback_reconciled_at,
           format_assignment,
           stimulus_set_version,
           catalog_hash,
           payload_sha256,
           payload_json,
           client_attempt_count,
           previous_attempt_latency_ms,
           submitted_at,
           stored_at,
           trusted_client_ip,
           deploy_context,
           deploy_id,
           deploy_url,
           deploy_branch,
           deploy_commit_ref
         ) VALUES (
           $1, $2, $3, $4, $5,
           $6, $7, $8, $9, $10::timestamptz,
           $11, $12::timestamptz, $13, $14,
           $15, $16, $17, $18, $19,
           $20::timestamptz, NOW(), $21, $22,
           $23, $24, $25, $26
         )
         RETURNING *`,
        [
          input.receiptId,
          input.sessionId,
          input.participantId,
          input.datasetClassification,
          input.clientTokenHmac,
          input.allocationId,
          input.randomizationVersion,
          input.allocationMethod,
          input.allocationStatus,
          input.assignedAt,
          input.fallbackReasonCode,
          input.fallbackReconciledAt,
          input.formatAssignment,
          input.stimulusSetVersion,
          input.catalogHash,
          input.payloadSha256,
          input.payloadJson,
          input.clientAttemptCount,
          input.previousAttemptLatencyMs,
          input.submittedAt,
          input.deploy.trustedClientIp,
          input.deploy.deployContext,
          input.deploy.deployId,
          input.deploy.deployUrl,
          input.deploy.deployBranch,
          input.deploy.deployCommitRef,
        ],
      );
      await client.query(
        `INSERT INTO mmq_submission_form_mirrors (
           mirror_id,
           receipt_id,
           form_name,
           state,
           next_attempt_at,
           created_at,
           updated_at
         ) VALUES (
           $1, $2, $3, 'pending', NOW(), NOW(), NOW()
         )`,
        [
          input.mirrorId,
          input.receiptId,
          input.datasetClassification === "formal"
            ? "mmq-submission-v2-formal"
            : "mmq-submission-v2-test",
        ],
      );
      await client.query("COMMIT");
      committed = true;
      return receipt(
        {
          ...insertedResult.rows[0],
          mirror_state: "pending",
        },
        false,
      );
    } catch (error) {
      if (!committed) await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }
}
