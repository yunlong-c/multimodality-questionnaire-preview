export type SubmissionStatus = "success" | "unconfirmed";

export async function resolveSubmissionState(
  submit: () => Promise<unknown>
): Promise<SubmissionStatus> {
  try {
    await submit();
    return "success";
  } catch {
    return "unconfirmed";
  }
}

export function buildCompletionHtml(
  status: SubmissionStatus,
  completedTrialCount: number
): string {
  const isSuccess = status === "success";
  const eyebrow = isSuccess ? "研究完成" : "提交状态尚未确认";
  const title = isSuccess ? "感谢您的参与" : "请重新提交作答";
  const lead = isSuccess
    ? "您的作答已成功提交并保存。感谢您对本研究的支持。"
    : "我们暂时无法确认您的作答是否已保存。请保持本页面打开，检查网络后重新提交。重新提交不会产生重复记录。";
  const nextStep = isSuccess
    ? "您现在可以关闭此页面。"
    : "在页面显示“已保存”前，请勿关闭此页面。若多次重试仍失败，可先下载本地备份并联系研究人员。";
  const submissionLabel = isSuccess ? "已保存" : "尚未确认";
  const retryAction = isSuccess
    ? ""
    : `
        <div class="submission-actions">
          <button id="retry-submit" class="button button--primary" type="button">重新提交</button>
          <p id="submission-feedback" class="helper-text" aria-live="polite"></p>
        </div>
      `;
  const exportHelper = isSuccess
    ? "以下文件仅用于本地留存或内部核查，不影响您已完成本次作答。"
    : "如需保留本地备份，可下载以下文件；下载不会替代服务器提交。";

  return `
    <main class="shell shell--success" data-completion-status="${status}">
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
        </div>

        <details class="export-panel text-left">
          <summary>研究人员下载入口</summary>
          <div class="export-panel__content">
            <p class="helper-text">${exportHelper}</p>
            <div class="download-actions">
              <button id="download-json" class="button button--secondary" type="button">下载作答记录（JSON）</button>
              <button id="download-csv" class="button button--secondary" type="button">下载试次记录（CSV）</button>
            </div>
          </div>
        </details>
      </section>
    </main>
  `;
}
