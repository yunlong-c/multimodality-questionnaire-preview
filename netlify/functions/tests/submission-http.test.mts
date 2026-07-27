import assert from "node:assert/strict";
import test, {
  afterEach,
  beforeEach,
} from "node:test";
import {
  submissionConflict,
  submissionsClosed,
} from "../_lib/submission-errors.mts";
import {
  createSubmitHandler,
  deploymentMetadata,
} from "../_lib/submission-http.mts";
import {
  buildSubmissionMirrorFormBody,
  mirrorRetryDelayMinutes,
  submissionMirrorEndpoint,
} from "../_lib/submission-mirror.mts";
import type {
  StoreSubmissionInput,
  SubmissionMirrorRow,
  SubmissionReceipt,
  SubmissionRepository,
} from "../_lib/submission-types.mts";
import {
  payloadSha256,
} from "../_lib/submission-validation.mts";
import {
  CATALOG_HASH,
  STIMULUS_SET_VERSION,
} from "../_lib/randomization-validation.mts";
import {
  sequenceCatalog,
} from "../../../frontend/src/data/sequenceCatalog.generated.ts";
import {
  TABLE_RENDERER_VERSION,
} from "../../../frontend/src/experiment/seriesTableRenderer.ts";

const originalSecret = process.env.MMQ_RANDOMIZATION_HMAC_SECRET;
const originalSubmissionsOpen = process.env.MMQ_SUBMISSIONS_OPEN;
const testSecret = "submission-test-secret-with-at-least-32-bytes";
const clientToken =
  "preview-client-00000000-0000-4000-8000-000000000001";
const sessionId =
  "session-00000000-0000-4000-8000-000000000002";
const participantId =
  "participant-00000000-0000-4000-8000-000000000003";

class FakeRepository implements SubmissionRepository {
  calls: StoreSubmissionInput[] = [];
  error: unknown;
  result: SubmissionReceipt = {
    receiptId: "receipt-00000000-0000-4000-8000-000000000004",
    sessionId,
    participantId,
    datasetClassification: "formal",
    payloadSha256: "0".repeat(64),
    storedAt: "2026-07-27T15:00:00.000Z",
    isReplay: false,
    mirrorStatus: "pending",
  };

  async store(input: StoreSubmissionInput): Promise<SubmissionReceipt> {
    this.calls.push(input);
    if (this.error) throw this.error;
    return {
      ...this.result,
      payloadSha256: input.payloadSha256,
      sessionId: input.sessionId,
      participantId: input.participantId,
      datasetClassification: input.datasetClassification,
    };
  }
}

function session(classification: "formal" | "test" = "formal") {
  const formal = classification === "formal";
  return {
    session_id: sessionId,
    participant_id: participantId,
    format_assignment: "graph",
    stimulus_set_version: STIMULUS_SET_VERSION,
    catalog_hash: CATALOG_HASH,
    dataset_classification: classification,
    formal_collection_allowed: formal,
    started_at: "2026-07-27T14:50:00.000Z",
    submitted_at: "2026-07-27T15:00:00.000Z",
    duration_ms: 600_000,
    allocation_id: formal
      ? "allocation-00000000-0000-4000-8000-000000000005"
      : null,
    randomization_version: formal
      ? "mmq-randomization-2026-07-v1"
      : null,
    allocation_method: formal ? "variable_block" : null,
    allocation_status: formal ? "confirmed" : null,
    assigned_at: formal ? "2026-07-27T14:49:00.000Z" : null,
    fallback_reason_code: null,
    fallback_reconciled_at: null,
  };
}

function experimentPayload(
  classification: "formal" | "test" = "formal",
  format: "table" | "graph" | "video" = "graph",
) {
  const pools = [
    "Pool_1",
    "Pool_2",
    "Pool_3",
    "Pool_4",
    "Pool_1",
  ] as const;
  const poolOne = sequenceCatalog.filter(
    (sequence) => sequence.pool === "Pool_1",
  );
  const demographics = {
    gender: "女",
    age: 30,
    education: "本科",
    experience: "中等经验",
    stat_course: "是",
    started_at: "2026-07-27T14:59:00.000Z",
    submitted_at: "2026-07-27T15:00:00.000Z",
    duration_ms: 60_000,
  };
  return {
    session: {
      ...session(classification),
      format_assignment: format,
    },
    trials: Array.from({ length: 5 }, (_, index) => {
      const sequence = index === 4
        ? poolOne[1]
        : sequenceCatalog.find(
          (candidate) => candidate.pool === pools[index],
        )!;
      const presentation = sequence.presentations[format];
      const isTable = format === "table";
      const isDistribution = index === 4;
      const supports = isDistribution
        ? [1, 2, 3, 4, 5]
        : [null, null, null, null, null];
      const probabilities = isDistribution
        ? [10, 20, 40, 20, 10]
        : [null, null, null, null, null];
      const metadata = sequence.metadata ?? {};
      return {
        session_id: sessionId,
        dataset_classification: classification,
        format_assignment: format,
        format,
        pool: sequence.pool,
        variant: sequence.variant,
        response_type: isDistribution ? "point_spd" : "point_only",
        stimulus_set_version: STIMULUS_SET_VERSION,
        catalog_hash: CATALOG_HASH,
        trial_no: index + 1,
        sequence_uid: sequence.sequence_uid,
        canonical_key: sequence.canonical_key,
        presentation_uid: presentation.presentation_uid,
        source_id: sequence.source_id,
        stimulus_id: String(sequence.source_id),
        display_index: sequence.display_index,
        legacy_asset_no: sequence.legacy_asset_no,
        pair_uid: sequence.pair_uid,
        values_sha256: sequence.values_sha256,
        source_data_file: sequence.source_data_file,
        legacy_path: presentation.legacy_path,
        legacy_asset_path: presentation.legacy_path,
        stimulus_path: presentation.legacy_path,
        legacy_asset_sha256: presentation.asset_sha256,
        asset_sha256: isTable ? null : presentation.asset_sha256,
        renderer_version: isTable ? TABLE_RENDERER_VERSION : null,
        pool2_speed:
          sequence.pool === "Pool_2" ? sequence.variant : null,
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
        point: 10,
        trial_started_at:
          `2026-07-27T14:5${index}:00.000Z`,
        trial_submitted_at:
          `2026-07-27T14:5${index + 1}:00.000Z`,
        trial_duration_ms: 60_000,
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
        sumP: isDistribution ? 100 : null,
      };
    }),
    demographics,
  };
}

function requestBody(
  classification: "formal" | "test" = "formal",
  overrides: Record<string, unknown> = {},
) {
  return requestBodyForPayload(
    experimentPayload(classification),
    overrides,
  );
}

function requestBodyForPayload(
  payload: ReturnType<typeof experimentPayload>,
  overrides: Record<string, unknown> = {},
) {
  const payloadJson = JSON.stringify(payload);
  return {
    schema_version: 1,
    client_token: clientToken,
    payload_json: payloadJson,
    payload_sha256: payloadSha256(payloadJson),
    transport: {
      client_attempt_count: 1,
      previous_attempt_latency_ms: null,
    },
    ...overrides,
  };
}

function jsonRequest(body: unknown, contentType = "application/json") {
  return new Request("https://study.example/api/submit", {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env.MMQ_RANDOMIZATION_HMAC_SECRET = testSecret;
  process.env.MMQ_SUBMISSIONS_OPEN = "true";
});

afterEach(() => {
  if (originalSecret === undefined) {
    delete process.env.MMQ_RANDOMIZATION_HMAC_SECRET;
  } else {
    process.env.MMQ_RANDOMIZATION_HMAC_SECRET = originalSecret;
  }
  if (originalSubmissionsOpen === undefined) {
    delete process.env.MMQ_SUBMISSIONS_OPEN;
  } else {
    process.env.MMQ_SUBMISSIONS_OPEN = originalSubmissionsOpen;
  }
});

test("a new authoritative submission returns a stable receipt contract", async () => {
  const repository = new FakeRepository();
  const response = await createSubmitHandler(() => repository)(
    jsonRequest(requestBody()),
    {
      ip: "203.0.113.8",
      deploy: { context: "production", id: "deploy-123" },
      site: { url: "https://study.example" },
    },
  );
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.authority, "netlify_database");
  assert.equal(body.is_replay, false);
  assert.equal(body.mirror_status, "pending");
  assert.equal(body.session_id, sessionId);
  assert.equal(body.payload_sha256, repository.calls[0].payloadSha256);
  assert.equal(repository.calls[0].submissionsOpen, true);
  assert.equal(repository.calls[0].deploy.trustedClientIp, "203.0.113.8");
  assert.equal(repository.calls[0].deploy.deployId, "deploy-123");
});

test("the strict schema accepts complete Table, Graph, and Video payloads", async () => {
  const repository = new FakeRepository();
  const handler = createSubmitHandler(() => repository);

  for (const format of ["table", "graph", "video"] as const) {
    const response = await handler(
      jsonRequest(requestBodyForPayload(experimentPayload("formal", format))),
    );
    assert.equal(response.status, 201, `${format} must remain valid`);
  }
  assert.deepEqual(
    repository.calls.map((call) => call.formatAssignment),
    ["table", "graph", "video"],
  );
});

test("same-hash replay returns HTTP 200 and does not require the gate", async () => {
  process.env.MMQ_SUBMISSIONS_OPEN = "false";
  const repository = new FakeRepository();
  repository.result.isReplay = true;
  repository.result.mirrorStatus = "accepted";
  const response = await createSubmitHandler(() => repository)(
    jsonRequest(requestBody()),
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.is_replay, true);
  assert.equal(body.mirror_status, "accepted");
  assert.equal(repository.calls[0].submissionsOpen, false);
});

test("a conflicting payload is a non-retryable 409", async () => {
  const repository = new FakeRepository();
  repository.error = submissionConflict();
  const response = await createSubmitHandler(() => repository)(
    jsonRequest(requestBody()),
  );
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.equal(body.error.code, "SUBMISSION_CONFLICT");
  assert.equal(body.error.retryable, false);
});

test("the independent submission gate uses a non-retryable 423", async () => {
  const repository = new FakeRepository();
  repository.error = submissionsClosed();
  const response = await createSubmitHandler(() => repository)(
    jsonRequest(requestBody()),
  );
  const body = await response.json();

  assert.equal(response.status, 423);
  assert.equal(body.error.code, "SUBMISSIONS_CLOSED");
  assert.equal(body.error.retryable, false);
});

test("the exact raw payload SHA-256 is verified before storage", async () => {
  const repository = new FakeRepository();
  const response = await createSubmitHandler(() => repository)(
    jsonRequest(requestBody("formal", {
      payload_sha256: "0".repeat(64),
    })),
  );
  const body = await response.json();

  assert.equal(response.status, 422);
  assert.equal(body.error.code, "PAYLOAD_HASH_MISMATCH");
  assert.equal(repository.calls.length, 0);
});

test("unknown fields and private outcome-like fields are rejected", async () => {
  const repository = new FakeRepository();
  const handler = createSubmitHandler(() => repository);

  const requestWithUnknown = requestBody();
  Object.assign(requestWithUnknown, { unexpected_server_field: true });
  let response = await handler(jsonRequest(requestWithUnknown));
  assert.equal(response.status, 400);

  const transportWithUnknown = requestBody();
  Object.assign(transportWithUnknown.transport, { hidden_retry_state: true });
  response = await handler(jsonRequest(transportWithUnknown));
  assert.equal(response.status, 400);

  const payloadWithOutcome = experimentPayload();
  Object.assign(payloadWithOutcome, { y21: 42 });
  response = await handler(
    jsonRequest(requestBodyForPayload(payloadWithOutcome)),
  );
  assert.equal(response.status, 400);

  const trialWithOutcome = experimentPayload();
  Object.assign(trialWithOutcome.trials[0], { private_y21: 42 });
  response = await handler(
    jsonRequest(requestBodyForPayload(trialWithOutcome)),
  );
  assert.equal(response.status, 400);

  const missingApprovedField = experimentPayload();
  delete (missingApprovedField.trials[0] as Partial<
    typeof missingApprovedField.trials[0]
  >).point;
  response = await handler(
    jsonRequest(requestBodyForPayload(missingApprovedField)),
  );
  assert.equal(response.status, 400);
  assert.equal(repository.calls.length, 0);
});

test("prediction values and probability distributions are validated server-side", async () => {
  const repository = new FakeRepository();
  const handler = createSubmitHandler(() => repository);
  const invalidPayloads = [];

  const missingPoint = experimentPayload();
  missingPoint.trials[0].point = null;
  invalidPayloads.push(missingPoint);

  const pointOnlyWithDistribution = experimentPayload();
  pointOnlyWithDistribution.trials[0].s1 = 1;
  invalidPayloads.push(pointOnlyWithDistribution);

  const decreasingSupports = experimentPayload();
  decreasingSupports.trials[4].s2 = -1;
  invalidPayloads.push(decreasingSupports);

  const invalidProbabilityRange = experimentPayload();
  invalidProbabilityRange.trials[4].p1 = 101;
  invalidPayloads.push(invalidProbabilityRange);

  const invalidProbabilityTotal = experimentPayload();
  invalidProbabilityTotal.trials[4].p5 = 9;
  invalidProbabilityTotal.trials[4].sumP = 99;
  invalidPayloads.push(invalidProbabilityTotal);

  const forgedSupportSum = experimentPayload();
  forgedSupportSum.trials[4].sumS = 999;
  invalidPayloads.push(forgedSupportSum);

  for (const payload of invalidPayloads) {
    const response = await handler(
      jsonRequest(requestBodyForPayload(payload)),
    );
    assert.equal(response.status, 400);
  }
  assert.equal(repository.calls.length, 0);
});

test("timing, counters, asset performance, and demographics are strictly validated", async () => {
  const repository = new FakeRepository();
  const handler = createSubmitHandler(() => repository);
  const invalidPayloads = [];

  const badSessionDuration = experimentPayload();
  badSessionDuration.session.duration_ms += 1;
  invalidPayloads.push(badSessionDuration);

  const nonCanonicalTrialTime = experimentPayload();
  nonCanonicalTrialTime.trials[0].trial_started_at =
    "2026-07-27T14:50:00Z";
  invalidPayloads.push(nonCanonicalTrialTime);

  const impossibleRevisionCount = experimentPayload();
  impossibleRevisionCount.trials[0].revision_count = 1;
  invalidPayloads.push(impossibleRevisionCount);

  const missingAssetAttempt = experimentPayload();
  missingAssetAttempt.trials[0].asset_load_attempt_count = 0;
  invalidPayloads.push(missingAssetAttempt);

  const failedFinalAsset = experimentPayload();
  failedFinalAsset.trials[0].asset_load_status = "failed";
  invalidPayloads.push(failedFinalAsset);

  const invalidTableMetric = experimentPayload("formal", "table");
  invalidTableMetric.trials[0].fullscreen_open_count = 0;
  invalidPayloads.push(invalidTableMetric);

  const invalidAge = experimentPayload();
  invalidAge.demographics.age = 151;
  for (const trial of invalidAge.trials) trial.age = 151;
  invalidPayloads.push(invalidAge);

  const invalidGender = experimentPayload();
  invalidGender.demographics.gender = "未说明";
  for (const trial of invalidGender.trials) trial.gender = "未说明";
  invalidPayloads.push(invalidGender);

  const unknownDemographic = experimentPayload();
  Object.assign(unknownDemographic.demographics, { contact: "not allowed" });
  invalidPayloads.push(unknownDemographic);

  const impossibleFallbackTime = experimentPayload();
  impossibleFallbackTime.session.allocation_method = "client_fallback";
  impossibleFallbackTime.session.fallback_reason_code =
    "allocation_timeout";
  impossibleFallbackTime.session.fallback_reconciled_at =
    "2026-07-27T14:48:00.000Z";
  invalidPayloads.push(impossibleFallbackTime);

  for (const payload of invalidPayloads) {
    const response = await handler(
      jsonRequest(requestBodyForPayload(payload)),
    );
    assert.equal(response.status, 400);
  }
  assert.equal(repository.calls.length, 0);
});

test("all catalog metadata fields and copied demographics remain immutable", async () => {
  const repository = new FakeRepository();
  const handler = createSubmitHandler(() => repository);

  const badMetadata = experimentPayload();
  badMetadata.trials[0].rho =
    typeof badMetadata.trials[0].rho === "number"
      ? badMetadata.trials[0].rho + 0.1
      : 0.1;
  let response = await handler(
    jsonRequest(requestBodyForPayload(badMetadata)),
  );
  assert.equal(response.status, 400);

  const mismatchedDemographics = experimentPayload();
  mismatchedDemographics.trials[2].age = 29;
  response = await handler(
    jsonRequest(requestBodyForPayload(mismatchedDemographics)),
  );
  assert.equal(response.status, 400);
  assert.equal(repository.calls.length, 0);
});

test("five unique trial numbers and consistent formats are required", async () => {
  const repository = new FakeRepository();
  const payload = experimentPayload();
  payload.trials[4].trial_no = 4;
  const payloadJson = JSON.stringify(payload);
  const response = await createSubmitHandler(() => repository)(
    jsonRequest(requestBody("formal", {
      payload_json: payloadJson,
      payload_sha256: payloadSha256(payloadJson),
    })),
  );

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "INVALID_REQUEST");
  assert.equal(repository.calls.length, 0);
});

test("the five trials must preserve the locked pool and response roles", async () => {
  const repository = new FakeRepository();
  const wrongPool = experimentPayload();
  wrongPool.trials[1].pool = "Pool_3";
  let payloadJson = JSON.stringify(wrongPool);
  const poolResponse = await createSubmitHandler(() => repository)(
    jsonRequest(requestBody("formal", {
      payload_json: payloadJson,
      payload_sha256: payloadSha256(payloadJson),
    })),
  );
  assert.equal(poolResponse.status, 400);

  const wrongRole = experimentPayload();
  wrongRole.trials[4].response_type = "point_only";
  payloadJson = JSON.stringify(wrongRole);
  const roleResponse = await createSubmitHandler(() => repository)(
    jsonRequest(requestBody("formal", {
      payload_json: payloadJson,
      payload_sha256: payloadSha256(payloadJson),
    })),
  );
  assert.equal(roleResponse.status, 400);
  assert.equal(repository.calls.length, 0);
});

test("the first and fifth Pool 1 trials cannot reuse one sequence", async () => {
  const repository = new FakeRepository();
  const payload = experimentPayload();
  payload.trials[4].sequence_uid = payload.trials[0].sequence_uid;
  const payloadJson = JSON.stringify(payload);
  const response = await createSubmitHandler(() => repository)(
    jsonRequest(requestBody("formal", {
      payload_json: payloadJson,
      payload_sha256: payloadSha256(payloadJson),
    })),
  );

  assert.equal(response.status, 400);
  assert.equal(repository.calls.length, 0);
});

test("trial identifiers, paths, and hashes must match the frozen catalog", async () => {
  const repository = new FakeRepository();
  const payload = experimentPayload();
  payload.trials[2].source_id += 1;
  const payloadJson = JSON.stringify(payload);
  const response = await createSubmitHandler(() => repository)(
    jsonRequest(requestBody("formal", {
      payload_json: payloadJson,
      payload_sha256: payloadSha256(payloadJson),
    })),
  );

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "INVALID_REQUEST");
  assert.equal(repository.calls.length, 0);
});

test("reconciled fallback audit metadata reaches authoritative storage", async () => {
  const repository = new FakeRepository();
  const payload = experimentPayload();
  payload.session.allocation_method = "client_fallback";
  payload.session.fallback_reason_code = "allocation_timeout";
  payload.session.fallback_reconciled_at = "2026-07-27T14:59:30.000Z";
  const payloadJson = JSON.stringify(payload);
  const response = await createSubmitHandler(() => repository)(
    jsonRequest(requestBody("formal", {
      payload_json: payloadJson,
      payload_sha256: payloadSha256(payloadJson),
    })),
  );

  assert.equal(response.status, 201);
  assert.equal(repository.calls[0].allocationMethod, "client_fallback");
  assert.equal(
    repository.calls[0].fallbackReasonCode,
    "allocation_timeout",
  );
  assert.equal(
    repository.calls[0].fallbackReconciledAt,
    "2026-07-27T14:59:30.000Z",
  );
});

test("test records are isolated and cannot carry formal allocation fields", async () => {
  const repository = new FakeRepository();
  const accepted = await createSubmitHandler(() => repository)(
    jsonRequest(requestBody("test")),
  );
  assert.equal(accepted.status, 201);
  assert.equal(repository.calls[0].datasetClassification, "test");
  assert.equal(repository.calls[0].allocationId, null);

  const payload = experimentPayload("test");
  payload.session.allocation_id =
    "allocation-00000000-0000-4000-8000-000000000005";
  const payloadJson = JSON.stringify(payload);
  const rejected = await createSubmitHandler(() => repository)(
    jsonRequest(requestBody("test", {
      payload_json: payloadJson,
      payload_sha256: payloadSha256(payloadJson),
    })),
  );
  assert.equal(rejected.status, 400);
});

test("unexpected database failures are retryable 503 responses", async () => {
  const repository = new FakeRepository();
  repository.error = new Error("database unavailable");
  const response = await createSubmitHandler(() => repository)(
    jsonRequest(requestBody()),
  );
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(body.error.code, "SUBMISSION_UNAVAILABLE");
  assert.equal(body.error.retryable, true);
});

test("only JSON POST requests are accepted", async () => {
  const repository = new FakeRepository();
  const response = await createSubmitHandler(() => repository)(
    jsonRequest(requestBody(), "text/plain"),
  );

  assert.equal(response.status, 400);
  assert.equal(repository.calls.length, 0);
});

test("immediate Forms mirroring is backgrounded only for new receipts", async () => {
  const repository = new FakeRepository();
  const dispatched: Array<{
    receiptId: string;
    endpointUrl: string;
  }> = [];
  const waited: Promise<unknown>[] = [];
  const handler = createSubmitHandler(
    () => repository,
    async (receiptId, endpointUrl) => {
      dispatched.push({ receiptId, endpointUrl });
    },
  );
  await handler(jsonRequest(requestBody()), {
    waitUntil: (promise) => waited.push(promise),
  });
  await Promise.all(waited);
  assert.deepEqual(dispatched, [{
    receiptId: repository.result.receiptId,
    endpointUrl: "https://study.example/",
  }]);

  repository.result.isReplay = true;
  await handler(jsonRequest(requestBody()), {
    waitUntil: (promise) => waited.push(promise),
  });
  assert.equal(dispatched.length, 1);
});

test("Forms mirroring uses an explicit runtime origin without build variables", () => {
  const originalDeployPrimeUrl = process.env.DEPLOY_PRIME_URL;
  const originalUrl = process.env.URL;
  const originalFormsEndpoint = process.env.MMQ_FORMS_ENDPOINT;
  delete process.env.DEPLOY_PRIME_URL;
  delete process.env.URL;
  delete process.env.MMQ_FORMS_ENDPOINT;
  try {
    assert.equal(
      submissionMirrorEndpoint(
        "https://deploy-preview-4--sequence-prediction-study.netlify.app",
      ).toString(),
      "https://deploy-preview-4--sequence-prediction-study.netlify.app/",
    );
  } finally {
    if (originalDeployPrimeUrl === undefined) {
      delete process.env.DEPLOY_PRIME_URL;
    } else {
      process.env.DEPLOY_PRIME_URL = originalDeployPrimeUrl;
    }
    if (originalUrl === undefined) {
      delete process.env.URL;
    } else {
      process.env.URL = originalUrl;
    }
    if (originalFormsEndpoint === undefined) {
      delete process.env.MMQ_FORMS_ENDPOINT;
    } else {
      process.env.MMQ_FORMS_ENDPOINT = originalFormsEndpoint;
    }
  }
});

test("trusted metadata comes from Netlify context rather than request fields", () => {
  const value = deploymentMetadata({
    ip: "198.51.100.2",
    deploy: { context: "deploy-preview", id: "preview-7" },
    site: { url: "https://preview.example" },
  });

  assert.equal(value.trustedClientIp, "198.51.100.2");
  assert.equal(value.deployContext, "deploy-preview");
  assert.equal(value.deployId, "preview-7");
  assert.equal(value.deployUrl, "https://preview.example");
});

test("Forms mirror payload carries the authority receipt and raw answer", () => {
  const row: SubmissionMirrorRow = {
    mirrorId: "mirror-1",
    receiptId: "receipt-1",
    formName: "mmq-submission-v2-formal",
    attemptCount: 1,
    payloadJson: "{\"answer\":1}",
    payloadSha256: "a".repeat(64),
    sessionId,
    participantId,
    datasetClassification: "formal",
    formatAssignment: "graph",
    stimulusSetVersion: STIMULUS_SET_VERSION,
    catalogHash: CATALOG_HASH,
    submittedAt: "2026-07-27T15:00:00.000Z",
    allocationId:
      "allocation-00000000-0000-4000-8000-000000000005",
    randomizationVersion: "mmq-randomization-2026-07-v1",
    allocationMethod: "variable_block",
    allocationStatus: "confirmed",
    assignedAt: "2026-07-27T14:49:00.000Z",
    fallbackReasonCode: null,
    fallbackReconciledAt: null,
    clientAttemptCount: 2,
    previousAttemptLatencyMs: 350,
  };
  const body = buildSubmissionMirrorFormBody(row);

  assert.equal(body.get("form-name"), "mmq-submission-v2-formal");
  assert.equal(body.get("receipt_id"), "receipt-1");
  assert.equal(body.get("submission_authority"), "netlify_database");
  assert.equal(body.get("payload_json"), "{\"answer\":1}");
  assert.equal(body.get("submit_attempt_count"), "2");
  assert.equal(body.get("submit_latency_ms"), "350");
  assert.equal(body.get("fallback_reason_code"), "");
  assert.equal(body.get("fallback_reconciled_at"), "");

  const fallbackBody = buildSubmissionMirrorFormBody({
    ...row,
    allocationMethod: "client_fallback",
    fallbackReasonCode: "allocation_timeout",
    fallbackReconciledAt: "2026-07-27T14:59:30.000Z",
  });
  assert.equal(
    fallbackBody.get("fallback_reason_code"),
    "allocation_timeout",
  );
  assert.equal(
    fallbackBody.get("fallback_reconciled_at"),
    "2026-07-27T14:59:30.000Z",
  );
});

test("Forms mirror retry backoff starts at 15 minutes and is capped", () => {
  assert.equal(mirrorRetryDelayMinutes(1), 15);
  assert.equal(mirrorRetryDelayMinutes(2), 30);
  assert.equal(mirrorRetryDelayMinutes(100), 1_440);
});
