import assert from "node:assert/strict";
import test from "node:test";

import { buildExperimentTrials } from "../src/data/officialManifest";
import {
  assembleExperimentPayload,
  getTrialNavigationModel
} from "../src/experiment/controlledQuestionnaire";
import type { ExperimentDemographics } from "../src/experiment/experimentTypes";
import {
  addFullscreenInteraction,
  addTrialVisibleDuration,
  beginAssetLoadAttempt,
  buildFinalTrialAnswer,
  commitTrialAnswer,
  createQuestionnaireTrialState,
  finishAssetLoadAttempt,
  recordTrialVisit
} from "../src/experiment/questionnaireState";

test("five prediction pages expose the locked previous/forward controls", () => {
  assert.deepEqual(getTrialNavigationModel(0), {
    showPrevious: false,
    forwardLabel: "下一题"
  });
  for (const trialIndex of [1, 2, 3]) {
    assert.deepEqual(getTrialNavigationModel(trialIndex), {
      showPrevious: true,
      forwardLabel: "下一题"
    });
  }
  assert.deepEqual(getTrialNavigationModel(4), {
    showPrevious: true,
    forwardLabel: "下一页"
  });
  assert.throws(() => getTrialNavigationModel(-1));
  assert.throws(() => getTrialNavigationModel(5));
});

test("draft, visits, timing, fullscreen metrics, and video quota persist across visits", () => {
  const state = createQuestionnaireTrialState();
  state.draft.point = "12.5";
  state.draft.s1 = "-5";
  state.videoRevealCompleted = true;
  state.videoReplayUsed = true;
  state.videoReplayCompleted = false;
  state.videoInitialRestartCount = 2;

  recordTrialVisit(state, "2026-07-23T01:00:00.000Z");
  addTrialVisibleDuration(state, 1200.4);
  addFullscreenInteraction(state, 1, 450.2);
  recordTrialVisit(state, "2026-07-23T01:05:00.000Z");
  addTrialVisibleDuration(state, 800.6);
  addFullscreenInteraction(state, 2, 600.8);

  assert.equal(state.draft.point, "12.5");
  assert.equal(state.draft.s1, "-5");
  assert.equal(state.firstStartedAt, "2026-07-23T01:00:00.000Z");
  assert.equal(state.visitCount, 2);
  assert.equal(Math.round(state.durationMs), 2001);
  assert.equal(state.fullscreenOpenCount, 3);
  assert.equal(Math.round(state.fullscreenDurationMs), 1051);
  assert.equal(state.videoRevealCompleted, true);
  assert.equal(state.videoReplayUsed, true);
  assert.equal(state.videoReplayCompleted, false);
  assert.equal(state.videoInitialRestartCount, 2);
});

test("video playback lifecycle metrics start from a conservative empty state", () => {
  const state = createQuestionnaireTrialState();

  assert.equal(state.videoRevealCompleted, false);
  assert.equal(state.videoReplayUsed, false);
  assert.equal(state.videoReplayCompleted, false);
  assert.equal(state.videoInitialRestartCount, 0);
});

test("revision count changes only after a previously submitted answer changes", () => {
  const state = createQuestionnaireTrialState();
  state.draft.point = "10";
  const first = buildFinalTrialAnswer("point_only", state.draft);

  commitTrialAnswer(state, first, "2026-07-23T01:00:00.000Z");
  assert.equal(state.revisionCount, 0);

  commitTrialAnswer(state, first, "2026-07-23T01:01:00.000Z");
  assert.equal(state.revisionCount, 0);

  state.draft.point = "11";
  const revised = buildFinalTrialAnswer("point_only", state.draft);
  commitTrialAnswer(state, revised, "2026-07-23T01:02:00.000Z");
  assert.equal(state.revisionCount, 1);
  assert.equal(state.finalAnswer?.point, 11);
  assert.equal(
    state.finalSubmittedAt,
    "2026-07-23T01:02:00.000Z"
  );
});

test("arbitrary decimal answers survive finalization without rounding", () => {
  const state = createQuestionnaireTrialState();
  state.draft.point = "3.445";
  state.draft.s1 = "-10.125";
  state.draft.s2 = "0.0001";
  state.draft.s3 = "3.44";
  state.draft.s4 = "3.44";
  state.draft.s5 = "99.99999";
  state.draft.p1 = "33.3333";
  state.draft.p2 = "33.3333";
  state.draft.p3 = "33.3334";
  state.draft.p4 = "0";
  state.draft.p5 = "0";

  const answer = buildFinalTrialAnswer("point_spd", state.draft);

  assert.deepEqual(answer, {
    point: 3.445,
    s1: -10.125,
    s2: 0.0001,
    s3: 3.44,
    s4: 3.44,
    s5: 99.99999,
    p1: 33.3333,
    p2: 33.3333,
    p3: 33.3334,
    p4: 0,
    p5: 0,
    sumS: 96.75509,
    sumP: 100
  });
});

test("asset loading records attempts, cumulative duration, and eventual success without identifiers", () => {
  const state = createQuestionnaireTrialState();

  const firstStartedAt = beginAssetLoadAttempt(state, 100);
  finishAssetLoadAttempt(state, firstStartedAt, 260, "failed");
  const secondStartedAt = beginAssetLoadAttempt(state, 300);
  finishAssetLoadAttempt(state, secondStartedAt, 410, "loaded");

  assert.equal(state.assetLoadAttemptCount, 2);
  assert.equal(state.assetLoadDurationMs, 270);
  assert.equal(state.assetLoadStatus, "loaded");
});

test("final payload always contains five unique final trials and no answer history", () => {
  const stimuli = buildExperimentTrials("table");
  const trialStates = stimuli.map((stimulus, index) => {
    const state = createQuestionnaireTrialState();
    state.draft.point = String(index + 1);
    if (stimulus.response_type === "point_spd") {
      for (let row = 1; row <= 5; row += 1) {
        state.draft[`s${row}` as "s1"] = String(row);
        state.draft[`p${row}` as "p1"] = "20";
      }
    }
    recordTrialVisit(
      state,
      `2026-07-23T01:0${index}:00.000Z`
    );
    commitTrialAnswer(
      state,
      buildFinalTrialAnswer(stimulus.response_type, state.draft),
      `2026-07-23T01:1${index}:00.000Z`
    );
    return state;
  });
  const demographics: ExperimentDemographics = {
    gender: "女",
    age: 30,
    education: "本科",
    experience: "中等经验",
    stat_course: "是",
    started_at: "2026-07-23T01:20:00.000Z",
    submitted_at: "2026-07-23T01:21:00.000Z",
    duration_ms: 60000
  };

  const payload = assembleExperimentPayload({
    stimuli,
    trialStates,
    demographics,
    sessionId: "session-test",
    participantId: "participant-test",
    formatAssignment: "table",
    datasetClassification: "test",
    formalCollectionAllowed: false,
    allocationMetadata: {
      allocation_id: null,
      randomization_version: null,
      allocation_method: null,
      allocation_status: null,
      assigned_at: null,
      fallback_reason_code: null,
      fallback_reconciled_at: null
    },
    startedAt: "2026-07-23T01:00:00.000Z",
    submittedAt: "2026-07-23T01:21:00.000Z"
  });

  assert.equal(payload.trials.length, 5);
  assert.deepEqual(
    {
      allocation_id: payload.session.allocation_id,
      randomization_version: payload.session.randomization_version,
      allocation_method: payload.session.allocation_method,
      allocation_status: payload.session.allocation_status,
      assigned_at: payload.session.assigned_at,
      fallback_reason_code: payload.session.fallback_reason_code,
      fallback_reconciled_at:
        payload.session.fallback_reconciled_at
    },
    {
      allocation_id: null,
      randomization_version: null,
      allocation_method: null,
      allocation_status: null,
      assigned_at: null,
      fallback_reason_code: null,
      fallback_reconciled_at: null
    }
  );
  assert.equal(
    new Set(payload.trials.map((trial) => trial.trial_no)).size,
    5
  );
  assert.equal(
    new Set(payload.trials.map((trial) => trial.sequence_uid)).size,
    5
  );
  assert.deepEqual(
    payload.trials.map((trial) => trial.visit_count),
    [1, 1, 1, 1, 1]
  );
  assert.ok(
    payload.trials.every(
      (trial) =>
        trial.asset_load_duration_ms === null &&
        trial.asset_load_attempt_count === 0 &&
        trial.asset_load_status === "not_applicable" &&
        trial.video_playback_version === null &&
        trial.playback_asset_path === null &&
        trial.playback_asset_sha256 === null &&
        trial.video_replay_used === false &&
        trial.video_replay_completed === false &&
        trial.video_initial_restart_count === 0
    )
  );
  assert.ok(
    payload.trials.every(
      (trial) =>
        !("answer_history" in trial) &&
        !("previous_answers" in trial)
    )
  );
});

test("Video payloads preserve legacy provenance and record the approved playback asset", () => {
  const stimuli = buildExperimentTrials("video");
  const trialStates = stimuli.map((stimulus, index) => {
    const state = createQuestionnaireTrialState();
    state.draft.point = String(index + 1);
    if (stimulus.response_type === "point_spd") {
      for (let row = 1; row <= 5; row += 1) {
        state.draft[`s${row}` as "s1"] = String(row);
        state.draft[`p${row}` as "p1"] = "20";
      }
    }
    state.videoReplayUsed = index === 0;
    state.videoReplayCompleted = index === 0;
    state.videoInitialRestartCount = index === 0 ? 1 : 0;
    recordTrialVisit(
      state,
      `2026-07-23T01:0${index}:00.000Z`
    );
    commitTrialAnswer(
      state,
      buildFinalTrialAnswer(stimulus.response_type, state.draft),
      `2026-07-23T01:1${index}:00.000Z`
    );
    return state;
  });
  const demographics: ExperimentDemographics = {
    gender: "female",
    age: 30,
    education: "bachelor",
    experience: "moderate",
    stat_course: "yes",
    started_at: "2026-07-23T01:20:00.000Z",
    submitted_at: "2026-07-23T01:21:00.000Z",
    duration_ms: 60000
  };

  const payload = assembleExperimentPayload({
    stimuli,
    trialStates,
    demographics,
    sessionId: "session-video-test",
    participantId: "participant-video-test",
    formatAssignment: "video",
    datasetClassification: "test",
    formalCollectionAllowed: false,
    allocationMetadata: {
      allocation_id: null,
      randomization_version: null,
      allocation_method: null,
      allocation_status: null,
      assigned_at: null,
      fallback_reason_code: null,
      fallback_reconciled_at: null
    },
    startedAt: "2026-07-23T01:00:00.000Z",
    submittedAt: "2026-07-23T01:21:00.000Z"
  });

  for (const [index, trial] of payload.trials.entries()) {
    const stimulus = stimuli[index];
    assert.equal(trial.legacy_path, stimulus.legacy_path);
    assert.equal(
      trial.legacy_asset_sha256,
      stimulus.legacy_asset_sha256
    );
    assert.equal(trial.stimulus_path, stimulus.playback_asset_path);
    assert.equal(trial.asset_sha256, stimulus.playback_asset_sha256);
    assert.equal(trial.video_playback_version, "single-play-gif-v1");
    assert.equal(
      trial.playback_asset_path,
      stimulus.playback_asset_path
    );
    assert.equal(
      trial.playback_asset_sha256,
      stimulus.playback_asset_sha256
    );
  }
  assert.equal(payload.trials[0].video_replay_used, true);
  assert.equal(payload.trials[0].video_replay_completed, true);
  assert.equal(payload.trials[0].video_initial_restart_count, 1);
});
