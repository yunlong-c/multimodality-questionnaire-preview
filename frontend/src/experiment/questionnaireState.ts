import type { ResponseType } from "../data/manifestTypes";
import type { AssetLoadStatus } from "./experimentTypes";

export const SUPPORT_FIELD_NAMES = ["s1", "s2", "s3", "s4", "s5"] as const;
export const PROBABILITY_FIELD_NAMES = ["p1", "p2", "p3", "p4", "p5"] as const;
export const TRIAL_RESPONSE_FIELD_NAMES = [
  "point",
  ...SUPPORT_FIELD_NAMES,
  ...PROBABILITY_FIELD_NAMES
] as const;

export type TrialResponseFieldName =
  (typeof TRIAL_RESPONSE_FIELD_NAMES)[number];

export type TrialResponseDraft = Record<TrialResponseFieldName, string>;

export interface FinalTrialAnswer {
  point: number;
  s1: number | null;
  s2: number | null;
  s3: number | null;
  s4: number | null;
  s5: number | null;
  p1: number | null;
  p2: number | null;
  p3: number | null;
  p4: number | null;
  p5: number | null;
  sumS: number | null;
  sumP: number | null;
}

export interface QuestionnaireTrialState {
  draft: TrialResponseDraft;
  finalAnswer: FinalTrialAnswer | null;
  finalAnswerSignature: string | null;
  firstStartedAt: string | null;
  finalSubmittedAt: string | null;
  durationMs: number;
  visitCount: number;
  revisionCount: number;
  fullscreenOpenCount: number;
  fullscreenDurationMs: number;
  assetLoadDurationMs: number;
  assetLoadAttemptCount: number;
  assetLoadStatus: AssetLoadStatus;
  videoRevealCompleted: boolean;
  videoReplayUsed: boolean;
}

export function createEmptyTrialDraft(): TrialResponseDraft {
  return {
    point: "",
    s1: "",
    s2: "",
    s3: "",
    s4: "",
    s5: "",
    p1: "",
    p2: "",
    p3: "",
    p4: "",
    p5: ""
  };
}

export function createQuestionnaireTrialState(): QuestionnaireTrialState {
  return {
    draft: createEmptyTrialDraft(),
    finalAnswer: null,
    finalAnswerSignature: null,
    firstStartedAt: null,
    finalSubmittedAt: null,
    durationMs: 0,
    visitCount: 0,
    revisionCount: 0,
    fullscreenOpenCount: 0,
    fullscreenDurationMs: 0,
    assetLoadDurationMs: 0,
    assetLoadAttemptCount: 0,
    assetLoadStatus: "not_applicable",
    videoRevealCompleted: false,
    videoReplayUsed: false
  };
}

export function beginAssetLoadAttempt(
  state: QuestionnaireTrialState,
  startedAtMs: number
): number {
  state.assetLoadAttemptCount += 1;
  if (state.assetLoadStatus !== "loaded") {
    state.assetLoadStatus = "pending";
  }
  return startedAtMs;
}

export function finishAssetLoadAttempt(
  state: QuestionnaireTrialState,
  startedAtMs: number,
  finishedAtMs: number,
  status: "loaded" | "failed"
): void {
  const elapsed = finishedAtMs - startedAtMs;
  if (Number.isFinite(elapsed) && elapsed >= 0) {
    state.assetLoadDurationMs += elapsed;
  }

  if (status === "loaded" || state.assetLoadStatus !== "loaded") {
    state.assetLoadStatus = status;
  }
}

export function recordTrialVisit(
  state: QuestionnaireTrialState,
  startedAt: string
): void {
  state.visitCount += 1;
  state.firstStartedAt ??= startedAt;
}

export function addTrialVisibleDuration(
  state: QuestionnaireTrialState,
  durationMs: number
): void {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return;
  }
  state.durationMs += durationMs;
}

export function addFullscreenInteraction(
  state: QuestionnaireTrialState,
  openCount: number,
  durationMs: number
): void {
  if (Number.isInteger(openCount) && openCount > 0) {
    state.fullscreenOpenCount += openCount;
  }
  if (Number.isFinite(durationMs) && durationMs > 0) {
    state.fullscreenDurationMs += durationMs;
  }
}

export function buildFinalTrialAnswer(
  responseType: ResponseType,
  draft: TrialResponseDraft
): FinalTrialAnswer {
  const point = requiredNumber(draft.point, "point");

  if (responseType === "point_only") {
    return {
      point,
      s1: null,
      s2: null,
      s3: null,
      s4: null,
      s5: null,
      p1: null,
      p2: null,
      p3: null,
      p4: null,
      p5: null,
      sumS: null,
      sumP: null
    };
  }

  const supports = SUPPORT_FIELD_NAMES.map((name) =>
    requiredNumber(draft[name], name)
  );
  const probabilities = PROBABILITY_FIELD_NAMES.map((name) =>
    requiredNumber(draft[name], name)
  );

  return {
    point,
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
    sumS: supports.reduce((sum, value) => sum + value, 0),
    sumP: probabilities.reduce((sum, value) => sum + value, 0)
  };
}

export function commitTrialAnswer(
  state: QuestionnaireTrialState,
  answer: FinalTrialAnswer,
  submittedAt: string
): void {
  const signature = JSON.stringify(answer);
  if (
    state.finalAnswerSignature !== null &&
    state.finalAnswerSignature !== signature
  ) {
    state.revisionCount += 1;
  }

  state.finalAnswer = answer;
  state.finalAnswerSignature = signature;
  state.finalSubmittedAt = submittedAt;
}

function requiredNumber(value: string, fieldName: string): number {
  const parsed = Number(value);
  if (value.trim() === "" || !Number.isFinite(parsed)) {
    throw new Error(`Cannot finalize invalid trial field: ${fieldName}`);
  }
  return parsed;
}
