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
import { buildTrialHtml } from "../src/experiment/trialRendering";
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
  NETLIFY_FORM_NAME,
  buildNetlifyFormSubmission,
  postNetlifyForm,
  resolveStaticCollectionState
} from "../src/api/client";
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
const participantCopySource = readFileSync(
  path.resolve("src/content/participantCopy.ts"),
  "utf8"
);
const stylesSource = readFileSync(
  path.resolve("src/styles/main.css"),
  "utf8"
);

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
  assert.match(examplePanel, /<summary>查看填写示例<\/summary>/);
  assert.doesNotMatch(examplePanel, /<details[^>]*\sopen(?:\s|>)/);
  assert.doesNotMatch(examplePanel, /<input\b/);
  assert.match(examplePanel, /class="distribution-example-table"/);
  assert.match(examplePanel, /以下数值仅用于说明填写格式，与本题答案无关，请勿照抄。/);

  const exampleBody = examplePanel.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1];
  assert.ok(exampleBody);
  assert.equal((exampleBody.match(/<tr>/g) ?? []).length, 5);
  assert.match(examplePanel, /<th scope="row">合计<\/th>/);
  assert.match(examplePanel, /<td>100%<\/td>/);

  const formalInputs = trialHtml.match(/<input\b[\s\S]*?\/>/g) ?? [];
  assert.equal(formalInputs.length, 11);
  for (const input of formalInputs) {
    assert.doesNotMatch(input, /\svalue=/);
  }

  assert.match(stylesSource, /\.distribution-example-table\s*\{[\s\S]*?width:\s*100%/);
  assert.match(stylesSource, /table-layout:\s*fixed/);
  assert.doesNotMatch(trialRenderingSource, /\/assets\/ui\/example\.png/);
});

test("submission resolution distinguishes confirmed success from unconfirmed submission", async () => {
  assert.equal(
    await resolveSubmissionState(async () => undefined),
    "success"
  );
  assert.equal(
    await resolveSubmissionState(async () => {
      throw new Error("simulated network failure");
    }),
    "unconfirmed"
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

test("Netlify form declaration and encoded submission contain the audited payload and SHA-256", async () => {
  assert.match(indexSource, /name="mmq-submission-v1"/);
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
    "payload_json",
    "submit_attempt_count",
    "submit_latency_ms"
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
  assert.equal(submission.body.get("form-name"), NETLIFY_FORM_NAME);
  assert.equal(submission.body.get("payload_json"), expectedJson);
  assert.equal(submission.body.get("payload_sha256"), expectedHash);
  assert.equal(submission.body.get("submit_attempt_count"), "2");
  assert.equal(submission.body.get("submit_latency_ms"), "431");
  assert.equal(
    submission.body.get("submit_latency_scope"),
    "previous_completed_attempt"
  );
  assert.equal(submission.body.has("ip"), false);
  assert.equal(submission.body.has("location"), false);
  assert.equal(submission.body.has("device_fingerprint"), false);
});

test("Netlify Forms accepts only a 2xx response as confirmed success", async () => {
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

  const failedFetch: typeof fetch = async () =>
    new Response(null, { status: 503 });
  await assert.rejects(
    postNetlifyForm(submission, failedFetch),
    /Netlify Forms submit failed: 503/
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
  const successHtml = buildCompletionHtml("success", 5);
  const unconfirmedHtml = buildCompletionHtml("unconfirmed", 5);

  assert.notEqual(successHtml, unconfirmedHtml);
  assert.match(successHtml, /(?:提交成功|已成功提交)/);
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

  assert.match(successHtml, /下载本人作答备份（可选）/);
  assert.match(unconfirmedHtml, /下载本人作答备份（可选）/);
});

test("completion debrief and method disclaimers are absent from participant-facing sources", () => {
  const successHtml = buildCompletionHtml("success", 5);
  const unconfirmedHtml = buildCompletionHtml("unconfirmed", 5);

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
