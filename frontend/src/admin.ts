import "./styles/admin.css";
import { renderRegulatoryFooter } from "./config/regulatoryFooter";

interface AdminSession {
  authenticated: boolean;
  username: string | null;
  configured: boolean;
}

interface AdminStats {
  table: number;
  graph: number;
  video: number;
  dataset_classification: {
    formal: number;
    test: number;
    "pre-v2/test": number;
  };
  release_gate: {
    formal_collection_allowed: boolean;
    reason: string;
  };
}

const app = document.querySelector<HTMLDivElement>("#admin-app");
if (!app) {
  throw new Error("Admin root #admin-app not found");
}

renderRegulatoryFooter();
void initialize();

async function apiJson<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    const body = (await response
      .json()
      .catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `请求失败（${response.status}）`);
  }
  return (await response.json()) as T;
}

async function initialize(): Promise<void> {
  try {
    const session = await apiJson<AdminSession>(
      "/api/admin/session",
    );
    if (session.authenticated && session.username) {
      renderDashboard(session.username);
      await refreshStats();
      return;
    }
    renderLogin(
      session.configured
        ? ""
        : "后台尚未配置管理员账号，请先完成服务器环境变量配置。",
    );
  } catch {
    renderLogin("无法连接研究数据服务，请稍后重试。");
  }
}

function renderLogin(message: string): void {
  app!.innerHTML = `
    <main class="admin-shell admin-shell--login">
      <section class="admin-card admin-login-card">
        <p class="admin-eyebrow">研究人员专用</p>
        <h1>研究数据后台</h1>
        <p class="admin-lead">登录后可查看收数状态并下载正式数据。</p>
        <form id="admin-login-form" class="admin-form">
          <label>
            <span>用户名</span>
            <input name="username" autocomplete="username" required />
          </label>
          <label>
            <span>密码</span>
            <input name="password" type="password" autocomplete="current-password" required />
          </label>
          <p id="admin-feedback" class="admin-feedback" role="alert">${escapeHtml(message)}</p>
          <button class="admin-button admin-button--primary" type="submit">登录</button>
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
    if (button) {
      button.disabled = true;
      button.textContent = "正在登录…";
    }
    try {
      await apiJson("/api/admin/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      renderDashboard(username);
      await refreshStats();
    } catch (error) {
      if (feedback) {
        feedback.textContent =
          error instanceof Error
            ? error.message
            : "登录失败";
      }
      if (button) {
        button.disabled = false;
        button.textContent = "登录";
      }
    }
  });
}

function renderDashboard(username: string): void {
  app!.innerHTML = `
    <main class="admin-shell">
      <header class="admin-header">
        <div>
          <p class="admin-eyebrow">研究人员专用</p>
          <h1>研究数据后台</h1>
        </div>
        <div class="admin-account">
          <span>${escapeHtml(username)}</span>
          <button id="admin-logout" class="admin-button admin-button--quiet" type="button">退出</button>
        </div>
      </header>

      <section class="admin-card">
        <div class="admin-section-heading">
          <div>
            <h2>收数状态</h2>
            <p>页面仅显示汇总数量，不展示参与者答案。</p>
          </div>
          <button id="refresh-stats" class="admin-button admin-button--secondary" type="button">刷新</button>
        </div>
        <p id="admin-dashboard-feedback" class="admin-feedback" role="status"></p>
        <div class="admin-stat-grid" aria-live="polite">
          ${statCard("正式提交", "stat-formal")}
          ${statCard("Table分配", "stat-table")}
          ${statCard("Graph分配", "stat-graph")}
          ${statCard("Video分配", "stat-video")}
        </div>
        <div id="release-gate-status" class="admin-gate"></div>
      </section>

      <section class="admin-card">
        <h2>正式数据下载</h2>
        <p>默认下载仅包含正式数据，不包含预览和测试记录。</p>
        <div class="admin-download-grid">
          ${downloadButton("正式完整JSON", "formal", "json")}
          ${downloadButton("正式逐题CSV", "formal", "trials.csv")}
          ${downloadButton("正式参与者CSV", "formal", "participants.csv")}
        </div>
      </section>

      <details class="admin-card admin-audit-panel">
        <summary>审计数据下载</summary>
        <p>包含测试及历史分类，仅用于核查，不应并入正式分析。</p>
        <div class="admin-download-grid">
          ${downloadButton("全部完整JSON", "all", "json")}
          ${downloadButton("全部逐题CSV", "all", "trials.csv")}
          ${downloadButton("全部参与者CSV", "all", "participants.csv")}
        </div>
      </details>
    </main>
  `;

  document
    .querySelector<HTMLButtonElement>("#refresh-stats")
    ?.addEventListener("click", () => void refreshStats());
  document
    .querySelector<HTMLButtonElement>("#admin-logout")
    ?.addEventListener("click", async () => {
      try {
        await apiJson("/api/admin/logout", {
          method: "POST",
          body: "{}",
        });
      } finally {
        renderLogin("");
      }
    });

  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "[data-export-scope][data-export-format]",
  )) {
    button.addEventListener("click", () => void downloadExport(button));
  }
}

function statCard(label: string, id: string): string {
  return `
    <article class="admin-stat">
      <span>${label}</span>
      <strong id="${id}">—</strong>
    </article>
  `;
}

function downloadButton(
  label: string,
  scope: "formal" | "all",
  format: "json" | "trials.csv" | "participants.csv",
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
  const feedback = document.querySelector<HTMLElement>(
    "#admin-dashboard-feedback",
  );
  if (feedback) {
    feedback.textContent = "正在读取最新状态…";
  }
  try {
    const stats = await apiJson<AdminStats>("/api/admin/stats");
    setText("stat-formal", stats.dataset_classification.formal);
    setText("stat-table", stats.table);
    setText("stat-graph", stats.graph);
    setText("stat-video", stats.video);
    const gate = document.querySelector<HTMLElement>(
      "#release-gate-status",
    );
    if (gate) {
      gate.className = `admin-gate ${
        stats.release_gate.formal_collection_allowed
          ? "admin-gate--open"
          : "admin-gate--closed"
      }`;
      gate.textContent = stats.release_gate.formal_collection_allowed
        ? "正式收数门槛：已开放"
        : `正式收数门槛：未开放（${stats.release_gate.reason}）`;
    }
    if (feedback) {
      feedback.textContent = `更新时间：${new Date().toLocaleString("zh-CN")}`;
    }
  } catch (error) {
    if (error instanceof Error && /Authentication/.test(error.message)) {
      renderLogin("登录已失效，请重新登录。");
      return;
    }
    if (feedback) {
      feedback.textContent =
        error instanceof Error ? error.message : "状态读取失败";
    }
  }
}

async function downloadExport(button: HTMLButtonElement): Promise<void> {
  const scope = button.dataset.exportScope;
  const format = button.dataset.exportFormat;
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "正在生成…";
  try {
    const response = await fetch(
      `/api/admin/export?scope=${encodeURIComponent(scope ?? "")}&format=${encodeURIComponent(format ?? "")}`,
      { credentials: "same-origin" },
    );
    if (!response.ok) {
      throw new Error(`导出失败（${response.status}）`);
    }
    const blob = await response.blob();
    const disposition =
      response.headers.get("content-disposition") ?? "";
    const filename =
      disposition.match(/filename="?([^";]+)"?/i)?.[1] ??
      `mmq-export-${Date.now()}`;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  } catch (error) {
    const feedback = document.querySelector<HTMLElement>(
      "#admin-dashboard-feedback",
    );
    if (feedback) {
      feedback.textContent =
        error instanceof Error ? error.message : "导出失败";
    }
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

function setText(id: string, value: number): void {
  const element = document.querySelector<HTMLElement>(`#${id}`);
  if (element) {
    element.textContent = value.toLocaleString("zh-CN");
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
