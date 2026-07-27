import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { getDatabase } from "@netlify/database";
import {
  DEFAULT_RANDOMIZATION_VERSION,
  DEFAULT_TOTAL_SLOTS,
  validateSchedule,
} from "./schedule-lib.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const defaultPrivatePath = path.join(
  repositoryRoot,
  ".private",
  "randomization",
  `${DEFAULT_RANDOMIZATION_VERSION}.json`,
);
const publicMetadataPath = path.join(
  repositoryRoot,
  "netlify",
  "randomization",
  "public-schedule-metadata.json",
);

function optionValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

const inputPath = path.resolve(
  repositoryRoot,
  optionValue("--file", defaultPrivatePath),
);
const activate = process.argv.includes("--activate");
const schedule = JSON.parse(await readFile(inputPath, "utf8"));
const publicMetadata = JSON.parse(await readFile(publicMetadataPath, "utf8"));
const validation = validateSchedule(schedule, {
  expectedTotalSlots: DEFAULT_TOTAL_SLOTS,
  expectedRandomizationVersion: DEFAULT_RANDOMIZATION_VERSION,
});

if (!validation.valid) {
  throw new Error(
    `Refusing to import an invalid private schedule:\n${validation.errors.join("\n")}`,
  );
}
if (
  publicMetadata.randomization_version !== schedule.randomization_version
  || publicMetadata.schedule_sha256 !== schedule.schedule_sha256
) {
  throw new Error(
    "The private schedule does not match the committed public schedule metadata.",
  );
}

const { pool } = getDatabase();
const client = await pool.connect();

try {
  await client.query("BEGIN");
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
    [`mmq-schedule-import:${schedule.randomization_version}`],
  );

  const existingResult = await client.query(
    `SELECT randomization_version, schedule_sha256, total_slots, status
       FROM mmq_randomization_schedules
      WHERE randomization_version = $1
      FOR UPDATE`,
    [schedule.randomization_version],
  );
  const existing = existingResult.rows[0];

  if (existing) {
    if (
      existing.schedule_sha256 !== schedule.schedule_sha256
      || Number(existing.total_slots) !== schedule.total_slots
    ) {
      throw new Error(
        "A different schedule already exists under this randomization version.",
      );
    }
  } else {
    await client.query(
      `INSERT INTO mmq_randomization_schedules (
         randomization_version,
         schema_version,
         schedule_sha256,
         total_slots,
         allowed_block_sizes,
         status,
         metadata
       ) VALUES ($1, $2, $3, $4, $5, 'draft', $6::jsonb)`,
      [
        schedule.randomization_version,
        schedule.schema_version,
        schedule.schedule_sha256,
        schedule.total_slots,
        schedule.allowed_block_sizes,
        JSON.stringify({
          generator_version: schedule.generator_version,
          generated_at: schedule.generated_at,
          format_counts: validation.summary.format_counts,
          block_count: validation.summary.block_count,
        }),
      ],
    );
  }

  const batchSize = 250;
  for (let offset = 0; offset < schedule.slots.length; offset += batchSize) {
    const batch = schedule.slots.slice(offset, offset + batchSize);
    const values = [];
    const placeholders = batch.map((slot, batchIndex) => {
      const parameterOffset = batchIndex * 6;
      values.push(
        schedule.randomization_version,
        slot.position,
        slot.block_id,
        slot.block_size,
        slot.block_position,
        slot.format_assignment,
      );
      return `($${parameterOffset + 1}, $${parameterOffset + 2}, $${parameterOffset + 3}, $${parameterOffset + 4}, $${parameterOffset + 5}, $${parameterOffset + 6})`;
    });
    await client.query(
      `INSERT INTO mmq_randomization_slots (
         randomization_version,
         position,
         block_id,
         block_size,
         block_position,
         format_assignment
       ) VALUES ${placeholders.join(",")}
       ON CONFLICT (randomization_version, position) DO NOTHING`,
      values,
    );
  }

  const auditResult = await client.query(
    `SELECT
       COUNT(*)::int AS total_slots,
       COUNT(*) FILTER (WHERE format_assignment = 'table')::int AS table_count,
       COUNT(*) FILTER (WHERE format_assignment = 'graph')::int AS graph_count,
       COUNT(*) FILTER (WHERE format_assignment = 'video')::int AS video_count,
       COUNT(*) FILTER (WHERE allocation_id IS NOT NULL)::int AS allocated_count,
       MIN(position)::int AS minimum_position,
       MAX(position)::int AS maximum_position
     FROM mmq_randomization_slots
     WHERE randomization_version = $1`,
    [schedule.randomization_version],
  );
  const audit = auditResult.rows[0];
  const expectedPerFormat = schedule.total_slots / 3;
  if (
    audit.total_slots !== schedule.total_slots
    || audit.table_count !== expectedPerFormat
    || audit.graph_count !== expectedPerFormat
    || audit.video_count !== expectedPerFormat
    || audit.minimum_position !== 1
    || audit.maximum_position !== schedule.total_slots
  ) {
    throw new Error("Database slot audit failed after schedule import.");
  }

  const badBlocksResult = await client.query(
    `SELECT block_id
       FROM mmq_randomization_slots
      WHERE randomization_version = $1
      GROUP BY block_id, block_size
     HAVING COUNT(*) <> block_size
         OR COUNT(*) FILTER (WHERE format_assignment = 'table') <> block_size / 3
         OR COUNT(*) FILTER (WHERE format_assignment = 'graph') <> block_size / 3
         OR COUNT(*) FILTER (WHERE format_assignment = 'video') <> block_size / 3
      LIMIT 1`,
    [schedule.randomization_version],
  );
  if (badBlocksResult.rowCount !== 0) {
    throw new Error("Database block-balance audit failed after schedule import.");
  }

  if (activate) {
    const otherActiveResult = await client.query(
      `SELECT randomization_version
         FROM mmq_randomization_schedules
        WHERE status = 'active'
          AND randomization_version <> $1
        LIMIT 1`,
      [schedule.randomization_version],
    );
    if (otherActiveResult.rowCount !== 0) {
      throw new Error(
        `Schedule '${otherActiveResult.rows[0].randomization_version}' is already active.`,
      );
    }
    if (audit.allocated_count !== 0 && existing?.status !== "active") {
      throw new Error("A draft schedule with assigned slots cannot be activated.");
    }
    await client.query(
      `UPDATE mmq_randomization_schedules
          SET status = 'active',
              activated_at = COALESCE(activated_at, NOW()),
              closed_at = NULL
        WHERE randomization_version = $1`,
      [schedule.randomization_version],
    );
  }

  await client.query("COMMIT");
  console.log(JSON.stringify({
    imported: true,
    activated: activate || existing?.status === "active",
    randomization_version: schedule.randomization_version,
    schedule_sha256: schedule.schedule_sha256,
    total_slots: audit.total_slots,
    format_counts: {
      table: audit.table_count,
      graph: audit.graph_count,
      video: audit.video_count,
    },
  }, null, 2));
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
