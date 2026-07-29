import {
  DISTRIBUTION_COPY,
  DISTRIBUTION_EXAMPLE_ROWS,
  DISTRIBUTION_LABELS,
  TRIAL_COPY
} from "../content/participantCopy";
import { resolveAssetUrl } from "../config/assets";
import type { AssembledTrial } from "../data/manifestTypes";
import {
  PROBABILITY_FIELD_NAMES,
  SUPPORT_FIELD_NAMES,
  beginAssetLoadAttempt,
  finishAssetLoadAttempt,
  type QuestionnaireTrialState
} from "./questionnaireState";
import { renderSeriesTable } from "./seriesTableRenderer";
import {
  VIDEO_ASSET_LOAD_TIMEOUT_MS,
  VIDEO_COMPLETE_REVEAL_DURATION_MS,
  appendPlaybackFragment,
  beginPlaybackAfterLoad,
  getVideoHiddenAction,
  preloadImageAsset,
  shouldShowVideoTerminalFrame,
  type VideoCompletionContext,
  type VideoPlaybackMode,
  waitForImageLoad
} from "./videoAssetLoader";

export interface StimulusInteractionSnapshot {
  fullscreenOpenCount: number;
  fullscreenDurationMs: number;
}

export interface StimulusInteractionController {
  snapshot: () => StimulusInteractionSnapshot;
  cleanup: () => void;
}

export interface StimulusInteractionOptions {
  onPrimaryAssetReady?: () => void;
}

export interface TrialValidationController {
  validate: () => boolean;
  refresh: () => void;
  cleanup: () => void;
}

export function buildTrialPreamble(stimulus: AssembledTrial): string {
  const debugLabel = isDebugMode()
    ? `<div class="stimulus-debug-label">${escapeHtml(buildDebugLabel(stimulus))}</div>`
    : "";
  const progress = (stimulus.trial_no / 5) * 100;

  return `
    <div class="trial-header">
      <div class="trial-progress">
        <span>第 ${stimulus.trial_no} / 5 题</span>
        <div class="trial-progress__track" aria-hidden="true">
          <span style="width: ${progress}%"></span>
        </div>
      </div>
      <h2>${TRIAL_COPY.title}</h2>
      <p class="helper-text">${TRIAL_COPY.helper}</p>
      ${debugLabel}
    </div>
  `;
}

export function buildTrialHtml(stimulus: AssembledTrial): string {
  const stimulusHtml = renderStimulus(stimulus);
  const pointInput = `
    <label class="field field--point" for="point-prediction">
      <span class="field-label">${TRIAL_COPY.pointLabel}</span>
      <input
        id="point-prediction"
        type="number"
        step="0.1"
        inputmode="decimal"
        name="point"
        autocomplete="off"
        required
      />
    </label>
  `;

  const distributionInputs =
    stimulus.response_type === "point_spd"
      ? `
        <section class="field-group field-group--distribution" aria-labelledby="distribution-title">
          <div class="section-heading">
            <h3 id="distribution-title">${DISTRIBUTION_COPY.title}</h3>
            <p class="helper-text">${DISTRIBUTION_COPY.helper}</p>
          </div>
          <details class="example-panel">
            <summary>${DISTRIBUTION_COPY.guideSummary}</summary>
            <div class="example-panel__content">
              <ul class="bullet-list">
                ${DISTRIBUTION_COPY.guideItems
                  .map((item) => `<li>${item}</li>`)
                  .join("")}
              </ul>
              <p class="distribution-example-note">${DISTRIBUTION_COPY.exampleNote}</p>
              <table class="distribution-example-table" aria-label="${DISTRIBUTION_COPY.exampleTableAriaLabel}">
                <thead>
                  <tr>
                    <th scope="col">${DISTRIBUTION_COPY.levelHeader}</th>
                    <th scope="col">${DISTRIBUTION_COPY.valueHeader}</th>
                    <th scope="col">${DISTRIBUTION_COPY.probabilityHeader}</th>
                  </tr>
                </thead>
                <tbody>
                  ${DISTRIBUTION_EXAMPLE_ROWS.map(
                    ({ level, value, probability }) => `
                      <tr>
                        <th scope="row">${level}</th>
                        <td>${value}</td>
                        <td>${probability}%</td>
                      </tr>
                    `
                  ).join("")}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row">${DISTRIBUTION_COPY.exampleTotalLabel}</th>
                    <td>—</td>
                    <td>100%</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </details>
          <div class="distribution-table" role="group" aria-label="${DISTRIBUTION_COPY.tableAriaLabel}">
            <div class="distribution-row distribution-row--header" aria-hidden="true">
              <div>${DISTRIBUTION_COPY.levelHeader}</div>
              <div>${DISTRIBUTION_COPY.valueHeader}</div>
              <div>${DISTRIBUTION_COPY.probabilityHeader}</div>
            </div>
            ${DISTRIBUTION_LABELS.map((label, index) => ({
              label,
              supportName: `s${index + 1}`,
              probabilityName: `p${index + 1}`
            }))
              .map(
                ({ label, supportName, probabilityName }) => `
                  <div class="distribution-row">
                    <div class="distribution-level">${label}</div>
                    <div>
                      <label class="sr-only" for="${supportName}">${label}可能数值</label>
                      <input
                        id="${supportName}"
                        type="number"
                        step="0.1"
                        inputmode="decimal"
                        name="${supportName}"
                        aria-label="${label}可能数值"
                        autocomplete="off"
                        required
                      />
                    </div>
                    <div class="probability-input">
                      <label class="sr-only" for="${probabilityName}">${label}对应概率</label>
                      <input
                        id="${probabilityName}"
                        type="number"
                        step="0.1"
                        min="0"
                        max="100"
                        inputmode="decimal"
                        name="${probabilityName}"
                        aria-label="${label}对应概率"
                        autocomplete="off"
                        required
                      />
                      <span aria-hidden="true">%</span>
                    </div>
                  </div>
                `
              )
              .join("")}
          </div>
          <div class="distribution-feedback" aria-live="polite">
            <p data-probability-total>${DISTRIBUTION_COPY.initialProbabilityTotal}</p>
            <p data-support-order>${DISTRIBUTION_COPY.initialOrder}</p>
          </div>
        </section>
      `
      : "";

  return `
    <div class="trial-shell" data-response-type="${stimulus.response_type}">
      ${stimulusHtml}
      <section class="field-group field-group--point">
        ${pointInput}
      </section>
      ${distributionInputs}
    </div>
  `;
}

export function buildDemographicHtml(): string {
  return `
    <div class="demographics-container demographics-panel">
      <section class="demographic-row">
        <fieldset class="field fieldset-reset demographic-field">
          <legend class="demo-label">您的性别</legend>
          <div class="choice-row">
            <label class="radio-label"><input type="radio" name="gender" value="男" required /> <span>男</span></label>
            <label class="radio-label"><input type="radio" name="gender" value="女" required /> <span>女</span></label>
          </div>
        </fieldset>
      </section>
      <section class="demographic-row">
        <label class="field demographic-field">
          <span class="demo-label">您的年龄</span>
          <input type="number" step="1" min="1" inputmode="numeric" name="age" required />
        </label>
      </section>
      <section class="demographic-row">
        <label class="field demographic-field">
          <span class="demo-label">您的受教育程度</span>
          <select name="education" required>
            <option value="">请选择</option>
            <option value="高中及以下">高中及以下</option>
            <option value="大专/高职">大专 / 高职</option>
            <option value="本科">本科</option>
            <option value="硕士">硕士</option>
            <option value="博士">博士</option>
          </select>
        </label>
      </section>
      <section class="demographic-row">
        <label class="field demographic-field">
          <span class="demo-label">您在数据分析或数值判断方面的经验如何？</span>
          <select name="experience" required>
            <option value="">请选择</option>
            <option value="毫无经验">毫无经验</option>
            <option value="有一些经验">有一些经验</option>
            <option value="中等经验">中等经验</option>
            <option value="非常丰富的经验">非常丰富的经验</option>
          </select>
        </label>
      </section>
      <section class="demographic-row">
        <label class="field demographic-field">
          <span class="demo-label">您是否修读过统计学或相关课程？</span>
          <select name="stat_course" required>
            <option value="">请选择</option>
            <option value="是">是</option>
            <option value="否">否</option>
          </select>
        </label>
      </section>
    </div>
  `;
}

export function attachStimulusInteractions(
  stimulus: AssembledTrial,
  state: QuestionnaireTrialState,
  setNavigationLocked: (locked: boolean) => void,
  options: StimulusInteractionOptions = {}
): StimulusInteractionController {
  const fullscreenController = attachFullscreenInteraction();
  const cleanupCallbacks: Array<() => void> = [fullscreenController.cleanup];
  let primaryAssetReadyNotified = false;
  let interactionsCleanedUp = false;
  const notifyPrimaryAssetReady = (): void => {
    if (primaryAssetReadyNotified || interactionsCleanedUp) {
      return;
    }
    primaryAssetReadyNotified = true;
    try {
      options.onPrimaryAssetReady?.();
    } catch {
      // Background prefetch must never affect the visible stimulus flow.
    }
  };

  if (stimulus.format === "graph") {
    const image =
      document.querySelector<HTMLImageElement>("[data-graph-image]");
    if (image) {
      const startedAt = beginAssetLoadAttempt(state, performance.now());
      let settled = false;

      const finish = (status: "loaded" | "failed"): void => {
        if (settled) {
          return;
        }
        settled = true;
        finishAssetLoadAttempt(
          state,
          startedAt,
          performance.now(),
          status
        );
        if (status === "loaded") {
          notifyPrimaryAssetReady();
        }
      };
      const handleLoad = (): void => finish("loaded");
      const handleError = (): void => finish("failed");

      image.addEventListener("load", handleLoad, { once: true });
      image.addEventListener("error", handleError, { once: true });
      if (image.complete) {
        queueMicrotask(() => {
          finish(image.naturalWidth > 0 ? "loaded" : "failed");
        });
      }

      cleanupCallbacks.push(() => {
        image.removeEventListener("load", handleLoad);
        image.removeEventListener("error", handleError);
      });
    }
  }

  if (stimulus.format === "video") {
    const container = document.querySelector<HTMLElement>(
      "[data-video-stimulus]"
    );
    const image =
      container?.querySelector<HTMLImageElement>("[data-video-image]");
    const replayButton =
      container?.querySelector<HTMLButtonElement>("[data-video-replay]");
    const retryButton =
      container?.querySelector<HTMLButtonElement>("[data-video-retry]");
    const loadingPanel =
      container?.querySelector<HTMLElement>("[data-video-loading]");
    const loadingText =
      container?.querySelector<HTMLElement>("[data-video-loading-text]");
    const status =
      container?.querySelector<HTMLElement>("[data-video-status]");

    if (image && replayButton && retryButton) {
      const gifUrl = image.dataset.gifSrc;
      const terminalFrameUrl = image.dataset.terminalFrameSrc;
      const revealDurationMs = VIDEO_COMPLETE_REVEAL_DURATION_MS;
      let playbackTimer: number | null = null;
      let loadController: AbortController | null = null;
      let playbackAttempt = 0;
      let failedMode: VideoPlaybackMode | null = null;
      let activeMode: VideoPlaybackMode | null = null;
      let restartInitialWhenVisible = false;
      let countInitialRestartWhenVisible = false;
      let cleanedUp = false;

      const showTerminalFrame = (): void => {
        if (terminalFrameUrl && image.isConnected) {
          image.src = terminalFrameUrl;
        }
        image.hidden = false;
        image.removeAttribute("aria-busy");
      };

      const showCompletedControls = (): void => {
        setNavigationLocked(false);
        activeMode = null;
        failedMode = null;
        retryButton.hidden = true;
        retryButton.disabled = true;
        if (loadingPanel) {
          loadingPanel.hidden = true;
        }

        if (!state.videoReplayUsed) {
          replayButton.hidden = false;
          replayButton.disabled = false;
          replayButton.textContent = "重播一次";
          if (status) {
            status.textContent = "历史数据已完整呈现，可选择重播一次。";
          }
        } else {
          replayButton.hidden = false;
          replayButton.disabled = true;
          replayButton.textContent = "重播已使用";
          if (status) {
            status.textContent = "本题的重播机会已使用。";
          }
        }
      };

      const showCompletedPresentation = (
        context: VideoCompletionContext
      ): void => {
        if (shouldShowVideoTerminalFrame(context)) {
          showTerminalFrame();
        }
        showCompletedControls();
      };

      const completeInitialReveal = (): void => {
        state.videoRevealCompleted = true;
        showCompletedPresentation("natural_completion");
      };

      const completeReplay = (): void => {
        state.videoReplayCompleted = true;
        showCompletedPresentation("natural_completion");
      };

      const schedule = (onComplete: () => void): void => {
        if (playbackTimer !== null) {
          window.clearTimeout(playbackTimer);
        }
        if (revealDurationMs !== null && revealDurationMs > 0) {
          playbackTimer = window.setTimeout(() => {
            playbackTimer = null;
            onComplete();
          }, revealDurationMs);
        } else {
          onComplete();
        }
      };

      const cancelActivePlayback = (): void => {
        loadController?.abort();
        loadController = null;
        if (playbackTimer !== null) {
          window.clearTimeout(playbackTimer);
          playbackTimer = null;
        }
      };

      const handleVisibilityChange = (): void => {
        if (!document.hidden) {
          if (
            restartInitialWhenVisible &&
            !state.videoRevealCompleted &&
            !cleanedUp
          ) {
            if (countInitialRestartWhenVisible) {
              state.videoInitialRestartCount += 1;
            }
            restartInitialWhenVisible = false;
            countInitialRestartWhenVisible = false;
            void beginPlayback("initial");
          }
          return;
        }

        const action = getVideoHiddenAction(activeMode);
        if (action === "none") {
          return;
        }

        cancelActivePlayback();
        activeMode = null;
        failedMode = null;

        if (action === "restart_initial_when_visible") {
          restartInitialWhenVisible = true;
          countInitialRestartWhenVisible = true;
          image.hidden = true;
          image.removeAttribute("src");
          image.setAttribute("aria-busy", "true");
          setNavigationLocked(true);
          return;
        }

        state.videoReplayCompleted = false;
        showCompletedPresentation("interrupted_replay");
      };

      const showLoadFailure = (mode: "initial" | "replay"): void => {
        activeMode = null;
        failedMode = mode;
        image.hidden = true;
        image.removeAttribute("src");
        image.setAttribute("aria-busy", "false");
        if (loadingPanel) {
          loadingPanel.hidden = false;
        }
        if (loadingText) {
          loadingText.textContent = "动画加载失败";
        }
        retryButton.hidden = false;
        retryButton.disabled = false;
        retryButton.textContent = "重新加载";
        replayButton.hidden = mode === "initial";
        replayButton.disabled = true;
        if (status) {
          status.textContent =
            mode === "initial"
              ? "动画未能加载。请检查网络后重新加载；完成呈现前不能翻页。"
              : "重播未能加载。请检查网络后重新加载，或继续作答。";
        }
      };

      const beginPlayback = async (
        mode: VideoPlaybackMode
      ): Promise<void> => {
        if (cleanedUp) {
          return;
        }
        if (mode === "initial" && document.hidden) {
          restartInitialWhenVisible = true;
          setNavigationLocked(true);
          return;
        }

        const assetLoadStartedAt =
          mode === "initial"
            ? beginAssetLoadAttempt(state, performance.now())
            : null;

        if (!gifUrl) {
          if (assetLoadStartedAt !== null) {
            finishAssetLoadAttempt(
              state,
              assetLoadStartedAt,
              performance.now(),
              "failed"
            );
          }
          showLoadFailure(mode);
          return;
        }

        loadController?.abort();
        loadController = new AbortController();
        const { signal } = loadController;
        playbackAttempt += 1;
        activeMode = mode;
        if (mode === "initial") {
          restartInitialWhenVisible = false;
        }
        failedMode = null;

        if (playbackTimer !== null) {
          window.clearTimeout(playbackTimer);
          playbackTimer = null;
        }

        if (mode === "initial") {
          setNavigationLocked(true);
          replayButton.hidden = true;
        } else {
          replayButton.hidden = false;
          replayButton.disabled = true;
          replayButton.textContent = "重播已使用";
        }

        image.hidden = true;
        image.setAttribute("aria-busy", "true");
        retryButton.hidden = true;
        retryButton.disabled = true;
        if (loadingPanel) {
          loadingPanel.hidden = false;
        }
        if (loadingText) {
          loadingText.textContent =
            mode === "initial" ? "动画正在加载" : "正在准备重播";
        }
        if (status) {
          status.textContent =
            mode === "initial"
              ? "动画正在加载，加载完成后将自动开始。"
              : "正在准备重播；您可以继续作答或离开本题。";
        }

        try {
          const playbackUrl = appendPlaybackFragment(
            gifUrl,
            `${Date.now()}-${playbackAttempt}`
          );
          await beginPlaybackAfterLoad({
            preload: () =>
              preloadImageAsset(
                gifUrl,
                signal,
                VIDEO_ASSET_LOAD_TIMEOUT_MS
              ),
            present: async () => {
              if (signal.aborted || !image.isConnected) {
                return;
              }
              await waitForImageLoad(image, playbackUrl, {
                signal,
                clearOnAbort: true,
                timeoutMs: VIDEO_ASSET_LOAD_TIMEOUT_MS
              });
            },
            onReady: () => {
              if (signal.aborted || !image.isConnected) {
                return;
              }

              if (assetLoadStartedAt !== null) {
                finishAssetLoadAttempt(
                  state,
                  assetLoadStartedAt,
                  performance.now(),
                  "loaded"
                );
              }
              if (mode === "initial") {
                notifyPrimaryAssetReady();
              }
              image.hidden = false;
              image.setAttribute("aria-busy", "false");
              if (loadingPanel) {
                loadingPanel.hidden = true;
              }
              if (status) {
                status.textContent =
                  mode === "initial"
                    ? "历史数据正在呈现，请完整查看。"
                    : "历史数据正在重新呈现；您可以继续作答或离开本题。";
              }
              schedule(
                mode === "initial"
                  ? completeInitialReveal
                  : completeReplay
              );
            }
          });
        } catch (error) {
          if (
            signal.aborted ||
            (error instanceof Error && error.name === "AbortError")
          ) {
            return;
          }
          if (assetLoadStartedAt !== null) {
            finishAssetLoadAttempt(
              state,
              assetLoadStartedAt,
              performance.now(),
              "failed"
            );
          }
          showLoadFailure(mode);
        }
      };

      const replay = (): void => {
        if (state.videoReplayUsed || !gifUrl) {
          return;
        }

        state.videoReplayUsed = true;
        state.videoReplayCompleted = false;
        replayButton.hidden = false;
        replayButton.disabled = true;
        replayButton.textContent = "重播已使用";
        if (status) {
          status.textContent = "正在准备重播；您可以继续作答或离开本题。";
        }
        void beginPlayback("replay");
      };

      const retryLoad = (): void => {
        if (!failedMode) {
          return;
        }
        void beginPlayback(failedMode);
      };

      document.addEventListener("visibilitychange", handleVisibilityChange);

      if (state.videoRevealCompleted) {
        showCompletedPresentation("completed_revisit");
      } else {
        setNavigationLocked(true);
        replayButton.hidden = true;
        replayButton.disabled = true;
        if (status) {
          status.textContent = "动画正在加载，加载完成后将自动开始。";
        }
        void beginPlayback("initial");
      }

      replayButton.addEventListener("click", replay);
      retryButton.addEventListener("click", retryLoad);
      cleanupCallbacks.push(() => {
        cleanedUp = true;
        replayButton.removeEventListener("click", replay);
        retryButton.removeEventListener("click", retryLoad);
        document.removeEventListener(
          "visibilitychange",
          handleVisibilityChange
        );
        if (activeMode === "replay") {
          state.videoReplayCompleted = false;
        }
        cancelActivePlayback();
        activeMode = null;
      });
    }
  } else {
    setNavigationLocked(false);
  }

  return {
    snapshot: fullscreenController.snapshot,
    cleanup: () => {
      interactionsCleanedUp = true;
      for (const cleanup of cleanupCallbacks.reverse()) {
        cleanup();
      }
    }
  };
}

export function attachTrialValidation(
  stimulus: AssembledTrial,
  form: HTMLFormElement
): TrialValidationController {
  const supportInputs = SUPPORT_FIELD_NAMES.map(
    (name) => form.elements.namedItem(name) as HTMLInputElement | null
  ).filter((input): input is HTMLInputElement => input !== null);
  const probabilityInputs = PROBABILITY_FIELD_NAMES.map(
    (name) => form.elements.namedItem(name) as HTMLInputElement | null
  ).filter((input): input is HTMLInputElement => input !== null);
  const totalFeedback =
    form.querySelector<HTMLElement>("[data-probability-total]");
  const orderFeedback =
    form.querySelector<HTMLElement>("[data-support-order]");

  const readSupport = (): Array<number | null> =>
    supportInputs.map((input) => numberOrNull(input.value));
  const readProbabilities = (): Array<number | null> =>
    probabilityInputs.map((input) => numberOrNull(input.value));

  const refresh = (): void => {
    if (stimulus.response_type !== "point_spd") {
      return;
    }

    const support = readSupport();
    const probabilities = readProbabilities();
    const sum = probabilities.reduce<number>(
      (total, value) => total + (value ?? 0),
      0
    );
    const probabilityComplete = probabilities.every(
      (value) => value !== null
    );
    const probabilityValid =
      probabilityComplete && Math.abs(sum - 100) <= 0.001;

    if (totalFeedback) {
      totalFeedback.textContent = `概率合计：${formatFeedbackNumber(sum)}%（需为100%）`;
      totalFeedback.dataset.state = probabilityValid
        ? "valid"
        : probabilityComplete
          ? "invalid"
          : "neutral";
    }

    const supportComplete = support.every((value) => value !== null);
    const supportOrdered =
      supportComplete &&
      support.every(
        (value, index) =>
          index === 0 || (support[index - 1] as number) <= (value as number)
      );

    if (orderFeedback) {
      orderFeedback.textContent = supportComplete
        ? supportOrdered
          ? "数值顺序符合从小到大的要求。"
          : "请检查数值顺序：后一个数值不能小于前一个。"
        : "可能数值需按从小到大填写。";
      orderFeedback.dataset.state = supportOrdered
        ? "valid"
        : supportComplete
          ? "invalid"
          : "neutral";
    }
  };

  const validate = (): boolean => {
    const validationMessage = getOrCreateValidationMessage(form);
    validationMessage.textContent = "";

    if (!form.reportValidity()) {
      return false;
    }

    if (stimulus.response_type !== "point_spd") {
      return true;
    }

    const support = readSupport();
    const probabilities = readProbabilities();
    if (
      support.some((value) => value === null) ||
      probabilities.some((value) => value === null)
    ) {
      validationMessage.textContent =
        "请先完成所有可能数值和概率值的填写，再继续下一步。";
      [...supportInputs, ...probabilityInputs]
        .find((input) => input.value.trim() === "")
        ?.focus();
      return false;
    }

    for (let index = 1; index < support.length; index += 1) {
      if ((support[index - 1] as number) > (support[index] as number)) {
        validationMessage.textContent =
          "请确保 5 个可能数值按从小到大的顺序填写，可相等但不能递减。";
        supportInputs[index]?.focus();
        return false;
      }
    }

    const sum = probabilities.reduce<number>(
      (total, value) => total + (value ?? 0),
      0
    );
    if (Math.abs(sum - 100) > 0.001) {
      validationMessage.textContent =
        `请确保 5 个概率值的总和正好为 100%。当前合计为 ${formatFeedbackNumber(sum)}%。`;
      probabilityInputs[0]?.focus();
      return false;
    }

    return true;
  };

  for (const input of [...supportInputs, ...probabilityInputs]) {
    input.addEventListener("input", refresh);
  }
  refresh();

  return {
    validate,
    refresh,
    cleanup: () => {
      for (const input of [...supportInputs, ...probabilityInputs]) {
        input.removeEventListener("input", refresh);
      }
    }
  };
}

function renderStimulus(stimulus: AssembledTrial): string {
  const caption = "历史数据";

  if (stimulus.format === "table") {
    return `
      <section class="stimulus stimulus--table">
        <div class="stimulus-caption">${caption}</div>
        ${renderSeriesTable(stimulus.values)}
      </section>
    `;
  }

  const stimulusUrl = resolveAssetUrl(stimulus.legacy_path);

  if (stimulus.format === "graph") {
    return `
      <section class="stimulus stimulus--graph stimulus--media">
        <div class="stimulus-caption">${caption}</div>
        <div class="stimulus-media-frame">
          <img
            src="${escapeHtml(stimulusUrl)}"
            alt="前 20 期历史数据折线图"
            class="series-image"
            role="button"
            tabindex="0"
            aria-label="全屏查看前 20 期历史数据折线图"
            data-fullscreen-media
            data-fullscreen-label="历史数据折线图"
            data-graph-image
          />
        </div>
        <p class="media-hint">点击图像可全屏查看</p>
      </section>
    `;
  }

  const terminalFrameUrl = stimulus.terminal_frame_path
    ? resolveAssetUrl(stimulus.terminal_frame_path)
    : "";
  const playbackAssetUrl = stimulus.playback_asset_path
    ? resolveAssetUrl(stimulus.playback_asset_path)
    : "";
  const replayInitiallyHidden =
    stimulus.video_playback_version === "single-play-gif-v1";

  return `
    <section
      class="stimulus stimulus--video stimulus--media"
      data-video-stimulus
      data-reveal-duration-ms="${VIDEO_COMPLETE_REVEAL_DURATION_MS}"
      data-video-playback-version="${escapeHtml(stimulus.video_playback_version ?? "")}"
    >
      <div class="stimulus-caption">${caption}</div>
      <div class="stimulus-media-frame video-card">
        <div class="video-loading-panel" data-video-loading>
          <span class="video-loading-spinner" aria-hidden="true"></span>
          <span data-video-loading-text>动画正在加载</span>
        </div>
        <img
          alt="逐步呈现前 20 期历史数据的动画"
          class="series-image"
          role="button"
          tabindex="0"
          aria-label="全屏查看逐步呈现的历史数据动画"
          data-fullscreen-media
          data-fullscreen-label="历史数据动画"
          data-video-image
          data-gif-src="${escapeHtml(playbackAssetUrl)}"
          data-terminal-frame-src="${escapeHtml(terminalFrameUrl)}"
          aria-busy="true"
          hidden
        />
      </div>
      <p class="media-hint">点击动画可全屏查看</p>
      <button
        type="button"
        class="video-replay-button"
        data-video-replay
        ${replayInitiallyHidden ? "hidden" : ""}
      >
        重播一次
      </button>
      <button
        type="button"
        class="video-replay-button"
        data-video-retry
        hidden
        disabled
      >
        重新加载
      </button>
      <p class="video-replay-status helper-text" data-video-status aria-live="polite">
        ${replayInitiallyHidden ? "动画正在加载，加载完成后将自动开始。" : ""}
      </p>
    </section>
  `;
}

function attachFullscreenInteraction(): StimulusInteractionController {
  const media =
    document.querySelector<HTMLImageElement>("[data-fullscreen-media]");
  if (!media) {
    return {
      snapshot: () => ({
        fullscreenOpenCount: 0,
        fullscreenDurationMs: 0
      }),
      cleanup: () => undefined
    };
  }

  let openCount = 0;
  let accumulatedDurationMs = 0;
  let openedAt: number | null = null;
  let overlay: HTMLDivElement | null = null;
  let placeholder: HTMLDivElement | null = null;
  let previousFocus: HTMLElement | null = null;
  let historyStatePushed = false;

  const currentDuration = (): number =>
    openedAt === null
      ? accumulatedDurationMs
      : accumulatedDurationMs + Math.max(0, performance.now() - openedAt);

  const restoreMedia = (): void => {
    if (!overlay) {
      return;
    }

    if (openedAt !== null) {
      accumulatedDurationMs += Math.max(0, performance.now() - openedAt);
      openedAt = null;
    }

    if (placeholder?.isConnected) {
      placeholder.replaceWith(media);
    }
    media.classList.remove("series-image--fullscreen");
    overlay.remove();
    overlay = null;
    placeholder = null;
    document.body.classList.remove("media-lightbox-open");
    window.removeEventListener("keydown", handleOverlayKeydown);
    window.removeEventListener("popstate", handlePopState);
    previousFocus?.focus({ preventScroll: true });
  };

  const closeOverlay = (returnThroughHistory: boolean): void => {
    if (!overlay) {
      return;
    }
    restoreMedia();

    if (returnThroughHistory && historyStatePushed) {
      historyStatePushed = false;
      window.history.back();
    } else {
      historyStatePushed = false;
    }
  };

  const handleOverlayKeydown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeOverlay(true);
    }
  };

  const handlePopState = (): void => {
    if (overlay) {
      closeOverlay(false);
    }
  };

  const openOverlay = (): void => {
    if (overlay || !media.parentElement) {
      return;
    }

    openCount += 1;
    openedAt = performance.now();
    previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : media;

    const rect = media.getBoundingClientRect();
    placeholder = document.createElement("div");
    placeholder.className = "media-placeholder";
    placeholder.style.height = `${rect.height}px`;
    media.parentElement.insertBefore(placeholder, media);

    overlay = document.createElement("div");
    overlay.className = "media-lightbox";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute(
      "aria-label",
      media.dataset.fullscreenLabel
        ? `全屏查看${media.dataset.fullscreenLabel}`
        : "全屏查看历史数据"
    );
    overlay.innerHTML = `
      <button type="button" class="media-lightbox__close" aria-label="关闭全屏查看">
        关闭
      </button>
      <div class="media-lightbox__stage"></div>
      <p class="media-lightbox__hint">可使用双指缩放查看细节</p>
    `;

    const stage =
      overlay.querySelector<HTMLDivElement>(".media-lightbox__stage");
    const closeButton =
      overlay.querySelector<HTMLButtonElement>(".media-lightbox__close");
    if (!stage || !closeButton) {
      overlay.remove();
      overlay = null;
      placeholder.remove();
      placeholder = null;
      openedAt = null;
      return;
    }

    media.classList.add("series-image--fullscreen");
    stage.appendChild(media);
    document.body.appendChild(overlay);
    document.body.classList.add("media-lightbox-open");

    closeButton.addEventListener("click", () => closeOverlay(true), {
      once: true
    });
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay || event.target === stage) {
        closeOverlay(true);
      }
    });
    window.addEventListener("keydown", handleOverlayKeydown);
    window.addEventListener("popstate", handlePopState);
    window.history.pushState(
      { mmq_media_lightbox: true },
      document.title,
      window.location.href
    );
    historyStatePushed = true;
    closeButton.focus();
  };

  const handleMediaClick = (): void => openOverlay();
  const handleMediaKeydown = (event: KeyboardEvent): void => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openOverlay();
    }
  };

  media.addEventListener("click", handleMediaClick);
  media.addEventListener("keydown", handleMediaKeydown);

  return {
    snapshot: () => ({
      fullscreenOpenCount: openCount,
      fullscreenDurationMs: Math.round(currentDuration())
    }),
    cleanup: () => {
      media.removeEventListener("click", handleMediaClick);
      media.removeEventListener("keydown", handleMediaKeydown);
      if (overlay) {
        closeOverlay(true);
      }
    }
  };
}

function getOrCreateValidationMessage(
  form: HTMLFormElement
): HTMLDivElement {
  const existing =
    form.querySelector<HTMLDivElement>("#trial-validation-message");
  if (existing) {
    return existing;
  }

  const message = document.createElement("div");
  message.id = "trial-validation-message";
  message.className = "validation-error";
  message.setAttribute("role", "alert");

  const navigation = form.querySelector("[data-questionnaire-navigation]");
  if (navigation) {
    navigation.before(message);
  } else {
    form.appendChild(message);
  }
  return message;
}

function formatFeedbackNumber(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(1).replace(/\.0$/, "");
}

function numberOrNull(input?: string | null): number | null {
  if (input === undefined || input === null || input.trim() === "") {
    return null;
  }

  const value = Number(input);
  return Number.isFinite(value) ? value : null;
}

function isDebugMode(): boolean {
  const value = new URLSearchParams(window.location.search).get("debug");
  return value === "1" || value === "true";
}

function buildDebugLabel(stimulus: AssembledTrial): string {
  const poolLabel =
    stimulus.pool === "Pool_2"
      ? stimulus.variant === "fast"
        ? "P2-F"
        : "P2-S"
      : stimulus.pool.replace("Pool_", "P");
  const sourceId = String(stimulus.source_id).padStart(3, "0");
  const displayIndex = String(stimulus.display_index).padStart(3, "0");
  const assetNo = String(stimulus.legacy_asset_no).padStart(3, "0");
  return `${poolLabel} / ID${sourceId} / 顺序${displayIndex} / 文件${assetNo}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
