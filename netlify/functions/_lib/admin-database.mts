import { randomUUID } from "node:crypto";
import { getDatabase } from "@netlify/database";
import { trialCsvHeaders } from "../../../frontend/src/experiment/experimentTypes.ts";
import randomizationMetadata from "../../randomization/public-schedule-metadata.json" with {
  type: "json",
};

export type AdminExportScope = "formal" | "all";
export type AdminExportFormat =
  | "json"
  | "participants.csv"
  | "trials.csv"
  | "mirrors.csv"
  | "conflicts.csv";

export interface DeploymentMetadata {
  trustedClientIp: string | null;
  deployContext: string | null;
  deployId: string | null;
  deployUrl: string | null;
  branch: string | null;
  commitRef: string | null;
}

export interface AdminStats {
  submissions: {
    formal: number;
    test: number;
    total: number;
  };
  formal_formats: {
    table: number;
    graph: number;
    video: number;
  };
  latest_stored_at: string | null;
  mirrors: {
    pending: number;
    failed: number;
    accepted: number;
  };
  conflicts: number;
  randomization: {
    enabled: boolean;
    status:
      | "active"
      | "paused"
      | "exhausted"
      | "not_configured";
    assigned: {
      table: number;
      graph: number;
      video: number;
      total: number;
    };
    client_fallback: {
      count: number;
      rate: number;
    };
    remaining_schedule_slots: number;
  };
}

export interface AdminExportPage {
  format: AdminExportFormat;
  scope: AdminExportScope;
  snapshot_at: string;
  offset: number;
  next_offset: number | null;
  total_rows: number;
  headers: string[];
  rows: Record<string, unknown>[];
}

export interface AdminRepository {
  consumeLoginAttempt(trustedClientIp: string): Promise<boolean>;
  stats(): Promise<AdminStats>;
  exportPage(input: {
    format: AdminExportFormat;
    scope: AdminExportScope;
    snapshotAt: string;
    offset: number;
    limit: number;
  }): Promise<AdminExportPage>;
  recordAudit(input: {
    eventType:
      | "login_success"
      | "login_failure"
      | "logout"
      | "export";
    deployment: DeploymentMetadata;
    exportId?: string;
    exportScope?: AdminExportScope;
    exportFormat?: AdminExportFormat;
    exportRowCount?: number;
  }): Promise<void>;
}

type QueryResult = {
  rows: Record<string, unknown>[];
  rowCount: number | null;
};

type PoolLike = {
  query: (
    text: string,
    values?: unknown[],
  ) => Promise<QueryResult>;
};

const PARTICIPANT_HEADERS = [
  "receipt_id",
  "session_id",
  "participant_id",
  "dataset_classification",
  "video_playback_classification",
  "format_assignment",
  "allocation_id",
  "randomization_version",
  "allocation_method",
  "allocation_status",
  "assigned_at",
  "fallback_reason_code",
  "fallback_reconciled_at",
  "stimulus_set_version",
  "catalog_hash",
  "payload_sha256",
  "client_attempt_count",
  "previous_attempt_latency_ms",
  "submitted_at",
  "stored_at",
  "trusted_client_ip",
  "deploy_context",
  "deploy_id",
  "deploy_url",
  "branch",
  "commit_ref",
  "formal_collection_allowed",
  "started_at",
  "duration_ms",
  "demographics_gender",
  "demographics_age",
  "demographics_education",
  "demographics_experience",
  "demographics_stat_course",
  "demographics_started_at",
  "demographics_submitted_at",
  "demographics_duration_ms",
] as const;

const TRIAL_HEADERS = [
  "receipt_id",
  "participant_id",
  "payload_sha256",
  "stored_at",
  "video_playback_classification",
  "allocation_id",
  "randomization_version",
  "allocation_method",
  "allocation_status",
  "assigned_at",
  "fallback_reason_code",
  "fallback_reconciled_at",
  ...trialCsvHeaders,
] as const;

const VIDEO_PLAYBACK_FIELDS = [
  "video_playback_version",
  "playback_asset_path",
  "playback_asset_sha256",
  "video_replay_used",
  "video_replay_completed",
  "video_initial_restart_count",
] as const;
const VIDEO_PLAYBACK_VERSION = "single-play-gif-v1";

const MIRROR_HEADERS = [
  "mirror_id",
  "receipt_id",
  "session_id",
  "participant_id",
  "dataset_classification",
  "form_name",
  "state",
  "attempt_count",
  "next_attempt_at",
  "last_attempt_at",
  "accepted_at",
  "last_http_status",
  "last_error",
] as const;

const CONFLICT_HEADERS = [
  "conflict_id",
  "session_id",
  "existing_receipt_id",
  "participant_id",
  "dataset_classification",
  "existing_payload_sha256",
  "attempted_payload_sha256",
  "received_at",
  "trusted_client_ip",
  "deploy_context",
  "deploy_id",
  "deploy_url",
  "branch",
  "commit_ref",
] as const;

function numeric(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function timestamp(value: unknown): string | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed)
    ? new Date(parsed).toISOString()
    : String(value);
}

function parsePayload(value: unknown): {
  session: Record<string, unknown>;
  demographics: Record<string, unknown>;
  trials: Record<string, unknown>[];
} {
  const parsed =
    typeof value === "string" ? JSON.parse(value) : value;
  if (
    !parsed
    || typeof parsed !== "object"
    || Array.isArray(parsed)
  ) {
    throw new Error("A stored submission payload is not an object.");
  }
  const record = parsed as Record<string, unknown>;
  const session =
    record.session
    && typeof record.session === "object"
    && !Array.isArray(record.session)
      ? record.session as Record<string, unknown>
      : null;
  const demographics =
    record.demographics
    && typeof record.demographics === "object"
    && !Array.isArray(record.demographics)
      ? record.demographics as Record<string, unknown>
      : null;
  const trials = Array.isArray(record.trials)
    ? record.trials.filter(
        (trial): trial is Record<string, unknown> =>
          Boolean(
            trial
            && typeof trial === "object"
            && !Array.isArray(trial),
          ),
      )
    : [];
  if (!session || !demographics || trials.length !== 5) {
    throw new Error(
      "A stored submission payload is missing its session, demographics, or five trials.",
    );
  }
  return { session, demographics, trials };
}

function videoPlaybackClassification(
  trials: Record<string, unknown>[],
): "single-play-gif-v1" | "pre-single-play" {
  const schemas = new Set<
    "single-play-gif-v1" | "pre-single-play"
  >(
    trials.map((trial) => {
      const present = VIDEO_PLAYBACK_FIELDS.filter((field) =>
        Object.prototype.hasOwnProperty.call(trial, field)
      );
      if (present.length === 0) return "pre-single-play";
      if (present.length === VIDEO_PLAYBACK_FIELDS.length) {
        return VIDEO_PLAYBACK_VERSION;
      }
      throw new Error(
        "A stored submission has a partial Video playback schema.",
      );
    }),
  );
  if (schemas.size !== 1) {
    throw new Error(
      "A stored submission mixes Video playback schema versions.",
    );
  }
  return schemas.values().next().value!;
}

function submissionMetadata(
  row: Record<string, unknown>,
): Record<string, unknown> {
  return {
    receipt_id: row.receipt_id,
    session_id: row.session_id,
    participant_id: row.participant_id,
    dataset_classification: row.dataset_classification,
    format_assignment: row.format_assignment,
    allocation_id: row.allocation_id,
    randomization_version: row.randomization_version,
    allocation_method: row.allocation_method,
    allocation_status: row.allocation_status,
    assigned_at: timestamp(row.assigned_at),
    fallback_reason_code: row.fallback_reason_code,
    fallback_reconciled_at: timestamp(
      row.fallback_reconciled_at,
    ),
    stimulus_set_version: row.stimulus_set_version,
    catalog_hash: row.catalog_hash,
    payload_sha256: row.payload_sha256,
    client_attempt_count: row.client_attempt_count,
    previous_attempt_latency_ms:
      row.previous_attempt_latency_ms,
    submitted_at: timestamp(row.submitted_at),
    stored_at: timestamp(row.stored_at),
    trusted_client_ip: row.trusted_client_ip,
    deploy_context: row.deploy_context,
    deploy_id: row.deploy_id,
    deploy_url: row.deploy_url,
    branch: row.branch,
    commit_ref: row.commit_ref,
  };
}

function participantRow(
  row: Record<string, unknown>,
): Record<string, unknown> {
  const payload = parsePayload(row.payload_json);
  return {
    ...payload.session,
    ...Object.fromEntries(
      Object.entries(payload.demographics).map(([key, value]) => [
        `demographics_${key}`,
        value,
      ]),
    ),
    video_playback_classification:
      videoPlaybackClassification(payload.trials),
    ...submissionMetadata(row),
  };
}

function trialRows(
  row: Record<string, unknown>,
): Record<string, unknown>[] {
  const payload = parsePayload(row.payload_json);
  const metadata = submissionMetadata(row);
  const playbackClassification =
    videoPlaybackClassification(payload.trials);
  return payload.trials.map((trial) => ({
    ...trial,
    ...Object.fromEntries(
      VIDEO_PLAYBACK_FIELDS.map((field) => [
        field,
        Object.prototype.hasOwnProperty.call(trial, field)
          ? trial[field]
          : "",
      ]),
    ),
    video_playback_classification: playbackClassification,
    receipt_id: metadata.receipt_id,
    participant_id: metadata.participant_id,
    payload_sha256: metadata.payload_sha256,
    stored_at: metadata.stored_at,
    allocation_id: metadata.allocation_id,
    randomization_version: metadata.randomization_version,
    allocation_method: metadata.allocation_method,
    allocation_status: metadata.allocation_status,
    assigned_at: metadata.assigned_at,
    fallback_reason_code: metadata.fallback_reason_code,
    fallback_reconciled_at:
      metadata.fallback_reconciled_at,
  }));
}

function jsonRow(
  row: Record<string, unknown>,
): Record<string, unknown> {
  const payload = parsePayload(row.payload_json);
  return {
    ...submissionMetadata(row),
    video_playback_classification:
      videoPlaybackClassification(payload.trials),
    payload,
  };
}

function scopeClause(scope: AdminExportScope): string {
  return scope === "formal"
    ? "AND s.dataset_classification = 'formal'"
    : "";
}

function normalizeDatabaseRow(
  row: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      value instanceof Date ? value.toISOString() : value,
    ]),
  );
}

export class PostgresAdminRepository implements AdminRepository {
  private readonly pool: PoolLike;

  constructor(
    pool = getDatabase().pool as unknown as PoolLike,
  ) {
    this.pool = pool;
  }

  async consumeLoginAttempt(
    trustedClientIp: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `INSERT INTO mmq_admin_login_throttle (
         trusted_client_ip,
         window_started_at,
         attempt_count,
         blocked_until,
         updated_at
       ) VALUES (
         $1::inet, NOW(), 1, NULL, NOW()
       )
       ON CONFLICT (trusted_client_ip)
       DO UPDATE SET
         window_started_at = CASE
           WHEN mmq_admin_login_throttle.window_started_at
                  <= NOW() - INTERVAL '15 minutes'
             THEN NOW()
           ELSE mmq_admin_login_throttle.window_started_at
         END,
         attempt_count = CASE
           WHEN mmq_admin_login_throttle.window_started_at
                  <= NOW() - INTERVAL '15 minutes'
             THEN 1
           ELSE mmq_admin_login_throttle.attempt_count + 1
         END,
         blocked_until = CASE
           WHEN mmq_admin_login_throttle.blocked_until > NOW()
             THEN mmq_admin_login_throttle.blocked_until
           WHEN mmq_admin_login_throttle.window_started_at
                  <= NOW() - INTERVAL '15 minutes'
             THEN NULL
           WHEN mmq_admin_login_throttle.attempt_count + 1 > 10
             THEN NOW() + INTERVAL '15 minutes'
           ELSE NULL
         END,
         updated_at = NOW()
       RETURNING
         attempt_count,
         (
           (blocked_until IS NULL OR blocked_until <= NOW())
           AND attempt_count <= 10
         ) AS allowed`,
      [trustedClientIp],
    );
    return result.rows[0]?.allowed === true;
  }

  async stats(): Promise<AdminStats> {
    const [
      submissionResult,
      mirrorResult,
      conflictResult,
      randomizationResult,
    ] =
      await Promise.all([
        this.pool.query(
          `SELECT
             COUNT(*) FILTER (
               WHERE dataset_classification = 'formal'
             )::int AS formal_count,
             COUNT(*) FILTER (
               WHERE dataset_classification = 'test'
             )::int AS test_count,
             COUNT(*)::int AS total_count,
             COUNT(*) FILTER (
               WHERE dataset_classification = 'formal'
                 AND LOWER(format_assignment) = 'table'
             )::int AS table_count,
             COUNT(*) FILTER (
               WHERE dataset_classification = 'formal'
                 AND LOWER(format_assignment) = 'graph'
             )::int AS graph_count,
             COUNT(*) FILTER (
               WHERE dataset_classification = 'formal'
                 AND LOWER(format_assignment) = 'video'
             )::int AS video_count,
             MAX(stored_at) AS latest_stored_at
           FROM mmq_submissions`,
        ),
        this.pool.query(
          `SELECT
             COUNT(*) FILTER (
               WHERE state IN ('pending', 'processing')
             )::int AS pending_count,
             COUNT(*) FILTER (
               WHERE state = 'failed'
             )::int AS failed_count,
             COUNT(*) FILTER (
               WHERE state = 'accepted'
             )::int AS accepted_count
           FROM mmq_submission_form_mirrors`,
        ),
        this.pool.query(
          `SELECT COUNT(*)::int AS conflict_count
             FROM mmq_submission_conflicts`,
        ),
        this.pool.query(
          `WITH selected_schedule AS (
             SELECT status
               FROM mmq_randomization_schedules
              WHERE randomization_version = $1
              LIMIT 1
           ),
           effective_assignments AS (
             SELECT assignment.*
               FROM mmq_randomization_assignments assignment
              WHERE assignment.randomization_version = $1
                AND NOT EXISTS (
                  SELECT 1
                    FROM mmq_randomization_assignments fallback
                   WHERE fallback.randomization_version = $1
                     AND fallback.allocation_method = 'client_fallback'
                     AND fallback.supersedes_allocation_id =
                           assignment.allocation_id
                )
           )
           SELECT
             COALESCE(
               (SELECT status FROM selected_schedule),
               'not_configured'
             ) AS schedule_status,
             CASE
               WHEN EXISTS (SELECT 1 FROM selected_schedule)
                 THEN (
                   SELECT COUNT(*)::int
                     FROM mmq_randomization_slots
                    WHERE randomization_version = $1
                      AND allocation_id IS NULL
                 )
               ELSE 0
             END AS remaining_slots,
             COUNT(*) FILTER (
               WHERE LOWER(format_assignment) = 'table'
             )::int AS table_count,
             COUNT(*) FILTER (
               WHERE LOWER(format_assignment) = 'graph'
             )::int AS graph_count,
             COUNT(*) FILTER (
               WHERE LOWER(format_assignment) = 'video'
             )::int AS video_count,
             COUNT(*)::int AS assigned_count,
             COUNT(*) FILTER (
               WHERE allocation_method = 'client_fallback'
             )::int AS fallback_count
           FROM effective_assignments`,
          [randomizationMetadata.randomization_version],
        ),
      ]);
    const submissions = submissionResult.rows[0] ?? {};
    const mirrors = mirrorResult.rows[0] ?? {};
    const conflicts = conflictResult.rows[0] ?? {};
    const randomization = randomizationResult.rows[0] ?? {};
    const assignedCount = numeric(
      randomization.assigned_count,
    );
    const fallbackCount = numeric(
      randomization.fallback_count,
    );
    const rawScheduleStatus = String(
      randomization.schedule_status ?? "not_configured",
    );
    const remainingScheduleSlots = numeric(
      randomization.remaining_slots,
    );
    const scheduleStatus: AdminStats["randomization"]["status"] =
      rawScheduleStatus === "active"
        ? (
            remainingScheduleSlots > 0
              ? "active"
              : "exhausted"
          )
        : rawScheduleStatus === "closed"
          ? "exhausted"
          : rawScheduleStatus === "draft"
            ? "paused"
            : "not_configured";
    return {
      submissions: {
        formal: numeric(submissions.formal_count),
        test: numeric(submissions.test_count),
        total: numeric(submissions.total_count),
      },
      formal_formats: {
        table: numeric(submissions.table_count),
        graph: numeric(submissions.graph_count),
        video: numeric(submissions.video_count),
      },
      latest_stored_at: timestamp(
        submissions.latest_stored_at,
      ),
      mirrors: {
        pending: numeric(mirrors.pending_count),
        failed: numeric(mirrors.failed_count),
        accepted: numeric(mirrors.accepted_count),
      },
      conflicts: numeric(conflicts.conflict_count),
      randomization: {
        enabled: scheduleStatus === "active",
        status: scheduleStatus,
        assigned: {
          table: numeric(randomization.table_count),
          graph: numeric(randomization.graph_count),
          video: numeric(randomization.video_count),
          total: assignedCount,
        },
        client_fallback: {
          count: fallbackCount,
          rate:
            assignedCount === 0
              ? 0
              : fallbackCount / assignedCount,
        },
        remaining_schedule_slots:
          scheduleStatus === "active"
            ? remainingScheduleSlots
            : 0,
      },
    };
  }

  async exportPage(input: {
    format: AdminExportFormat;
    scope: AdminExportScope;
    snapshotAt: string;
    offset: number;
    limit: number;
  }): Promise<AdminExportPage> {
    if (
      input.format === "mirrors.csv"
      || input.format === "conflicts.csv"
    ) {
      return this.operationalExportPage(input);
    }

    const filter = scopeClause(input.scope);
    const countResult = await this.pool.query(
      `SELECT COUNT(*)::int AS row_count
         FROM mmq_submissions s
        WHERE s.stored_at <= $1::timestamptz
        ${filter}`,
      [input.snapshotAt],
    );
    const submissionCount = numeric(
      countResult.rows[0]?.row_count,
    );
    const totalRows =
      input.format === "trials.csv"
        ? submissionCount * 5
        : submissionCount;
    const submissionOffset =
      input.format === "trials.csv"
        ? Math.floor(input.offset / 5)
        : input.offset;
    const submissionLimit =
      input.format === "trials.csv"
        ? Math.max(1, Math.floor(input.limit / 5))
        : input.limit;
    const result = await this.pool.query(
      `SELECT
         s.receipt_id,
         s.session_id,
         s.participant_id,
         s.dataset_classification,
         s.allocation_id,
         s.randomization_version,
         s.allocation_method,
         s.allocation_status,
         s.assigned_at,
         s.fallback_reason_code,
         s.fallback_reconciled_at,
         s.format_assignment,
         s.stimulus_set_version,
         s.catalog_hash,
         s.payload_sha256,
         s.payload_json,
         s.client_attempt_count,
         s.previous_attempt_latency_ms,
         s.submitted_at,
         s.stored_at,
         s.trusted_client_ip,
         s.deploy_context,
         s.deploy_id,
         s.deploy_url,
         s.deploy_branch AS branch,
         s.deploy_commit_ref AS commit_ref
       FROM mmq_submissions s
       WHERE s.stored_at <= $1::timestamptz
       ${filter}
       ORDER BY s.stored_at, s.receipt_id
       LIMIT $2 OFFSET $3`,
      [
        input.snapshotAt,
        submissionLimit,
        submissionOffset,
      ],
    );

    let rows: Record<string, unknown>[];
    let headers: string[];
    if (input.format === "participants.csv") {
      rows = result.rows.map(participantRow);
      headers = [...PARTICIPANT_HEADERS];
    } else if (input.format === "trials.csv") {
      rows = result.rows.flatMap(trialRows);
      headers = [...TRIAL_HEADERS];
    } else {
      rows = result.rows.map(jsonRow);
      headers = [];
    }
    const consumed = input.offset + rows.length;
    return {
      format: input.format,
      scope: input.scope,
      snapshot_at: input.snapshotAt,
      offset: input.offset,
      next_offset: consumed < totalRows ? consumed : null,
      total_rows: totalRows,
      headers,
      rows,
    };
  }

  private async operationalExportPage(input: {
    format: "mirrors.csv" | "conflicts.csv";
    scope: AdminExportScope;
    snapshotAt: string;
    offset: number;
    limit: number;
  }): Promise<AdminExportPage> {
    const filter = scopeClause(input.scope);
    const isMirror = input.format === "mirrors.csv";
    const timeColumn = isMirror ? "s.stored_at" : "c.received_at";
    const countTable = isMirror
      ? `mmq_submission_form_mirrors m
         JOIN mmq_submissions s ON s.receipt_id = m.receipt_id`
      : `mmq_submission_conflicts c
         JOIN mmq_submissions s
           ON s.receipt_id = c.existing_receipt_id`;
    const countResult = await this.pool.query(
      `SELECT COUNT(*)::int AS row_count
         FROM ${countTable}
        WHERE ${timeColumn} <= $1::timestamptz
        ${filter}`,
      [input.snapshotAt],
    );
    const totalRows = numeric(countResult.rows[0]?.row_count);

    const result = isMirror
      ? await this.pool.query(
          `SELECT
             m.mirror_id,
             m.receipt_id,
             s.session_id,
             s.participant_id,
             s.dataset_classification,
             m.form_name,
             m.state,
             m.attempt_count,
             m.next_attempt_at,
             m.last_attempt_at,
             m.accepted_at,
             m.last_http_status,
             m.last_error
           FROM mmq_submission_form_mirrors m
           JOIN mmq_submissions s ON s.receipt_id = m.receipt_id
          WHERE s.stored_at <= $1::timestamptz
          ${filter}
          ORDER BY s.stored_at, m.mirror_id
          LIMIT $2 OFFSET $3`,
          [input.snapshotAt, input.limit, input.offset],
        )
      : await this.pool.query(
          `SELECT
             c.conflict_id,
             c.session_id,
             c.existing_receipt_id,
             s.participant_id,
             s.dataset_classification,
             s.payload_sha256 AS existing_payload_sha256,
             c.attempted_payload_sha256,
             c.received_at,
             c.trusted_client_ip,
             c.deploy_context,
             c.deploy_id,
             c.deploy_url,
             c.deploy_branch AS branch,
             c.deploy_commit_ref AS commit_ref
           FROM mmq_submission_conflicts c
           JOIN mmq_submissions s
             ON s.receipt_id = c.existing_receipt_id
          WHERE c.received_at <= $1::timestamptz
          ${filter}
          ORDER BY c.received_at, c.conflict_id
          LIMIT $2 OFFSET $3`,
          [input.snapshotAt, input.limit, input.offset],
        );
    const rows = result.rows.map(normalizeDatabaseRow);
    const consumed = input.offset + rows.length;
    return {
      format: input.format,
      scope: input.scope,
      snapshot_at: input.snapshotAt,
      offset: input.offset,
      next_offset: consumed < totalRows ? consumed : null,
      total_rows: totalRows,
      headers: isMirror
        ? [...MIRROR_HEADERS]
        : [...CONFLICT_HEADERS],
      rows,
    };
  }

  async recordAudit(input: {
    eventType:
      | "login_success"
      | "login_failure"
      | "logout"
      | "export";
    deployment: DeploymentMetadata;
    exportId?: string;
    exportScope?: AdminExportScope;
    exportFormat?: AdminExportFormat;
    exportRowCount?: number;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO mmq_admin_audit (
         audit_id,
         actor,
         event_type,
         export_id,
         export_scope,
         export_format,
         export_row_count,
         trusted_client_ip,
         deploy_context,
         deploy_id,
         deploy_url,
         branch,
         commit_ref
       ) VALUES (
         $1, 'shared_admin', $2, $3, $4, $5, $6,
         $7::inet, $8, $9, $10, $11, $12
       )
       ON CONFLICT (export_id) WHERE export_id IS NOT NULL
       DO NOTHING`,
      [
        randomUUID(),
        input.eventType,
        input.exportId ?? null,
        input.exportScope ?? null,
        input.exportFormat ?? null,
        input.exportRowCount ?? null,
        input.deployment.trustedClientIp,
        input.deployment.deployContext,
        input.deployment.deployId,
        input.deployment.deployUrl,
        input.deployment.branch,
        input.deployment.commitRef,
      ],
    );
  }
}
