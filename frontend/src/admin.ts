import "./styles/admin.css";
import { csvDocument } from "./adminCsv";

type ExportScope = "formal" | "all";
type ExportFormat =
  | "json"
  | "participants.csv"
  | "trials.csv"
  | "mirrors.csv"
  | "conflicts.csv";

interface AdminSessionResponse {
  authenticated: boolean;
  username: string | null;
  configured: boolean;
  expires_at: string | null;
  csrf_token: string | null;
}

interface LoginResponse {
  ok: true;
  username: string;
  expires_at: string;
  csrf_token: string;
}

interface AdminStats {
  submissions: {
    formal: number;
    test: number;
    total: number;
  };
  formal_formats: {
    table: number;
    graph: number;
    video: number;
  };
  latest_stored_at: string | null;
  mirrors: {
    pending: number;
    failed: number;
    accepted: number;
  };
  conflicts: number;
  randomization: {
    enabled: boolean;
    status:
      | "active"
      | "paused"
      | "exhausted"
      | "not_configured";
    assigned: {
      table: number;
      graph: number;
      video: number;
      total: number;
    };
    client_fallback: {
      count: number;
      rate: number;
    };
    remaining_schedule_slots: number;
  };
}

interface ExportPage {
  format: ExportFormat;
  scope: ExportScope;
  snapshot_at: string;
  offset: number;
  next_offset: number | null;
  total_rows: number;
  headers: string[];
  rows: Record<string, unknown>[];
}

function requireAdminRoot(): HTMLDivElement {
  const element =
    document.querySelector<HTMLDivElement>("#admin-app");
  if (!element) {
    throw new Error("Admin root #admin-app not found");
  }
  return element;
}

const app = requireAdminRoot();
let csrfToken: string | null = null;
let sessionExpiresAt: string | null = null;

void initialize();

async function apiJson<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    cache: "no-store",
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const body = (await response.json().catch(() => ({}))) as {
    error?: string | { message?: string };
  };
  if (!response.ok) {
    const message =
      typeof body.error === "string"
        ? body.error
        : body.error?.message;
    throw new Error(message ?? `请求失败（${response.status}）`);
  }
  return body as T;
}

async function initialize(): Promise<void> {
  try {
    const session = await apiJson<AdminSessionResponse>(
      "/api/admin/session",
    );
    if (
      session.authenticated
      && session.username
      && session.csrf_token
    ) {
      csrfToken = session.csrf_token;
      sessionExpiresAt = session.expires_at;
      renderDashboard(session.username);
      await refreshStats();
      return;
    }
    renderLogin(
      session.configured
        ? ""
        : "研究人员账户尚未完成服务器配置。",
    );
  } catch {
    renderLogin("无法连接研究数据服务，请稍后重试。");
  }
}

function renderLogin(message: string): void {
  csrfToken = null;
  sessionExpiresAt = null;
  app.innerHTML = `
    <main class="admin-shell admin-shell--login">
      <section class="admin-card admin-login-card">
        <p class="admin-eyebrow">研究团队专用</p>
        <h1>研究数据后台</h1>
        <p class="admin-lead">
          登录后可核对权威收件数量并下载研究数据。
        </p>
        <form id="admin-login-form" class="admin-form">
          <label>
            <span>用户名</span>
            <input
              name="username"
              autocomplete="username"
              maxlength="128"
              required
            />
          </label>
          <label>
            <span>密码</span>
            <input
              name="password"
              type="password"
              autocomplete="current-password"
              maxlength="1024"
              required
            />
          </label>
          <p
            id="admin-feedback"
            class="admin-feedback"
            role="alert"
          >${escapeHtml(message)}</p>
          <button
            class="admin-button admin-button--primary"
            type="submit"
          >登录</button>
        </form>
      </section>
    </main>
  `;

  const form = document.querySelector<HTMLFormElement>(
    "#admin-login-form",
  );
  const feedback = document.querySelector<HTMLElement>(
    "#admin-feedback",
  );
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector<HTMLButtonElement>("button");
    const formData = new FormData(form);
    const username = String(formData.get("username") ?? "");
    const password = String(formData.get("password") ?? "");
    setButtonBusy(button, true, "正在登录…");
    if (feedback) {
      feedback.textContent = "";
    }
    try {
      const result = await apiJson<LoginResponse>(
        "/api/admin/login",
        {
          method: "POST",
          body: JSON.stringify({ username, password }),
        },
      );
      csrfToken = result.csrf_token;
      sessionExpiresAt = result.expires_at;
      form.reset();
      renderDashboard(result.username);
      await refreshStats();
    } catch (error) {
      if (feedback) {
        feedback.textContent = errorMessage(error, "登录失败");
      }
      setButtonBusy(button, false, "登录");
    }
  });
}

function renderDashboard(username: string): void {
  app.innerHTML = `
    <main class="admin-shell">
      <header class="admin-header">
        <div>
          <p class="admin-eyebrow">研究团队专用</p>
          <h1>研究数据后台</h1>
          <p class="admin-session-note">
            权威数据源：Netlify Database
          </p>
        </div>
        <div class="admin-account">
          <span>${escapeHtml(username)}</span>
          <button
            id="admin-logout"
            class="admin-button admin-button--quiet"
            type="button"
          >退出</button>
        </div>
      </header>

      <section class="admin-card">
        <div class="admin-section-heading">
          <div>
            <h2>权威收件状态</h2>
            <p>
              本页只显示汇总数量，不直接展示参与者答案。
            </p>
          </div>
          <button
            id="refresh-stats"
            class="admin-button admin-button--secondary"
            type="button"
          >刷新</button>
        </div>
        <p
          id="admin-dashboard-feedback"
          class="admin-feedback admin-feedback--status"
          role="status"
        ></p>
        <div class="admin-stat-grid" aria-live="polite">
          ${statCard("正式答卷", "stat-formal")}
          ${statCard("测试答卷", "stat-test")}
          ${statCard("Table（正式）", "stat-table")}
          ${statCard("Graph（正式）", "stat-graph")}
          ${statCard("Video（正式）", "stat-video")}
        </div>
        <div class="admin-latest">
          <span>最近一次权威收件</span>
          <strong id="stat-latest">—</strong>
        </div>
      </section>

      <section class="admin-card">
        <div class="admin-section-heading">
          <div>
            <h2>随机分配运行状态</h2>
            <p>
              显示已产生的分配数量与应急随机比例，不展示私有分配表。
            </p>
          </div>
          <strong
            id="stat-randomization-status"
            class="admin-status-pill"
          >—</strong>
        </div>
        <div class="admin-stat-grid">
          ${statCard("Table已分配", "stat-assigned-table")}
          ${statCard("Graph已分配", "stat-assigned-graph")}
          ${statCard("Video已分配", "stat-assigned-video")}
          ${statCard("应急随机", "stat-fallback")}
          ${statCard("剩余分配位", "stat-remaining-slots")}
        </div>
      </section>

      <section class="admin-card">
        <div class="admin-section-heading">
          <div>
            <h2>Forms副本与异常</h2>
            <p>
              Database是权威数据；Forms仅用于冗余副本和对账。
            </p>
          </div>
        </div>
        <div class="admin-stat-grid admin-stat-grid--operations">
          ${statCard("Forms已接受", "stat-mirror-accepted")}
          ${statCard("Forms待处理", "stat-mirror-pending")}
          ${statCard("Forms失败", "stat-mirror-failed", "danger")}
          ${statCard("提交冲突", "stat-conflicts", "danger")}
        </div>
      </section>

      <section class="admin-card">
        <h2>正式数据下载</h2>
        <p>
          默认只包含正式答卷；JSON保留完整会话，CSV分别按参与者和逐题整理。
        </p>
        <div class="admin-download-grid">
          ${downloadButton("完整JSON", "formal", "json")}
          ${downloadButton("参与者CSV", "formal", "participants.csv")}
          ${downloadButton("逐题CSV", "formal", "trials.csv")}
          ${downloadButton("Forms副本CSV", "formal", "mirrors.csv")}
          ${downloadButton("冲突记录CSV", "formal", "conflicts.csv")}
        </div>
      </section>

      <details class="admin-card admin-audit-panel">
        <summary>全部测试与审计数据</summary>
        <p>
          包含测试环境记录，仅用于技术核查，不应直接并入正式分析。
        </p>
        <div class="admin-download-grid">
          ${downloadButton("全部完整JSON", "all", "json")}
          ${downloadButton("全部参与者CSV", "all", "participants.csv")}
          ${downloadButton("全部逐题CSV", "all", "trials.csv")}
          ${downloadButton("全部Forms副本CSV", "all", "mirrors.csv")}
          ${downloadButton("全部冲突记录CSV", "all", "conflicts.csv")}
        </div>
      </details>
    </main>
  `;

  document
    .querySelector<HTMLButtonElement>("#refresh-stats")
    ?.addEventListener("click", () => void refreshStats());
  document
    .querySelector<HTMLButtonElement>("#admin-logout")
    ?.addEventListener("click", () => void logout());

  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "[data-export-scope][data-export-format]",
  )) {
    button.addEventListener("click", () => void downloadExport(button));
  }
}

function statCard(
  label: string,
  id: string,
  tone: "normal" | "danger" = "normal",
): string {
  return `
    <article class="admin-stat${
      tone === "danger" ? " admin-stat--danger" : ""
    }">
      <span>${label}</span>
      <strong id="${id}">—</strong>
    </article>
  `;
}

function downloadButton(
  label: string,
  scope: ExportScope,
  format: ExportFormat,
): string {
  return `
    <button
      class="admin-button admin-button--secondary"
      type="button"
      data-export-scope="${scope}"
      data-export-format="${format}"
    >${label}</button>
  `;
}

async function refreshStats(): Promise<void> {
  const feedback = dashboardFeedback();
  if (feedback) {
    feedback.textContent = "正在读取最新状态…";
  }
  try {
    const stats = await apiJson<AdminStats>("/api/admin/stats");
    setCount("stat-formal", stats.submissions.formal);
    setCount("stat-test", stats.submissions.test);
    setCount("stat-table", stats.formal_formats.table);
    setCount("stat-graph", stats.formal_formats.graph);
    setCount("stat-video", stats.formal_formats.video);
    setCount("stat-mirror-accepted", stats.mirrors.accepted);
    setCount("stat-mirror-pending", stats.mirrors.pending);
    setCount("stat-mirror-failed", stats.mirrors.failed);
    setCount("stat-conflicts", stats.conflicts);
    setCount(
      "stat-assigned-table",
      stats.randomization.assigned.table,
    );
    setCount(
      "stat-assigned-graph",
      stats.randomization.assigned.graph,
    );
    setCount(
      "stat-assigned-video",
      stats.randomization.assigned.video,
    );
    setText(
      "stat-fallback",
      `${stats.randomization.client_fallback.count.toLocaleString("zh-CN")}（${formatPercentage(
        stats.randomization.client_fallback.rate,
      )}）`,
    );
    setText(
      "stat-remaining-slots",
      stats.randomization.enabled
        ? stats.randomization.remaining_schedule_slots.toLocaleString("zh-CN")
        : "未启用",
    );
    setText(
      "stat-randomization-status",
      randomizationStatusLabel(stats.randomization.status),
    );
    setText(
      "stat-latest",
      stats.latest_stored_at
        ? new Date(stats.latest_stored_at).toLocaleString("zh-CN")
        : "尚无权威答卷",
    );
    if (feedback) {
      const expiry = sessionExpiresAt
        ? `；登录有效至${new Date(sessionExpiresAt).toLocaleString("zh-CN")}`
        : "";
      feedback.textContent =
        `更新于${new Date().toLocaleString("zh-CN")}${expiry}`;
    }
  } catch (error) {
    if (isAuthenticationError(error)) {
      renderLogin("登录已失效，请重新登录。");
      return;
    }
    if (feedback) {
      feedback.textContent = errorMessage(error, "状态读取失败");
    }
  }
}

function formatPercentage(rate: number): string {
  const normalized = Number.isFinite(rate)
    ? Math.max(0, rate)
    : 0;
  return new Intl.NumberFormat("zh-CN", {
    style: "percent",
    minimumFractionDigits: normalized > 0 && normalized < 0.01 ? 2 : 1,
    maximumFractionDigits: 2,
  }).format(normalized);
}

function randomizationStatusLabel(
  status: AdminStats["randomization"]["status"],
): string {
  switch (status) {
    case "active":
      return "运行中";
    case "paused":
      return "尚未启用";
    case "exhausted":
      return "已停止或已用尽";
    default:
      return "未配置";
  }
}

async function logout(): Promise<void> {
  try {
    await apiJson("/api/admin/logout", {
      method: "POST",
      body: "{}",
      headers: csrfHeaders(),
    });
  } catch {
    // Clearing the local view is safe even if the remote cookie already expired.
  }
  renderLogin("");
}

async function downloadExport(
  button: HTMLButtonElement,
): Promise<void> {
  const scope = button.dataset.exportScope as ExportScope | undefined;
  const format = button.dataset.exportFormat as ExportFormat | undefined;
  if (!scope || !format) {
    return;
  }
  const feedback = dashboardFeedback();
  const originalText = button.textContent ?? "下载";
  setButtonBusy(button, true, "正在准备…");
  try {
    const exportId = crypto.randomUUID();
    let offset = 0;
    let snapshotAt: string | null = null;
    let headers: string[] = [];
    let totalRows = 0;
    const rows: Record<string, unknown>[] = [];

    for (let pageNumber = 1; pageNumber <= 1000; pageNumber += 1) {
      const query = new URLSearchParams({
        scope,
        format,
        export_id: exportId,
        offset: String(offset),
      });
      if (snapshotAt) {
        query.set("snapshot_at", snapshotAt);
      }
      const page = await apiJson<ExportPage>(
        `/api/admin/export?${query.toString()}`,
        { headers: csrfHeaders() },
      );
      snapshotAt ??= page.snapshot_at;
      headers = page.headers;
      totalRows = page.total_rows;
      rows.push(...page.rows);
      button.textContent =
        totalRows === 0
          ? "正在生成…"
          : `正在下载 ${Math.min(rows.length, totalRows)} / ${totalRows}`;
      if (page.next_offset === null) {
        break;
      }
      if (
        page.next_offset <= offset
        || page.snapshot_at !== snapshotAt
      ) {
        throw new Error("导出分页校验失败，请重新下载。");
      }
      offset = page.next_offset;
      if (pageNumber === 1000) {
        throw new Error("导出记录过多，请联系维护人员。");
      }
    }

    const isJson = format === "json";
    const content = isJson
      ? JSON.stringify(
          {
            schema_version: 1,
            generated_at: new Date().toISOString(),
            snapshot_at: snapshotAt,
            scope,
            record_count: rows.length,
            submissions: rows,
          },
          null,
          2,
        )
      : csvDocument(headers, rows);
    const mime = isJson
      ? "application/json;charset=utf-8"
      : "text/csv;charset=utf-8";
    const extension = isJson ? "json" : "csv";
    const kind = format.replace(".csv", "");
    const timestamp = new Date()
      .toISOString()
      .replaceAll(/[:.]/g, "-");
    saveBlob(
      new Blob([isJson ? content : `\uFEFF${content}`], { type: mime }),
      `mmq-${scope}-${kind}-${timestamp}.${extension}`,
    );
    if (feedback) {
      feedback.textContent =
        `已生成${rows.length.toLocaleString("zh-CN")}行数据。`;
    }
  } catch (error) {
    if (isAuthenticationError(error)) {
      renderLogin("登录已失效，请重新登录。");
      return;
    }
    if (feedback) {
      feedback.textContent = errorMessage(error, "导出失败");
    }
  } finally {
    setButtonBusy(button, false, originalText);
  }
}

function csrfHeaders(): Record<string, string> {
  if (!csrfToken) {
    throw new Error("登录安全令牌已失效，请重新登录。");
  }
  return { "X-MMQ-CSRF": csrfToken };
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function setButtonBusy(
  button: HTMLButtonElement | null,
  busy: boolean,
  label: string,
): void {
  if (!button) {
    return;
  }
  button.disabled = busy;
  button.textContent = label;
}

function dashboardFeedback(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    "#admin-dashboard-feedback",
  );
}

function setCount(id: string, value: number): void {
  setText(id, value.toLocaleString("zh-CN"));
}

function setText(id: string, value: string): void {
  const element = document.querySelector<HTMLElement>(`#${id}`);
  if (element) {
    element.textContent = value;
  }
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function isAuthenticationError(error: unknown): boolean {
  return (
    error instanceof Error
    && /登录|Authentication|required/i.test(error.message)
  );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
