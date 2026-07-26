import {
  buildExperimentTrials,
  catalogHash,
  stimulusSetVersion
} from "../data/officialManifest";
import type { AssembledTrial, StimulusFormat } from "../data/manifestTypes";
import type {
  DatasetClassification,
  ExperimentDemographics,
  ExperimentPayload,
  ExperimentTrial,
  StartExperimentOptions
} from "./experimentTypes";
import {
  TRIAL_RESPONSE_FIELD_NAMES,
  addFullscreenInteraction,
  addTrialVisibleDuration,
  buildFinalTrialAnswer,
  commitTrialAnswer,
  createQuestionnaireTrialState,
  recordTrialVisit,
  type QuestionnaireTrialState,
  type TrialResponseDraft
} from "./questionnaireState";
import {
  attachStimulusInteractions,
  attachTrialValidation,
  buildDemographicHtml,
  buildTrialHtml,
  buildTrialPreamble,
  type StimulusInteractionController,
  type TrialValidationController
} from "./trialRendering";

interface AssemblePayloadOptions {
  stimuli: readonly AssembledTrial[];
  trialStates: readonly QuestionnaireTrialState[];
  demographics: ExperimentDemographics;
  sessionId: string;
  participantId: string;
  formatAssignment: StimulusFormat;
  datasetClassification: DatasetClassification;
  formalCollectionAllowed: boolean;
  startedAt: string;
  submittedAt: string;
}

export interface TrialNavigationModel {
  showPrevious: boolean;
  forwardLabel: "下一题" | "下一页";
}

export function getTrialNavigationModel(
  trialIndex: number,
  trialCount = 5
): TrialNavigationModel {
  if (
    !Number.isInteger(trialIndex) ||
    !Number.isInteger(trialCount) ||
    trialCount <= 0 ||
    trialIndex < 0 ||
    trialIndex >= trialCount
  ) {
    throw new Error("Trial navigation index is out of range.");
  }

  return {
    showPrevious: trialIndex > 0,
    forwardLabel: trialIndex === trialCount - 1 ? "下一页" : "下一题"
  };
}

export function runControlledQuestionnaire({
  mount,
  formatAssignment,
  participantId,
  sessionId,
  datasetClassification,
  formalCollectionAllowed,
  onComplete
}: StartExperimentOptions): void {
  const sessionStartedAt = new Date().toISOString();
  const stimuli = buildExperimentTrials(formatAssignment);
  const trialStates = stimuli.map(() => createQuestionnaireTrialState());
  const effectiveDatasetClassification: DatasetClassification =
    formalCollectionAllowed && datasetClassification === "formal"
      ? "formal"
      : "test";

  mount.innerHTML = `
    <main class="shell">
      <section class="card card--experiment">
        <div id="questionnaire-host" class="questionnaire-host"></div>
      </section>
    </main>
  `;

  const displayElement =
    mount.querySelector<HTMLElement>("#questionnaire-host");
  if (!displayElement) {
    throw new Error("Questionnaire display element not found.");
  }

  let activeTrialIndex: number | null = null;
  let activeInteraction: StimulusInteractionController | null = null;
  let activeValidation: TrialValidationController | null = null;
  let activeVisibleStartedAt: number | null = null;
  let demographicsActive = false;
  let demographicsStartedAt: string | null = null;
  let demographicsDurationMs = 0;
  let completed = false;

  const pauseVisibleClock = (): void => {
    if (activeVisibleStartedAt === null) {
      return;
    }

    const elapsed = Math.max(0, performance.now() - activeVisibleStartedAt);
    if (activeTrialIndex !== null) {
      addTrialVisibleDuration(trialStates[activeTrialIndex], elapsed);
    } else if (demographicsActive) {
      demographicsDurationMs += elapsed;
    }
    activeVisibleStartedAt = null;
  };

  const resumeVisibleClock = (): void => {
    if (
      activeVisibleStartedAt === null &&
      document.visibilityState === "visible" &&
      (activeTrialIndex !== null || demographicsActive)
    ) {
      activeVisibleStartedAt = performance.now();
    }
  };

  const handleVisibilityChange = (): void => {
    if (document.visibilityState === "hidden") {
      pauseVisibleClock();
    } else {
      resumeVisibleClock();
    }
  };

  document.addEventListener("visibilitychange", handleVisibilityChange);

  const leaveActiveTrial = (form: HTMLFormElement): void => {
    if (activeTrialIndex === null) {
      return;
    }

    trialStates[activeTrialIndex].draft = readTrialDraft(form);
    pauseVisibleClock();

    const interactionSnapshot = activeInteraction?.snapshot();
    if (interactionSnapshot) {
      addFullscreenInteraction(
        trialStates[activeTrialIndex],
        interactionSnapshot.fullscreenOpenCount,
        interactionSnapshot.fullscreenDurationMs
      );
    }

    activeInteraction?.cleanup();
    activeValidation?.cleanup();
    activeInteraction = null;
    activeValidation = null;
    activeTrialIndex = null;
  };

  const renderDemographics = (): void => {
    demographicsStartedAt = new Date().toISOString();
    demographicsActive = true;
    activeVisibleStartedAt = null;

    displayElement.innerHTML = `
      <div class="jspsych-content-wrapper">
        <div class="jspsych-content">
          <div class="jspsych-survey-html-form-preamble">
            <div class="demographic-header">
              <p class="eyebrow">背景问卷</p>
              <h2>基本信息</h2>
            </div>
          </div>
          <form id="jspsych-survey-html-form">
            ${buildDemographicHtml()}
            <div class="questionnaire-navigation questionnaire-navigation--single" data-questionnaire-navigation>
              <button id="jspsych-survey-html-form-next" class="button button--primary" type="submit">
                提交并完成
              </button>
            </div>
          </form>
        </div>
      </div>
    `;

    const form =
      displayElement.querySelector<HTMLFormElement>(
        "#jspsych-survey-html-form"
      );
    const submitButton =
      displayElement.querySelector<HTMLButtonElement>(
        "#jspsych-survey-html-form-next"
      );
    if (!form || !submitButton) {
      throw new Error("Demographic form failed to render.");
    }

    let submissionStarted = false;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (submissionStarted || !form.reportValidity()) {
        return;
      }

      submissionStarted = true;
      submitButton.disabled = true;
      pauseVisibleClock();
      demographicsActive = false;
      completed = true;
      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange
      );

      const submittedAt = new Date().toISOString();
      const demographics = readDemographics(
        form,
        demographicsStartedAt,
        submittedAt,
        Math.round(demographicsDurationMs)
      );
      const payload = assembleExperimentPayload({
        stimuli,
        trialStates,
        demographics,
        sessionId,
        participantId,
        formatAssignment,
        datasetClassification: effectiveDatasetClassification,
        formalCollectionAllowed,
        startedAt: sessionStartedAt,
        submittedAt
      });
      onComplete(payload);
    });

    resumeVisibleClock();
    scrollPageToTop();
  };

  const renderTrial = (trialIndex: number): void => {
    const stimulus = stimuli[trialIndex];
    const state = trialStates[trialIndex];
    if (!stimulus || !state) {
      throw new Error(`Questionnaire trial ${trialIndex + 1} is unavailable.`);
    }

    recordTrialVisit(state, new Date().toISOString());
    activeTrialIndex = trialIndex;
    activeVisibleStartedAt = null;

    const navigation = getTrialNavigationModel(
      trialIndex,
      stimuli.length
    );
    displayElement.innerHTML = `
      <div class="jspsych-content-wrapper">
        <div class="jspsych-content">
          <div class="jspsych-survey-html-form-preamble">
            ${buildTrialPreamble(stimulus)}
          </div>
          <form id="jspsych-survey-html-form">
            ${buildTrialHtml(stimulus)}
            <div class="questionnaire-navigation${navigation.showPrevious ? "" : " questionnaire-navigation--single"}" data-questionnaire-navigation>
              ${
                navigation.showPrevious
                  ? `
                    <button id="questionnaire-previous" class="button button--secondary" type="button">
                      上一题
                    </button>
                  `
                  : ""
              }
              <button id="jspsych-survey-html-form-next" class="button button--primary" type="submit">
                ${navigation.forwardLabel}
              </button>
            </div>
          </form>
        </div>
      </div>
    `;

    const form =
      displayElement.querySelector<HTMLFormElement>(
        "#jspsych-survey-html-form"
      );
    const previousButton =
      displayElement.querySelector<HTMLButtonElement>(
        "#questionnaire-previous"
      );
    const nextButton =
      displayElement.querySelector<HTMLButtonElement>(
        "#jspsych-survey-html-form-next"
      );
    if (!form || !nextButton) {
      throw new Error(`Questionnaire trial ${trialIndex + 1} failed to render.`);
    }

    restoreTrialDraft(form, state.draft);
    activeValidation = attachTrialValidation(stimulus, form);
    activeValidation.refresh();

    let navigationLocked = false;
    const setNavigationLocked = (locked: boolean): void => {
      navigationLocked = locked;
      nextButton.disabled = locked;
      if (previousButton) {
        previousButton.disabled = locked;
      }
    };
    activeInteraction = attachStimulusInteractions(
      stimulus,
      state,
      setNavigationLocked
    );

    previousButton?.addEventListener("click", () => {
      if (navigationLocked || completed) {
        return;
      }
      leaveActiveTrial(form);
      renderTrial(trialIndex - 1);
    });

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (navigationLocked || completed) {
        return;
      }

      state.draft = readTrialDraft(form);
      if (!activeValidation?.validate()) {
        return;
      }

      const answer = buildFinalTrialAnswer(
        stimulus.response_type,
        state.draft
      );
      commitTrialAnswer(state, answer, new Date().toISOString());
      leaveActiveTrial(form);

      if (trialIndex < stimuli.length - 1) {
        renderTrial(trialIndex + 1);
      } else {
        renderDemographics();
      }
    });

    resumeVisibleClock();
    scrollPageToTop();
  };

  renderTrial(0);
}

export function assembleExperimentPayload({
  stimuli,
  trialStates,
  demographics,
  sessionId,
  participantId,
  formatAssignment,
  datasetClassification,
  formalCollectionAllowed,
  startedAt,
  submittedAt
}: AssemblePayloadOptions): ExperimentPayload {
  assertFinalTrialSet(stimuli, trialStates);

  return {
    session: {
      session_id: sessionId,
      participant_id: participantId,
      format_assignment: formatAssignment,
      stimulus_set_version: stimulusSetVersion,
      catalog_hash: catalogHash,
      dataset_classification: datasetClassification,
      formal_collection_allowed: formalCollectionAllowed,
      started_at: startedAt,
      submitted_at: submittedAt,
      duration_ms:
        new Date(submittedAt).getTime() - new Date(startedAt).getTime()
    },
    trials: stimuli.map((stimulus, index) =>
      buildFinalTrialRow({
        stimulus,
        state: trialStates[index],
        demographics,
        sessionId,
        formatAssignment,
        datasetClassification
      })
    ),
    demographics
  };
}

function buildFinalTrialRow({
  stimulus,
  state,
  demographics,
  sessionId,
  formatAssignment,
  datasetClassification
}: {
  stimulus: AssembledTrial;
  state: QuestionnaireTrialState;
  demographics: ExperimentDemographics;
  sessionId: string;
  formatAssignment: StimulusFormat;
  datasetClassification: DatasetClassification;
}): ExperimentTrial {
  const answer = state.finalAnswer;
  if (!answer) {
    throw new Error(`Trial ${stimulus.trial_no} has no final answer.`);
  }

  return {
    session_id: sessionId,
    format_assignment: formatAssignment,
    stimulus_set_version: stimulus.stimulus_set_version,
    catalog_hash: stimulus.catalog_hash,
    dataset_classification: datasetClassification,
    trial_no: stimulus.trial_no,
    pool: stimulus.pool,
    sequence_uid: stimulus.sequence_uid,
    canonical_key: stimulus.canonical_key,
    presentation_uid: stimulus.presentation_uid,
    source_id: stimulus.source_id,
    stimulus_id: String(stimulus.source_id),
    display_index: stimulus.display_index,
    legacy_asset_no: stimulus.legacy_asset_no,
    pair_uid: stimulus.pair_uid,
    format: stimulus.format,
    variant: stimulus.variant,
    response_type: stimulus.response_type,
    legacy_path: stimulus.legacy_path,
    legacy_asset_path: stimulus.legacy_path,
    stimulus_path: stimulus.legacy_path,
    legacy_asset_sha256: stimulus.legacy_asset_sha256,
    asset_sha256: stimulus.asset_sha256,
    renderer_version: stimulus.renderer_version,
    values_sha256: stimulus.values_sha256,
    pool2_speed: stimulus.pool2_speed,
    source_data_file: stimulus.source_data_file,
    rho: stimulus.metadata.rho ?? null,
    trend: stimulus.metadata.trend ?? null,
    beta: stimulus.metadata.beta ?? null,
    condition: stimulus.metadata.condition ?? null,
    tau_obs: stimulus.metadata.tau_obs ?? null,
    beta1: stimulus.metadata.beta1 ?? null,
    beta2: stimulus.metadata.beta2 ?? null,
    structure: stimulus.metadata.structure ?? null,
    direction: stimulus.metadata.direction ?? null,
    sigma1: stimulus.metadata.sigma1 ?? null,
    sigma2: stimulus.metadata.sigma2 ?? null,
    point: answer.point,
    trial_started_at: state.firstStartedAt,
    trial_submitted_at: state.finalSubmittedAt,
    trial_duration_ms: Math.round(state.durationMs),
    visit_count: state.visitCount,
    revision_count: state.revisionCount,
    fullscreen_open_count:
      stimulus.format === "table" ? null : state.fullscreenOpenCount,
    fullscreen_duration_ms:
      stimulus.format === "table" ? null : Math.round(state.fullscreenDurationMs),
    s1: answer.s1,
    s2: answer.s2,
    s3: answer.s3,
    s4: answer.s4,
    s5: answer.s5,
    p1: answer.p1,
    p2: answer.p2,
    p3: answer.p3,
    p4: answer.p4,
    p5: answer.p5,
    gender: demographics.gender,
    age: demographics.age,
    education: demographics.education,
    experience: demographics.experience,
    stat_course: demographics.stat_course,
    sumS: answer.sumS,
    sumP: answer.sumP
  };
}

function assertFinalTrialSet(
  stimuli: readonly AssembledTrial[],
  trialStates: readonly QuestionnaireTrialState[]
): void {
  if (stimuli.length !== 5 || trialStates.length !== 5) {
    throw new Error("A completed questionnaire must contain exactly 5 trials.");
  }

  const trialNumbers = new Set(stimuli.map((stimulus) => stimulus.trial_no));
  if (
    trialNumbers.size !== 5 ||
    ![1, 2, 3, 4, 5].every((trialNo) => trialNumbers.has(trialNo))
  ) {
    throw new Error("Final questionnaire trials must be unique and numbered 1–5.");
  }

  if (trialStates.some((state) => state.finalAnswer === null)) {
    throw new Error("Every questionnaire trial must have one final answer.");
  }
}

function readTrialDraft(form: HTMLFormElement): TrialResponseDraft {
  const draft = {} as TrialResponseDraft;
  for (const name of TRIAL_RESPONSE_FIELD_NAMES) {
    const input = form.elements.namedItem(name);
    draft[name] = input instanceof HTMLInputElement ? input.value : "";
  }
  return draft;
}

function restoreTrialDraft(
  form: HTMLFormElement,
  draft: TrialResponseDraft
): void {
  for (const name of TRIAL_RESPONSE_FIELD_NAMES) {
    const input = form.elements.namedItem(name);
    if (input instanceof HTMLInputElement) {
      input.value = draft[name];
    }
  }
}

function readDemographics(
  form: HTMLFormElement,
  startedAt: string | null,
  submittedAt: string,
  durationMs: number
): ExperimentDemographics {
  const formData = new FormData(form);
  return {
    gender: formValueOrNull(formData.get("gender")),
    age: numberOrNull(formValueOrNull(formData.get("age"))),
    education: formValueOrNull(formData.get("education")),
    experience: formValueOrNull(formData.get("experience")),
    stat_course: formValueOrNull(formData.get("stat_course")),
    started_at: startedAt,
    submitted_at: submittedAt,
    duration_ms: durationMs
  };
}

function formValueOrNull(value: FormDataEntryValue | null): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function numberOrNull(value: string | null): number | null {
  if (value === null || value.trim() === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function scrollPageToTop(): void {
  window.scrollTo({
    top: 0,
    left: 0,
    behavior: "auto"
  });
}
