import {
  mkdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { getDatabase } from "@netlify/database";
import publicMetadata from "../../netlify/randomization/public-schedule-metadata.json" with {
  type: "json",
};
import {
  rowsToCsv,
  summarizeLedger,
} from "./ledger-lib.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const timestamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
const outputArgumentIndex = process.argv.indexOf("--output");
const outputDirectory = path.resolve(
  repositoryRoot,
  outputArgumentIndex === -1
    ? path.join(".private", "randomization", "exports", timestamp)
    : process.argv[outputArgumentIndex + 1],
);

const { pool } = getDatabase();
try {
  const scheduleResult = await pool.query(
    `SELECT randomization_version, schedule_sha256, total_slots, status,
            imported_at, activated_at, closed_at
       FROM mmq_randomization_schedules
      WHERE randomization_version = $1`,
    [publicMetadata.randomization_version],
  );
  const schedule = scheduleResult.rows[0];
  if (!schedule) {
    throw new Error(
      `Randomization version '${publicMetadata.randomization_version}' is not imported.`,
    );
  }
  if (schedule.schedule_sha256 !== publicMetadata.schedule_sha256) {
    throw new Error(
      "Database schedule hash does not match the committed public metadata.",
    );
  }

  const assignmentsResult = await pool.query(
    `SELECT
       a.allocation_id,
       a.randomization_version,
       a.schedule_position,
       s.block_id,
       s.block_size,
       s.block_position,
       a.token_hmac,
       a.participant_id,
       a.format_assignment,
       a.allocation_method,
       a.allocation_status,
       a.assigned_at,
       a.fallback_reason_code,
       a.fallback_reconciled_at,
       a.supersedes_allocation_id,
       a.created_at,
       a.last_seen_at,
       a.visit_count
     FROM mmq_randomization_assignments a
     LEFT JOIN mmq_randomization_slots s
       ON s.randomization_version = a.randomization_version
      AND s.position = a.schedule_position
     WHERE a.randomization_version = $1
     ORDER BY a.assigned_at, a.allocation_id`,
    [publicMetadata.randomization_version],
  );
  const sessionsResult = await pool.query(
    `SELECT
       se.session_id,
       se.allocation_id,
       a.participant_id,
       a.format_assignment,
       a.allocation_method,
       se.opened_at,
       se.source
     FROM mmq_randomization_sessions se
     JOIN mmq_randomization_assignments a
       ON a.allocation_id = se.allocation_id
     WHERE a.randomization_version = $1
     ORDER BY se.opened_at, se.session_id`,
    [publicMetadata.randomization_version],
  );

  const summary = summarizeLedger({
    schedule,
    assignments: assignmentsResult.rows,
    sessions: sessionsResult.rows,
  });
  const assignmentColumns = [
    "allocation_id",
    "randomization_version",
    "schedule_position",
    "block_id",
    "block_size",
    "block_position",
    "token_hmac",
    "participant_id",
    "format_assignment",
    "allocation_method",
    "allocation_status",
    "assigned_at",
    "fallback_reason_code",
    "fallback_reconciled_at",
    "supersedes_allocation_id",
    "created_at",
    "last_seen_at",
    "visit_count",
  ];
  const sessionColumns = [
    "session_id",
    "allocation_id",
    "participant_id",
    "format_assignment",
    "allocation_method",
    "opened_at",
    "source",
  ];

  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(outputDirectory, "randomization-summary.json"),
      `${JSON.stringify(summary, null, 2)}\n`,
      "utf8",
    ),
    writeFile(
      path.join(outputDirectory, "randomization-assignments.csv"),
      rowsToCsv(assignmentsResult.rows, assignmentColumns),
      "utf8",
    ),
    writeFile(
      path.join(outputDirectory, "randomization-sessions.csv"),
      rowsToCsv(sessionsResult.rows, sessionColumns),
      "utf8",
    ),
  ]);

  console.log(JSON.stringify({
    exported: true,
    output_directory: outputDirectory,
    summary,
  }, null, 2));
} finally {
  await pool.end();
}
