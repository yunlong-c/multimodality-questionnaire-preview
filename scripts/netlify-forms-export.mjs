#!/usr/bin/env -S npx tsx

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  mkdir,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  catalogHash as frozenCatalogHash,
  sequenceCatalog,
  stimulusSetVersion as frozenStimulusSetVersion
} from "../frontend/src/data/sequenceCatalog.generated.ts";
import { trialCsvHeaders } from "../frontend/src/experiment/experimentTypes.ts";
import { TABLE_RENDERER_VERSION } from "../frontend/src/experiment/seriesTableRenderer.ts";

const PAYLOAD_CLASSIFICATIONS = ["formal", "test"];
const EXPORT_CLASSIFICATIONS = [
  "formal",
  "test",
  "pre-randomization-test"
];
const STIMULUS_FORMATS = ["table", "graph", "video"];
const RANDOMIZATION_VERSION = "mmq-randomization-2026-07-v1";
const ALLOCATION_METHODS = ["variable_block", "client_fallback"];
const ALLOCATION_STATUSES = ["confirmed", "unreconciled"];
const FALLBACK_REASON_CODES = [
  "allocation_timeout",
  "allocation_network_error",
  "allocation_server_error"
];
const ALLOCATION_FIELDS = [
  "allocation_id",
  "randomization_version",
  "allocation_method",
  "allocation_status",
  "assigned_at",
  "fallback_reason_code",
  "fallback_reconciled_at"
];
const DEMOGRAPHIC_OPTIONS = {
  gender: ["男", "女"],
  education: ["高中及以下", "大专/高职", "本科", "硕士", "博士"],
  experience: ["毫无经验", "有一些经验", "中等经验", "非常丰富的经验"],
  stat_course: ["是", "否"]
};
const MAX_SOURCE_BYTES = 128 * 1024 * 1024;
const MAX_PAYLOAD_JSON_BYTES = 256 * 1024;
const MAX_INVALID_EXCERPT_LENGTH = 1200;
const MAX_OUTPUT_STRING_LENGTH = 4096;
const OUTPUT_FILENAMES = [
  "participants.csv",
  "trials.csv",
  "variable-block-participants.csv",
  "variable-block-trials.csv",
  "fallback-reconciled-participants.csv",
  "fallback-reconciled-trials.csv",
  "fallback-unreconciled-participants.csv",
  "fallback-unreconciled-trials.csv",
  "duplicate-submissions.csv",
  "submission-conflicts.csv"
];
const ROOT_OUTPUT_FILENAMES = [
  "export-summary.json",
  "invalid-submissions.csv"
];

const LEGACY_SESSION_FIELDS = [
  "session_id",
  "participant_id",
  "format_assignment",
  "stimulus_set_version",
  "catalog_hash",
  "dataset_classification",
  "formal_collection_allowed",
  "started_at",
  "submitted_at",
  "duration_ms"
];
const SESSION_FIELDS = [...LEGACY_SESSION_FIELDS, ...ALLOCATION_FIELDS];

const DEMOGRAPHICS_FIELDS = [
  "gender",
  "age",
  "education",
  "experience",
  "stat_course",
  "started_at",
  "submitted_at",
  "duration_ms"
];

const PAYLOAD_FIELDS = ["session", "trials", "demographics"];
const TRANSPORT_FIELDS = [
  "submit_attempt_count",
  "submit_latency_ms",
  "submit_latency_scope"
];
const METADATA_FIELDS = [
  "rho",
  "trend",
  "beta",
  "condition",
  "tau_obs",
  "beta1",
  "beta2",
  "structure",
  "direction",
  "sigma1",
  "sigma2"
];

const CATALOG_BY_SEQUENCE_UID = new Map(
  sequenceCatalog.map((sequence) => [sequence.sequence_uid, sequence])
);

if (
  CATALOG_BY_SEQUENCE_UID.size !== sequenceCatalog.length ||
  sequenceCatalog.length !== 272
) {
  throw new Error("The frozen sequence catalog is incomplete or has duplicate IDs.");
}

const PARTICIPANT_PRIORITY_HEADERS = [
  "source_row",
  "session_id",
  "participant_id",
  "payload_sha256",
  "format_assignment",
  "dataset_classification",
  "export_classification",
  ...ALLOCATION_FIELDS,
  "stimulus_set_version",
  "catalog_hash",
  "formal_collection_allowed",
  "started_at",
  "submitted_at",
  "duration_ms",
  "netlify_created_at",
  "netlify_submit_attempt_count",
  "netlify_submit_latency_ms",
  "netlify_submit_latency_scope"
];

const TRIAL_PRIORITY_HEADERS = [
  "source_row",
  "session_id",
  "participant_id",
  "payload_sha256",
  "dataset_classification",
  "export_classification",
  "format_assignment",
  ...ALLOCATION_FIELDS,
  "trial_no",
  "pool",
  "sequence_uid",
  "canonical_key",
  "presentation_uid"
];

const DUPLICATE_HEADERS = [
  "source_row",
  "retained_source_row",
  "session_id",
  "participant_id",
  "payload_sha256",
  "dataset_classification",
  "export_classification",
  ...ALLOCATION_FIELDS,
  "submitted_at",
  "netlify_created_at",
  "submit_attempt_count",
  "submit_latency_ms",
  "submit_latency_scope",
  "retained_submit_attempt_count",
  "retained_submit_latency_ms",
  "retained_submit_latency_scope"
];

const CONFLICT_HEADERS = [
  "source_row",
  "session_id",
  "participant_id",
  "payload_sha256",
  "dataset_classification",
  "export_classification",
  ...ALLOCATION_FIELDS,
  "submitted_at",
  "netlify_created_at",
  "conflict_hash_count",
  "conflict_hashes",
  "conflict_classifications",
  "payload_json"
];

const INVALID_HEADERS = [
  "source_row",
  "error_code",
  "error_message",
  "session_id",
  "participant_id",
  "payload_sha256",
  "dataset_classification",
  ...ALLOCATION_FIELDS,
  "submitted_at",
  "netlify_created_at",
  "payload_json_bytes",
  "payload_json_sha256",
  "payload_excerpt"
];

export class ExportValidationError extends Error {
  constructor(message, { sourceRow = null, code = "VALIDATION_ERROR" } = {}) {
    const prefix = sourceRow === null ? "" : `Netlify CSV row ${sourceRow}: `;
    super(`${prefix}${message}`);
    this.name = "ExportValidationError";
    this.sourceRow = sourceRow;
    this.code = code;
  }
}

/**
 * Parse an RFC 4180-style CSV document. Quoted fields may contain commas,
 * escaped quotes and CR/LF line breaks.
 */
export function parseCsv(source) {
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let fieldStarted = false;
  let quoteClosed = false;

  const finishField = () => {
    row.push(field);
    field = "";
    fieldStarted = false;
    quoteClosed = false;
  };

  const finishRow = () => {
    finishField();
    rows.push(row);
    row = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
          quoteClosed = true;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (quoteClosed && char !== "," && char !== "\r" && char !== "\n") {
      throw new ExportValidationError(
        `Unexpected character after a closing quote at character ${index + 1}.`
      );
    }

    if (char === '"' && !fieldStarted) {
      inQuotes = true;
      fieldStarted = true;
    } else if (char === '"') {
      throw new ExportValidationError(
        `Unexpected quote in an unquoted field at character ${index + 1}.`,
        { code: "CSV_QUOTE_STRUCTURE" }
      );
    } else if (char === ",") {
      finishField();
    } else if (char === "\r" || char === "\n") {
      if (char === "\r" && text[index + 1] === "\n") {
        index += 1;
      }
      finishRow();
    } else {
      field += char;
      fieldStarted = true;
    }
  }

  if (inQuotes) {
    throw new ExportValidationError("CSV ends inside a quoted field.");
  }

  if (fieldStarted || quoteClosed || field.length > 0 || row.length > 0) {
    finishRow();
  }

  return rows.filter(
    (candidate) => !(candidate.length === 1 && candidate[0] === "")
  );
}

export function stringifyCsv(rows, preferredHeaders = []) {
  const headers = orderedHeaders(rows, preferredHeaders);
  const body = [
    headers.map(escapeCsvValue).join(","),
    ...rows.map((row) =>
      headers.map((header) => escapeCsvValue(row[header])).join(",")
    )
  ].join("\r\n");

  return `\uFEFF${body}\r\n`;
}

export async function organizeNetlifyFormsExport({
  inputPath,
  outputPath,
  overwrite = false
}) {
  const resolvedInput = path.resolve(inputPath);
  const resolvedOutput = path.resolve(outputPath);
  assertInputOutsideOutput(resolvedInput, resolvedOutput);

  const sourceBuffer = await readFile(resolvedInput);
  if (sourceBuffer.byteLength > MAX_SOURCE_BYTES) {
    throw new ExportValidationError(
      `The source CSV exceeds the ${MAX_SOURCE_BYTES} byte safety limit.`,
      { code: "CSV_TOO_LARGE" }
    );
  }
  const source = decodeUtf8(sourceBuffer);
  const sourceSha256 = sha256Buffer(sourceBuffer);
  const { records, invalidSubmissions } = parseNetlifyRecords(source);
  const analysis = analyzeRecords(records);

  const summary = {
    generated_at: new Date().toISOString(),
    source_file: resolvedInput,
    source_sha256: sourceSha256,
    output_directory: resolvedOutput,
    source_rows: records.length + invalidSubmissions.length,
    valid_source_rows: records.length,
    invalid_source_rows: invalidSubmissions.length,
    unique_sessions_seen: analysis.uniqueSessionsSeen,
    accepted_sessions: analysis.acceptedSessions,
    accepted_trials: analysis.acceptedTrials,
    exact_duplicate_rows: analysis.exactDuplicateRows,
    conflict_sessions_excluded: analysis.conflictSessionsExcluded,
    conflict_rows: analysis.conflictRows,
    classifications: Object.fromEntries(
      EXPORT_CLASSIFICATIONS.map((classification) => {
        const result = analysis.byClassification[classification];
        return [
          classification,
          {
            accepted_sessions: result.participants.length,
            accepted_trials: result.trials.length,
            exact_duplicate_rows: result.duplicates.length,
            conflict_rows: result.conflicts.length
          }
        ];
      })
    ),
    randomization_audit: summarizeRandomization(
      analysis.byClassification.formal.participants
    ),
    policy: {
      frozen_stimulus_set_version: frozenStimulusSetVersion,
      frozen_catalog_hash: frozenCatalogHash,
      deduplication_key: "session_id + payload_sha256",
      conflicting_sessions:
        "All versions of a session with more than one payload hash are excluded from participants.csv and trials.csv.",
      dataset_separation:
        "formal/, test/ and pre-randomization-test/ output directories",
      pre_randomization_policy:
        "Rows using the legacy session schema are never treated as formal, regardless of their original dataset_classification.",
      formal_randomization_policy:
        `Post-cutover formal rows require complete allocation metadata for ${RANDOMIZATION_VERSION}.`,
      sensitivity_analysis:
        "The variable-block-only participant and trial files exclude every client_fallback session.",
      invalid_submissions:
        "Invalid rows are isolated; retain the original Netlify CSV as the recoverable source record."
    }
  };

  await validateOutputTarget(resolvedOutput, overwrite);
  const stagingDirectory = await createStagingDirectory(resolvedOutput);
  try {
    await writeExportDirectory(
      stagingDirectory,
      analysis,
      invalidSubmissions,
      summary
    );
    await installStagedDirectory(
      stagingDirectory,
      resolvedOutput,
      overwrite
    );
  } catch (error) {
    if (existsSync(stagingDirectory)) {
      await rm(stagingDirectory, { recursive: true, force: true });
    }
    throw error;
  }

  return summary;
}

async function writeExportDirectory(
  directory,
  analysis,
  invalidSubmissions,
  summary
) {
  for (const classification of EXPORT_CLASSIFICATIONS) {
    const classificationDirectory = path.join(directory, classification);
    await mkdir(classificationDirectory, { recursive: true });
    const classificationResult = analysis.byClassification[classification];
    const variableBlockParticipants =
      classificationResult.participants.filter(
        (row) => row.allocation_method === "variable_block"
      );
    const variableBlockSessionIds = new Set(
      variableBlockParticipants.map((row) => row.session_id)
    );
    const fallbackReconciledParticipants =
      classificationResult.participants.filter(
        (row) =>
          row.allocation_method === "client_fallback" &&
          row.allocation_status === "confirmed"
      );
    const fallbackReconciledSessionIds = new Set(
      fallbackReconciledParticipants.map((row) => row.session_id)
    );
    const fallbackUnreconciledParticipants =
      classificationResult.participants.filter(
        (row) =>
          row.allocation_method === "client_fallback" &&
          row.allocation_status === "unreconciled"
      );
    const fallbackUnreconciledSessionIds = new Set(
      fallbackUnreconciledParticipants.map((row) => row.session_id)
    );

    await Promise.all([
      writeCsv(
        path.join(classificationDirectory, "participants.csv"),
        classificationResult.participants,
        PARTICIPANT_PRIORITY_HEADERS
      ),
      writeCsv(
        path.join(classificationDirectory, "trials.csv"),
        classificationResult.trials,
        TRIAL_PRIORITY_HEADERS
      ),
      writeCsv(
        path.join(classificationDirectory, "variable-block-participants.csv"),
        variableBlockParticipants,
        PARTICIPANT_PRIORITY_HEADERS
      ),
      writeCsv(
        path.join(classificationDirectory, "variable-block-trials.csv"),
        classificationResult.trials.filter((row) =>
          variableBlockSessionIds.has(row.session_id)
        ),
        TRIAL_PRIORITY_HEADERS
      ),
      writeCsv(
        path.join(
          classificationDirectory,
          "fallback-reconciled-participants.csv"
        ),
        fallbackReconciledParticipants,
        PARTICIPANT_PRIORITY_HEADERS
      ),
      writeCsv(
        path.join(classificationDirectory, "fallback-reconciled-trials.csv"),
        classificationResult.trials.filter((row) =>
          fallbackReconciledSessionIds.has(row.session_id)
        ),
        TRIAL_PRIORITY_HEADERS
      ),
      writeCsv(
        path.join(
          classificationDirectory,
          "fallback-unreconciled-participants.csv"
        ),
        fallbackUnreconciledParticipants,
        PARTICIPANT_PRIORITY_HEADERS
      ),
      writeCsv(
        path.join(classificationDirectory, "fallback-unreconciled-trials.csv"),
        classificationResult.trials.filter((row) =>
          fallbackUnreconciledSessionIds.has(row.session_id)
        ),
        TRIAL_PRIORITY_HEADERS
      ),
      writeCsv(
        path.join(classificationDirectory, "duplicate-submissions.csv"),
        classificationResult.duplicates,
        DUPLICATE_HEADERS
      ),
      writeCsv(
        path.join(classificationDirectory, "submission-conflicts.csv"),
        classificationResult.conflicts,
        CONFLICT_HEADERS
      )
    ]);
  }

  await writeCsv(
    path.join(directory, "invalid-submissions.csv"),
    invalidSubmissions,
    INVALID_HEADERS
  );
  await writeFile(
    path.join(directory, "export-summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
    "utf8"
  );
}

export function parseNetlifyRecords(csvSource) {
  const rows = parseCsv(csvSource);
  if (rows.length === 0) {
    throw new ExportValidationError("The CSV contains no rows.");
  }

  const normalizedHeaders = normalizeHeaders(rows[0]);
  if (!normalizedHeaders.includes("payload_json")) {
    throw new ExportValidationError(
      'Required column "payload_json" was not found.'
    );
  }

  const records = [];
  const invalidSubmissions = [];

  for (const [offset, values] of rows.slice(1).entries()) {
    const sourceRow = offset + 2;
    if (values.length !== normalizedHeaders.length) {
      throw new ExportValidationError(
        `Expected ${normalizedHeaders.length} columns but found ${values.length}.`,
        { sourceRow, code: "CSV_COLUMN_COUNT" }
      );
    }

    const formRow = Object.fromEntries(
      normalizedHeaders.map((header, index) => [header, values[index]])
    );

    try {
      records.push(parseSubmissionRecord(formRow, sourceRow));
    } catch (error) {
      invalidSubmissions.push(
        invalidSubmissionRow(formRow, sourceRow, error)
      );
    }
  }

  return { records, invalidSubmissions };
}

function parseSubmissionRecord(formRow, sourceRow) {
  const payloadJson = formRow.payload_json;
  if (Buffer.byteLength(payloadJson, "utf8") > MAX_PAYLOAD_JSON_BYTES) {
    throw new ExportValidationError(
      `payload_json exceeds the ${MAX_PAYLOAD_JSON_BYTES} byte per-submission limit.`,
      { sourceRow, code: "PAYLOAD_TOO_LARGE" }
    );
  }

  let payload;
  try {
    payload = JSON.parse(payloadJson);
  } catch (error) {
    throw new ExportValidationError(
      `payload_json is not valid JSON (${error.message}).`,
      { sourceRow, code: "INVALID_JSON" }
    );
  }

  validatePayloadShape(payload, sourceRow);
  const allocationSchema = detectAllocationSchema(payload.session, sourceRow);

  const reconciledFields = {};
  for (const field of [
    "session_id",
    "participant_id",
    "format_assignment",
    "dataset_classification",
    "stimulus_set_version",
    "catalog_hash",
    "submitted_at"
  ]) {
    reconciledFields[field] = reconcileField({
      name: field,
      outer: formRow[field],
      inner: payload.session[field],
      sourceRow,
      required: true
    });
  }

  const payloadClassification = reconciledFields.dataset_classification;
  if (!PAYLOAD_CLASSIFICATIONS.includes(payloadClassification)) {
    throw new ExportValidationError(
      `dataset_classification must be "formal" or "test", found ${JSON.stringify(
        payloadClassification
      )}.`,
      { sourceRow, code: "INVALID_CLASSIFICATION" }
    );
  }

  if (allocationSchema === "current") {
    for (const field of ALLOCATION_FIELDS) {
      reconcileAllocationField({
        name: field,
        formRow,
        inner: payload.session[field],
        sourceRow
      });
    }
  }

  const suppliedHash = normalizeHash(formRow.payload_sha256, sourceRow, true);
  const calculatedHash = sha256(payloadJson);
  if (suppliedHash !== calculatedHash) {
    throw new ExportValidationError(
      `payload_sha256 does not match payload_json (provided ${suppliedHash}, calculated ${calculatedHash}).`,
      { sourceRow, code: "HASH_MISMATCH" }
    );
  }

  validateTransportFields(formRow, sourceRow);
  validatePayloadAgainstFrozenCatalog(payload, sourceRow, allocationSchema);
  const exportClassification =
    allocationSchema === "legacy"
      ? "pre-randomization-test"
      : payloadClassification;

  return {
    sourceRow,
    formRow,
    payload,
    payloadJson,
    payloadSha256: suppliedHash,
    sessionId: reconciledFields.session_id,
    participantId: reconciledFields.participant_id,
    payloadClassification,
    classification: exportClassification,
    exportClassification,
    allocationSchema,
    submittedAt: reconciledFields.submitted_at,
    netlifyCreatedAt:
      boundedAuditValue(formRow.created_at) ||
      boundedAuditValue(formRow.netlify_created_at) ||
      boundedAuditValue(formRow.created) ||
      ""
  };
}

function invalidSubmissionRow(formRow, sourceRow, error) {
  return {
    source_row: sourceRow,
    error_code:
      error instanceof ExportValidationError
        ? error.code
        : "UNEXPECTED_ROW_ERROR",
    error_message: truncateString(
      error?.message ?? String(error),
      MAX_OUTPUT_STRING_LENGTH
    ),
    session_id: boundedAuditValue(formRow.session_id),
    participant_id: boundedAuditValue(formRow.participant_id),
    payload_sha256: boundedAuditValue(formRow.payload_sha256),
    dataset_classification: boundedAuditValue(
      formRow.dataset_classification
    ),
    ...Object.fromEntries(
      ALLOCATION_FIELDS.map((field) => [
        field,
        boundedAuditValue(formRow[field])
      ])
    ),
    submitted_at: boundedAuditValue(formRow.submitted_at),
    netlify_created_at:
      boundedAuditValue(formRow.created_at) ||
      boundedAuditValue(formRow.netlify_created_at) ||
      boundedAuditValue(formRow.created),
    payload_json_bytes: Buffer.byteLength(formRow.payload_json ?? "", "utf8"),
    payload_json_sha256: sha256(formRow.payload_json ?? ""),
    payload_excerpt: truncateString(
      formRow.payload_json ?? "",
      MAX_INVALID_EXCERPT_LENGTH
    )
  };
}

export function analyzeRecords(records) {
  const bySession = new Map();
  for (const record of records) {
    const sessionRecords = bySession.get(record.sessionId) ?? [];
    sessionRecords.push(record);
    bySession.set(record.sessionId, sessionRecords);
  }

  const byClassification = Object.fromEntries(
    EXPORT_CLASSIFICATIONS.map((classification) => [
      classification,
      { participants: [], trials: [], duplicates: [], conflicts: [] }
    ])
  );

  let acceptedSessions = 0;
  let acceptedTrials = 0;
  let exactDuplicateRows = 0;
  let conflictSessionsExcluded = 0;
  let conflictRows = 0;

  for (const sessionRecords of bySession.values()) {
    sessionRecords.sort((left, right) => left.sourceRow - right.sourceRow);
    const recordsByHash = groupBy(sessionRecords, (record) => record.payloadSha256);

    for (const sameHashRecords of recordsByHash.values()) {
      const retained = sameHashRecords[0];
      for (const duplicate of sameHashRecords.slice(1)) {
        exactDuplicateRows += 1;
        byClassification[duplicate.classification].duplicates.push(
          duplicateRow(duplicate, retained)
        );
      }
    }

    if (recordsByHash.size > 1) {
      conflictSessionsExcluded += 1;
      conflictRows += sessionRecords.length;
      const hashes = [...recordsByHash.keys()].sort();
      const classifications = [
        ...new Set(sessionRecords.map((record) => record.payloadClassification))
      ].sort();

      for (const record of sessionRecords) {
        byClassification[record.classification].conflicts.push(
          conflictRow(record, hashes, classifications)
        );
      }
      continue;
    }

    const retained = sessionRecords[0];
    const result = byClassification[retained.classification];
    result.participants.push(participantRow(retained));
    for (const trial of retained.payload.trials) {
      result.trials.push(trialRow(retained, trial));
      acceptedTrials += 1;
    }
    acceptedSessions += 1;
  }

  for (const classification of EXPORT_CLASSIFICATIONS) {
    const result = byClassification[classification];
    result.participants.sort(compareRows);
    result.trials.sort((left, right) => {
      const sessionComparison = compareRows(left, right);
      return sessionComparison || Number(left.trial_no) - Number(right.trial_no);
    });
    result.duplicates.sort(compareRows);
    result.conflicts.sort(compareRows);
  }

  return {
    byClassification,
    uniqueSessionsSeen: bySession.size,
    acceptedSessions,
    acceptedTrials,
    exactDuplicateRows,
    conflictSessionsExcluded,
    conflictRows
  };
}

function participantRow(record) {
  return {
    ...record.payload.session,
    ...prefixKeys(record.payload.demographics, "demographics_"),
    source_row: record.sourceRow,
    session_id: record.sessionId,
    participant_id: record.participantId,
    payload_sha256: record.payloadSha256,
    export_classification: record.exportClassification,
    netlify_created_at: record.netlifyCreatedAt,
    netlify_submit_attempt_count:
      record.formRow.submit_attempt_count ?? "",
    netlify_submit_latency_ms: record.formRow.submit_latency_ms ?? "",
    netlify_submit_latency_scope:
      record.formRow.submit_latency_scope ?? ""
  };
}

function allocationFieldsForOutput(record) {
  return Object.fromEntries(
    ALLOCATION_FIELDS.map((field) => [
      field,
      Object.prototype.hasOwnProperty.call(record.payload.session, field)
        ? record.payload.session[field]
        : null
    ])
  );
}

function trialRow(record, trial) {
  return {
    ...trial,
    ...allocationFieldsForOutput(record),
    source_row: record.sourceRow,
    session_id: record.sessionId,
    participant_id: record.participantId,
    payload_sha256: record.payloadSha256,
    export_classification: record.exportClassification
  };
}

function summarizeRandomization(participants) {
  const variableBlock = participants.filter(
    (row) => row.allocation_method === "variable_block"
  );
  const fallbackReconciled = participants.filter(
    (row) =>
      row.allocation_method === "client_fallback" &&
      row.allocation_status === "confirmed"
  );
  const fallbackUnreconciled = participants.filter(
    (row) =>
      row.allocation_method === "client_fallback" &&
      row.allocation_status === "unreconciled"
  );
  const fallback = [...fallbackReconciled, ...fallbackUnreconciled];
  const ordered = [...participants].sort((left, right) => {
    const timestampComparison = String(left.assigned_at).localeCompare(
      String(right.assigned_at),
      "en"
    );
    return timestampComparison || compareRows(left, right);
  });
  let currentFallbackRun = 0;
  let maximumConsecutiveFallback = 0;
  for (const row of ordered) {
    if (row.allocation_method === "client_fallback") {
      currentFallbackRun += 1;
      maximumConsecutiveFallback = Math.max(
        maximumConsecutiveFallback,
        currentFallbackRun
      );
    } else {
      currentFallbackRun = 0;
    }
  }

  const fallbackRate =
    participants.length === 0 ? 0 : fallback.length / participants.length;
  return {
    accepted_formal_sessions: participants.length,
    variable_block_sessions: variableBlock.length,
    fallback_sessions: fallback.length,
    fallback_reconciled_sessions: fallbackReconciled.length,
    fallback_unreconciled_sessions: fallbackUnreconciled.length,
    fallback_rate: fallbackRate,
    maximum_consecutive_fallback: maximumConsecutiveFallback,
    pause_recommended:
      fallbackRate > 0.01 || maximumConsecutiveFallback >= 3,
    all_formal_format_counts: countFormats(participants),
    variable_block_only_format_counts: countFormats(variableBlock),
    fallback_format_counts: countFormats(fallback),
    interpretation:
      "Counts cover accepted completed Forms submissions, not every assignment in the private allocation ledger."
  };
}

function countFormats(rows) {
  return Object.fromEntries(
    STIMULUS_FORMATS.map((format) => [
      format,
      rows.filter((row) => row.format_assignment === format).length
    ])
  );
}

function duplicateRow(record, retained) {
  return {
    source_row: record.sourceRow,
    retained_source_row: retained.sourceRow,
    session_id: record.sessionId,
    participant_id: record.participantId,
    payload_sha256: record.payloadSha256,
    dataset_classification: record.payloadClassification,
    export_classification: record.exportClassification,
    ...allocationFieldsForOutput(record),
    submitted_at: record.submittedAt,
    netlify_created_at: record.netlifyCreatedAt,
    submit_attempt_count: record.formRow.submit_attempt_count ?? "",
    submit_latency_ms: record.formRow.submit_latency_ms ?? "",
    submit_latency_scope: record.formRow.submit_latency_scope ?? "",
    retained_submit_attempt_count:
      retained.formRow.submit_attempt_count ?? "",
    retained_submit_latency_ms: retained.formRow.submit_latency_ms ?? "",
    retained_submit_latency_scope:
      retained.formRow.submit_latency_scope ?? ""
  };
}

function conflictRow(record, hashes, classifications) {
  return {
    source_row: record.sourceRow,
    session_id: record.sessionId,
    participant_id: record.participantId,
    payload_sha256: record.payloadSha256,
    dataset_classification: record.payloadClassification,
    export_classification: record.exportClassification,
    ...allocationFieldsForOutput(record),
    submitted_at: record.submittedAt,
    netlify_created_at: record.netlifyCreatedAt,
    conflict_hash_count: hashes.length,
    conflict_hashes: hashes.join("|"),
    conflict_classifications: classifications.join("|"),
    payload_json: record.payloadJson
  };
}

function validatePayloadShape(payload, sourceRow) {
  assertRecord(payload, "payload_json", sourceRow);
  assertExactKeys(payload, PAYLOAD_FIELDS, "payload_json", sourceRow);
  assertRecord(payload.session, "payload_json.session", sourceRow);
  assertRecord(payload.demographics, "payload_json.demographics", sourceRow);
  if (!Array.isArray(payload.trials)) {
    throw new ExportValidationError("payload_json.trials must be an array.", {
      sourceRow,
      code: "SCHEMA_TYPE"
    });
  }
}

function validatePayloadAgainstFrozenCatalog(
  payload,
  sourceRow,
  allocationSchema
) {
  const { session, trials } = payload;
  assertExactKeys(
    session,
    allocationSchema === "current" ? SESSION_FIELDS : LEGACY_SESSION_FIELDS,
    "payload_json.session",
    sourceRow
  );
  assertExactKeys(
    payload.demographics,
    DEMOGRAPHICS_FIELDS,
    "payload_json.demographics",
    sourceRow
  );

  validateSession(session, sourceRow, allocationSchema);
  validateDemographics(payload.demographics, session, sourceRow);

  if (trials.length !== 5) {
    throw new ExportValidationError(
      `payload_json.trials must contain exactly 5 trials, found ${trials.length}.`,
      { sourceRow, code: "TRIAL_COUNT" }
    );
  }

  for (const [index, trial] of trials.entries()) {
    assertRecord(trial, `payload_json.trials[${index}]`, sourceRow);
    assertExactKeys(
      trial,
      trialCsvHeaders,
      `payload_json.trials[${index}]`,
      sourceRow
    );
  }

  const trialNumbers = trials.map((trial) => trial.trial_no);
  if (
    new Set(trialNumbers).size !== 5 ||
    ![1, 2, 3, 4, 5].every((number) => trialNumbers.includes(number))
  ) {
    throw new ExportValidationError(
      "trial_no values must be unique and equal to 1, 2, 3, 4 and 5.",
      { sourceRow, code: "TRIAL_NUMBER_RULE" }
    );
  }

  const sequenceIds = trials.map((trial) => trial.sequence_uid);
  if (
    sequenceIds.some(
      (value) => typeof value !== "string" || value.length === 0
    ) ||
    new Set(sequenceIds).size !== trials.length
  ) {
    throw new ExportValidationError(
      "The 5 trials must have 5 non-empty, unique sequence_uid values.",
      { sourceRow, code: "TRIAL_SEQUENCE_RULE" }
    );
  }

  for (const trial of trials) {
    validateTrialAgainstCatalog(
      trial,
      session,
      payload.demographics,
      sourceRow
    );
  }

  const byTrialNo = new Map(trials.map((trial) => [trial.trial_no, trial]));
  if (byTrialNo.get(1).sequence_uid === byTrialNo.get(5).sequence_uid) {
    throw new ExportValidationError(
      "Trial 1 and trial 5 must use different Pool 1 sequences.",
      { sourceRow, code: "TRIAL_SEQUENCE_RULE" }
    );
  }
}

function validateSession(session, sourceRow, allocationSchema) {
  assertBoundedString(session.session_id, "session.session_id", sourceRow, 256);
  assertBoundedString(
    session.participant_id,
    "session.participant_id",
    sourceRow,
    256
  );
  assertEnum(
    session.format_assignment,
    STIMULUS_FORMATS,
    "session.format_assignment",
    sourceRow
  );
  assertEqual(
    session.stimulus_set_version,
    frozenStimulusSetVersion,
    "session.stimulus_set_version",
    sourceRow
  );
  assertEqual(
    session.catalog_hash,
    frozenCatalogHash,
    "session.catalog_hash",
    sourceRow
  );
  assertEnum(
    session.dataset_classification,
    PAYLOAD_CLASSIFICATIONS,
    "session.dataset_classification",
    sourceRow
  );

  const expectedFormalAllowed =
    session.dataset_classification === "formal";
  assertEqual(
    session.formal_collection_allowed,
    expectedFormalAllowed,
    "session.formal_collection_allowed",
    sourceRow
  );
  assertIsoTimestamp(session.started_at, "session.started_at", sourceRow);
  assertIsoTimestamp(session.submitted_at, "session.submitted_at", sourceRow);
  assertIntegerInRange(
    session.duration_ms,
    0,
    30 * 24 * 60 * 60 * 1000,
    "session.duration_ms",
    sourceRow
  );

  const wallDuration =
    Date.parse(session.submitted_at) - Date.parse(session.started_at);
  if (wallDuration !== session.duration_ms) {
    throw new ExportValidationError(
      "session.duration_ms does not equal submitted_at - started_at.",
      { sourceRow, code: "SESSION_TIME_MISMATCH" }
    );
  }

  if (allocationSchema === "current") {
    validateAllocationMetadata(session, sourceRow);
  }
}

function detectAllocationSchema(session, sourceRow) {
  const present = ALLOCATION_FIELDS.filter((field) =>
    Object.prototype.hasOwnProperty.call(session, field)
  );
  if (present.length === 0) {
    return "legacy";
  }
  if (present.length === ALLOCATION_FIELDS.length) {
    return "current";
  }
  const missing = ALLOCATION_FIELDS.filter(
    (field) => !Object.prototype.hasOwnProperty.call(session, field)
  );
  throw new ExportValidationError(
    `payload_json.session has a partial allocation schema; missing: ${missing.join(
      ", "
    )}.`,
    { sourceRow, code: "ALLOCATION_SCHEMA" }
  );
}

function validateAllocationMetadata(session, sourceRow) {
  if (session.dataset_classification === "test") {
    for (const field of ALLOCATION_FIELDS) {
      assertEqual(
        session[field],
        null,
        `session.${field} for a test session`,
        sourceRow
      );
    }
    return;
  }

  assertBoundedString(
    session.allocation_id,
    "session.allocation_id",
    sourceRow,
    256
  );
  assertEqual(
    session.randomization_version,
    RANDOMIZATION_VERSION,
    "session.randomization_version",
    sourceRow
  );
  assertEnum(
    session.allocation_method,
    ALLOCATION_METHODS,
    "session.allocation_method",
    sourceRow
  );
  assertEnum(
    session.allocation_status,
    ALLOCATION_STATUSES,
    "session.allocation_status",
    sourceRow
  );
  assertIsoTimestamp(session.assigned_at, "session.assigned_at", sourceRow);

  if (session.allocation_method === "variable_block") {
    assertEqual(
      session.allocation_status,
      "confirmed",
      "session.allocation_status for variable_block",
      sourceRow
    );
    assertEqual(
      session.fallback_reason_code,
      null,
      "session.fallback_reason_code for variable_block",
      sourceRow
    );
    assertEqual(
      session.fallback_reconciled_at,
      null,
      "session.fallback_reconciled_at for variable_block",
      sourceRow
    );
    return;
  }

  assertEnum(
    session.fallback_reason_code,
    FALLBACK_REASON_CODES,
    "session.fallback_reason_code",
    sourceRow
  );
  if (session.allocation_status === "confirmed") {
    assertIsoTimestamp(
      session.fallback_reconciled_at,
      "session.fallback_reconciled_at",
      sourceRow
    );
    if (
      Date.parse(session.fallback_reconciled_at) <
        Date.parse(session.assigned_at)
    ) {
      throw new ExportValidationError(
        "session.fallback_reconciled_at must not precede assigned_at.",
        { sourceRow, code: "ALLOCATION_TIME_WINDOW" }
      );
    }
  } else {
    assertEqual(
      session.fallback_reconciled_at,
      null,
      "session.fallback_reconciled_at for an unreconciled fallback",
      sourceRow
    );
  }
}

function validateDemographics(demographics, session, sourceRow) {
  for (const [field, allowed] of Object.entries(DEMOGRAPHIC_OPTIONS)) {
    assertEnum(
      demographics[field],
      allowed,
      `demographics.${field}`,
      sourceRow
    );
  }
  assertIntegerInRange(
    demographics.age,
    1,
    150,
    "demographics.age",
    sourceRow
  );
  assertIsoTimestamp(
    demographics.started_at,
    "demographics.started_at",
    sourceRow
  );
  assertIsoTimestamp(
    demographics.submitted_at,
    "demographics.submitted_at",
    sourceRow
  );
  assertIntegerInRange(
    demographics.duration_ms,
    0,
    30 * 24 * 60 * 60 * 1000,
    "demographics.duration_ms",
    sourceRow
  );
  assertTimeWindow(
    demographics.started_at,
    demographics.submitted_at,
    session.started_at,
    session.submitted_at,
    "demographics",
    sourceRow
  );
}

function validateTrialAgainstCatalog(
  trial,
  session,
  demographics,
  sourceRow
) {
  const trialPath = `trial ${trial.trial_no}`;
  assertIntegerInRange(trial.trial_no, 1, 5, `${trialPath}.trial_no`, sourceRow);

  const trialPlan = {
    1: { pool: "Pool_1", responseType: "point_only" },
    2: { pool: "Pool_2", responseType: "point_only" },
    3: { pool: "Pool_3", responseType: "point_only" },
    4: { pool: "Pool_4", responseType: "point_only" },
    5: { pool: "Pool_1", responseType: "point_spd" }
  }[trial.trial_no];

  const sequence = CATALOG_BY_SEQUENCE_UID.get(trial.sequence_uid);
  if (!sequence) {
    throw new ExportValidationError(
      `${trialPath}.sequence_uid is not in the frozen catalog.`,
      { sourceRow, code: "CATALOG_SEQUENCE_MISMATCH" }
    );
  }
  const presentation = sequence.presentations[session.format_assignment];
  if (!presentation) {
    throw new ExportValidationError(
      `${trialPath} has no frozen ${session.format_assignment} presentation.`,
      { sourceRow, code: "CATALOG_PRESENTATION_MISMATCH" }
    );
  }

  for (const field of [
    "session_id",
    "format_assignment",
    "stimulus_set_version",
    "catalog_hash",
    "dataset_classification"
  ]) {
    assertEqual(trial[field], session[field], `${trialPath}.${field}`, sourceRow);
  }
  assertEqual(trial.format, session.format_assignment, `${trialPath}.format`, sourceRow);
  assertEqual(trial.pool, trialPlan.pool, `${trialPath}.pool`, sourceRow);
  assertEqual(
    trial.response_type,
    trialPlan.responseType,
    `${trialPath}.response_type`,
    sourceRow
  );
  if (!sequence.response_eligibility.includes(trial.response_type)) {
    throw new ExportValidationError(
      `${trialPath}.response_type is not eligible for its frozen sequence.`,
      { sourceRow, code: "CATALOG_RESPONSE_MISMATCH" }
    );
  }

  const sequenceExpectations = {
    stimulus_set_version: sequence.stimulus_set_version,
    canonical_key: sequence.canonical_key,
    pool: sequence.pool,
    variant: sequence.variant,
    source_id: sequence.source_id,
    stimulus_id: String(sequence.source_id),
    display_index: sequence.display_index,
    legacy_asset_no: sequence.legacy_asset_no,
    pair_uid: sequence.pair_uid,
    values_sha256: sequence.values_sha256,
    source_data_file: sequence.source_data_file
  };
  for (const [field, expected] of Object.entries(sequenceExpectations)) {
    assertEqual(trial[field], expected, `${trialPath}.${field}`, sourceRow);
  }

  const presentationExpectations = {
    presentation_uid: presentation.presentation_uid,
    legacy_path: presentation.legacy_path,
    legacy_asset_path: presentation.legacy_path,
    stimulus_path: presentation.legacy_path,
    legacy_asset_sha256: presentation.asset_sha256,
    asset_sha256:
      session.format_assignment === "table"
        ? null
        : presentation.asset_sha256,
    renderer_version:
      session.format_assignment === "table"
        ? TABLE_RENDERER_VERSION
        : null
  };
  for (const [field, expected] of Object.entries(presentationExpectations)) {
    assertEqual(trial[field], expected, `${trialPath}.${field}`, sourceRow);
  }

  for (const field of METADATA_FIELDS) {
    assertEqual(
      trial[field],
      sequence.metadata?.[field] ?? null,
      `${trialPath}.${field}`,
      sourceRow
    );
  }

  const expectedPool2Speed =
    sequence.pool === "Pool_2" ? sequence.variant : null;
  assertEqual(
    trial.pool2_speed,
    expectedPool2Speed,
    `${trialPath}.pool2_speed`,
    sourceRow
  );
  const expectedLegacyAssetNumber =
    sequence.pool === "Pool_2" && sequence.variant === "fast"
      ? sequence.source_id
      : sequence.display_index;
  assertEqual(
    trial.legacy_asset_no,
    expectedLegacyAssetNumber,
    `${trialPath}.legacy_asset_no frozen mapping`,
    sourceRow
  );

  validateTrialOperationalFields(trial, session, sourceRow);
  validateTrialAnswer(trial, sourceRow);

  for (const field of [
    "gender",
    "age",
    "education",
    "experience",
    "stat_course"
  ]) {
    assertEqual(
      trial[field],
      demographics[field],
      `${trialPath}.${field}`,
      sourceRow
    );
  }
}

function validateTrialOperationalFields(trial, session, sourceRow) {
  const trialPath = `trial ${trial.trial_no}`;
  assertIsoTimestamp(
    trial.trial_started_at,
    `${trialPath}.trial_started_at`,
    sourceRow
  );
  assertIsoTimestamp(
    trial.trial_submitted_at,
    `${trialPath}.trial_submitted_at`,
    sourceRow
  );
  assertIntegerInRange(
    trial.trial_duration_ms,
    0,
    30 * 24 * 60 * 60 * 1000,
    `${trialPath}.trial_duration_ms`,
    sourceRow
  );
  assertTimeWindow(
    trial.trial_started_at,
    trial.trial_submitted_at,
    session.started_at,
    session.submitted_at,
    trialPath,
    sourceRow
  );
  assertIntegerInRange(
    trial.visit_count,
    1,
    100000,
    `${trialPath}.visit_count`,
    sourceRow
  );
  assertIntegerInRange(
    trial.revision_count,
    0,
    100000,
    `${trialPath}.revision_count`,
    sourceRow
  );
  if (trial.revision_count > trial.visit_count - 1) {
    throw new ExportValidationError(
      `${trialPath}.revision_count cannot exceed visit_count - 1.`,
      { sourceRow, code: "TRIAL_COUNTER_RULE" }
    );
  }

  if (session.format_assignment === "table") {
    for (const field of [
      "fullscreen_open_count",
      "fullscreen_duration_ms",
      "asset_load_duration_ms"
    ]) {
      assertEqual(trial[field], null, `${trialPath}.${field}`, sourceRow);
    }
    assertEqual(
      trial.asset_load_attempt_count,
      0,
      `${trialPath}.asset_load_attempt_count`,
      sourceRow
    );
    assertEqual(
      trial.asset_load_status,
      "not_applicable",
      `${trialPath}.asset_load_status`,
      sourceRow
    );
    return;
  }

  assertIntegerInRange(
    trial.fullscreen_open_count,
    0,
    100000,
    `${trialPath}.fullscreen_open_count`,
    sourceRow
  );
  assertIntegerInRange(
    trial.fullscreen_duration_ms,
    0,
    30 * 24 * 60 * 60 * 1000,
    `${trialPath}.fullscreen_duration_ms`,
    sourceRow
  );
  assertIntegerInRange(
    trial.asset_load_duration_ms,
    0,
    30 * 24 * 60 * 60 * 1000,
    `${trialPath}.asset_load_duration_ms`,
    sourceRow
  );
  assertIntegerInRange(
    trial.asset_load_attempt_count,
    1,
    100000,
    `${trialPath}.asset_load_attempt_count`,
    sourceRow
  );
  assertEnum(
    trial.asset_load_status,
    ["loaded"],
    `${trialPath}.asset_load_status`,
    sourceRow
  );
}

function validateTrialAnswer(trial, sourceRow) {
  const trialPath = `trial ${trial.trial_no}`;
  assertFiniteInRange(
    trial.point,
    -1e12,
    1e12,
    `${trialPath}.point`,
    sourceRow
  );
  const supportFields = ["s1", "s2", "s3", "s4", "s5"];
  const probabilityFields = ["p1", "p2", "p3", "p4", "p5"];

  if (trial.response_type === "point_only") {
    for (const field of [...supportFields, ...probabilityFields, "sumS", "sumP"]) {
      assertEqual(trial[field], null, `${trialPath}.${field}`, sourceRow);
    }
    return;
  }

  const supports = supportFields.map((field) => {
    assertFiniteInRange(
      trial[field],
      -1e12,
      1e12,
      `${trialPath}.${field}`,
      sourceRow
    );
    return trial[field];
  });
  const probabilities = probabilityFields.map((field) => {
    assertFiniteInRange(
      trial[field],
      0,
      100,
      `${trialPath}.${field}`,
      sourceRow
    );
    return trial[field];
  });
  for (let index = 1; index < supports.length; index += 1) {
    if (supports[index - 1] > supports[index]) {
      throw new ExportValidationError(
        `${trialPath} support values are not nondecreasing.`,
        { sourceRow, code: "ANSWER_ORDER" }
      );
    }
  }

  const supportSum = supports.reduce((sum, value) => sum + value, 0);
  const probabilitySum = probabilities.reduce((sum, value) => sum + value, 0);
  assertApproximatelyEqual(
    trial.sumS,
    supportSum,
    `${trialPath}.sumS`,
    sourceRow
  );
  assertApproximatelyEqual(
    trial.sumP,
    probabilitySum,
    `${trialPath}.sumP`,
    sourceRow
  );
  assertApproximatelyEqual(
    probabilitySum,
    100,
    `${trialPath} probability total`,
    sourceRow,
    0.001
  );
}

function validateTransportFields(formRow, sourceRow) {
  if (nonEmpty(formRow.submit_attempt_count)) {
    assertDecimalIntegerStringInRange(
      formRow.submit_attempt_count,
      1,
      100000,
      "submit_attempt_count",
      sourceRow
    );
  }
  if (nonEmpty(formRow.submit_latency_ms)) {
    assertDecimalIntegerStringInRange(
      formRow.submit_latency_ms,
      0,
      24 * 60 * 60 * 1000,
      "submit_latency_ms",
      sourceRow
    );
  }
  if (nonEmpty(formRow.submit_latency_scope)) {
    assertEqual(
      formRow.submit_latency_scope,
      "previous_completed_attempt",
      "submit_latency_scope",
      sourceRow
    );
  }
}

function assertDecimalIntegerStringInRange(
  value,
  minimum,
  maximum,
  field,
  sourceRow
) {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) {
    throw new ExportValidationError(
      `${field} must be a plain base-10 integer string.`,
      { sourceRow, code: "TRANSPORT_NUMBER" }
    );
  }
  assertIntegerInRange(Number(value), minimum, maximum, field, sourceRow);
}

function assertRecord(value, field, sourceRow) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ExportValidationError(`${field} must be an object.`, {
      sourceRow,
      code: "SCHEMA_TYPE"
    });
  }
}

function assertExactKeys(value, expectedKeys, field, sourceRow) {
  const expected = new Set(expectedKeys);
  const actualKeys = Object.keys(value);
  const unknown = actualKeys.filter((key) => !expected.has(key));
  const missing = expectedKeys.filter(
    (key) => !Object.prototype.hasOwnProperty.call(value, key)
  );
  if (unknown.length > 0 || missing.length > 0) {
    throw new ExportValidationError(
      `${field} fields do not match the approved schema` +
        `${unknown.length > 0 ? `; unknown: ${unknown.join(", ")}` : ""}` +
        `${missing.length > 0 ? `; missing: ${missing.join(", ")}` : ""}.`,
      { sourceRow, code: "SCHEMA_FIELDS" }
    );
  }
}

function assertBoundedString(value, field, sourceRow, maxLength) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength
  ) {
    throw new ExportValidationError(
      `${field} must be a non-empty string no longer than ${maxLength} characters.`,
      { sourceRow, code: "SCHEMA_STRING" }
    );
  }
}

function assertIsoTimestamp(value, field, sourceRow) {
  assertBoundedString(value, field, sourceRow, 64);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new ExportValidationError(`${field} must be an ISO UTC timestamp.`, {
      sourceRow,
      code: "SCHEMA_TIMESTAMP"
    });
  }
}

function assertTimeWindow(
  startedAt,
  submittedAt,
  sessionStartedAt,
  sessionSubmittedAt,
  field,
  sourceRow
) {
  const started = Date.parse(startedAt);
  const submitted = Date.parse(submittedAt);
  if (
    started > submitted ||
    started < Date.parse(sessionStartedAt) ||
    submitted > Date.parse(sessionSubmittedAt)
  ) {
    throw new ExportValidationError(
      `${field} timestamps must be ordered within the session window.`,
      { sourceRow, code: "TIME_WINDOW" }
    );
  }
}

function assertEnum(value, allowed, field, sourceRow) {
  if (!allowed.includes(value)) {
    throw new ExportValidationError(
      `${field} must be one of ${allowed.join(", ")}.`,
      { sourceRow, code: "SCHEMA_ENUM" }
    );
  }
}

function assertIntegerInRange(value, minimum, maximum, field, sourceRow) {
  if (
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new ExportValidationError(
      `${field} must be an integer from ${minimum} through ${maximum}.`,
      { sourceRow, code: "SCHEMA_NUMBER" }
    );
  }
}

function assertFiniteInRange(value, minimum, maximum, field, sourceRow) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new ExportValidationError(
      `${field} must be a finite number from ${minimum} through ${maximum}.`,
      { sourceRow, code: "SCHEMA_NUMBER" }
    );
  }
}

function assertApproximatelyEqual(
  actual,
  expected,
  field,
  sourceRow,
  tolerance = 1e-9
) {
  if (
    typeof actual !== "number" ||
    !Number.isFinite(actual) ||
    Math.abs(actual - expected) > tolerance
  ) {
    throw new ExportValidationError(
      `${field} does not match its calculated value.`,
      { sourceRow, code: "ANSWER_SUM" }
    );
  }
}

function assertEqual(actual, expected, field, sourceRow) {
  if (!Object.is(actual, expected)) {
    throw new ExportValidationError(
      `${field} does not match the approved value.`,
      { sourceRow, code: "CATALOG_FIELD_MISMATCH" }
    );
  }
}

function reconcileField({
  name,
  outer,
  inner,
  sourceRow,
  required = false
}) {
  const outerValue = nonEmpty(outer);
  const innerValue = nonEmpty(inner);

  if (outerValue && innerValue && outerValue !== innerValue) {
    throw new ExportValidationError(
      `${name} differs between the CSV column (${JSON.stringify(
        outerValue
      )}) and payload_json (${JSON.stringify(innerValue)}).`,
      { sourceRow }
    );
  }

  const value = outerValue || innerValue;
  if (required && !value) {
    throw new ExportValidationError(`${name} is missing.`, { sourceRow });
  }
  return value;
}

function reconcileAllocationField({
  name,
  formRow,
  inner,
  sourceRow
}) {
  if (!Object.prototype.hasOwnProperty.call(formRow, name)) {
    throw new ExportValidationError(
      `Required post-cutover Forms column ${name} is missing.`,
      { sourceRow, code: "ALLOCATION_FORM_FIELD" }
    );
  }
  const outer = nonEmpty(formRow[name]) || null;
  if (outer !== inner) {
    throw new ExportValidationError(
      `${name} differs between the CSV column (${JSON.stringify(
        outer
      )}) and payload_json (${JSON.stringify(inner)}).`,
      { sourceRow, code: "ALLOCATION_FIELD_MISMATCH" }
    );
  }
}

function normalizeHash(value, sourceRow, required = false) {
  const normalized = nonEmpty(value).toLowerCase();
  if (!normalized) {
    if (required) {
      throw new ExportValidationError("payload_sha256 is missing.", {
        sourceRow,
        code: "HASH_MISSING"
      });
    }
    return "";
  }
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new ExportValidationError(
      "payload_sha256 must contain 64 hexadecimal characters.",
      { sourceRow, code: "HASH_FORMAT" }
    );
  }
  return normalized;
}

function normalizeHeaders(headers) {
  if (headers.length > 100) {
    throw new ExportValidationError(
      "CSV contains more than 100 columns.",
      { code: "CSV_TOO_WIDE" }
    );
  }
  if (headers.some((header) => String(header).length > 128)) {
    throw new ExportValidationError(
      "CSV contains a header longer than 128 characters.",
      { code: "CSV_HEADER_TOO_LONG" }
    );
  }
  const normalized = headers.map(normalizeHeader);
  const duplicates = normalized.filter(
    (header, index) => normalized.indexOf(header) !== index
  );
  if (duplicates.length > 0) {
    throw new ExportValidationError(
      `CSV headers collide after normalization: ${[
        ...new Set(duplicates)
      ].join(", ")}.`
    );
  }
  if (normalized.some((header) => !header)) {
    throw new ExportValidationError("CSV contains an empty header.");
  }
  return normalized;
}

function normalizeHeader(value) {
  return String(value)
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function prefixKeys(value, prefix) {
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [`${prefix}${key}`, child])
  );
}

function orderedHeaders(rows, preferredHeaders) {
  const found = new Set();
  for (const row of rows) {
    for (const header of Object.keys(row)) {
      found.add(header);
    }
  }
  for (const header of preferredHeaders) {
    found.add(header);
  }

  return [
    ...preferredHeaders,
    ...[...found].filter((header) => !preferredHeaders.includes(header)).sort()
  ];
}

function escapeCsvValue(value) {
  if (value === null || value === undefined) {
    return "";
  }
  const formulaSafe =
    typeof value === "string" && /^[=+\-@\t\r\n]/.test(value)
      ? `'${value}`
      : String(value);
  const normalized = formulaSafe.replaceAll('"', '""');
  return /[",\r\n]/.test(normalized) ? `"${normalized}"` : normalized;
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function nonEmpty(value) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim();
}

function truncateString(value, maximumLength) {
  const normalized = String(value ?? "");
  return normalized.length <= maximumLength
    ? normalized
    : `${normalized.slice(0, maximumLength)}…`;
}

function boundedAuditValue(value) {
  if (
    value === null ||
    value === undefined ||
    (typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean")
  ) {
    return "";
  }
  return truncateString(value, 512);
}

function groupBy(values, keyFunction) {
  const groups = new Map();
  for (const value of values) {
    const key = keyFunction(value);
    const group = groups.get(key) ?? [];
    group.push(value);
    groups.set(key, group);
  }
  return groups;
}

function compareRows(left, right) {
  const sessionComparison = String(left.session_id).localeCompare(
    String(right.session_id),
    "en"
  );
  if (sessionComparison !== 0) {
    return sessionComparison;
  }
  return Number(left.source_row) - Number(right.source_row);
}

async function writeCsv(filename, rows, preferredHeaders) {
  await writeFile(filename, stringifyCsv(rows, preferredHeaders), "utf8");
}

function assertInputOutsideOutput(inputPath, outputPath) {
  const relative = path.relative(outputPath, inputPath);
  const inputIsInsideOutput =
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative));
  if (inputIsInsideOutput) {
    throw new ExportValidationError(
      "The input CSV must not be the output directory or be stored inside it.",
      { code: "INPUT_INSIDE_OUTPUT" }
    );
  }
}

function decodeUtf8(buffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new ExportValidationError("The source CSV is not valid UTF-8.", {
      code: "CSV_ENCODING"
    });
  }
}

function sha256Buffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function validateOutputTarget(outputPath, overwrite) {
  if (!existsSync(outputPath)) {
    return;
  }

  await assertSafeOutputDirectory(outputPath, "output directory");
  const existing = await readdir(outputPath);
  if (existing.length > 0 && !overwrite) {
    throw new ExportValidationError(
      `Output directory is not empty: ${outputPath}. Use --overwrite to replace only this export directory.`,
      { code: "OUTPUT_NOT_EMPTY" }
    );
  }
  if (existing.length === 0) {
    return;
  }

  const allowed = new Set([
    ...EXPORT_CLASSIFICATIONS,
    ...ROOT_OUTPUT_FILENAMES
  ]);
  const unexpected = existing.filter((entry) => !allowed.has(entry));
  if (unexpected.length > 0) {
    throw new ExportValidationError(
      `Refusing to overwrite a directory containing unrelated entries: ${unexpected.join(
        ", "
      )}. Choose a dedicated output directory.`,
      { code: "UNSAFE_OUTPUT_CONTENTS" }
    );
  }
  for (const classification of EXPORT_CLASSIFICATIONS) {
    const classificationDirectory = path.join(outputPath, classification);
    if (!existsSync(classificationDirectory)) {
      continue;
    }
    await assertSafeOutputDirectory(
      classificationDirectory,
      `${classification} output directory`
    );
    const classificationEntries = await readdir(classificationDirectory);
    const unexpectedClassificationEntries = classificationEntries.filter(
      (entry) => !OUTPUT_FILENAMES.includes(entry)
    );
    if (unexpectedClassificationEntries.length > 0) {
      throw new ExportValidationError(
        `Refusing to overwrite unrelated files in ${classificationDirectory}: ${unexpectedClassificationEntries.join(
          ", "
        )}.`,
        { code: "UNSAFE_OUTPUT_CONTENTS" }
      );
    }
  }
}

async function createStagingDirectory(outputPath) {
  const parent = path.dirname(outputPath);
  await mkdir(parent, { recursive: true });
  return mkdtemp(path.join(parent, `.${path.basename(outputPath)}.tmp-`));
}

async function installStagedDirectory(stagingPath, outputPath, overwrite) {
  if (!existsSync(outputPath)) {
    await rename(stagingPath, outputPath);
    return;
  }

  const existing = await readdir(outputPath);
  if (existing.length > 0 && !overwrite) {
    throw new ExportValidationError(
      `Output directory became non-empty during export: ${outputPath}.`,
      { code: "OUTPUT_CHANGED_DURING_EXPORT" }
    );
  }
  await assertSafeOutputDirectory(outputPath, "output directory");

  const backupPath = path.join(
    path.dirname(outputPath),
    `.${path.basename(outputPath)}.backup-${process.pid}-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}`
  );
  if (existsSync(backupPath)) {
    throw new ExportValidationError(
      `Could not reserve a safe backup path beside ${outputPath}.`,
      { code: "OUTPUT_BACKUP_COLLISION" }
    );
  }

  await rename(outputPath, backupPath);
  try {
    await rename(stagingPath, outputPath);
  } catch (error) {
    await rename(backupPath, outputPath);
    throw error;
  }

  await rm(backupPath, { recursive: true, force: true });
}

async function assertSafeOutputDirectory(candidatePath, label) {
  const stats = await lstat(candidatePath);
  if (stats.isSymbolicLink()) {
    throw new ExportValidationError(
      `Refusing to use ${label} because it is a symbolic link or junction: ${candidatePath}.`,
      { code: "UNSAFE_OUTPUT_LINK" }
    );
  }
  if (!stats.isDirectory()) {
    throw new ExportValidationError(
      `Expected ${label} to be a directory: ${candidatePath}.`,
      { code: "UNSAFE_OUTPUT_TYPE" }
    );
  }
}

function parseArguments(argv) {
  let inputPath = "";
  let outputPath = "";
  let overwrite = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--input" || argument === "-i") {
      inputPath = argv[index + 1] ?? "";
      index += 1;
    } else if (argument === "--output" || argument === "-o") {
      outputPath = argv[index + 1] ?? "";
      index += 1;
    } else if (argument === "--overwrite") {
      overwrite = true;
    } else if (argument === "--help" || argument === "-h") {
      return { help: true };
    } else {
      throw new ExportValidationError(`Unknown argument: ${argument}`);
    }
  }

  if (!inputPath || !outputPath) {
    throw new ExportValidationError(
      "Both --input <netlify.csv> and --output <directory> are required."
    );
  }

  return { inputPath, outputPath, overwrite, help: false };
}

function usage() {
  return [
    "Usage:",
    "  node scripts/netlify-forms-export.mjs --input <netlify.csv> --output <directory> [--overwrite]",
    "",
    "The command writes formal/, test/ and pre-randomization-test/ subdirectories plus export-summary.json.",
    "Conflicting sessions are excluded from participants.csv and trials.csv."
  ].join("\n");
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const summary = await organizeNetlifyFormsExport(options);
  process.stdout.write(
    [
      "Netlify Forms export organized successfully.",
      `Source rows: ${summary.source_rows}`,
      `Invalid rows isolated: ${summary.invalid_source_rows}`,
      `Accepted sessions: ${summary.accepted_sessions}`,
      `Accepted trials: ${summary.accepted_trials}`,
      `Exact duplicate rows: ${summary.exact_duplicate_rows}`,
      `Conflict sessions excluded: ${summary.conflict_sessions_excluded}`,
      `Conflict rows: ${summary.conflict_rows}`,
      `Formal: ${summary.classifications.formal.accepted_sessions} sessions / ${summary.classifications.formal.accepted_trials} trials`,
      `Test: ${summary.classifications.test.accepted_sessions} sessions / ${summary.classifications.test.accepted_trials} trials`,
      `Pre-randomization/test: ${summary.classifications["pre-randomization-test"].accepted_sessions} sessions / ${summary.classifications["pre-randomization-test"].accepted_trials} trials`,
      `Fallback: ${summary.randomization_audit.fallback_sessions} (${(
        summary.randomization_audit.fallback_rate * 100
      ).toFixed(2)}%), unreconciled ${summary.randomization_audit.fallback_unreconciled_sessions}`,
      `Output: ${summary.output_directory}`
    ].join("\n") + "\n"
  );
}

const invokedDirectly =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedDirectly) {
  main().catch((error) => {
    process.stderr.write(
      `${error.name ?? "Error"}: ${error.message ?? String(error)}\n`
    );
    process.exitCode = 1;
  });
}
