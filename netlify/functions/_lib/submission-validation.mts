import { createHash } from "node:crypto";
import {
  sequenceCatalog,
} from "../../../frontend/src/data/sequenceCatalog.generated.ts";
import {
  getVideoPlaybackMetadata,
} from "../../../frontend/src/data/videoPlaybackManifest.generated.ts";
import {
  trialCsvHeaders,
} from "../../../frontend/src/experiment/experimentTypes.ts";
import {
  TABLE_RENDERER_VERSION,
} from "../../../frontend/src/experiment/seriesTableRenderer.ts";
import metadata from "../../randomization/public-schedule-metadata.json" with {
  type: "json",
};
import type {
  AllocationMethod,
  FallbackReasonCode,
  StimulusFormat,
} from "./randomization-types.mts";
import {
  CATALOG_HASH,
  STIMULUS_SET_VERSION,
  tokenHmac,
} from "./randomization-validation.mts";
import {
  invalidSubmissionRequest,
  submissionHashMismatch,
  submissionReleaseMismatch,
  submissionTooLarge,
} from "./submission-errors.mts";
import type {
  DatasetClassification,
  ValidatedSubmission,
  VideoPlaybackVersion,
} from "./submission-types.mts";

export const MAX_SUBMISSION_REQUEST_BYTES = 512 * 1024;
export const MAX_PAYLOAD_JSON_BYTES = 256 * 1024;

const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,255}$/;
const CLIENT_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,255}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const FORMATS = new Set<StimulusFormat>(["table", "graph", "video"]);
const ALLOCATION_METHODS = new Set<AllocationMethod>([
  "variable_block",
  "client_fallback",
]);
const FALLBACK_REASONS = new Set<FallbackReasonCode>([
  "allocation_timeout",
  "allocation_network_error",
  "allocation_server_error",
]);
const REQUEST_FIELDS = [
  "schema_version",
  "client_token",
  "payload_json",
  "payload_sha256",
  "transport",
] as const;
const TRANSPORT_FIELDS = [
  "client_attempt_count",
  "previous_attempt_latency_ms",
] as const;
const PAYLOAD_FIELDS = ["session", "trials", "demographics"] as const;
const SESSION_FIELDS = [
  "session_id",
  "participant_id",
  "format_assignment",
  "stimulus_set_version",
  "catalog_hash",
  "dataset_classification",
  "formal_collection_allowed",
  "allocation_id",
  "randomization_version",
  "allocation_method",
  "allocation_status",
  "assigned_at",
  "fallback_reason_code",
  "fallback_reconciled_at",
  "started_at",
  "submitted_at",
  "duration_ms",
] as const;
const DEMOGRAPHICS_FIELDS = [
  "gender",
  "age",
  "education",
  "experience",
  "stat_course",
  "started_at",
  "submitted_at",
  "duration_ms",
] as const;
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
  "sigma2",
] as const;
const DEMOGRAPHIC_OPTIONS = {
  gender: new Set(["男", "女"]),
  education: new Set([
    "高中及以下",
    "大专/高职",
    "本科",
    "硕士",
    "博士",
  ]),
  experience: new Set([
    "毫无经验",
    "有一些经验",
    "中等经验",
    "非常丰富的经验",
  ]),
  stat_course: new Set(["是", "否"]),
} as const;
const MAX_RESEARCH_DURATION_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_RESEARCH_COUNTER = 100_000;
const MAX_ANSWER_MAGNITUDE = 1e12;
const VIDEO_PLAYBACK_VERSION: VideoPlaybackVersion =
  "single-play-gif-v1";
const EXPECTED_POOLS = [
  "Pool_1",
  "Pool_2",
  "Pool_3",
  "Pool_4",
  "Pool_1",
] as const;
const EXPECTED_RESPONSE_TYPES = [
  "point_only",
  "point_only",
  "point_only",
  "point_only",
  "point_spd",
] as const;
const CATALOG_BY_SEQUENCE_UID = new Map(
  sequenceCatalog.map((sequence) => [sequence.sequence_uid, sequence]),
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw invalidSubmissionRequest(`'${label}' must be an object.`);
  }
  return value;
}

function assertExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
  label: string,
): void {
  const expected = new Set(expectedKeys);
  const actualKeys = Object.keys(value);
  const unknown = actualKeys.filter((key) => !expected.has(key));
  const missing = expectedKeys.filter(
    (key) => !Object.prototype.hasOwnProperty.call(value, key),
  );
  if (unknown.length > 0 || missing.length > 0) {
    throw invalidSubmissionRequest(
      `'${label}' fields do not match the approved schema`
      + `${unknown.length > 0 ? `; unknown: ${unknown.join(", ")}` : ""}`
      + `${missing.length > 0 ? `; missing: ${missing.join(", ")}` : ""}.`,
    );
  }
}

function assertEqual(
  actual: unknown,
  expected: unknown,
  label: string,
): void {
  if (!Object.is(actual, expected)) {
    throw invalidSubmissionRequest(`'${label}' is inconsistent or invalid.`);
  }
}

function integerInRange(
  value: unknown,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (
    !Number.isInteger(value)
    || (value as number) < minimum
    || (value as number) > maximum
  ) {
    throw invalidSubmissionRequest(
      `'${label}' must be an integer from ${minimum} through ${maximum}.`,
    );
  }
  return value as number;
}

function finiteInRange(
  value: unknown,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (
    typeof value !== "number"
    || !Number.isFinite(value)
    || value < minimum
    || value > maximum
  ) {
    throw invalidSubmissionRequest(
      `'${label}' must be a finite number from ${minimum} through ${maximum}.`,
    );
  }
  return value;
}

function approximatelyEqual(
  actual: unknown,
  expected: number,
  label: string,
  tolerance = 1e-9,
): void {
  if (
    typeof actual !== "number"
    || !Number.isFinite(actual)
    || Math.abs(actual - expected) > tolerance
  ) {
    throw invalidSubmissionRequest(
      `'${label}' does not match its calculated value.`,
    );
  }
}

function enumString(
  value: unknown,
  allowed: ReadonlySet<string>,
  label: string,
): string {
  if (typeof value !== "string" || !allowed.has(value)) {
    throw invalidSubmissionRequest(`'${label}' is invalid.`);
  }
  return value;
}

function requiredString(
  value: Record<string, unknown>,
  key: string,
  pattern?: RegExp,
): string {
  const candidate = value[key];
  if (
    typeof candidate !== "string"
    || candidate.length === 0
    || (pattern && !pattern.test(candidate))
  ) {
    throw invalidSubmissionRequest(`'${key}' is missing or invalid.`);
  }
  return candidate;
}

function nullableString(
  value: Record<string, unknown>,
  key: string,
): string | null {
  const candidate = value[key];
  if (candidate === null) return null;
  if (typeof candidate !== "string" || candidate.length === 0) {
    throw invalidSubmissionRequest(`'${key}' must be a string or null.`);
  }
  return candidate;
}

function isoTimestamp(value: string, key: string): string {
  if (
    value.length > 64
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString() !== value
  ) {
    throw invalidSubmissionRequest(
      `'${key}' must be a canonical ISO-8601 UTC timestamp.`,
    );
  }
  return value;
}

function assertTimeWindow(
  startedAt: string,
  submittedAt: string,
  sessionStartedAt: string,
  sessionSubmittedAt: string,
  label: string,
): void {
  const started = Date.parse(startedAt);
  const submitted = Date.parse(submittedAt);
  if (
    started > submitted
    || started < Date.parse(sessionStartedAt)
    || submitted > Date.parse(sessionSubmittedAt)
  ) {
    throw invalidSubmissionRequest(
      `'${label}' timestamps must be ordered within the session window.`,
    );
  }
}

function stimulusFormat(value: unknown, key: string): StimulusFormat {
  if (typeof value !== "string" || !FORMATS.has(value as StimulusFormat)) {
    throw invalidSubmissionRequest(`'${key}' is invalid.`);
  }
  return value as StimulusFormat;
}

function datasetClassification(
  value: unknown,
): DatasetClassification {
  if (value !== "formal" && value !== "test") {
    throw invalidSubmissionRequest(
      "'dataset_classification' must be 'formal' or 'test'.",
    );
  }
  return value;
}

function allocationMethod(value: unknown): AllocationMethod | null {
  if (value === null) return null;
  if (
    typeof value !== "string"
    || !ALLOCATION_METHODS.has(value as AllocationMethod)
  ) {
    throw invalidSubmissionRequest("'allocation_method' is invalid.");
  }
  return value as AllocationMethod;
}

function assertRelease(
  stimulusSetVersion: string,
  catalogHash: string,
): void {
  if (
    stimulusSetVersion !== STIMULUS_SET_VERSION
    || catalogHash !== CATALOG_HASH
  ) {
    throw submissionReleaseMismatch();
  }
}

function parseTransport(body: Record<string, unknown>): {
  clientAttemptCount: number;
  previousAttemptLatencyMs: number | null;
} {
  const transport = record(body.transport, "transport");
  assertExactKeys(transport, TRANSPORT_FIELDS, "transport");
  const clientAttemptCount = integerInRange(
    transport.client_attempt_count,
    1,
    1_000,
    "transport.client_attempt_count",
  );
  const previousAttemptLatencyMs = transport.previous_attempt_latency_ms;
  if (
    previousAttemptLatencyMs !== null
    && (
      !Number.isInteger(previousAttemptLatencyMs)
      || (previousAttemptLatencyMs as number) < 0
      || (previousAttemptLatencyMs as number) > 3_600_000
    )
  ) {
    throw invalidSubmissionRequest(
      "'transport.previous_attempt_latency_ms' is invalid.",
    );
  }
  return {
    clientAttemptCount,
    previousAttemptLatencyMs: previousAttemptLatencyMs as number | null,
  };
}

function assertTrials(
  payload: Record<string, unknown>,
  session: Record<string, unknown>,
  sessionId: string,
  classification: DatasetClassification,
  format: StimulusFormat,
): void {
  if (!Array.isArray(payload.trials) || payload.trials.length !== 5) {
    throw invalidSubmissionRequest(
      "'payload_json.trials' must contain exactly five trials.",
    );
  }
  const trialNumbers = new Set<number>();
  const sequenceUids = new Set<string>();
  let firstSequenceUid: string | null = null;
  let fifthSequenceUid: string | null = null;
  const demographics = record(
    payload.demographics,
    "payload_json.demographics",
  );
  for (const [index, value] of payload.trials.entries()) {
    const trial = record(value, `payload_json.trials[${index}]`);
    const trialLabel = `payload_json.trials[${index}]`;
    assertExactKeys(trial, trialCsvHeaders, trialLabel);
    if (
      trial.session_id !== sessionId
      || trial.dataset_classification !== classification
      || trial.format_assignment !== format
      || trial.format !== format
      || trial.stimulus_set_version !== STIMULUS_SET_VERSION
      || trial.catalog_hash !== CATALOG_HASH
    ) {
      throw invalidSubmissionRequest(
        `Trial ${index + 1} is inconsistent with its session.`,
      );
    }
    if (
      !Number.isInteger(trial.trial_no)
      || (trial.trial_no as number) < 1
      || (trial.trial_no as number) > 5
      || trial.trial_no !== index + 1
    ) {
      throw invalidSubmissionRequest(
        `Trial ${index + 1} has an invalid trial number.`,
      );
    }
    if (
      trial.pool !== EXPECTED_POOLS[index]
      || trial.response_type !== EXPECTED_RESPONSE_TYPES[index]
    ) {
      throw invalidSubmissionRequest(
        `Trial ${index + 1} has an invalid research role.`,
      );
    }
    trialNumbers.add(trial.trial_no as number);
    const sequenceUid = requiredString(trial, "sequence_uid");
    sequenceUids.add(sequenceUid);
    const sequence = CATALOG_BY_SEQUENCE_UID.get(
      sequenceUid as typeof sequenceCatalog[number]["sequence_uid"],
    );
    if (!sequence) {
      throw invalidSubmissionRequest(
        `Trial ${index + 1} does not reference a frozen sequence.`,
      );
    }
    const presentation = sequence.presentations[format];
    const videoPlayback = format === "video"
      ? getVideoPlaybackMetadata(presentation.presentation_uid)
      : null;
    if (
      format === "video"
      && (
        !videoPlayback
        || videoPlayback.playback_version !== VIDEO_PLAYBACK_VERSION
      )
    ) {
      throw submissionReleaseMismatch();
    }
    const expectedAssetSha256 =
      format === "table"
        ? null
        : videoPlayback?.playback_asset_sha256
          ?? presentation.asset_sha256;
    const expectedStimulusPath =
      videoPlayback?.playback_asset_path
      ?? presentation.legacy_path;
    const expectedRendererVersion =
      format === "table" ? TABLE_RENDERER_VERSION : null;
    if (
      trial.stimulus_set_version !== sequence.stimulus_set_version
      || trial.canonical_key !== sequence.canonical_key
      || trial.pool !== sequence.pool
      || trial.variant !== sequence.variant
      || trial.source_id !== sequence.source_id
      || trial.stimulus_id !== String(sequence.source_id)
      || trial.display_index !== sequence.display_index
      || trial.legacy_asset_no !== sequence.legacy_asset_no
      || trial.pair_uid !== sequence.pair_uid
      || trial.values_sha256 !== sequence.values_sha256
      || trial.source_data_file !== sequence.source_data_file
      || trial.presentation_uid !== presentation.presentation_uid
      || trial.legacy_path !== presentation.legacy_path
      || trial.legacy_asset_path !== presentation.legacy_path
      || trial.stimulus_path !== expectedStimulusPath
      || trial.legacy_asset_sha256 !== presentation.asset_sha256
      || trial.asset_sha256 !== expectedAssetSha256
      || trial.renderer_version !== expectedRendererVersion
      || trial.video_playback_version
        !== (videoPlayback?.playback_version ?? null)
      || trial.playback_asset_path
        !== (videoPlayback?.playback_asset_path ?? null)
      || trial.playback_asset_sha256
        !== (videoPlayback?.playback_asset_sha256 ?? null)
      || !sequence.response_eligibility.includes(
        EXPECTED_RESPONSE_TYPES[index],
      )
    ) {
      throw invalidSubmissionRequest(
        `Trial ${index + 1} does not match the frozen catalog.`,
      );
    }
    for (const field of METADATA_FIELDS) {
      assertEqual(
        trial[field],
        sequence.metadata?.[field] ?? null,
        `${trialLabel}.${field}`,
      );
    }
    assertEqual(
      trial.pool2_speed,
      sequence.pool === "Pool_2" ? sequence.variant : null,
      `${trialLabel}.pool2_speed`,
    );
    assertTrialOperationalFields(trial, session, format, trialLabel);
    assertTrialAnswer(trial, trialLabel);
    for (const field of [
      "gender",
      "age",
      "education",
      "experience",
      "stat_course",
    ]) {
      assertEqual(
        trial[field],
        demographics[field],
        `${trialLabel}.${field}`,
      );
    }
    if (index === 0) firstSequenceUid = sequenceUid;
    if (index === 4) fifthSequenceUid = sequenceUid;
  }
  if (trialNumbers.size !== 5 || sequenceUids.size !== 5) {
    throw invalidSubmissionRequest(
      "Trial numbers and sequence identifiers must be unique.",
    );
  }
  if (firstSequenceUid === fifthSequenceUid) {
    throw invalidSubmissionRequest(
      "The first and fifth trials must use different Pool 1 sequences.",
    );
  }
  if (session.formal_collection_allowed !== (classification === "formal")) {
    throw invalidSubmissionRequest(
      "'formal_collection_allowed' is inconsistent with the dataset.",
    );
  }
}

function assertTrialOperationalFields(
  trial: Record<string, unknown>,
  session: Record<string, unknown>,
  format: StimulusFormat,
  label: string,
): void {
  const trialStartedAt = isoTimestamp(
    requiredString(trial, "trial_started_at"),
    `${label}.trial_started_at`,
  );
  const trialSubmittedAt = isoTimestamp(
    requiredString(trial, "trial_submitted_at"),
    `${label}.trial_submitted_at`,
  );
  assertTimeWindow(
    trialStartedAt,
    trialSubmittedAt,
    session.started_at as string,
    session.submitted_at as string,
    label,
  );
  integerInRange(
    trial.trial_duration_ms,
    0,
    MAX_RESEARCH_DURATION_MS,
    `${label}.trial_duration_ms`,
  );
  const visitCount = integerInRange(
    trial.visit_count,
    1,
    MAX_RESEARCH_COUNTER,
    `${label}.visit_count`,
  );
  const revisionCount = integerInRange(
    trial.revision_count,
    0,
    MAX_RESEARCH_COUNTER,
    `${label}.revision_count`,
  );
  if (revisionCount > visitCount - 1) {
    throw invalidSubmissionRequest(
      `'${label}.revision_count' cannot exceed visit_count - 1.`,
    );
  }

  if (format === "video") {
    if (
      typeof trial.video_replay_used !== "boolean"
      || typeof trial.video_replay_completed !== "boolean"
    ) {
      throw invalidSubmissionRequest(
        `'${label}' Video replay fields must be boolean.`,
      );
    }
    if (
      trial.video_replay_completed === true
      && trial.video_replay_used !== true
    ) {
      throw invalidSubmissionRequest(
        `'${label}.video_replay_completed' requires video_replay_used.`,
      );
    }
    integerInRange(
      trial.video_initial_restart_count,
      0,
      MAX_RESEARCH_COUNTER,
      `${label}.video_initial_restart_count`,
    );
  } else {
    for (const field of [
      "video_playback_version",
      "playback_asset_path",
      "playback_asset_sha256",
    ]) {
      assertEqual(trial[field], null, `${label}.${field}`);
    }
    assertEqual(
      trial.video_replay_used,
      false,
      `${label}.video_replay_used`,
    );
    assertEqual(
      trial.video_replay_completed,
      false,
      `${label}.video_replay_completed`,
    );
    assertEqual(
      trial.video_initial_restart_count,
      0,
      `${label}.video_initial_restart_count`,
    );
  }

  if (format === "table") {
    for (const field of [
      "fullscreen_open_count",
      "fullscreen_duration_ms",
      "asset_load_duration_ms",
    ]) {
      assertEqual(trial[field], null, `${label}.${field}`);
    }
    assertEqual(
      trial.asset_load_attempt_count,
      0,
      `${label}.asset_load_attempt_count`,
    );
    assertEqual(
      trial.asset_load_status,
      "not_applicable",
      `${label}.asset_load_status`,
    );
    return;
  }

  integerInRange(
    trial.fullscreen_open_count,
    0,
    MAX_RESEARCH_COUNTER,
    `${label}.fullscreen_open_count`,
  );
  integerInRange(
    trial.fullscreen_duration_ms,
    0,
    MAX_RESEARCH_DURATION_MS,
    `${label}.fullscreen_duration_ms`,
  );
  integerInRange(
    trial.asset_load_duration_ms,
    0,
    MAX_RESEARCH_DURATION_MS,
    `${label}.asset_load_duration_ms`,
  );
  integerInRange(
    trial.asset_load_attempt_count,
    1,
    MAX_RESEARCH_COUNTER,
    `${label}.asset_load_attempt_count`,
  );
  assertEqual(
    trial.asset_load_status,
    "loaded",
    `${label}.asset_load_status`,
  );
}

function assertTrialAnswer(
  trial: Record<string, unknown>,
  label: string,
): void {
  finiteInRange(
    trial.point,
    -MAX_ANSWER_MAGNITUDE,
    MAX_ANSWER_MAGNITUDE,
    `${label}.point`,
  );
  const supportFields = ["s1", "s2", "s3", "s4", "s5"] as const;
  const probabilityFields = ["p1", "p2", "p3", "p4", "p5"] as const;

  if (trial.response_type === "point_only") {
    for (const field of [
      ...supportFields,
      ...probabilityFields,
      "sumS",
      "sumP",
    ]) {
      assertEqual(trial[field], null, `${label}.${field}`);
    }
    return;
  }

  const supports = supportFields.map((field) =>
    finiteInRange(
      trial[field],
      -MAX_ANSWER_MAGNITUDE,
      MAX_ANSWER_MAGNITUDE,
      `${label}.${field}`,
    )
  );
  const probabilities = probabilityFields.map((field) =>
    finiteInRange(trial[field], 0, 100, `${label}.${field}`)
  );
  for (let index = 1; index < supports.length; index += 1) {
    if (supports[index - 1] > supports[index]) {
      throw invalidSubmissionRequest(
        `'${label}' support values must be nondecreasing.`,
      );
    }
  }
  const supportSum = supports.reduce((sum, value) => sum + value, 0);
  const probabilitySum = probabilities.reduce(
    (sum, value) => sum + value,
    0,
  );
  approximatelyEqual(trial.sumS, supportSum, `${label}.sumS`);
  approximatelyEqual(trial.sumP, probabilitySum, `${label}.sumP`);
  approximatelyEqual(
    probabilitySum,
    100,
    `${label}.probability_total`,
    0.001,
  );
}

function assertDemographics(
  demographics: Record<string, unknown>,
  session: Record<string, unknown>,
): void {
  assertExactKeys(
    demographics,
    DEMOGRAPHICS_FIELDS,
    "payload_json.demographics",
  );
  enumString(
    demographics.gender,
    DEMOGRAPHIC_OPTIONS.gender,
    "payload_json.demographics.gender",
  );
  enumString(
    demographics.education,
    DEMOGRAPHIC_OPTIONS.education,
    "payload_json.demographics.education",
  );
  enumString(
    demographics.experience,
    DEMOGRAPHIC_OPTIONS.experience,
    "payload_json.demographics.experience",
  );
  enumString(
    demographics.stat_course,
    DEMOGRAPHIC_OPTIONS.stat_course,
    "payload_json.demographics.stat_course",
  );
  integerInRange(
    demographics.age,
    1,
    150,
    "payload_json.demographics.age",
  );
  const startedAt = isoTimestamp(
    requiredString(demographics, "started_at"),
    "payload_json.demographics.started_at",
  );
  const submittedAt = isoTimestamp(
    requiredString(demographics, "submitted_at"),
    "payload_json.demographics.submitted_at",
  );
  integerInRange(
    demographics.duration_ms,
    0,
    MAX_RESEARCH_DURATION_MS,
    "payload_json.demographics.duration_ms",
  );
  assertTimeWindow(
    startedAt,
    submittedAt,
    session.started_at as string,
    session.submitted_at as string,
    "payload_json.demographics",
  );
}

function parsePayload(
  payloadJson: string,
): {
  session: Record<string, unknown>;
  payload: Record<string, unknown>;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadJson);
  } catch {
    throw invalidSubmissionRequest("'payload_json' is not valid JSON.");
  }
  const payload = record(parsed, "payload_json");
  assertExactKeys(payload, PAYLOAD_FIELDS, "payload_json");
  const session = record(payload.session, "payload_json.session");
  assertExactKeys(session, SESSION_FIELDS, "payload_json.session");
  return {
    payload,
    session,
  };
}

export function payloadSha256(payloadJson: string): string {
  return createHash("sha256").update(payloadJson, "utf8").digest("hex");
}

export function parseSubmissionBody(
  body: unknown,
  hmacSecret: string,
): ValidatedSubmission {
  const request = record(body, "request");
  assertExactKeys(request, REQUEST_FIELDS, "request");
  if (request.schema_version !== 1) {
    throw invalidSubmissionRequest("'schema_version' must be 1.");
  }
  const clientToken = requiredString(request, "client_token", CLIENT_TOKEN);
  const payloadJson = requiredString(request, "payload_json");
  if (Buffer.byteLength(payloadJson, "utf8") > MAX_PAYLOAD_JSON_BYTES) {
    throw submissionTooLarge();
  }
  const claimedSha256 = requiredString(
    request,
    "payload_sha256",
    SHA256,
  );
  if (payloadSha256(payloadJson) !== claimedSha256) {
    throw submissionHashMismatch();
  }
  const transport = parseTransport(request);
  const { payload, session } = parsePayload(payloadJson);
  const sessionId = requiredString(session, "session_id", SAFE_IDENTIFIER);
  const participantId = requiredString(
    session,
    "participant_id",
    SAFE_IDENTIFIER,
  );
  const classification = datasetClassification(
    session.dataset_classification,
  );
  const format = stimulusFormat(
    session.format_assignment,
    "format_assignment",
  );
  const stimulusSetVersion = requiredString(
    session,
    "stimulus_set_version",
  );
  const catalogHash = requiredString(session, "catalog_hash", SHA256);
  assertRelease(stimulusSetVersion, catalogHash);
  const submittedAt = isoTimestamp(
    requiredString(session, "submitted_at"),
    "submitted_at",
  );
  const startedAt = isoTimestamp(
    requiredString(session, "started_at"),
    "started_at",
  );
  const sessionDurationMs = integerInRange(
    session.duration_ms,
    0,
    MAX_RESEARCH_DURATION_MS,
    "duration_ms",
  );
  if (Date.parse(submittedAt) - Date.parse(startedAt) !== sessionDurationMs) {
    throw invalidSubmissionRequest(
      "'duration_ms' must equal submitted_at minus started_at.",
    );
  }
  const demographics = record(
    payload.demographics,
    "payload_json.demographics",
  );
  assertDemographics(demographics, session);
  assertTrials(
    payload,
    session,
    sessionId,
    classification,
    format,
  );

  let allocationId: string | null = null;
  let randomizationVersion: string | null = null;
  let method: AllocationMethod | null = null;
  let status: "confirmed" | null = null;
  let assignedAt: string | null = null;
  let fallbackReasonCode: FallbackReasonCode | null = null;
  let fallbackReconciledAt: string | null = null;

  if (classification === "formal") {
    allocationId = requiredString(
      session,
      "allocation_id",
      SAFE_IDENTIFIER,
    );
    randomizationVersion = requiredString(
      session,
      "randomization_version",
    );
    if (randomizationVersion !== metadata.randomization_version) {
      throw submissionReleaseMismatch();
    }
    method = allocationMethod(session.allocation_method);
    if (!method) {
      throw invalidSubmissionRequest(
        "'allocation_method' is required for formal data.",
      );
    }
    if (session.allocation_status !== "confirmed") {
      throw invalidSubmissionRequest(
        "A formal submission requires a confirmed allocation.",
      );
    }
    status = "confirmed";
    assignedAt = isoTimestamp(
      requiredString(session, "assigned_at"),
      "assigned_at",
    );
    const rawFallbackReason = session.fallback_reason_code;
    const rawFallbackReconciledAt = session.fallback_reconciled_at;
    if (method === "variable_block") {
      if (
        rawFallbackReason !== null
        || rawFallbackReconciledAt !== null
      ) {
        throw invalidSubmissionRequest(
          "A variable-block allocation cannot include fallback metadata.",
        );
      }
    } else {
      if (
        typeof rawFallbackReason !== "string"
        || !FALLBACK_REASONS.has(
          rawFallbackReason as FallbackReasonCode,
        )
      ) {
        throw invalidSubmissionRequest(
          "'fallback_reason_code' is invalid.",
        );
      }
      fallbackReasonCode = rawFallbackReason as FallbackReasonCode;
      fallbackReconciledAt = isoTimestamp(
        requiredString(session, "fallback_reconciled_at"),
        "fallback_reconciled_at",
      );
      if (Date.parse(fallbackReconciledAt) < Date.parse(assignedAt)) {
        throw invalidSubmissionRequest(
          "'fallback_reconciled_at' cannot precede 'assigned_at'.",
        );
      }
    }
  } else {
    for (const key of [
      "allocation_id",
      "randomization_version",
      "allocation_method",
      "allocation_status",
      "assigned_at",
      "fallback_reason_code",
      "fallback_reconciled_at",
    ]) {
      if (nullableString(session, key) !== null) {
        throw invalidSubmissionRequest(
          `Test data must not include '${key}'.`,
        );
      }
    }
  }

  return {
    clientToken,
    clientTokenHmac: tokenHmac(clientToken, hmacSecret),
    payloadJson,
    payloadSha256: claimedSha256,
    sessionId,
    participantId,
    datasetClassification: classification,
    formatAssignment: format,
    stimulusSetVersion,
    catalogHash,
    submittedAt,
    allocationId,
    randomizationVersion,
    allocationMethod: method,
    allocationStatus: status,
    assignedAt,
    fallbackReasonCode,
    fallbackReconciledAt,
    ...transport,
  };
}
