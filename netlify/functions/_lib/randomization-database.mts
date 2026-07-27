import { getDatabase } from "@netlify/database";
import {
  collectionClosed,
  invalidRequest,
  scheduleMismatch,
  scheduleExhausted,
} from "./randomization-errors.mts";
import type {
  AllocateRepositoryInput,
  AllocationRecord,
  AllocationResult,
  RandomizationRepository,
  ReconcileRepositoryInput,
} from "./randomization-types.mts";

type DatabaseClient = {
  query: (text: string, values?: unknown[]) => Promise<{
    rows: Record<string, unknown>[];
    rowCount: number | null;
  }>;
  release: () => void;
};

function timestamp(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  const parsed = Date.parse(String(value));
  if (!Number.isFinite(parsed)) {
    throw new Error("Database returned an invalid timestamp.");
  }
  return new Date(parsed).toISOString();
}

function allocationRecord(
  row: Record<string, unknown>,
  sessionId: string,
): AllocationRecord {
  return {
    allocationId: String(row.allocation_id),
    participantId: String(row.participant_id),
    sessionId,
    formatAssignment: row.format_assignment as AllocationRecord["formatAssignment"],
    allocationMethod: row.allocation_method as AllocationRecord["allocationMethod"],
    allocationStatus: "confirmed",
    assignedAt: timestamp(row.assigned_at),
    fallbackReasonCode:
      (row.fallback_reason_code as AllocationRecord["fallbackReasonCode"])
      ?? null,
    fallbackReconciledAt: row.fallback_reconciled_at
      ? timestamp(row.fallback_reconciled_at)
      : null,
  };
}

async function recordSession(
  client: DatabaseClient,
  sessionId: string,
  allocationId: string,
  openedAt: string,
  source: "allocate" | "reconcile",
): Promise<boolean> {
  const existingResult = await client.query(
    `SELECT allocation_id
       FROM mmq_randomization_sessions
      WHERE session_id = $1`,
    [sessionId],
  );
  if (existingResult.rows[0]) {
    if (existingResult.rows[0].allocation_id !== allocationId) {
      throw invalidRequest(
        "The session identifier is already associated with another allocation.",
      );
    }
    return false;
  }
  await client.query(
    `INSERT INTO mmq_randomization_sessions (
       session_id,
       allocation_id,
       opened_at,
       source
     ) VALUES ($1, $2, $3::timestamptz, $4)`,
    [sessionId, allocationId, openedAt, source],
  );
  return true;
}

async function beginTransaction(pool: ReturnType<typeof getDatabase>["pool"]) {
  const client = await pool.connect() as unknown as DatabaseClient;
  await client.query("BEGIN");
  return client;
}

async function rollbackQuietly(client: DatabaseClient) {
  try {
    await client.query("ROLLBACK");
  } catch {
    // The original database error is more useful than a rollback error.
  }
}

async function activeSchedule(
  client: DatabaseClient,
  randomizationVersion: string,
  scheduleSha256: string,
) {
  const result = await client.query(
    `SELECT randomization_version, schedule_sha256, status
       FROM mmq_randomization_schedules
      WHERE randomization_version = $1`,
    [randomizationVersion],
  );
  const schedule = result.rows[0];
  if (!schedule) {
    throw collectionClosed();
  }
  if (schedule.schedule_sha256 !== scheduleSha256) {
    throw scheduleMismatch();
  }
  return schedule;
}

async function returningAssignment(
  client: DatabaseClient,
  randomizationVersion: string,
  tokenHmacValue: string,
): Promise<Record<string, unknown> | null> {
  const result = await client.query(
    `SELECT *
       FROM mmq_randomization_assignments
      WHERE randomization_version = $1
        AND token_hmac = $2
      ORDER BY CASE allocation_method
        WHEN 'client_fallback' THEN 0
        ELSE 1
      END
      LIMIT 1
      FOR UPDATE`,
    [randomizationVersion, tokenHmacValue],
  );
  return result.rows[0] ?? null;
}

export class PostgresRandomizationRepository
implements RandomizationRepository {
  private readonly pool: ReturnType<typeof getDatabase>["pool"];

  constructor(pool = getDatabase().pool) {
    this.pool = pool;
  }

  async allocate(input: AllocateRepositoryInput): Promise<AllocationResult> {
    const client = await beginTransaction(this.pool);
    try {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`mmq-allocate:${input.randomizationVersion}`],
      );
      const schedule = await activeSchedule(
        client,
        input.randomizationVersion,
        input.scheduleSha256,
      );
      const returning = await returningAssignment(
        client,
        input.randomizationVersion,
        input.tokenHmac,
      );
      if (returning) {
        const isNewSession = await recordSession(
          client,
          input.sessionId,
          String(returning.allocation_id),
          input.now,
          "allocate",
        );
        const updatedResult = await client.query(
          `UPDATE mmq_randomization_assignments
              SET last_seen_at = $2::timestamptz,
                  visit_count = visit_count
                    + CASE WHEN $3::boolean THEN 1 ELSE 0 END
            WHERE allocation_id = $1
          RETURNING *`,
          [returning.allocation_id, input.now, isNewSession],
        );
        await client.query("COMMIT");
        return {
          record: allocationRecord(updatedResult.rows[0], input.sessionId),
          isReturning: true,
        };
      }
      if (schedule.status !== "active") {
        throw collectionClosed();
      }

      const slotResult = await client.query(
        `SELECT position, format_assignment
           FROM mmq_randomization_slots
          WHERE randomization_version = $1
            AND allocation_id IS NULL
          ORDER BY position
          LIMIT 1
          FOR UPDATE`,
        [input.randomizationVersion],
      );
      const slot = slotResult.rows[0];
      if (!slot) {
        throw scheduleExhausted();
      }

      const insertedResult = await client.query(
        `INSERT INTO mmq_randomization_assignments (
           allocation_id,
           randomization_version,
           schedule_position,
           token_hmac,
           participant_id,
           format_assignment,
           allocation_method,
           allocation_status,
           assigned_at,
           created_at,
           last_seen_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6,
           'variable_block', 'confirmed',
           $7::timestamptz, $7::timestamptz, $7::timestamptz
         )
         RETURNING *`,
        [
          input.allocationId,
          input.randomizationVersion,
          slot.position,
          input.tokenHmac,
          input.participantId,
          slot.format_assignment,
          input.now,
        ],
      );
      const slotUpdate = await client.query(
        `UPDATE mmq_randomization_slots
            SET allocation_id = $3,
                assigned_at = $4::timestamptz
          WHERE randomization_version = $1
            AND position = $2
            AND allocation_id IS NULL`,
        [
          input.randomizationVersion,
          slot.position,
          input.allocationId,
          input.now,
        ],
      );
      if (slotUpdate.rowCount !== 1) {
        throw new Error("The selected schedule slot was not updated.");
      }
      await recordSession(
        client,
        input.sessionId,
        input.allocationId,
        input.now,
        "allocate",
      );
      await client.query("COMMIT");
      return {
        record: allocationRecord(insertedResult.rows[0], input.sessionId),
        isReturning: false,
      };
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async reconcile(
    input: ReconcileRepositoryInput,
  ): Promise<AllocationResult> {
    const client = await beginTransaction(this.pool);
    try {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`mmq-reconcile:${input.randomizationVersion}:${input.tokenHmac}`],
      );
      await activeSchedule(
        client,
        input.randomizationVersion,
        input.scheduleSha256,
      );

      const existingResult = await client.query(
        `SELECT *
           FROM mmq_randomization_assignments
          WHERE randomization_version = $1
            AND token_hmac = $2
            AND allocation_method = 'client_fallback'
          LIMIT 1
          FOR UPDATE`,
        [input.randomizationVersion, input.tokenHmac],
      );
      const existing = existingResult.rows[0];
      if (existing) {
        const sameFallback =
          existing.allocation_id === input.allocationId
          && existing.participant_id === input.participantId
          && existing.format_assignment === input.formatAssignment
          && existing.fallback_reason_code === input.fallbackReasonCode;
        if (!sameFallback) {
          throw invalidRequest(
            "This browser token is already associated with different fallback metadata.",
          );
        }
        const isNewSession = await recordSession(
          client,
          input.sessionId,
          String(existing.allocation_id),
          input.reconciledAt,
          "reconcile",
        );
        const updatedResult = await client.query(
          `UPDATE mmq_randomization_assignments
              SET last_seen_at = $2::timestamptz,
                  visit_count = visit_count
                    + CASE WHEN $3::boolean THEN 1 ELSE 0 END
            WHERE allocation_id = $1
          RETURNING *`,
          [existing.allocation_id, input.reconciledAt, isNewSession],
        );
        await client.query("COMMIT");
        return {
          record: allocationRecord(updatedResult.rows[0], input.sessionId),
          isReturning: true,
        };
      }

      const scheduledResult = await client.query(
        `SELECT allocation_id
           FROM mmq_randomization_assignments
          WHERE randomization_version = $1
            AND token_hmac = $2
            AND allocation_method = 'variable_block'
          LIMIT 1`,
        [input.randomizationVersion, input.tokenHmac],
      );
      const supersedesAllocationId =
        scheduledResult.rows[0]?.allocation_id ?? null;
      const insertedResult = await client.query(
        `INSERT INTO mmq_randomization_assignments (
           allocation_id,
           randomization_version,
           schedule_position,
           token_hmac,
           participant_id,
           format_assignment,
           allocation_method,
           allocation_status,
           assigned_at,
           fallback_reason_code,
           fallback_reconciled_at,
           supersedes_allocation_id,
           created_at,
           last_seen_at
         ) VALUES (
           $1, $2, NULL, $3, $4, $5,
           'client_fallback', 'confirmed',
           $6::timestamptz, $7, $8::timestamptz, $9,
           $8::timestamptz, $8::timestamptz
         )
         RETURNING *`,
        [
          input.allocationId,
          input.randomizationVersion,
          input.tokenHmac,
          input.participantId,
          input.formatAssignment,
          input.assignedAt,
          input.fallbackReasonCode,
          input.reconciledAt,
          supersedesAllocationId,
        ],
      );
      await recordSession(
        client,
        input.sessionId,
        input.allocationId,
        input.reconciledAt,
        "reconcile",
      );
      await client.query("COMMIT");
      return {
        record: allocationRecord(insertedResult.rows[0], input.sessionId),
        isReturning: false,
      };
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }
}
