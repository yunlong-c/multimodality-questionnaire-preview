import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  symlink,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  catalogHash,
  sequenceCatalog,
  stimulusSetVersion
} from "../../frontend/src/data/sequenceCatalog.generated.ts";
import {
  getVideoPlaybackMetadata
} from "../../frontend/src/data/videoPlaybackManifest.generated.ts";
import { TABLE_RENDERER_VERSION } from "../../frontend/src/experiment/seriesTableRenderer.ts";
import {
  ExportValidationError,
  organizeNetlifyFormsExport,
  parseCsv,
  parseNetlifyRecords,
  stringifyCsv
} from "../netlify-forms-export.mjs";

test("CSV parser preserves commas, quotes and embedded line breaks", () => {
  const rows = parseCsv(
    '\uFEFFid,note,payload_json\r\n1,"逗号, 引号""内容""\r\n第二行","{""ok"":true}"\r\n'
  );

  assert.deepEqual(rows, [
    ["id", "note", "payload_json"],
    ["1", '逗号, 引号"内容"\r\n第二行', '{"ok":true}']
  ]);
});

test("CSV output neutralizes spreadsheet formulas without changing negative numbers", () => {
  const csv = stringifyCsv([
    {
      equals: "=2+2",
      plus: "+cmd",
      minus_string: "-3",
      at: "@SUM(A1:A2)",
      tab: "\tcmd",
      carriage_return: "\rcmd",
      line_feed: "\ncmd",
      negative_number: -3
    }
  ]);
  const [headers, values] = parseCsv(csv);
  const row = Object.fromEntries(
    headers.map((header, index) => [header, values[index]])
  );

  for (const field of [
    "equals",
    "plus",
    "minus_string",
    "at",
    "tab",
    "carriage_return",
    "line_feed"
  ]) {
    assert.ok(row[field].startsWith("'"));
  }
  assert.equal(row.negative_number, "-3");
});

test("real frozen Table, Graph and Video payloads all pass the exporter gate", () => {
  const result = parseNetlifyRecords(
    buildNetlifyCsv(
      ["table", "graph", "video"].map((format) =>
        submission(
          makePayload({
            sessionId: `session-${format}`,
            participantId: `participant-${format}`,
            classification: "test",
            format
          })
        )
      )
    )
  );

  assert.equal(result.records.length, 3);
  assert.equal(result.invalidSubmissions.length, 0);
});

test("pre-single-play records remain exportable with blank playback fields", async () => {
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "mmq-netlify-pre-single-play-")
  );
  const inputPath = path.join(temporaryRoot, "netlify.csv");
  const outputPath = path.join(temporaryRoot, "organized");
  const payload = makePreSinglePlayPayload({
    sessionId: "session-pre-single-play",
    participantId: "participant-pre-single-play",
    classification: "formal",
    format: "video"
  });

  await writeFile(
    inputPath,
    buildNetlifyCsv([submission(payload)]),
    "utf8"
  );
  const summary = await organizeNetlifyFormsExport({
    inputPath,
    outputPath
  });

  assert.equal(summary.classifications.formal.accepted_sessions, 1);
  const participants = await readCsvRecords(
    path.join(outputPath, "formal", "participants.csv")
  );
  const trials = await readCsvRecords(
    path.join(outputPath, "formal", "trials.csv")
  );
  assert.equal(
    participants[0].video_playback_classification,
    "pre-single-play"
  );
  assert.equal(trials.length, 5);
  assert.ok(
    trials.every(
      (row) =>
        row.video_playback_classification === "pre-single-play"
        && row.video_playback_version === ""
        && row.playback_asset_path === ""
        && row.playback_asset_sha256 === ""
        && row.video_replay_used === ""
        && row.video_replay_completed === ""
        && row.video_initial_restart_count === ""
    )
  );
});

test("organizer binds valid submissions to the real frozen catalog and preserves transport diagnostics", async () => {
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "mmq-netlify-export-")
  );
  const inputPath = path.join(temporaryRoot, "netlify.csv");
  const outputPath = path.join(temporaryRoot, "organized");

  const formalPayload = makePayload({
    sessionId: "session-formal",
    participantId: "+participant-formula",
    classification: "formal",
    point: -42
  });
  const conflictA = makePayload({
    sessionId: "session-conflict",
    participantId: "participant-conflict",
    classification: "formal",
    point: 10
  });
  const conflictB = clone(conflictA);
  conflictB.trials[0].point = 11;
  const testPayload = makePayload({
    sessionId: "session-test",
    participantId: "participant-test",
    classification: "test"
  });

  const records = [
    submission(formalPayload, {
      pretty: true,
      createdAt: "2026-07-27 10:00",
      attempt: "1",
      latency: ""
    }),
    submission(formalPayload, {
      pretty: true,
      createdAt: "2026-07-27 10:01",
      attempt: "2",
      latency: "456"
    }),
    submission(conflictA, {
      createdAt: "2026-07-27 10:02",
      attempt: "1"
    }),
    submission(conflictB, {
      createdAt: "2026-07-27 10:03",
      attempt: "2",
      latency: "321"
    }),
    submission(testPayload, {
      createdAt: "2026-07-27 10:04",
      attempt: "1"
    })
  ];

  await writeFile(inputPath, buildNetlifyCsv(records), "utf8");
  const summary = await organizeNetlifyFormsExport({
    inputPath,
    outputPath
  });

  assert.equal(summary.source_rows, 5);
  assert.equal(summary.valid_source_rows, 5);
  assert.equal(summary.invalid_source_rows, 0);
  assert.equal(summary.unique_sessions_seen, 3);
  assert.equal(summary.accepted_sessions, 2);
  assert.equal(summary.accepted_trials, 10);
  assert.equal(summary.exact_duplicate_rows, 1);
  assert.equal(summary.conflict_sessions_excluded, 1);
  assert.equal(summary.conflict_rows, 2);
  assert.equal(
    summary.policy.frozen_stimulus_set_version,
    stimulusSetVersion
  );
  assert.equal(summary.policy.frozen_catalog_hash, catalogHash);

  const formalParticipants = await readCsvRecords(
    path.join(outputPath, "formal", "participants.csv")
  );
  assert.equal(formalParticipants.length, 1);
  assert.equal(
    formalParticipants[0].participant_id,
    "'+participant-formula"
  );
  assert.equal(formalParticipants[0].demographics_gender, "女");
  assert.equal(formalParticipants[0].netlify_submit_attempt_count, "1");
  assert.equal(formalParticipants[0].netlify_submit_latency_ms, "");
  assert.equal(formalParticipants[0].allocation_method, "variable_block");
  assert.equal(formalParticipants[0].allocation_status, "confirmed");
  assert.equal(
    formalParticipants[0].video_playback_classification,
    "single-play-gif-v1"
  );

  const formalTrials = await readCsvRecords(
    path.join(outputPath, "formal", "trials.csv")
  );
  assert.equal(formalTrials.length, 5);
  assert.ok(
    formalTrials.every(
      (row) =>
        row.video_playback_classification === "single-play-gif-v1"
    )
  );
  assert.ok(
    formalTrials.every(
      (row) =>
        row.allocation_method === "variable_block" &&
        row.randomization_version === "mmq-randomization-2026-07-v1"
    )
  );
  assert.deepEqual(
    formalTrials.map((row) => row.trial_no),
    ["1", "2", "3", "4", "5"]
  );
  assert.equal(formalTrials[0].point, "-42");
  assert.ok(!formalTrials[0].point.startsWith("'"));
  assert.equal(
    formalTrials[1].sequence_uid,
    "MMQ-P02-FAST-ID019"
  );
  assert.equal(formalTrials[1].source_id, "19");
  assert.equal(formalTrials[1].display_index, "21");
  assert.equal(formalTrials[1].legacy_asset_no, "19");

  const duplicates = await readCsvRecords(
    path.join(outputPath, "formal", "duplicate-submissions.csv")
  );
  assert.equal(duplicates.length, 1);
  assert.equal(duplicates[0].submit_attempt_count, "2");
  assert.equal(duplicates[0].submit_latency_ms, "456");
  assert.equal(
    duplicates[0].submit_latency_scope,
    "previous_completed_attempt"
  );
  assert.equal(duplicates[0].retained_submit_attempt_count, "1");
  assert.equal(duplicates[0].retained_submit_latency_ms, "");

  const conflicts = await readCsvRecords(
    path.join(outputPath, "formal", "submission-conflicts.csv")
  );
  assert.equal(conflicts.length, 2);
  assert.ok(
    conflicts.every(
      (row) =>
        row.session_id === "session-conflict" &&
        row.conflict_hash_count === "2" &&
        row.payload_json.length > 0
    )
  );

  const testTrials = await readCsvRecords(
    path.join(outputPath, "test", "trials.csv")
  );
  assert.equal(testTrials.length, 5);
  assert.ok(testTrials.every((row) => row.session_id === "session-test"));

  const invalid = await readCsvRecords(
    path.join(outputPath, "invalid-submissions.csv")
  );
  assert.equal(invalid.length, 0);
});

test("fallback reconciliation is treated as a state upgrade rather than an answer conflict", async () => {
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "mmq-netlify-fallback-upgrade-")
  );
  const inputPath = path.join(temporaryRoot, "netlify.csv");
  const outputPath = path.join(temporaryRoot, "organized");
  const unreconciled = makePayload({
    sessionId: "session-fallback-upgrade",
    participantId: "participant-fallback-upgrade",
    classification: "formal",
    allocationMethod: "client_fallback",
    allocationStatus: "unreconciled",
    fallbackReasonCode: "allocation_timeout",
    fallbackReconciledAt: null
  });
  const confirmed = clone(unreconciled);
  confirmed.session.allocation_status = "confirmed";
  confirmed.session.fallback_reconciled_at =
    "2026-07-27T02:00:30.000Z";

  await writeFile(
    inputPath,
    buildNetlifyCsv([
      submission(unreconciled, {
        createdAt: "2026-07-27T02:00:00.000Z",
        mirrorSource: "client_emergency"
      }),
      submission(confirmed, {
        createdAt: "2026-07-27T02:01:00.000Z",
        receiptId: "receipt-fallback-upgrade",
        submissionAuthority: "netlify_database",
        mirrorSource: "authority_queue"
      })
    ]),
    "utf8"
  );

  const summary = await organizeNetlifyFormsExport({
    inputPath,
    outputPath
  });

  assert.equal(summary.classifications.formal.accepted_sessions, 1);
  assert.equal(summary.classifications.formal.accepted_trials, 5);
  assert.equal(summary.classifications.formal.exact_duplicate_rows, 0);
  assert.equal(summary.classifications.formal.fallback_state_upgrade_rows, 1);
  assert.equal(summary.conflict_sessions_excluded, 0);
  assert.equal(summary.classifications.formal.conflict_rows, 0);

  const participants = await readCsvRecords(
    path.join(outputPath, "formal", "participants.csv")
  );
  assert.equal(participants.length, 1);
  assert.equal(participants[0].allocation_status, "confirmed");
  assert.equal(
    participants[0].fallback_reconciled_at,
    "2026-07-27T02:00:30.000Z"
  );

  const duplicates = await readCsvRecords(
    path.join(outputPath, "formal", "duplicate-submissions.csv")
  );
  assert.equal(duplicates.length, 1);
  assert.equal(duplicates[0].duplicate_reason, "fallback_state_upgrade");
  assert.equal(duplicates[0].retained_source_row, "3");

  const conflicts = await readCsvRecords(
    path.join(outputPath, "formal", "submission-conflicts.csv")
  );
  assert.equal(conflicts.length, 0);
});

test("fallback state upgrades never hide changed trials or demographics", async () => {
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "mmq-netlify-fallback-conflicts-")
  );
  const inputPath = path.join(temporaryRoot, "netlify.csv");
  const outputPath = path.join(temporaryRoot, "organized");

  const trialOld = makePayload({
    sessionId: "session-fallback-trial-conflict",
    participantId: "participant-fallback-trial-conflict",
    classification: "formal",
    allocationMethod: "client_fallback",
    allocationStatus: "unreconciled",
    fallbackReasonCode: "allocation_timeout",
    fallbackReconciledAt: null
  });
  const trialNew = clone(trialOld);
  trialNew.session.allocation_status = "confirmed";
  trialNew.session.fallback_reconciled_at =
    "2026-07-27T03:00:30.000Z";
  trialNew.trials[0].point += 1;

  const demographicsOld = makePayload({
    sessionId: "session-fallback-demographics-conflict",
    participantId: "participant-fallback-demographics-conflict",
    classification: "formal",
    allocationMethod: "client_fallback",
    allocationStatus: "unreconciled",
    fallbackReasonCode: "allocation_timeout",
    fallbackReconciledAt: null
  });
  const demographicsNew = clone(demographicsOld);
  demographicsNew.session.allocation_status = "confirmed";
  demographicsNew.session.fallback_reconciled_at =
    "2026-07-27T03:01:30.000Z";
  demographicsNew.demographics.age += 1;
  for (const trial of demographicsNew.trials) {
    trial.age += 1;
  }

  await writeFile(
    inputPath,
    buildNetlifyCsv([
      submission(trialOld, {
        createdAt: "2026-07-27T03:00:00.000Z",
        mirrorSource: "client_emergency"
      }),
      submission(trialNew, {
        createdAt: "2026-07-27T03:00:45.000Z",
        receiptId: "receipt-fallback-trial-conflict",
        submissionAuthority: "netlify_database",
        mirrorSource: "authority_queue"
      }),
      submission(demographicsOld, {
        createdAt: "2026-07-27T03:01:00.000Z",
        mirrorSource: "client_emergency"
      }),
      submission(demographicsNew, {
        createdAt: "2026-07-27T03:01:45.000Z",
        receiptId: "receipt-fallback-demographics-conflict",
        submissionAuthority: "netlify_database",
        mirrorSource: "authority_queue"
      })
    ]),
    "utf8"
  );

  const summary = await organizeNetlifyFormsExport({
    inputPath,
    outputPath
  });

  assert.equal(summary.classifications.formal.accepted_sessions, 0);
  assert.equal(summary.classifications.formal.fallback_state_upgrade_rows, 0);
  assert.equal(summary.conflict_sessions_excluded, 2);
  assert.equal(summary.classifications.formal.conflict_rows, 4);

  const conflicts = await readCsvRecords(
    path.join(outputPath, "formal", "submission-conflicts.csv")
  );
  assert.equal(conflicts.length, 4);
});

test("legacy formal and test payloads are quarantined as pre-randomization/test", async () => {
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "mmq-netlify-legacy-")
  );
  const inputPath = path.join(temporaryRoot, "netlify.csv");
  const outputPath = path.join(temporaryRoot, "organized");
  const oldFormal = makeLegacyPayload({
    sessionId: "session-old-formal",
    participantId: "participant-old-formal",
    classification: "formal"
  });
  const oldTest = makeLegacyPayload({
    sessionId: "session-old-test",
    participantId: "participant-old-test",
    classification: "test"
  });

  await writeFile(
    inputPath,
    buildNetlifyCsv([submission(oldFormal), submission(oldTest)]),
    "utf8"
  );
  const summary = await organizeNetlifyFormsExport({
    inputPath,
    outputPath
  });

  assert.equal(summary.classifications.formal.accepted_sessions, 0);
  assert.equal(summary.classifications.test.accepted_sessions, 0);
  assert.equal(
    summary.classifications["pre-randomization-test"].accepted_sessions,
    2
  );
  assert.equal(
    summary.classifications["pre-randomization-test"].accepted_trials,
    10
  );

  const quarantined = await readCsvRecords(
    path.join(
      outputPath,
      "pre-randomization-test",
      "participants.csv"
    )
  );
  assert.deepEqual(
    new Set(quarantined.map((row) => row.dataset_classification)),
    new Set(["formal", "test"])
  );
  assert.ok(
    quarantined.every(
      (row) =>
        row.export_classification === "pre-randomization-test" &&
        row.allocation_method === ""
    )
  );
});

test("formal allocation audit separates variable-block and fallback sensitivity files", async () => {
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "mmq-netlify-randomization-")
  );
  const inputPath = path.join(temporaryRoot, "netlify.csv");
  const outputPath = path.join(temporaryRoot, "organized");
  const variableBlock = makePayload({
    sessionId: "01-variable-block",
    participantId: "participant-variable",
    classification: "formal",
    format: "table"
  });
  const fallbackReconciled = makePayload({
    sessionId: "02-fallback-reconciled",
    participantId: "participant-fallback-reconciled",
    classification: "formal",
    format: "graph",
    allocationMethod: "client_fallback",
    fallbackReasonCode: "allocation_server_error",
    fallbackReconciledAt: "2026-07-27T02:05:00.000Z"
  });
  const fallbackUnreconciled = makePayload({
    sessionId: "03-fallback-unreconciled",
    participantId: "participant-fallback-unreconciled",
    classification: "formal",
    format: "video",
    allocationMethod: "client_fallback",
    allocationStatus: "unreconciled",
    fallbackReasonCode: "allocation_timeout"
  });

  await writeFile(
    inputPath,
    buildNetlifyCsv(
      [variableBlock, fallbackReconciled, fallbackUnreconciled].map((payload) =>
        submission(payload)
      )
    ),
    "utf8"
  );
  const summary = await organizeNetlifyFormsExport({
    inputPath,
    outputPath
  });

  assert.deepEqual(summary.randomization_audit, {
    accepted_formal_sessions: 3,
    variable_block_sessions: 1,
    fallback_sessions: 2,
    fallback_reconciled_sessions: 1,
    fallback_unreconciled_sessions: 1,
    fallback_rate: 2 / 3,
    maximum_consecutive_fallback: 2,
    pause_recommended: true,
    all_formal_format_counts: { table: 1, graph: 1, video: 1 },
    variable_block_only_format_counts: { table: 1, graph: 0, video: 0 },
    fallback_format_counts: { table: 0, graph: 1, video: 1 },
    interpretation:
      "Counts cover accepted completed Forms submissions, not every assignment in the private allocation ledger."
  });

  const expectedFiles = [
    ["variable-block-participants.csv", 1],
    ["variable-block-trials.csv", 5],
    ["fallback-reconciled-participants.csv", 1],
    ["fallback-reconciled-trials.csv", 5],
    ["fallback-unreconciled-participants.csv", 1],
    ["fallback-unreconciled-trials.csv", 5]
  ];
  for (const [filename, expectedRows] of expectedFiles) {
    const rows = await readCsvRecords(
      path.join(outputPath, "formal", filename)
    );
    assert.equal(rows.length, expectedRows, filename);
  }

  const formalParticipants = await readCsvRecords(
    path.join(outputPath, "formal", "participants.csv")
  );
  const formalTrials = await readCsvRecords(
    path.join(outputPath, "formal", "trials.csv")
  );
  assert.equal(formalParticipants.length, 3);
  assert.equal(formalTrials.length, 15);
  assert.deepEqual(
    new Set(formalTrials.map((row) => row.allocation_method)),
    new Set(["variable_block", "client_fallback"])
  );
});

test("post-cutover formal allocation metadata is strict and reconciled with Forms columns", () => {
  const partial = makePayload({
    sessionId: "session-partial-allocation",
    participantId: "participant-partial",
    classification: "formal"
  });
  delete partial.session.fallback_reconciled_at;

  const invalidVersion = makePayload({
    sessionId: "session-invalid-version",
    participantId: "participant-invalid-version",
    classification: "formal"
  });
  invalidVersion.session.randomization_version = "unexpected-version";

  const mismatchedOuter = submission(
    makePayload({
      sessionId: "session-outer-mismatch",
      participantId: "participant-outer-mismatch",
      classification: "formal"
    })
  );
  mismatchedOuter.allocationMethod = "client_fallback";

  const invalidFallbackReason = makePayload({
    sessionId: "session-invalid-fallback-reason",
    participantId: "participant-invalid-fallback-reason",
    classification: "formal",
    allocationMethod: "client_fallback",
    fallbackReasonCode: "unapproved_reason",
    fallbackReconciledAt: "2026-07-27T02:05:00.000Z"
  });

  const unconfirmedVariableBlock = makePayload({
    sessionId: "session-unconfirmed-variable-block",
    participantId: "participant-unconfirmed-variable-block",
    classification: "formal",
    allocationStatus: "unreconciled"
  });

  const result = parseNetlifyRecords(
    buildNetlifyCsv([
      submission(partial),
      submission(invalidVersion),
      mismatchedOuter,
      submission(invalidFallbackReason),
      submission(unconfirmedVariableBlock)
    ])
  );

  assert.equal(result.records.length, 0);
  assert.deepEqual(
    result.invalidSubmissions.map((row) => row.error_code),
    [
      "ALLOCATION_SCHEMA",
      "CATALOG_FIELD_MISMATCH",
      "ALLOCATION_FIELD_MISMATCH",
      "SCHEMA_ENUM",
      "CATALOG_FIELD_MISMATCH"
    ]
  );
});

test("a successful pre-submit reconcile may be timestamped after the frozen questionnaire payload", () => {
  const reconciledAfterQuestionnaire = makePayload({
    sessionId: "session-reconciled-after-questionnaire",
    participantId: "participant-reconciled-after-questionnaire",
    classification: "formal",
    allocationMethod: "client_fallback",
    fallbackReasonCode: "allocation_network_error",
    fallbackReconciledAt: "2026-07-27T02:10:01.000Z"
  });
  const reconciledBeforeAssignment = makePayload({
    sessionId: "session-reconciled-before-assignment",
    participantId: "participant-reconciled-before-assignment",
    classification: "formal",
    allocationMethod: "client_fallback",
    fallbackReasonCode: "allocation_network_error",
    fallbackReconciledAt: "2026-07-27T01:59:49.000Z"
  });

  const result = parseNetlifyRecords(
    buildNetlifyCsv([
      submission(reconciledAfterQuestionnaire),
      submission(reconciledBeforeAssignment)
    ])
  );

  assert.equal(result.records.length, 1);
  assert.equal(
    result.records[0].sessionId,
    "session-reconciled-after-questionnaire"
  );
  assert.equal(result.invalidSubmissions.length, 1);
  assert.equal(
    result.invalidSubmissions[0].error_code,
    "ALLOCATION_TIME_WINDOW"
  );
});

test("bad public rows are isolated while valid formal/test rows still export", async () => {
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "mmq-netlify-invalid-")
  );
  const inputPath = path.join(temporaryRoot, "netlify.csv");
  const outputPath = path.join(temporaryRoot, "organized");
  const validFormal = makePayload({
    sessionId: "session-valid",
    participantId: "participant-valid",
    classification: "formal"
  });

  const fakeCatalog = clone(validFormal);
  fakeCatalog.session.session_id = "session-fake-catalog";
  fakeCatalog.session.catalog_hash = "f".repeat(64);
  for (const trial of fakeCatalog.trials) {
    trial.session_id = fakeCatalog.session.session_id;
    trial.catalog_hash = fakeCatalog.session.catalog_hash;
  }

  const fakePath = clone(validFormal);
  fakePath.session.session_id = "session-fake-path";
  for (const trial of fakePath.trials) {
    trial.session_id = fakePath.session.session_id;
  }
  fakePath.trials[0].legacy_path = "assets/not-the-frozen-file.png";

  const unknownNestedField = clone(validFormal);
  unknownNestedField.session.session_id = "session-unknown-field";
  for (const trial of unknownNestedField.trials) {
    trial.session_id = unknownNestedField.session.session_id;
  }
  unknownNestedField.session.unapproved_nested = {
    child: { deeper: { value: "must not become a wide column" } }
  };

  const brokenPool2FastMapping = clone(validFormal);
  brokenPool2FastMapping.session.session_id = "session-bad-p2-map";
  for (const trial of brokenPool2FastMapping.trials) {
    trial.session_id = brokenPool2FastMapping.session.session_id;
  }
  brokenPool2FastMapping.trials[1].legacy_asset_no =
    brokenPool2FastMapping.trials[1].display_index;

  const invalidJsonRecord = submission(validFormal);
  invalidJsonRecord.sessionId = "session-invalid-json";
  invalidJsonRecord.payloadJson = '{"session":';
  invalidJsonRecord.payloadSha256 = hash(invalidJsonRecord.payloadJson);

  const records = [
    submission(validFormal),
    submission(fakeCatalog),
    submission(fakePath),
    submission(unknownNestedField),
    submission(brokenPool2FastMapping),
    invalidJsonRecord
  ];
  await writeFile(inputPath, buildNetlifyCsv(records), "utf8");

  const summary = await organizeNetlifyFormsExport({
    inputPath,
    outputPath
  });

  assert.equal(summary.source_rows, 6);
  assert.equal(summary.valid_source_rows, 1);
  assert.equal(summary.invalid_source_rows, 5);
  assert.equal(summary.accepted_sessions, 1);
  assert.equal(summary.accepted_trials, 5);

  const participants = await readCsvRecords(
    path.join(outputPath, "formal", "participants.csv")
  );
  assert.equal(participants.length, 1);
  assert.equal(participants[0].session_id, "session-valid");

  const invalidRows = await readCsvRecords(
    path.join(outputPath, "invalid-submissions.csv")
  );
  assert.equal(invalidRows.length, 5);
  assert.deepEqual(
    new Set(invalidRows.map((row) => row.error_code)),
    new Set([
      "CATALOG_FIELD_MISMATCH",
      "SCHEMA_FIELDS",
      "INVALID_JSON"
    ])
  );
  assert.ok(
    invalidRows.every(
      (row) =>
        row.error_message.length > 0 &&
        row.payload_excerpt.length <= 1201
    )
  );
});

test("hash, field whitelist, trial count and formal/test gate violations become invalid rows", () => {
  const formal = makePayload({
    sessionId: "session-validation",
    participantId: "participant-validation",
    classification: "formal"
  });

  const wrongHashRecord = submission(formal);
  wrongHashRecord.payloadSha256 = "0".repeat(64);

  const missingHashRecord = submission(formal);
  missingHashRecord.payloadSha256 = "";

  const incomplete = clone(formal);
  incomplete.session.session_id = "session-incomplete";
  incomplete.trials.pop();
  for (const trial of incomplete.trials) {
    trial.session_id = incomplete.session.session_id;
  }

  const wrongFormalGate = clone(formal);
  wrongFormalGate.session.session_id = "session-wrong-gate";
  wrongFormalGate.session.formal_collection_allowed = false;
  for (const trial of wrongFormalGate.trials) {
    trial.session_id = wrongFormalGate.session.session_id;
  }

  const result = parseNetlifyRecords(
    buildNetlifyCsv([
      wrongHashRecord,
      missingHashRecord,
      submission(incomplete),
      submission(wrongFormalGate)
    ])
  );

  assert.equal(result.records.length, 0);
  assert.deepEqual(
    result.invalidSubmissions.map((row) => row.error_code),
    [
      "HASH_MISMATCH",
      "HASH_MISSING",
      "TRIAL_COUNT",
      "CATALOG_FIELD_MISMATCH"
    ]
  );
});

test("malformed CSV structure still fails fast", () => {
  assert.throws(
    () => parseNetlifyRecords('payload_json,session_id\r\n"{""x"":1}",id,extra'),
    (error) =>
      error instanceof ExportValidationError &&
      /Expected 2 columns but found 3/.test(error.message)
  );
  assert.throws(
    () => parseCsv('a,b\r\nunquoted"quote,value\r\n'),
    (error) =>
      error instanceof ExportValidationError &&
      error.code === "CSV_QUOTE_STRUCTURE"
  );
});

test("an all-empty data row is counted and isolated rather than silently dropped", () => {
  const valid = makePayload({
    sessionId: "session-empty-row-check",
    participantId: "participant-empty-row-check",
    classification: "test"
  });
  const csv = `${buildNetlifyCsv([submission(valid)])}${",".repeat(23)}\r\n`;
  const result = parseNetlifyRecords(csv);

  assert.equal(result.records.length, 1);
  assert.equal(result.invalidSubmissions.length, 1);
  assert.equal(result.invalidSubmissions[0].source_row, 3);
  assert.equal(result.invalidSubmissions[0].error_code, "INVALID_JSON");
  assert.equal(result.invalidSubmissions[0].payload_json_bytes, 0);
  assert.equal(result.invalidSubmissions[0].payload_json_sha256, hash(""));
});

test("a failed replacement never deletes the previous export or an input stored inside it", async () => {
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "mmq-netlify-atomic-")
  );
  const outputPath = path.join(temporaryRoot, "organized");
  const sentinelPath = path.join(outputPath, "sentinel.txt");
  const malformedInput = path.join(temporaryRoot, "malformed.csv");
  await mkdir(outputPath);
  await writeFile(sentinelPath, "keep-me", "utf8");
  await writeFile(malformedInput, 'payload_json\r\n"unterminated', "utf8");

  await assert.rejects(
    organizeNetlifyFormsExport({
      inputPath: malformedInput,
      outputPath,
      overwrite: true
    }),
    ExportValidationError
  );
  assert.equal(await readFile(sentinelPath, "utf8"), "keep-me");

  const nestedInput = path.join(outputPath, "source.csv");
  await writeFile(nestedInput, "payload_json\r\n", "utf8");
  await assert.rejects(
    organizeNetlifyFormsExport({
      inputPath: nestedInput,
      outputPath,
      overwrite: true
    }),
    (error) =>
      error instanceof ExportValidationError &&
      error.code === "INPUT_INSIDE_OUTPUT"
  );
});

test("overwrite refuses a symbolic-link or junction output target", async (t) => {
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "mmq-netlify-link-")
  );
  const targetPath = path.join(temporaryRoot, "target");
  const linkedOutput = path.join(temporaryRoot, "linked-output");
  const inputPath = path.join(temporaryRoot, "netlify.csv");
  await mkdir(targetPath);
  try {
    await symlink(
      targetPath,
      linkedOutput,
      process.platform === "win32" ? "junction" : "dir"
    );
  } catch (error) {
    if (error?.code === "EPERM" || error?.code === "EACCES") {
      t.skip("This host does not permit creating a test symlink.");
      return;
    }
    throw error;
  }
  const payload = makePayload({
    sessionId: "session-link",
    participantId: "participant-link",
    classification: "test"
  });
  await writeFile(inputPath, buildNetlifyCsv([submission(payload)]), "utf8");

  await assert.rejects(
    organizeNetlifyFormsExport({
      inputPath,
      outputPath: linkedOutput,
      overwrite: true
    }),
    (error) =>
      error instanceof ExportValidationError &&
      error.code === "UNSAFE_OUTPUT_LINK"
  );
});

function makePayload({
  sessionId,
  participantId,
  classification,
  point = 10,
  format = "graph",
  allocationMethod = "variable_block",
  allocationStatus = "confirmed",
  fallbackReasonCode = null,
  fallbackReconciledAt = null
}) {
  const submittedAt = "2026-07-27T02:10:00.000Z";
  const demographics = {
    gender: "女",
    age: 31,
    education: "本科",
    experience: "中等经验",
    stat_course: "是",
    started_at: "2026-07-27T02:09:00.000Z",
    submitted_at: submittedAt,
    duration_ms: 60000
  };
  const selectedSequences = selectFixtureSequences();

  const allocation =
    classification === "formal"
      ? {
          allocation_id: `allocation-${sessionId}`,
          randomization_version: "mmq-randomization-2026-07-v1",
          allocation_method: allocationMethod,
          allocation_status: allocationStatus,
          assigned_at: "2026-07-27T01:59:50.000Z",
          fallback_reason_code: fallbackReasonCode,
          fallback_reconciled_at: fallbackReconciledAt
        }
      : {
          allocation_id: null,
          randomization_version: null,
          allocation_method: null,
          allocation_status: null,
          assigned_at: null,
          fallback_reason_code: null,
          fallback_reconciled_at: null
        };

  return {
    session: {
      session_id: sessionId,
      participant_id: participantId,
      format_assignment: format,
      stimulus_set_version: stimulusSetVersion,
      catalog_hash: catalogHash,
      dataset_classification: classification,
      formal_collection_allowed: classification === "formal",
      started_at: "2026-07-27T02:00:00.000Z",
      submitted_at: submittedAt,
      duration_ms: 600000,
      ...allocation
    },
    trials: selectedSequences.map((sequence, index) =>
      makeTrial({
        sequence,
        trialNo: index + 1,
        format,
        responseType: index === 4 ? "point_spd" : "point_only",
        sessionId,
        classification,
        demographics,
        point
      })
    ),
    demographics
  };
}

function makeLegacyPayload(options) {
  const payload = makePreSinglePlayPayload(options);
  for (const field of [
    "allocation_id",
    "randomization_version",
    "allocation_method",
    "allocation_status",
    "assigned_at",
    "fallback_reason_code",
    "fallback_reconciled_at"
  ]) {
    delete payload.session[field];
  }
  return payload;
}

function makePreSinglePlayPayload(options) {
  const payload = makePayload(options);
  for (const trial of payload.trials) {
    for (const field of [
      "video_playback_version",
      "playback_asset_path",
      "playback_asset_sha256",
      "video_replay_used",
      "video_replay_completed",
      "video_initial_restart_count"
    ]) {
      delete trial[field];
    }
    if (trial.format === "video") {
      trial.stimulus_path = trial.legacy_path;
      trial.asset_sha256 = trial.legacy_asset_sha256;
    }
  }
  return payload;
}

function selectFixtureSequences() {
  const criteria = [
    (sequence) => sequence.pool === "Pool_1" && sequence.source_id === 1,
    (sequence) =>
      sequence.pool === "Pool_2" &&
      sequence.variant === "fast" &&
      sequence.source_id === 19,
    (sequence) => sequence.pool === "Pool_3" && sequence.source_id === 1,
    (sequence) => sequence.pool === "Pool_4" && sequence.source_id === 1,
    (sequence) => sequence.pool === "Pool_1" && sequence.source_id === 2
  ];
  return criteria.map((predicate) => {
    const sequence = sequenceCatalog.find(predicate);
    assert.ok(sequence, "real frozen fixture sequence must exist");
    return sequence;
  });
}

function makeTrial({
  sequence,
  trialNo,
  format,
  responseType,
  sessionId,
  classification,
  demographics,
  point
}) {
  const presentation = sequence.presentations[format];
  const isTable = format === "table";
  const isVideo = format === "video";
  const videoPlayback = isVideo
    ? getVideoPlaybackMetadata(presentation.presentation_uid)
    : null;
  if (isVideo && !videoPlayback) {
    throw new Error(
      `Missing Video playback metadata for ${presentation.presentation_uid}.`
    );
  }
  const isDistribution = responseType === "point_spd";
  const supports = isDistribution ? [1, 2, 3, 4, 5] : [null, null, null, null, null];
  const probabilities = isDistribution
    ? [10, 20, 40, 20, 10]
    : [null, null, null, null, null];
  const metadata = sequence.metadata ?? {};

  return {
    session_id: sessionId,
    format_assignment: format,
    stimulus_set_version: stimulusSetVersion,
    catalog_hash: catalogHash,
    dataset_classification: classification,
    trial_no: trialNo,
    pool: sequence.pool,
    sequence_uid: sequence.sequence_uid,
    canonical_key: sequence.canonical_key,
    presentation_uid: presentation.presentation_uid,
    source_id: sequence.source_id,
    stimulus_id: String(sequence.source_id),
    display_index: sequence.display_index,
    legacy_asset_no: sequence.legacy_asset_no,
    pair_uid: sequence.pair_uid,
    format,
    variant: sequence.variant,
    response_type: responseType,
    legacy_path: presentation.legacy_path,
    legacy_asset_path: presentation.legacy_path,
    stimulus_path: isVideo
      ? videoPlayback.playback_asset_path
      : presentation.legacy_path,
    legacy_asset_sha256: presentation.asset_sha256,
    asset_sha256: isTable
      ? null
      : isVideo
        ? videoPlayback.playback_asset_sha256
        : presentation.asset_sha256,
    renderer_version: isTable ? TABLE_RENDERER_VERSION : null,
    video_playback_version: isVideo
      ? videoPlayback.playback_version
      : null,
    playback_asset_path: isVideo
      ? videoPlayback.playback_asset_path
      : null,
    playback_asset_sha256: isVideo
      ? videoPlayback.playback_asset_sha256
      : null,
    video_replay_used: false,
    video_replay_completed: false,
    video_initial_restart_count: 0,
    values_sha256: sequence.values_sha256,
    pool2_speed: sequence.pool === "Pool_2" ? sequence.variant : null,
    source_data_file: sequence.source_data_file,
    rho: metadata.rho ?? null,
    trend: metadata.trend ?? null,
    beta: metadata.beta ?? null,
    condition: metadata.condition ?? null,
    tau_obs: metadata.tau_obs ?? null,
    beta1: metadata.beta1 ?? null,
    beta2: metadata.beta2 ?? null,
    structure: metadata.structure ?? null,
    direction: metadata.direction ?? null,
    sigma1: metadata.sigma1 ?? null,
    sigma2: metadata.sigma2 ?? null,
    point,
    trial_started_at: `2026-07-27T02:0${trialNo - 1}:00.000Z`,
    trial_submitted_at: `2026-07-27T02:0${trialNo}:00.000Z`,
    trial_duration_ms: 60000,
    visit_count: 1,
    revision_count: 0,
    fullscreen_open_count: isTable ? null : 0,
    fullscreen_duration_ms: isTable ? null : 0,
    asset_load_duration_ms: isTable ? null : 250,
    asset_load_attempt_count: isTable ? 0 : 1,
    asset_load_status: isTable ? "not_applicable" : "loaded",
    s1: supports[0],
    s2: supports[1],
    s3: supports[2],
    s4: supports[3],
    s5: supports[4],
    p1: probabilities[0],
    p2: probabilities[1],
    p3: probabilities[2],
    p4: probabilities[3],
    p5: probabilities[4],
    gender: demographics.gender,
    age: demographics.age,
    education: demographics.education,
    experience: demographics.experience,
    stat_course: demographics.stat_course,
    sumS: isDistribution ? 15 : null,
    sumP: isDistribution ? 100 : null
  };
}

function submission(
  payload,
  {
    pretty = false,
    createdAt = "2026-07-27 10:00",
    attempt = "1",
    latency = "",
    scope = "previous_completed_attempt",
    receiptId = "",
    submissionAuthority = "",
    mirrorSource = ""
  } = {}
) {
  const payloadJson = JSON.stringify(payload, null, pretty ? 2 : 0);
  return {
    sessionId: payload.session.session_id,
    participantId: payload.session.participant_id,
    format: payload.session.format_assignment,
    classification: payload.session.dataset_classification,
    stimulusSetVersion: payload.session.stimulus_set_version,
    catalogHash: payload.session.catalog_hash,
    submittedAt: payload.session.submitted_at,
    allocationId: payload.session.allocation_id,
    randomizationVersion: payload.session.randomization_version,
    allocationMethod: payload.session.allocation_method,
    allocationStatus: payload.session.allocation_status,
    assignedAt: payload.session.assigned_at,
    fallbackReasonCode: payload.session.fallback_reason_code,
    fallbackReconciledAt: payload.session.fallback_reconciled_at,
    payloadSha256: hash(payloadJson),
    payloadJson,
    createdAt,
    attempt,
    latency,
    scope,
    receiptId,
    submissionAuthority,
    mirrorSource
  };
}

function buildNetlifyCsv(records) {
  const header = [
    "created_at",
    "session_id",
    "participant_id",
    "format_assignment",
    "dataset_classification",
    "stimulus_set_version",
    "catalog_hash",
    "submitted_at",
    "payload_sha256",
    "allocation_id",
    "randomization_version",
    "allocation_method",
    "allocation_status",
    "assigned_at",
    "fallback_reason_code",
    "fallback_reconciled_at",
    "submit_attempt_count",
    "submit_latency_ms",
    "submit_latency_scope",
    "receipt_id",
    "submission_authority",
    "mirror_source",
    "submission_note",
    "payload_json"
  ];
  const rows = records.map((record) => [
    record.createdAt,
    record.sessionId,
    record.participantId,
    record.format,
    record.classification,
    record.stimulusSetVersion,
    record.catalogHash,
    record.submittedAt,
    record.payloadSha256,
    record.allocationId,
    record.randomizationVersion,
    record.allocationMethod,
    record.allocationStatus,
    record.assignedAt,
    record.fallbackReasonCode,
    record.fallbackReconciledAt,
    record.attempt,
    record.latency,
    record.scope,
    record.receiptId,
    record.submissionAuthority,
    record.mirrorSource,
    '表单备注, 包含"引号"\n与换行',
    record.payloadJson
  ]);

  return `\uFEFF${[header, ...rows]
    .map((row) => row.map(independentCsvEscape).join(","))
    .join("\r\n")}\r\n`;
}

function independentCsvEscape(value) {
  const stringValue = String(value ?? "");
  if (!/[",\r\n]/.test(stringValue)) {
    return stringValue;
  }
  return `"${stringValue.replaceAll('"', '""')}"`;
}

async function readCsvRecords(filename) {
  const rows = parseCsv(await readFile(filename, "utf8"));
  const headers = rows[0];
  return rows.slice(1).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index]]))
  );
}

function hash(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
