import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");

async function source(...segments: string[]): Promise<string> {
  return readFile(path.join(repositoryRoot, ...segments), "utf8");
}

test("admin audit and database login throttle are append-only migrations", async () => {
  const migration = await source(
    "netlify",
    "database",
    "schema-migrations",
    "0003_create_admin_audit.sql",
  );
  assert.match(migration, /CREATE TABLE IF NOT EXISTS mmq_admin_audit/);
  assert.match(migration, /actor TEXT NOT NULL DEFAULT 'shared_admin'/);
  assert.match(migration, /event_type IN/);
  assert.match(migration, /CREATE UNIQUE INDEX[\s\S]*export_id/);
  assert.match(
    migration,
    /CREATE TABLE IF NOT EXISTS mmq_admin_login_throttle/,
  );
  assert.match(migration, /trusted_client_ip INET PRIMARY KEY/);
});

test("admin entrypoints are protected and login has database-backed limiting", async () => {
  const entries = await Promise.all(
    [
      ["admin-session.mts", "/api/admin/session", "GET"],
      ["admin-login.mts", "/api/admin/login", "POST"],
      ["admin-logout.mts", "/api/admin/logout", "POST"],
      ["admin-stats.mts", "/api/admin/stats", "GET"],
      ["admin-export.mts", "/api/admin/export", "GET"],
    ].map(async ([filename, route, method]) => ({
      filename,
      route,
      method,
      text: await source("netlify", "functions", filename),
    })),
  );
  for (const entry of entries) {
    assert.match(entry.text, new RegExp(`path: "${entry.route}"`));
    assert.match(entry.text, new RegExp(`method: "${entry.method}"`));
  }
  const login = entries.find(
    (entry) => entry.filename === "admin-login.mts",
  )?.text ?? "";
  assert.doesNotMatch(login, /rateLimit/);
  const database = await source(
    "netlify",
    "functions",
    "_lib",
    "admin-database.mts",
  );
  assert.match(database, /consumeLoginAttempt/);
  assert.match(database, /INTERVAL '15 minutes'/);
  assert.match(database, /attempt_count \+ 1 > 10/);
});

test("admin is built as an unlinked page", async () => {
  const config = await source("netlify.toml");
  const vite = await source("frontend", "vite.config.ts");
  const participantHtml = await source("frontend", "index.html");
  const participantMain = await source(
    "frontend",
    "src",
    "main.ts",
  );
  assert.doesNotMatch(config, /MMQ_EXCLUDE_ADMIN\s*=/);
  assert.match(vite, /inputs\.admin = resolve\(frontendRoot, "admin\.html"\)/);
  assert.doesNotMatch(participantHtml, /admin\.html|研究人员入口/);
  assert.doesNotMatch(participantMain, /admin\.html|研究人员入口/);
});

test("admin authentication uses signed strict cookies and CSRF checks", async () => {
  const auth = await source(
    "netlify",
    "functions",
    "_lib",
    "admin-auth.mts",
  );
  const http = await source(
    "netlify",
    "functions",
    "_lib",
    "admin-http.mts",
  );
  assert.match(auth, /scrypt/);
  assert.match(auth, /createHmac\("sha256"/);
  assert.match(auth, /HttpOnly/);
  assert.match(auth, /Secure/);
  assert.match(auth, /SameSite=Strict/);
  assert.match(auth, /8 \* 60 \* 60/);
  assert.match(auth, /requireCsrf/);
  assert.match(auth, /requireSameOrigin/);
  assert.match(http, /requireCsrf\(request, session\)/);
  assert.match(http, /requireSameOrigin\(request\)/);
});

test("admin statistics and exports read only authoritative submissions", async () => {
  const database = await source(
    "netlify",
    "functions",
    "_lib",
    "admin-database.mts",
  );
  assert.match(database, /FROM mmq_submissions/);
  assert.match(database, /mmq_submission_form_mirrors/);
  assert.match(database, /mmq_submission_conflicts/);
  assert.match(database, /s\.assigned_at/);
  assert.match(database, /s\.fallback_reason_code/);
  assert.match(database, /s\.fallback_reconciled_at/);
  assert.match(database, /mmq_randomization_assignments/);
  assert.match(database, /mmq_randomization_slots/);
  assert.doesNotMatch(database, /FROM netlify_forms/i);

  const http = await source(
    "netlify",
    "functions",
    "_lib",
    "admin-http.mts",
  );
  assert.match(http, /JSON_EXPORT_PAGE_LIMIT = 20/);
  assert.match(http, /CSV_EXPORT_PAGE_LIMIT = 500/);

  const adminFrontend = await source(
    "frontend",
    "src",
    "admin.ts",
  );
  assert.match(adminFrontend, /stat-assigned-table/);
  assert.match(adminFrontend, /stat-fallback/);
  assert.match(adminFrontend, /stat-remaining-slots/);
  assert.doesNotMatch(
    adminFrontend,
    /schedule_position|block_position|token_hmac/,
  );
});
