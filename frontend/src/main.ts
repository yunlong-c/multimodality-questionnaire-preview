import "./styles/main.css";

import type {
  ExperimentPayload,
  ExperimentTrial
} from "./experiment/buildExperiment";
import { apiBootstrap, apiSubmit, type BootstrapResponse } from "./api/client";
import {
  INSTRUCTIONS_COPY,
  LANDING_COPY
} from "./content/participantCopy";
import {
  catalogHash,
  stimulusSetVersion
} from "./data/releaseInfo";
import {
  getRequestedDatasetClassification,
  resolveExperimentFormat
} from "./config/runtimeMode";
import {
  buildCompletionHtml,
  resolveSubmissionState,
  type SubmissionStatus
} from "./submission/completion";
import { renderRegulatoryFooter } from "./config/regulatoryFooter";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("App root #app not found.");
}

renderLandingPage(app);
renderRegulatoryFooter();

function renderLandingPage(root: HTMLDivElement): void {
  root.innerHTML = `
    <main class="shell shell--landing">
      <section class="card hero">
        <p class="eyebrow">${LANDING_COPY.eyebrow}</p>
        <h1>${LANDING_COPY.title}</h1>
        <p class="lead">
          ${LANDING_COPY.lead}
        </p>
        <p>
          ${LANDING_COPY.detail}
        </p>
        <div class="research-meta" aria-label="研究概况">
          <span>${LANDING_COPY.duration}</span>
          <span>${LANDING_COPY.questionCount}</span>
        </div>
        <div class="page-actions">
          <button id="next-instructions" class="button button--primary">${LANDING_COPY.continueButton}</button>
        </div>
      </section>
    </main>
  `;

  const button = root.querySelector<HTMLButtonElement>("#next-instructions");
  button?.addEventListener("click", () => renderInstructionsPage(root));
}

function renderInstructionsPage(root: HTMLDivElement): void {
  root.innerHTML = `
    <main class="shell shell--landing">
      <section class="card hero">
        <p class="eyebrow">${INSTRUCTIONS_COPY.eyebrow}</p>
        <h1>${INSTRUCTIONS_COPY.title}</h1>
        <div class="instructions-content text-left">
          <p>${INSTRUCTIONS_COPY.intro}</p>
          <ul class="bullet-list">
            <li><strong>${INSTRUCTIONS_COPY.viewLabel}</strong> ${INSTRUCTIONS_COPY.viewText}</li>
            <li><strong>${INSTRUCTIONS_COPY.pointLabel}</strong> ${INSTRUCTIONS_COPY.pointText}</li>
            <li><strong>${INSTRUCTIONS_COPY.distributionLabel}</strong> ${INSTRUCTIONS_COPY.distributionText}</li>
            <li><strong>${INSTRUCTIONS_COPY.backgroundLabel}</strong> ${INSTRUCTIONS_COPY.backgroundText}</li>
          </ul>
          <p>${INSTRUCTIONS_COPY.durationAndMethod}</p>
        </div>
        <div class="button-row page-actions page-actions--split">
          <button id="back-landing" class="button button--secondary">${INSTRUCTIONS_COPY.backButton}</button>
          <button id="next-consent" class="button button--primary">${INSTRUCTIONS_COPY.consentButton}</button>
        </div>
      </section>
    </main>
  `;

  root.querySelector<HTMLButtonElement>("#back-landing")?.addEventListener("click", () => renderLandingPage(root));
  root.querySelector<HTMLButtonElement>("#next-consent")?.addEventListener("click", () => renderConsentPage(root));
}

function renderConsentPage(root: HTMLDivElement): void {
  root.innerHTML = `
    <main class="shell shell--landing">
      <section class="card hero">
        <p class="eyebrow">参与研究</p>
        <h1>参与确认</h1>
        <div class="consent-content consent-box text-left">
          <dl class="consent-list">
            <div><dt>参与时长</dt><dd>约 5–10 分钟。</dd></div>
            <div><dt>自愿参与及退出</dt><dd>您的参与完全自愿。您有权在任何时候中止参与，不会产生任何不利后果。</dd></div>
            <div><dt>数据保密性</dt><dd>本研究所收集的所有数据将仅用于学术分析，完全匿名化处理，不会包含或泄露您的任何个人身份信息。</dd></div>
          </dl>
          <div class="consent-check-wrap">
            <label class="consent-check">
              <input type="checkbox" id="consent-checkbox" />
              <span>我已阅读并理解上述内容，同意参与本研究</span>
            </label>
          </div>
        </div>
        <div class="button-row page-actions page-actions--split">
          <button id="back-instructions" class="button button--secondary">返回</button>
          <button id="start-experiment" class="button button--primary" disabled>开始答题</button>
        </div>
      </section>
    </main>
  `;

  const checkbox = root.querySelector<HTMLInputElement>("#consent-checkbox");
  const startButton = root.querySelector<HTMLButtonElement>("#start-experiment");
  const backButton = root.querySelector<HTMLButtonElement>("#back-instructions");
  const actionRow = root.querySelector<HTMLDivElement>(".page-actions--split");
  const mobileActionLayout = window.matchMedia("(max-width: 720px)");

  const syncActionOrder = (): void => {
    if (!actionRow || !startButton || !backButton) {
      return;
    }

    if (mobileActionLayout.matches) {
      actionRow.append(startButton, backButton);
    } else {
      actionRow.append(backButton, startButton);
    }
  };

  const stopSyncingActionOrder = (): void => {
    mobileActionLayout.removeEventListener("change", syncActionOrder);
  };

  syncActionOrder();
  mobileActionLayout.addEventListener("change", syncActionOrder);

  checkbox?.addEventListener("change", (e) => {
    if (startButton) {
      startButton.disabled = !(e.target as HTMLInputElement).checked;
    }
  });

  backButton?.addEventListener("click", () => {
    stopSyncingActionOrder();
    renderInstructionsPage(root);
  });
  
  startButton?.addEventListener("click", () => {
    startButton.disabled = true;
    startButton.textContent = "正在连接服务器…";

    Promise.all([
      apiBootstrap(
        getRequestedDatasetClassification(window.location.search)
      ),
      import("./experiment/buildExperiment")
    ])
      .then(([bootstrap, { startExperiment }]: [
        BootstrapResponse,
        typeof import("./experiment/buildExperiment")
      ]) => {
        const catalogReleaseMatches =
          bootstrap.catalog_hash === catalogHash &&
          bootstrap.stimulus_set_version === stimulusSetVersion;
        const formalCollectionAllowed =
          bootstrap.formal_collection_allowed === true &&
          bootstrap.dataset_classification === "formal" &&
          catalogReleaseMatches;
        const formatAssignment = resolveExperimentFormat(
          window.location.search,
          bootstrap.format_assignment
        );

        startExperiment({
          mount: root,
          formatAssignment,
          participantId: bootstrap.participant_id,
          sessionId: bootstrap.session_id,
          datasetClassification: formalCollectionAllowed ? "formal" : "test",
          formalCollectionAllowed,
          onComplete: (payload) => {
            const submit = () =>
              apiSubmit(
                bootstrap.session_id,
                bootstrap.participant_id,
                payload
              );
            renderSubmittingPage(root);
            void submitAndRenderCompletion(root, payload, submit);
          }
        });
        stopSyncingActionOrder();
      })
      .catch((err) => {
        console.error("Bootstrap failed:", err);
        startButton.disabled = false;
        startButton.textContent = "开始答题";
        alert("无法连接到服务器，请确保后端已启动后重试。");
      });
  });
}

type SubmitRequest = () => Promise<unknown>;

function renderSubmittingPage(root: HTMLDivElement): void {
  root.innerHTML = `
    <main class="shell shell--success">
      <section class="card submission-status" role="status" aria-live="polite">
        <p class="eyebrow">正在提交</p>
        <h1>正在保存您的作答</h1>
        <p class="lead">请保持此页面打开，提交完成后页面会自动更新。</p>
      </section>
    </main>
  `;
}

async function submitAndRenderCompletion(
  root: HTMLDivElement,
  payload: ExperimentPayload,
  submit: SubmitRequest
): Promise<void> {
  const status = await resolveSubmissionState(submit);
  renderCompletionPage(root, payload, status, submit);
}

function renderCompletionPage(
  root: HTMLDivElement,
  payload: ExperimentPayload,
  status: SubmissionStatus,
  submit: SubmitRequest
): void {
  root.innerHTML = buildCompletionHtml(status, payload.trials.length);

  const retryButton = root.querySelector<HTMLButtonElement>("#retry-submit");
  const submissionFeedback =
    root.querySelector<HTMLElement>("#submission-feedback");

  retryButton?.addEventListener("click", async () => {
    if (retryButton.dataset.pending === "true") {
      return;
    }

    retryButton.dataset.pending = "true";
    retryButton.disabled = true;
    retryButton.textContent = "正在重新提交…";
    if (submissionFeedback) {
      submissionFeedback.textContent = "正在确认提交状态，请保持页面打开。";
    }

    const nextStatus = await resolveSubmissionState(submit);
    if (nextStatus === "success") {
      renderCompletionPage(root, payload, nextStatus, submit);
      return;
    }

    retryButton.dataset.pending = "false";
    retryButton.disabled = false;
    retryButton.textContent = "重新提交";
    if (submissionFeedback) {
      submissionFeedback.textContent =
        "仍未能确认提交状态。请检查网络后再次尝试，或下载本地备份并联系研究人员。";
    }
  });

  const downloadJsonBtn = root.querySelector<HTMLButtonElement>("#download-json");
  downloadJsonBtn?.addEventListener("click", () => {
    downloadTextFile(
      JSON.stringify(payload, null, 2),
      `experiment_data_${payload.session.session_id}.json`,
      "application/json;charset=utf-8"
    );
  });

  const downloadCsvBtn = root.querySelector<HTMLButtonElement>("#download-csv");
  downloadCsvBtn?.addEventListener("click", async () => {
    const { trialCsvHeaders } = await import("./experiment/buildExperiment");
    downloadTextFile(
      generateCsv(payload, trialCsvHeaders),
      `experiment_trials_${payload.session.session_id}.csv`,
      "text/csv;charset=utf-8"
    );
  });
}

function generateCsv(
  payload: ExperimentPayload,
  headers: readonly (keyof ExperimentTrial)[]
): string {
  const trialRows = payload.trials;

  const rows = trialRows.map((trial) => {
    return headers
      .map((header) => escapeCsvValue(trial[header]))
      .join(",");
  });

  return [headers.join(","), ...rows].join("\r\n");
}

function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  const normalized = String(value).replaceAll('"', '""');
  return /[",\n\r]/.test(normalized) ? `"${normalized}"` : normalized;
}

function downloadTextFile(content: string, filename: string, mimeType: string): void {
  const normalizedContent = mimeType.includes("text/csv") ? `\uFEFF${content}` : content;
  const blob = new Blob([normalizedContent], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
