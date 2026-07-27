import type { SubmissionResult } from "../api/client";

export type SubmissionStatus =
  | {
      state: "success";
      receiptId: string;
      storedAt: string;
    }
  | {
      state: "local_preview";
    }
  | {
      state: "unconfirmed";
    };

export async function resolveSubmissionState(
  submit: () => Promise<SubmissionResult>,
): Promise<SubmissionStatus> {
  try {
    const result = await submit();
    if (result.status === "confirmed") {
      return {
        state: "success",
        receiptId: result.receipt.receiptId,
        storedAt: result.receipt.storedAt,
      };
    }
    return { state: "local_preview" };
  } catch {
    return { state: "unconfirmed" };
  }
}

export function buildCompletionHtml(
  status: SubmissionStatus,
  completedTrialCount: number,
): string {
  const isSuccess = status.state === "success";
  const isLocalPreview = status.state === "local_preview";
  const eyebrow = isSuccess
    ? "研究完成"
    : isLocalPreview
      ? "本地预览完成"
      : "提交状态尚未确认";
  const title = isSuccess
    ? "感谢您的参与"
    : isLocalPreview
      ? "本次预览已完成"
      : "请重新提交作答";
  const lead = isSuccess
    ? "您的作答已由研究服务器确认保存。感谢您对本研究的支持。"
    : isLocalPreview
      ? "当前页面是静态或本地预览，作答仅保存在当前浏览器中，没有发送到研究服务器。"
      : "主存储暂时没有返回确认回执。请保持本页面打开，检查网络后重新提交。";
  const nextStep = isSuccess
    ? "您现在可以关闭此页面。"
    : isLocalPreview
      ? "此页面不得用于正式收数；如需留存，可下载本人作答备份。"
      : "在页面显示服务器完成编号前，请勿关闭此页面。若多次重试仍失败，可先下载本地备份。";
  const submissionLabel = isSuccess
    ? "已由服务器确认"
    : isLocalPreview
      ? "仅本机保存"
      : "主存储尚未确认";
  const receiptItem = isSuccess
    ? `
          <div class="summary-item summary-item--receipt">
            <span class="summary-label">完成编号</span>
            <strong class="receipt-id">${escapeHtml(status.receiptId)}</strong>
          </div>
      `
    : "";
  const retryAction =
    status.state === "unconfirmed"
      ? `
        <div class="submission-actions">
          <button id="retry-submit" class="button button--primary" type="button">重新提交</button>
          <p id="submission-feedback" class="helper-text" aria-live="polite"></p>
        </div>
      `
      : "";
  const exportHelper = isSuccess
    ? "如需自行留存，可选择下载本人本次作答的备份文件；这不会影响已经确认的提交。"
    : isLocalPreview
      ? "下载文件只是当前浏览器中的预览备份，不代表研究服务器已经收到作答。"
      : "建议先下载本人作答备份，再检查网络并重新提交；下载不会替代服务器提交。";

  return `
    <main class="shell shell--success" data-completion-status="${status.state}">
      <section class="card">
        <p class="eyebrow">${eyebrow}</p>
        <h1>${title}</h1>
        <p class="lead">${lead}</p>
        <p>${nextStep}</p>
        ${retryAction}
        <div class="summary-grid">
          <div class="summary-item">
            <span class="summary-label">已完成题目</span>
            <strong>${completedTrialCount} 题</strong>
          </div>
          <div class="summary-item">
            <span class="summary-label">提交状态</span>
            <strong>${submissionLabel}</strong>
          </div>
          ${receiptItem}
        </div>

        <details class="export-panel text-left">
          <summary>下载本人作答备份（可选）</summary>
          <div class="export-panel__content">
            <p class="helper-text">${exportHelper}</p>
            <div class="download-actions">
              <button id="download-json" class="button button--secondary" type="button">下载完整备份（JSON）</button>
              <button id="download-csv" class="button button--secondary" type="button">下载试次备份（CSV）</button>
            </div>
          </div>
        </details>
      </section>
    </main>
  `;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
