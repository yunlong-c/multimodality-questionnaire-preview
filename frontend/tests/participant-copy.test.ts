import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import path from "node:path";

import {
  DISTRIBUTION_COPY,
  DISTRIBUTION_EXAMPLE_ROWS,
  DISTRIBUTION_LABELS,
  INSTRUCTIONS_COPY,
  LANDING_COPY,
  PRE_TASK_COPY,
  TRIAL_COPY
} from "../src/content/participantCopy";
import {
  catalogHash,
  sequenceCatalog,
  stimulusSetVersion
} from "../src/data/sequenceCatalog.generated";
import { selectExperimentTrials } from "../src/data/manifestSelectors";
import type { StimulusSequence } from "../src/data/manifestTypes";
import {
  attachTrialValidation,
  buildTrialHtml
} from "../src/experiment/trialRendering";
import {
  buildCompletionHtml,
  resolveSubmissionState
} from "../src/submission/completion";
import {
  getRequestedDatasetClassification,
  getRequestedPreviewFormatOverride,
  resolveExperimentFormat
} from "../src/config/runtimeMode";
import {
  AuthoritativeSubmissionError,
  NETLIFY_FORM_NAMES,
  PENDING_SUBMISSION_STORAGE_KEY,
  buildNetlifyFormSubmission,
  clearPendingSubmission,
  createPendingSubmissionRecord,
  createNetlifySubmissionTransportState,
  persistPendingSubmission,
  postAuthoritativeSubmission,
  postNetlifyForm,
  prepareNetlifyFormAttempt,
  readPendingSubmission,
  reconcilePendingFallbackForAuthority,
  resolveStaticCollectionState
} from "../src/api/client";
import {
  FORMAL_ASSIGNMENT_STORAGE_KEY,
  RANDOMIZATION_VERSION,
  allocateFormalParticipant,
  randomFormatWithWebCrypto,
  reconcileFallbackBeforeSubmit
} from "../src/api/formalAllocation";
import type { ExperimentPayload } from "../src/experiment/experimentTypes";

const mainSource = readFileSync(path.resolve("src/main.ts"), "utf8");
const experimentSource = readFileSync(
  path.resolve("src/experiment/buildExperiment.ts"),
  "utf8"
);
const trialRenderingSource = readFileSync(
  path.resolve("src/experiment/trialRendering.ts"),
  "utf8"
);
const indexSource = readFileSync(path.resolve("index.html"), "utf8");

const netlifyTestPayload: ExperimentPayload = {
  session: {
    session_id: "session-form-test",
    participant_id: "participant-form-test",
    format_assignment: "graph",
    stimulus_set_version: stimulusSetVersion,
    catalog_hash: catalogHash,
    dataset_classification: "formal",
    formal_collection_allowed: true,
    allocation_id: "allocation-form-test",
    randomization_version: "mmq-randomization-2026-07-v1",
    allocation_method: "variable_block",
    allocation_status: "confirmed",
    assigned_at: "2026-07-27T00:59:59.000Z",
    fallback_reason_code: null,
    fallback_reconciled_at: null,
    started_at: "2026-07-27T01:00:00.000Z",
    submitted_at: "2026-07-27T01:05:00.000Z",
    duration_ms: 300000
  },
  trials: [],
  demographics: {
    gender: null,
    age: null,
    education: null,
    experience: null,
    stat_course: null,
    started_at: null,
    submitted_at: null,
    duration_ms: null
  }
};
const controlledQuestionnaireSource = readFileSync(
  path.resolve("src/experiment/controlledQuestionnaire.ts"),
  "utf8"
);
const completionSource = readFileSync(
  path.resolve("src/submission/completion.ts"),
  "utf8"
);
const apiClientSource = readFileSync(
  path.resolve("src/api/client.ts"),
  "utf8"
);
const participantCopySource = readFileSync(
  path.resolve("src/content/participantCopy.ts"),
  "utf8"
);
const stylesSource = readFileSync(
  path.resolve("src/styles/main.css"),
  "utf8"
);

function createMemoryStorage(): Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    }
  };
}

function successfulAllocationResponse(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    participant_id: "participant-allocation-test",
    client_token: "client-allocation-test-0001",
    format_assignment: "graph",
    session_id: "session-allocation-test-0001",
    is_returning: false,
    dataset_classification: "formal",
    formal_collection_allowed: true,
    stimulus_set_version: stimulusSetVersion,
    catalog_hash: catalogHash,
    allocation_id: "allocation-variable-test-0001",
    randomization_version: RANDOMIZATION_VERSION,
    allocation_method: "variable_block",
    allocation_status: "confirmed",
    assigned_at: "2026-07-27T01:00:00.000Z",
    fallback_reason_code: null,
    fallback_reconciled_at: null,
    ...overrides
  };
}

function collectCopyText(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(collectCopyText);
  }
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(collectCopyText);
  }
  return [];
}

function joinedCopy(value: unknown): string {
  return collectCopyText(value).join("\n");
}

function assertOrdered(source: string, fragments: readonly string[]): void {
  let cursor = -1;
  for (const fragment of fragments) {
    const index = source.indexOf(fragment, cursor + 1);
    assert.notEqual(
      index,
      -1,
      `Expected locked participant copy fragment: ${fragment}`
    );
    cursor = index;
  }
}

class FakeTrialInput {
  value = "";
  focused = false;
  private readonly inputListeners = new Set<() => void>();

  addEventListener(type: string, listener: () => void): void {
    if (type === "input") {
      this.inputListeners.add(listener);
    }
  }

  removeEventListener(type: string, listener: () => void): void {
    if (type === "input") {
      this.inputListeners.delete(listener);
    }
  }

  dispatchInput(): void {
    for (const listener of this.inputListeners) {
      listener();
    }
  }

  focus(): void {
    this.focused = true;
  }
}

function createTrialValidationHarness(): {
  form: HTMLFormElement;
  inputs: Map<string, FakeTrialInput>;
  totalFeedback: { textContent: string; dataset: Record<string, string> };
  orderFeedback: { textContent: string; dataset: Record<string, string> };
  validationMessage: { textContent: string };
} {
  const fieldNames = [
    "s1",
    "s2",
    "s3",
    "s4",
    "s5",
    "p1",
    "p2",
    "p3",
    "p4",
    "p5"
  ];
  const inputs = new Map(
    fieldNames.map((name) => [name, new FakeTrialInput()])
  );
  const totalFeedback = { textContent: "", dataset: {} };
  const orderFeedback = { textContent: "", dataset: {} };
  const validationMessage = { textContent: "" };
  const form = {
    elements: {
      namedItem: (name: string) => inputs.get(name) ?? null
    },
    querySelector: (selector: string) => {
      if (selector === "[data-probability-total]") {
        return totalFeedback;
      }
      if (selector === "[data-support-order]") {
        return orderFeedback;
      }
      if (selector === "#trial-validation-message") {
        return validationMessage;
      }
      return null;
    },
    reportValidity: () => true
  } as unknown as HTMLFormElement;

  return {
    form,
    inputs,
    totalFeedback,
    orderFeedback,
    validationMessage
  };
}

test("pre-task and trial copy remove locked strategy cues", () => {
  const copyUnderTest = joinedCopy([
    PRE_TASK_COPY,
    TRIAL_COPY,
    DISTRIBUTION_COPY
  ]);
  const renderedCopySources =
    `${mainSource}\n${experimentSource}\n${trialRenderingSource}\n${completionSource}`;
  const forbiddenCues = [
    "历史走势",
    "最可能出现的数值",
    "题目没有标准答案",
    "人类信息处理机制",
    "不要求采用特定方法",
    "不要求使用特定预测方法"
  ] as const;

  for (const cue of forbiddenCues) {
    assert.equal(
      copyUnderTest.includes(cue),
      false,
      `Participant copy must not contain strategy cue: ${cue}`
    );
    assert.equal(
      renderedCopySources.includes(cue),
      false,
      `Rendered page source must not contain strategy cue: ${cue}`
    );
  }

  assert.match(joinedCopy(TRIAL_COPY), /前\s*20\s*期(?:历史)?数据/);
  assert.match(joinedCopy(TRIAL_COPY), /第\s*21\s*期/);
  assert.equal(
    TRIAL_COPY.helper,
    "请查看前 20 期历史数据并填写第 21 期预测值。"
  );
  assert.match(mainSource, /LANDING_COPY\./);
  assert.match(mainSource, /INSTRUCTIONS_COPY\./);
  assert.match(trialRenderingSource, /TRIAL_COPY\./);
  assert.match(trialRenderingSource, /DISTRIBUTION_COPY\./);
});

test("pre-task copy does not disclose the modality comparison", () => {
  const preTaskText = joinedCopy(PRE_TASK_COPY);
  const landingText = joinedCopy(LANDING_COPY);
  const instructionsText = joinedCopy(INSTRUCTIONS_COPY);

  assert.ok(PRE_TASK_COPY.length > 0, "PRE_TASK_COPY must not be empty");
  for (const fragment of collectCopyText(LANDING_COPY)) {
    assert.ok(
      preTaskText.includes(fragment),
      `PRE_TASK_COPY is missing landing copy: ${fragment}`
    );
  }
  for (const fragment of collectCopyText(INSTRUCTIONS_COPY)) {
    assert.ok(
      preTaskText.includes(fragment),
      `PRE_TASK_COPY is missing instructions copy: ${fragment}`
    );
  }

  for (const term of [
    "多模态",
    "呈现方式",
    "呈现形式",
    "表格",
    "图形",
    "动画"
  ]) {
    assert.equal(
      preTaskText.includes(term),
      false,
      `Pre-task copy must not disclose modality term: ${term}`
    );
  }

  assert.match(landingText, /5\s*[–-]\s*10\s*分钟/);
  assert.match(instructionsText, /5\s*(?:到|[–-])\s*10\s*分钟/);
});

test("participation confirmation keeps the required remaining information", () => {
  assertOrdered(mainSource, [
    "参与研究",
    "参与确认",
    "参与时长",
    "约 5–10 分钟。",
    "自愿参与及退出",
    "您的参与完全自愿。您有权在任何时候中止参与，不会产生任何不利后果。",
    "数据保密性",
    "本研究所收集的所有数据将仅用于学术分析，完全匿名化处理，不会包含或泄露您的任何个人身份信息。",
    "我已阅读并理解上述内容，同意参与本研究"
  ]);
  assert.equal(INSTRUCTIONS_COPY.consentButton, "继续到参与确认");
});

test("locked demographic questions and options remain unchanged and ordered", () => {
  assertOrdered(trialRenderingSource, [
    "您的性别",
    'value="男"',
    'value="女"',
    "您的年龄",
    "您的受教育程度",
    'value="高中及以下"',
    'value="大专/高职"',
    'value="本科"',
    'value="硕士"',
    'value="博士"',
    "您在数据分析或数值判断方面的经验如何？",
    'value="毫无经验"',
    'value="有一些经验"',
    'value="中等经验"',
    'value="非常丰富的经验"',
    "您是否修读过统计学或相关课程？",
    'value="是"',
    'value="否"'
  ]);

  assert.match(
    trialRenderingSource,
    /<input type="radio" name="gender" value="男" required/
  );
  assert.match(
    trialRenderingSource,
    /<input type="radio" name="gender" value="女" required/
  );
  for (const name of ["age", "education", "experience", "stat_course"]) {
    assert.match(
      trialRenderingSource,
      new RegExp(`(?:input|select)[^>]*name="${name}"[^>]*required`)
    );
  }
});

test("homepage and background page expose only the approved concise copy", () => {
  assert.equal("privacy" in LANDING_COPY, false);

  const metaBlock = mainSource.match(
    /<div class="research-meta"[^>]*>([\s\S]*?)<\/div>/
  )?.[1];
  assert.ok(metaBlock);
  assert.equal((metaBlock.match(/<span>/g) ?? []).length, 2);
  assert.match(metaBlock, /LANDING_COPY\.duration/);
  assert.match(metaBlock, /LANDING_COPY\.questionCount/);

  assert.match(controlledQuestionnaireSource, /<p class="eyebrow">背景问卷<\/p>/);
  assert.match(controlledQuestionnaireSource, /<h2>基本信息<\/h2>/);
  assert.doesNotMatch(controlledQuestionnaireSource, /demographic-copy/);
});

test("removed participant copy does not remain in rendered sources", () => {
  const participantFacingSources = [
    participantCopySource,
    mainSource,
    controlledQuestionnaireSource,
    trialRenderingSource,
    completionSource
  ].join("\n");

  for (const forbidden of [
    "不收集姓名等直接身份信息",
    "研究目的",
    "了解人们在时间序列预测任务中的判断与决策过程。",
    "联系方式",
    "如您对本研究有任何疑问，请联系研究人员或问卷发放方。",
    "最后一步",
    "请填写最后的背景信息",
    "感谢您完成前面的题目。请再填写以下简短信息，用于后续统计分析。"
  ]) {
    assert.equal(
      participantFacingSources.includes(forbidden),
      false,
      `Removed participant copy remains present: ${forbidden}`
    );
  }
});

test("trial five renders a collapsed read-only example and leaves answer inputs blank", () => {
  assert.deepEqual([...DISTRIBUTION_LABELS], [
    "最低",
    "较低",
    "中等",
    "较高",
    "最高"
  ]);
  assert.deepEqual([...DISTRIBUTION_EXAMPLE_ROWS], [
    { level: "最低", value: 1, probability: 10 },
    { level: "较低", value: 2, probability: 20 },
    { level: "中等", value: 3, probability: 40 },
    { level: "较高", value: 4, probability: 20 },
    { level: "最高", value: 5, probability: 10 }
  ]);
  assert.equal(
    DISTRIBUTION_EXAMPLE_ROWS.reduce(
      (total, row) => total + row.probability,
      0
    ),
    100
  );
  assert.deepEqual(
    DISTRIBUTION_EXAMPLE_ROWS.map((row) => row.value),
    [1, 2, 3, 4, 5]
  );

  const distributionText = joinedCopy(DISTRIBUTION_COPY);
  assert.match(distributionText, /5\s*个/);
  assert.match(distributionText, /可能数值/);
  assert.match(distributionText, /从小到大/);
  assert.match(distributionText, /概率/);
  assert.match(distributionText, /对应概率.{0,10}不要求按大小排列/);
  assert.match(distributionText, /同一行的可能数值对应/);
  assert.match(
    distributionText,
    /(?:合计|总和).{0,12}100%|100%.{0,12}(?:合计|总和)/
  );
  assert.match(distributionText, /与本题答案无关，请勿照抄/);

  const fifthTrial = selectExperimentTrials(
    sequenceCatalog as readonly StimulusSequence[],
    "table",
    stimulusSetVersion,
    catalogHash
  )[4];
  const trialHtml = buildTrialHtml(fifthTrial);
  const examplePanel = trialHtml.match(
    /<details class="example-panel">([\s\S]*?)<\/details>/
  )?.[0];
  assert.ok(examplePanel);
  assert.match(examplePanel, /<summary>查看填写规则与示例<\/summary>/);
  assert.doesNotMatch(examplePanel, /<details[^>]*\sopen(?:\s|>)/);
  assert.doesNotMatch(examplePanel, /<input\b/);
  assert.match(examplePanel, /class="distribution-example-table"/);
  assert.match(
    examplePanel,
    /以下数值和概率仅用于说明填写格式，与本题答案无关，请勿照抄。/
  );

  const exampleBody = examplePanel.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1];
  assert.ok(exampleBody);
  assert.equal((exampleBody.match(/<tr>/g) ?? []).length, 5);
  assert.match(examplePanel, /<th scope="row">合计<\/th>/);
  assert.match(examplePanel, /<td>100%<\/td>/);

  const formalInputs = trialHtml.match(/<input\b[\s\S]*?\/>/g) ?? [];
  assert.equal(formalInputs.length, 11);
  for (const input of formalInputs) {
    assert.doesNotMatch(input, /\svalue=/);
    assert.match(input, /\sstep="any"/);
    assert.doesNotMatch(input, /\sstep="0\.1"/);
  }
  const probabilityInputs = formalInputs.filter((input) =>
    /\sname="p[1-5]"/.test(input)
  );
  assert.equal(probabilityInputs.length, 5);
  for (const input of probabilityInputs) {
    assert.match(input, /\smin="0"/);
    assert.match(input, /\smax="100"/);
  }

  assert.match(stylesSource, /\.distribution-example-table\s*\{[\s\S]*?width:\s*100%/);
  assert.match(stylesSource, /table-layout:\s*fixed/);
  assert.doesNotMatch(trialRenderingSource, /\/assets\/ui\/example\.png/);
});

test("distribution validation accepts unsorted probabilities and clears stale errors after edits", () => {
  const fifthTrial = selectExperimentTrials(
    sequenceCatalog as readonly StimulusSequence[],
    "table",
    stimulusSetVersion,
    catalogHash
  )[4];
  const {
    form,
    inputs,
    totalFeedback,
    orderFeedback,
    validationMessage
  } = createTrialValidationHarness();
  const controller = attachTrialValidation(fifthTrial, form);

  for (const [name, value] of [
    ["s1", "1"],
    ["s2", "0"],
    ["s3", "2"],
    ["s4", "3"],
    ["s5", "4"],
    ["p1", "40"],
    ["p2", "5"],
    ["p3", "30"],
    ["p4", "10"],
    ["p5", "15"]
  ]) {
    const input = inputs.get(name);
    assert.ok(input);
    input.value = value;
  }

  assert.equal(controller.validate(), false);
  assert.match(validationMessage.textContent, /“可能数值”一列/);
  assert.match(validationMessage.textContent, /“对应概率”不要求排序/);

  const correctedInput = inputs.get("s2");
  assert.ok(correctedInput);
  correctedInput.value = "2";
  correctedInput.dispatchInput();

  assert.equal(validationMessage.textContent, "");
  assert.match(
    stylesSource,
    /\.validation-error:empty\s*\{[\s\S]*?display:\s*none/
  );
  assert.equal(orderFeedback.dataset.state, "valid");
  assert.equal(
    orderFeedback.textContent,
    "“可能数值”一列顺序正确；“对应概率”不要求排序。"
  );
  assert.equal(totalFeedback.dataset.state, "valid");
  assert.equal(totalFeedback.textContent, "概率合计：100%（需为100%）");
  assert.equal(controller.validate(), true);

  for (const [name, value] of [
    ["s1", "1.11"],
    ["s2", "2.22"],
    ["s3", "3.44"],
    ["s4", "3.44"],
    ["s5", "4.567"],
    ["p1", "40.125"],
    ["p2", "4.875"],
    ["p3", "30"],
    ["p4", "10"],
    ["p5", "15"]
  ]) {
    const input = inputs.get(name);
    assert.ok(input);
    input.value = value;
    input.dispatchInput();
  }
  assert.equal(orderFeedback.dataset.state, "valid");
  assert.equal(totalFeedback.textContent, "概率合计：100%（需为100%）");
  assert.equal(controller.validate(), true);

  const finalProbabilityInput = inputs.get("p5");
  assert.ok(finalProbabilityInput);
  finalProbabilityInput.value = "14.95";
  finalProbabilityInput.dispatchInput();
  assert.equal(controller.validate(), false);
  assert.equal(
    totalFeedback.textContent,
    "概率合计：99.95%（需为100%）"
  );
  assert.match(validationMessage.textContent, /当前合计为 99\.95%/);

  finalProbabilityInput.value = "15";
  finalProbabilityInput.dispatchInput();
  assert.equal(validationMessage.textContent, "");
  assert.equal(totalFeedback.dataset.state, "valid");
  assert.equal(controller.validate(), true);

  controller.cleanup();
});

test("compact participant chrome preserves all stimulus dimensions", () => {
  assert.match(
    stylesSource,
    /\.stimulus-media-frame\s*\{[\s\S]*?width:\s*min\(820px,\s*100%\)/
  );
  assert.match(
    stylesSource,
    /\.series-image\s*\{[\s\S]*?width:\s*100%[\s\S]*?height:\s*auto/
  );
  assert.match(
    stylesSource,
    /\.series-table-grid\s*\{[\s\S]*?width:\s*min\(640px,\s*100%\)/
  );
  assert.match(
    stylesSource,
    /\.series-table th,\s*\.series-table td\s*\{[\s\S]*?height:\s*37px/
  );
  assert.match(
    stylesSource,
    /\.series-table td\s*\{[\s\S]*?font-size:\s*1rem/
  );
  assert.doesNotMatch(stylesSource, /\bzoom\s*:/);
  assert.doesNotMatch(stylesSource, /transform:\s*scale\(/);
  assert.match(
    stylesSource,
    /\.field input,[\s\S]*?font-size:\s*1rem/
  );
  assert.match(
    stylesSource,
    /\.button,[\s\S]*?min-height:\s*46px/
  );
});

test("submission resolution distinguishes confirmed success from unconfirmed submission", async () => {
  assert.deepEqual(
    await resolveSubmissionState(async () => ({
      status: "confirmed",
      receipt: {
        receiptId: "receipt-test-0001",
        sessionId: "session-form-test",
        participantId: "participant-form-test",
        datasetClassification: "formal",
        payloadSha256: "a".repeat(64),
        storedAt: "2026-07-27T01:05:01.000Z",
        isReplay: false,
        authority: "netlify_database",
        mirrorStatus: "pending"
      }
    })),
    {
      state: "success",
      receiptId: "receipt-test-0001",
      storedAt: "2026-07-27T01:05:01.000Z"
    }
  );
  assert.deepEqual(
    await resolveSubmissionState(async () => ({
      status: "local_preview",
      payloadSha256: "b".repeat(64)
    })),
    { state: "local_preview" }
  );
  assert.deepEqual(
    await resolveSubmissionState(async () => {
      throw new Error("simulated network failure");
    }),
    { state: "unconfirmed" }
  );
});

test("static collection defaults to formal only when configured and test links always stay test", () => {
  assert.deepEqual(resolveStaticCollectionState(undefined, "formal"), {
    datasetClassification: "formal",
    formalCollectionAllowed: true
  });
  assert.deepEqual(resolveStaticCollectionState("test", "formal"), {
    datasetClassification: "test",
    formalCollectionAllowed: false
  });
  assert.deepEqual(resolveStaticCollectionState(undefined, "test"), {
    datasetClassification: "test",
    formalCollectionAllowed: false
  });
});

test("formal allocation retries two transient failures and then persists a Web Crypto fallback", async () => {
  const storage = createMemoryStorage();
  let requestCount = 0;
  const attemptedSessionIds: string[] = [];
  const unavailableFetch: typeof fetch = async (_input, init) => {
    requestCount += 1;
    const request = JSON.parse(String(init?.body)) as {
      session_id?: string;
    };
    attemptedSessionIds.push(request.session_id ?? "");
    return Response.json(
      {
        error: {
          code: "ALLOCATION_UNAVAILABLE",
          message: "temporarily unavailable"
        }
      },
      { status: 503 }
    );
  };

  const result = await allocateFormalParticipant(
    "client-allocation-test-0001",
    {
      fetchImplementation: unavailableFetch,
      storage,
      retryDelaysMs: [0, 0]
    }
  );

  assert.equal(requestCount, 3);
  assert.equal(new Set(attemptedSessionIds).size, 1);
  assert.notEqual(attemptedSessionIds[0], result.session_id);
  assert.ok(
    attemptedSessionIds.every(
      (attemptSessionId) => attemptSessionId !== result.session_id
    )
  );
  assert.equal(result.dataset_classification, "formal");
  assert.equal(result.formal_collection_allowed, true);
  assert.equal(result.allocation_method, "client_fallback");
  assert.equal(result.allocation_status, "unreconciled");
  assert.equal(
    result.fallback_reason_code,
    "allocation_server_error"
  );
  assert.ok(["table", "graph", "video"].includes(result.format_assignment));
  assert.ok(storage.getItem(FORMAL_ASSIGNMENT_STORAGE_KEY));

  const firstAllocationId = result.allocation_id;
  const firstFormat = result.format_assignment;
  const returning = await allocateFormalParticipant(
    "client-allocation-test-0001",
    {
      fetchImplementation: async () => {
        throw new TypeError("network unavailable");
      },
      storage,
      retryDelaysMs: [0, 0]
    }
  );
  assert.equal(returning.allocation_id, firstAllocationId);
  assert.equal(returning.format_assignment, firstFormat);
  assert.equal(returning.participant_id, result.participant_id);
  assert.equal(returning.is_returning, true);
  assert.notEqual(returning.session_id, result.session_id);
});

test("formal allocation never falls back for catalog, capacity, collection, or other 4xx rejection", async () => {
  for (const [status, code] of [
    [400, "INVALID_REQUEST"],
    [409, "CATALOG_MISMATCH"],
    [409, "SCHEDULE_MISMATCH"],
    [409, "SCHEDULE_EXHAUSTED"],
    [423, "COLLECTION_CLOSED"]
  ] as const) {
    const storage = createMemoryStorage();
    let requestCount = 0;
    await assert.rejects(
      allocateFormalParticipant("client-allocation-test-0001", {
        fetchImplementation: async () => {
          requestCount += 1;
          return Response.json(
            { error: { code, message: code } },
            { status }
          );
        },
        storage,
        retryDelaysMs: [0, 0]
      }),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        error.code === code
    );
    assert.equal(requestCount, 1);
    assert.equal(
      storage.getItem(FORMAL_ASSIGNMENT_STORAGE_KEY),
      null
    );
  }
});

test("formal allocation classifies an aborted request as a timeout fallback", async () => {
  const result = await allocateFormalParticipant(
    "client-allocation-test-0001",
    {
      fetchImplementation: async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () =>
              reject(
                new DOMException("request aborted", "AbortError")
              ),
            { once: true }
          );
        }),
      storage: createMemoryStorage(),
      attemptTimeoutMs: 2,
      retryDelaysMs: [0, 0]
    }
  );

  assert.equal(result.allocation_method, "client_fallback");
  assert.equal(result.fallback_reason_code, "allocation_timeout");
});

test("formal allocation classifies a fetch rejection as a network fallback", async () => {
  const result = await allocateFormalParticipant(
    "client-allocation-test-0001",
    {
      fetchImplementation: async () => {
        throw new TypeError("network unavailable");
      },
      storage: createMemoryStorage(),
      retryDelaysMs: [0, 0]
    }
  );

  assert.equal(result.allocation_method, "client_fallback");
  assert.equal(
    result.fallback_reason_code,
    "allocation_network_error"
  );
});

test("server allocation is persisted and cannot silently change on a later visit", async () => {
  const storage = createMemoryStorage();
  const clientToken = "client-allocation-test-0001";
  const first = await allocateFormalParticipant(clientToken, {
    fetchImplementation: async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as {
        session_id: string;
      };
      return Response.json(
        successfulAllocationResponse({
          session_id: request.session_id
        })
      );
    },
    storage,
    retryDelaysMs: [0, 0]
  });
  assert.equal(first.allocation_method, "variable_block");

  await assert.rejects(
    allocateFormalParticipant(clientToken, {
      fetchImplementation: async (_input, init) => {
        const request = JSON.parse(String(init?.body)) as {
          session_id: string;
        };
        return Response.json(
          successfulAllocationResponse({
            format_assignment: "video",
            session_id: request.session_id
          })
        );
      },
      storage,
      retryDelaysMs: [0, 0]
    }),
    /change an existing formal assignment/
  );
});

test("Web Crypto selection maps an unbiased uint32 draw to the three formats", () => {
  for (const [draw, expected] of [
    [0, "table"],
    [1, "graph"],
    [2, "video"]
  ] as const) {
    assert.equal(
      randomFormatWithWebCrypto({
        getRandomValues: (values) => {
          (values as Uint32Array)[0] = draw;
          return values;
        }
      }),
      expected
    );
  }

  const draws = [0xffffffff, 2];
  assert.equal(
    randomFormatWithWebCrypto({
      getRandomValues: (values) => {
        (values as Uint32Array)[0] = draws.shift() ?? 0;
        return values;
      }
    }),
    "video"
  );
});

test("fallback reconciliation upgrades audit metadata but never blocks the Forms payload", async () => {
  const payload = structuredClone(netlifyTestPayload);
  payload.session = {
    ...payload.session,
    participant_id: "fallback-participant-test-0001",
    session_id: "fallback-session-test-0001",
    format_assignment: "video",
    allocation_id: "fallback-allocation-test-0001",
    randomization_version: RANDOMIZATION_VERSION,
    allocation_method: "client_fallback",
    allocation_status: "unreconciled",
    assigned_at: "2026-07-27T00:59:00.000Z",
    fallback_reason_code: "allocation_network_error",
    fallback_reconciled_at: null
  };

  await reconcileFallbackBeforeSubmit(
    payload,
    "client-allocation-test-0001",
    {
      fetchImplementation: async (_input, init) => {
        const request = JSON.parse(String(init?.body)) as Record<
          string,
          unknown
        >;
        return Response.json(
          successfulAllocationResponse({
            participant_id: request.participant_id,
            session_id: request.session_id,
            format_assignment: request.format_assignment,
            allocation_id: request.allocation_id,
            allocation_method: "client_fallback",
            assigned_at: request.assigned_at,
            fallback_reason_code: request.fallback_reason_code,
            fallback_reconciled_at: "2026-07-27T01:05:01.000Z"
          })
        );
      },
      storage: createMemoryStorage()
    }
  );

  assert.equal(payload.session.allocation_status, "confirmed");
  assert.equal(
    payload.session.fallback_reconciled_at,
    "2026-07-27T01:05:01.000Z"
  );
  assert.equal(payload.session.format_assignment, "video");

  payload.session.allocation_status = "unreconciled";
  payload.session.fallback_reconciled_at = null;
  await assert.doesNotReject(
    reconcileFallbackBeforeSubmit(
      payload,
      "client-allocation-test-0001",
      {
        fetchImplementation: async () =>
          Response.json(
            {
              error: {
                code: "ALLOCATION_UNAVAILABLE",
                message: "still unavailable"
              }
            },
            { status: 503 }
          ),
        storage: createMemoryStorage()
      }
    )
  );
  assert.equal(payload.session.allocation_status, "unreconciled");
  assert.equal(payload.session.fallback_reconciled_at, null);
});

test("Forms retries reconcile once and resend one frozen payload hash", async () => {
  const payload = structuredClone(netlifyTestPayload);
  payload.session = {
    ...payload.session,
    allocation_id: "fallback-allocation-freeze-0001",
    allocation_method: "client_fallback",
    allocation_status: "unreconciled",
    fallback_reason_code: "allocation_server_error",
    fallback_reconciled_at: null
  };
  const state = createNetlifySubmissionTransportState();
  let reconciliationCount = 0;
  const reconcileOnce = async (): Promise<void> => {
    reconciliationCount += 1;
    payload.session.allocation_status = "confirmed";
    payload.session.fallback_reconciled_at =
      "2026-07-27T01:05:01.000Z";
  };

  const firstAttempt = await prepareNetlifyFormAttempt(
    state,
    payload,
    reconcileOnce
  );
  state.lastCompletedAttemptLatencyMs = 731;

  // A later in-memory change must not alter the audit record or hash sent by
  // the retry. Only the transport diagnostics may change.
  payload.session.allocation_status = "unreconciled";
  payload.session.fallback_reconciled_at = null;
  payload.session.duration_ms = 999999;
  const retryAttempt = await prepareNetlifyFormAttempt(
    state,
    payload,
    reconcileOnce
  );

  assert.equal(reconciliationCount, 1);
  assert.equal(firstAttempt.payloadJson, retryAttempt.payloadJson);
  assert.equal(firstAttempt.payloadSha256, retryAttempt.payloadSha256);
  assert.equal(
    firstAttempt.body.get("payload_sha256"),
    retryAttempt.body.get("payload_sha256")
  );
  assert.equal(
    firstAttempt.body.get("allocation_status"),
    "confirmed"
  );
  assert.equal(
    retryAttempt.body.get("allocation_status"),
    "confirmed"
  );
  assert.equal(
    retryAttempt.body.get("fallback_reconciled_at"),
    "2026-07-27T01:05:01.000Z"
  );
  assert.equal(firstAttempt.body.get("submit_attempt_count"), "1");
  assert.equal(retryAttempt.body.get("submit_attempt_count"), "2");
  assert.equal(firstAttempt.body.get("submit_latency_ms"), "");
  assert.equal(retryAttempt.body.get("submit_latency_ms"), "731");
});

test("v2 Netlify emergency forms remain separated while v1 is frozen", async () => {
  assert.match(indexSource, /name="mmq-submission-v1"/);
  assert.match(indexSource, /name="mmq-submission-v2-formal"/);
  assert.match(indexSource, /name="mmq-submission-v2-test"/);
  assert.match(indexSource, /data-netlify="true"/);
  for (const field of [
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
    "payload_json",
    "submit_attempt_count",
    "submit_latency_ms",
    "receipt_id",
    "submission_authority",
    "mirror_status",
    "mirror_source"
  ]) {
    assert.match(indexSource, new RegExp(`name="${field}"`));
  }

  const submission = await buildNetlifyFormSubmission(
    netlifyTestPayload,
    2,
    431
  );
  const expectedJson = JSON.stringify(netlifyTestPayload);
  const expectedHash = createHash("sha256")
    .update(expectedJson, "utf8")
    .digest("hex");

  assert.equal(submission.payloadJson, expectedJson);
  assert.equal(submission.payloadSha256, expectedHash);
  assert.equal(
    submission.body.get("form-name"),
    NETLIFY_FORM_NAMES.formal
  );
  assert.equal(submission.body.get("payload_json"), expectedJson);
  assert.equal(submission.body.get("payload_sha256"), expectedHash);
  assert.equal(
    submission.body.get("allocation_id"),
    "allocation-form-test"
  );
  assert.equal(
    submission.body.get("randomization_version"),
    "mmq-randomization-2026-07-v1"
  );
  assert.equal(
    submission.body.get("allocation_method"),
    "variable_block"
  );
  assert.equal(submission.body.get("allocation_status"), "confirmed");
  assert.equal(
    submission.body.get("assigned_at"),
    "2026-07-27T00:59:59.000Z"
  );
  assert.equal(submission.body.get("fallback_reason_code"), "");
  assert.equal(submission.body.get("fallback_reconciled_at"), "");
  assert.equal(submission.body.get("submit_attempt_count"), "2");
  assert.equal(submission.body.get("submit_latency_ms"), "431");
  assert.equal(
    submission.body.get("submit_latency_scope"),
    "previous_completed_attempt"
  );
  assert.equal(
    submission.body.get("mirror_status"),
    "emergency_unconfirmed"
  );
  assert.equal(
    submission.body.get("mirror_source"),
    "client_emergency"
  );
  assert.equal(submission.body.get("receipt_id"), "");
  assert.equal(submission.body.has("ip"), false);
  assert.equal(submission.body.has("location"), false);
  assert.equal(submission.body.has("device_fingerprint"), false);

  const testPayload = structuredClone(netlifyTestPayload);
  testPayload.session.dataset_classification = "test";
  testPayload.session.formal_collection_allowed = false;
  const testSubmission = await buildNetlifyFormSubmission(
    testPayload,
    1,
    null
  );
  assert.equal(
    testSubmission.body.get("form-name"),
    NETLIFY_FORM_NAMES.test
  );
});

test("Netlify Forms 2xx only confirms an emergency copy, never authority", async () => {
  const submission = await buildNetlifyFormSubmission(
    netlifyTestPayload,
    1,
    null
  );
  let observedBody = "";
  const successfulFetch: typeof fetch = async (_input, init) => {
    observedBody = String(init?.body ?? "");
    return new Response(null, { status: 204 });
  };
  await postNetlifyForm(submission, successfulFetch);
  assert.equal(
    new URLSearchParams(observedBody).get("payload_sha256"),
    submission.payloadSha256
  );
  assert.equal(
    new URLSearchParams(observedBody).get("form-name"),
    NETLIFY_FORM_NAMES.formal
  );

  const failedFetch: typeof fetch = async () =>
    new Response(null, { status: 503 });
  await assert.rejects(
    postNetlifyForm(submission, failedFetch),
    /Netlify Forms submit failed: 503/
  );
});

test("pending payload is frozen before transport and cleared only by matching hash", async () => {
  const storage = createMemoryStorage();
  const submission = await buildNetlifyFormSubmission(
    netlifyTestPayload,
    1,
    null
  );
  const pending = createPendingSubmissionRecord(
    {
      payloadJson: submission.payloadJson,
      payloadSha256: submission.payloadSha256,
      payloadSnapshot: structuredClone(netlifyTestPayload)
    },
    "client-submit-test-0001",
    () => new Date("2026-07-27T01:05:00.100Z")
  );

  persistPendingSubmission(pending, storage);
  assert.equal(
    storage.getItem(PENDING_SUBMISSION_STORAGE_KEY) !== null,
    true
  );
  assert.deepEqual(readPendingSubmission(storage), pending);

  clearPendingSubmission("f".repeat(64), storage);
  assert.deepEqual(readPendingSubmission(storage), pending);
  clearPendingSubmission(pending.payload_sha256, storage);
  assert.equal(readPendingSubmission(storage), null);
});

test("unreconciled fallback survives Forms backup and later upgrades to one authoritative receipt", async () => {
  const storage = createMemoryStorage();
  const fallbackPayload = structuredClone(netlifyTestPayload);
  fallbackPayload.session = {
    ...fallbackPayload.session,
    session_id: "fallback-session-recovery-0001",
    participant_id: "fallback-participant-recovery-0001",
    format_assignment: "video",
    allocation_id: "fallback-allocation-recovery-0001",
    allocation_method: "client_fallback",
    allocation_status: "unreconciled",
    fallback_reason_code: "allocation_server_error",
    fallback_reconciled_at: null
  };
  const initialSubmission = await buildNetlifyFormSubmission(
    fallbackPayload,
    0,
    null
  );
  const initialPending = createPendingSubmissionRecord(
    {
      payloadJson: initialSubmission.payloadJson,
      payloadSha256: initialSubmission.payloadSha256,
      payloadSnapshot: structuredClone(fallbackPayload)
    },
    "client-fallback-recovery-0001"
  );
  persistPendingSubmission(initialPending, storage);

  const stillPending =
    await reconcilePendingFallbackForAuthority(
      initialPending,
      "client-fallback-recovery-0001",
      async () => {
        // Simulates a transient reconciliation failure: payload remains
        // unreconciled and must not be sent to the authority endpoint.
      },
      storage
    );
  assert.equal(stillPending.readyForAuthority, false);
  assert.equal(stillPending.hashUpdated, false);
  assert.equal(
    stillPending.pending.payload_sha256,
    initialPending.payload_sha256
  );

  const emergencyCopy = await buildNetlifyFormSubmission(
    JSON.parse(initialPending.payload_json) as ExperimentPayload,
    1,
    null
  );
  let emergencyBody = "";
  await postNetlifyForm(
    emergencyCopy,
    async (_input, init) => {
      emergencyBody = String(init?.body ?? "");
      return new Response(null, { status: 204 });
    }
  );
  assert.equal(
    new URLSearchParams(emergencyBody).get("form-name"),
    NETLIFY_FORM_NAMES.formal
  );
  assert.equal(
    new URLSearchParams(emergencyBody).get("payload_sha256"),
    initialPending.payload_sha256
  );
  initialPending.emergency_form_sent_at =
    "2026-07-27T01:05:01.000Z";
  persistPendingSubmission(initialPending, storage);

  const restoredAfterRefresh = readPendingSubmission(storage);
  assert.ok(restoredAfterRefresh);
  const reconciled =
    await reconcilePendingFallbackForAuthority(
      restoredAfterRefresh,
      "client-fallback-recovery-0001",
      async (payload) => {
        payload.session.allocation_status = "confirmed";
        payload.session.fallback_reconciled_at =
          "2026-07-27T01:05:02.000Z";
      },
      storage
    );
  assert.equal(reconciled.readyForAuthority, true);
  assert.equal(reconciled.hashUpdated, true);
  assert.notEqual(
    reconciled.pending.payload_sha256,
    initialPending.payload_sha256
  );
  assert.equal(reconciled.pending.emergency_form_sent_at, null);
  const reconciledPayload = JSON.parse(
    reconciled.pending.payload_json
  ) as ExperimentPayload;
  assert.equal(
    reconciledPayload.session.session_id,
    fallbackPayload.session.session_id
  );
  assert.equal(
    reconciledPayload.session.format_assignment,
    fallbackPayload.session.format_assignment
  );
  assert.equal(
    reconciledPayload.session.allocation_status,
    "confirmed"
  );
  assert.deepEqual(
    reconciledPayload.trials,
    fallbackPayload.trials
  );
  assert.deepEqual(
    reconciledPayload.demographics,
    fallbackPayload.demographics
  );

  let authorityPayloadHash = "";
  const receipt = await postAuthoritativeSubmission(
    reconciled.pending,
    async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as {
        payload_sha256: string;
      };
      authorityPayloadHash = request.payload_sha256;
      return Response.json(
        {
          receipt_id: "receipt-fallback-recovery-0001",
          session_id: fallbackPayload.session.session_id,
          participant_id:
            fallbackPayload.session.participant_id,
          dataset_classification: "formal",
          payload_sha256: reconciled.pending.payload_sha256,
          stored_at: "2026-07-27T01:05:03.000Z",
          is_replay: false,
          authority: "netlify_database",
          mirror_status: "pending"
        },
        { status: 201 }
      );
    }
  );
  assert.equal(
    authorityPayloadHash,
    reconciled.pending.payload_sha256
  );
  assert.equal(
    receipt.receiptId,
    "receipt-fallback-recovery-0001"
  );
});

test("authoritative submit requires a matching database receipt", async () => {
  const submission = await buildNetlifyFormSubmission(
    netlifyTestPayload,
    1,
    null
  );
  const pending = createPendingSubmissionRecord(
    {
      payloadJson: submission.payloadJson,
      payloadSha256: submission.payloadSha256,
      payloadSnapshot: structuredClone(netlifyTestPayload)
    },
    "client-submit-test-0001"
  );
  let observedRequest: Record<string, unknown> | null = null;
  const receipt = await postAuthoritativeSubmission(
    pending,
    async (input, init) => {
      assert.equal(String(input), "/api/submit");
      observedRequest = JSON.parse(String(init?.body)) as Record<
        string,
        unknown
      >;
      return Response.json(
        {
          receipt_id: "receipt-authority-test-0001",
          session_id: netlifyTestPayload.session.session_id,
          participant_id:
            netlifyTestPayload.session.participant_id,
          dataset_classification: "formal",
          payload_sha256: submission.payloadSha256,
          stored_at: "2026-07-27T01:05:01.000Z",
          is_replay: false,
          authority: "netlify_database",
          mirror_status: "pending"
        },
        { status: 201 }
      );
    }
  );

  assert.equal(receipt.receiptId, "receipt-authority-test-0001");
  assert.equal(receipt.payloadSha256, submission.payloadSha256);
  assert.equal(observedRequest?.schema_version, 1);
  assert.equal(
    observedRequest?.client_token,
    "client-submit-test-0001"
  );
  assert.equal(
    observedRequest?.payload_json,
    submission.payloadJson
  );
  assert.equal(
    observedRequest?.payload_sha256,
    submission.payloadSha256
  );
  assert.deepEqual(observedRequest?.transport, {
    client_attempt_count: 1,
    previous_attempt_latency_ms: null
  });

  const mismatchedPending = {
    ...pending,
    attempt_count: 0,
    previous_attempt_latency_ms: null
  };
  await assert.rejects(
    postAuthoritativeSubmission(
      mismatchedPending,
      async () =>
        Response.json(
          {
            receipt_id: "receipt-wrong-hash",
            session_id: netlifyTestPayload.session.session_id,
            participant_id:
              netlifyTestPayload.session.participant_id,
            dataset_classification: "formal",
            payload_sha256: "0".repeat(64),
            stored_at: "2026-07-27T01:05:01.000Z",
            is_replay: false,
            authority: "netlify_database",
            mirror_status: "pending"
          },
          { status: 201 }
        )
    ),
    /did not match the frozen submission/
  );

  const conflictPending = {
    ...pending,
    attempt_count: 0,
    previous_attempt_latency_ms: null
  };
  await assert.rejects(
    postAuthoritativeSubmission(
      conflictPending,
      async () =>
        Response.json(
          {
            error: {
              code: "SUBMISSION_CONFLICT",
              message: "a different payload already exists",
              retryable: false
            }
          },
          { status: 409 }
        )
    ),
    (error: unknown) =>
      error instanceof AuthoritativeSubmissionError &&
      error.code === "SUBMISSION_CONFLICT" &&
      error.retryable === false
  );
});

test("Deploy Preview test data uses authority and cannot treat Forms as saved", () => {
  assert.match(apiClientSource, /AUTHORITATIVE_SUBMIT_ENDPOINT\s*=\s*"\/api\/submit"/);
  assert.match(
    apiClientSource,
    /if\s*\(!usesAuthoritativeSubmissionTransport\(\)\)[\s\S]*?status:\s*"local_preview"/
  );
  assert.doesNotMatch(apiClientSource, /isNetlifyFormsMode/);
  assert.match(
    completionSource,
    /result\.status\s*===\s*"confirmed"/
  );
  assert.doesNotMatch(
    completionSource,
    /await submit\(\);\s*return\s+"success"/
  );
});

test("preview, debug, and fixed-format URLs request test data without changing participant copy", () => {
  assert.equal(getRequestedDatasetClassification("?preview=1"), "test");
  assert.equal(getRequestedDatasetClassification("?debug=1"), "test");
  assert.equal(
    getRequestedDatasetClassification("?format=table"),
    "test"
  );
  assert.equal(
    getRequestedDatasetClassification("?preview=0"),
    undefined
  );
  assert.equal(getRequestedDatasetClassification(""), undefined);
  assert.doesNotMatch(joinedCopy(PRE_TASK_COPY), /测试|预览模式/);
});

test("valid fixed-format links select that format and are classified as test", () => {
  assert.equal(
    getRequestedPreviewFormatOverride("?preview=1&format=table"),
    "table"
  );
  assert.equal(
    getRequestedPreviewFormatOverride("?preview=1&format=graph"),
    "graph"
  );
  assert.equal(
    getRequestedPreviewFormatOverride("?debug=1&format=video"),
    "video"
  );
  assert.equal(
    getRequestedPreviewFormatOverride("?format=table"),
    "table"
  );
  assert.equal(
    getRequestedPreviewFormatOverride("?preview=0&format=video"),
    "video"
  );
  assert.equal(
    getRequestedPreviewFormatOverride("?preview=1&format=unknown"),
    undefined
  );
  assert.equal(
    resolveExperimentFormat("?preview=1&format=table", "graph"),
    "table"
  );
  assert.equal(resolveExperimentFormat("?format=table", "video"), "table");
  assert.equal(resolveExperimentFormat("", "graph"), "graph");
  assert.match(mainSource, /resolveExperimentFormat/);
  assert.match(
    mainSource,
    /resolveExperimentFormat\([\s\S]*window\.location\.search,[\s\S]*bootstrap\.format_assignment/
  );
});

test("success and unconfirmed completion states render different, truthful HTML", () => {
  const successHtml = buildCompletionHtml(
    {
      state: "success",
      receiptId: "receipt-display-test-0001",
      storedAt: "2026-07-27T01:05:01.000Z"
    },
    5
  );
  const unconfirmedHtml = buildCompletionHtml(
    { state: "unconfirmed" },
    5
  );
  const localPreviewHtml = buildCompletionHtml(
    { state: "local_preview" },
    5
  );

  assert.notEqual(successHtml, unconfirmedHtml);
  assert.match(
    successHtml,
    /(?:提交成功|已成功提交|已由研究服务器确认保存)/
  );
  assert.doesNotMatch(
    successHtml,
    /(?:尚未确认|未确认提交|提交未成功|重新提交)/
  );

  assert.match(
    unconfirmedHtml,
    /(?:尚未确认|未确认提交|提交未成功)/
  );
  assert.doesNotMatch(
    unconfirmedHtml,
    /(?:您的作答已成功提交|您现在可以关闭|安全地关闭|data-completion-status="success")/
  );
  assert.match(unconfirmedHtml, /(?:重试|重新提交)/);
  assert.match(successHtml, /receipt-display-test-0001/);
  assert.match(successHtml, /已由研究服务器确认保存/);
  assert.match(unconfirmedHtml, /主存储/);
  assert.doesNotMatch(unconfirmedHtml, /已由研究服务器确认保存/);
  assert.match(localPreviewHtml, /没有发送到研究服务器/);
  assert.doesNotMatch(
    localPreviewHtml,
    /data-completion-status="success"/
  );

  assert.match(successHtml, /下载本人作答备份（可选）/);
  assert.match(unconfirmedHtml, /下载本人作答备份（可选）/);
});

test("completion debrief and method disclaimers are absent from participant-facing sources", () => {
  const successHtml = buildCompletionHtml(
    {
      state: "success",
      receiptId: "receipt-copy-test-0001",
      storedAt: "2026-07-27T01:05:01.000Z"
    },
    5
  );
  const unconfirmedHtml = buildCompletionHtml(
    { state: "unconfirmed" },
    5
  );

  const renderedSources =
    `${participantCopySource}\n${trialRenderingSource}\n${completionSource}`;
  for (const forbidden of [
    "完成后的研究说明",
    "不要求采用特定方法",
    "不要求使用特定预测方法",
    "数据处理说明",
    "隐私与数据",
    "必要网络日志",
    "联系邮箱",
    "备案人真实姓名"
  ]) {
    assert.equal(renderedSources.includes(forbidden), false);
    assert.equal(successHtml.includes(forbidden), false);
    assert.equal(unconfirmedHtml.includes(forbidden), false);
  }
});
