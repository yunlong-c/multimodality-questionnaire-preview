import assert from "node:assert/strict";
import {
  randomBytes,
  scryptSync,
} from "node:crypto";
import test from "node:test";
import type {
  AdminExportPage,
  AdminRepository,
  AdminStats,
} from "../_lib/admin-database.mts";
import {
  createAdminExportHandler,
  createAdminLoginHandler,
  createAdminLogoutHandler,
  createAdminSessionHandler,
  createAdminStatsHandler,
} from "../_lib/admin-http.mts";

const adminUsername = "researcher";
const adminPassword = "a-long-test-password-for-admin";
const salt = randomBytes(16);
const passwordHash = scryptSync(adminPassword, salt, 32);
process.env.MMQ_ADMIN_USERNAME = adminUsername;
process.env.MMQ_ADMIN_PASSWORD_HASH =
  `scrypt.${salt.toString("base64url")}`
  + `.${passwordHash.toString("base64url")}`;
process.env.MMQ_ADMIN_SESSION_SECRET = "s".repeat(64);
process.env.CONTEXT = "deploy-preview";
process.env.DEPLOY_ID = "deploy-test";

const context = {
  ip: "203.0.113.18",
  deploy: {
    context: "deploy-preview",
    id: "deploy-test",
    published: false,
  },
};

const stats: AdminStats = {
  submissions: { formal: 3, test: 2, total: 5 },
  formal_formats: { table: 1, graph: 1, video: 1 },
  latest_stored_at: "2026-07-27T12:00:00.000Z",
  mirrors: { pending: 1, failed: 0, accepted: 4 },
  conflicts: 0,
  randomization: {
    enabled: true,
    status: "active",
    assigned: {
      table: 10,
      graph: 10,
      video: 10,
      total: 30,
    },
    client_fallback: {
      count: 1,
      rate: 1 / 30,
    },
    remaining_schedule_slots: 2971,
  },
};

class FakeAdminRepository implements AdminRepository {
  readonly audits: Parameters<AdminRepository["recordAudit"]>[0][] = [];
  readonly exportInputs:
    Parameters<AdminRepository["exportPage"]>[0][] = [];
  loginAllowed = true;

  async consumeLoginAttempt(): Promise<boolean> {
    return this.loginAllowed;
  }

  async stats(): Promise<AdminStats> {
    return stats;
  }

  async exportPage(
    input: Parameters<AdminRepository["exportPage"]>[0],
  ): Promise<AdminExportPage> {
    this.exportInputs.push(input);
    return {
      format: input.format,
      scope: input.scope,
      snapshot_at: input.snapshotAt,
      offset: input.offset,
      next_offset: null,
      total_rows: 1,
      headers: [],
      rows: [{ receipt_id: "receipt-1" }],
    };
  }

  async recordAudit(
    input: Parameters<AdminRepository["recordAudit"]>[0],
  ): Promise<void> {
    this.audits.push(input);
  }
}

function request(
  path: string,
  init?: RequestInit,
): Request {
  return new Request(`https://survey.example${path}`, init);
}

async function json(response: Response): Promise<Record<string, any>> {
  return await response.json() as Record<string, any>;
}

async function login(
  repository: FakeAdminRepository,
): Promise<{
  cookie: string;
  csrfToken: string;
}> {
  const response = await createAdminLoginHandler(
    () => repository,
  )(
    request("/api/admin/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://survey.example",
        "Sec-Fetch-Site": "same-origin",
      },
      body: JSON.stringify({
        username: adminUsername,
        password: adminPassword,
      }),
    }),
    context,
  );
  assert.equal(response.status, 200);
  const body = await json(response);
  const setCookie = response.headers.get("set-cookie") ?? "";
  assert.match(setCookie, /mmq_admin_session=/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /SameSite=Strict/);
  assert.match(setCookie, /Max-Age=28800/);
  return {
    cookie: setCookie.split(";")[0],
    csrfToken: String(body.csrf_token),
  };
}

test("login rejects cross-origin and invalid credentials", async () => {
  const repository = new FakeAdminRepository();
  const handler = createAdminLoginHandler(() => repository);
  const crossOrigin = await handler(
    request("/api/admin/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://attacker.example",
      },
      body: JSON.stringify({
        username: adminUsername,
        password: adminPassword,
      }),
    }),
    context,
  );
  assert.equal(crossOrigin.status, 403);

  const invalid = await handler(
    request("/api/admin/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://survey.example",
      },
      body: JSON.stringify({
        username: adminUsername,
        password: "wrong-password",
      }),
    }),
    context,
  );
  assert.equal(invalid.status, 401);
  assert.deepEqual(
    repository.audits.map((entry) => entry.eventType),
    ["login_failure"],
  );
});

test("login is denied when the database IP throttle is exhausted", async () => {
  const repository = new FakeAdminRepository();
  repository.loginAllowed = false;
  const response = await createAdminLoginHandler(
    () => repository,
  )(
    request("/api/admin/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://survey.example",
      },
      body: JSON.stringify({
        username: adminUsername,
        password: adminPassword,
      }),
    }),
    context,
  );
  assert.equal(response.status, 429);
  assert.equal(
    repository.audits[0]?.eventType,
    "login_failure",
  );
});

test("signed session protects stats and exposes no secret", async () => {
  const repository = new FakeAdminRepository();
  const { cookie, csrfToken } = await login(repository);
  assert.equal(
    repository.audits[0]?.eventType,
    "login_success",
  );

  const sessionResponse = await createAdminSessionHandler()(
    request("/api/admin/session", {
      headers: { Cookie: cookie },
    }),
  );
  assert.equal(sessionResponse.status, 200);
  const session = await json(sessionResponse);
  assert.equal(session.authenticated, true);
  assert.equal(session.username, adminUsername);
  assert.equal(session.csrf_token, csrfToken);
  assert.equal("password" in session, false);

  const statsHandler = createAdminStatsHandler(() => repository);
  assert.equal(
    (
      await statsHandler(request("/api/admin/stats"))
    ).status,
    401,
  );
  const response = await statsHandler(
    request("/api/admin/stats", {
      headers: { Cookie: cookie },
    }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await json(response), stats);
});

test("export requires CSRF and records one shared-admin audit", async () => {
  const repository = new FakeAdminRepository();
  const { cookie, csrfToken } = await login(repository);
  const handler = createAdminExportHandler(() => repository);
  const exportId = "cbb7b5b7-dbcf-4a40-a6de-f0343758ea17";
  const url =
    `/api/admin/export?scope=formal&format=json`
    + `&export_id=${exportId}&offset=0`;
  const missingCsrf = await handler(
    request(url, { headers: { Cookie: cookie } }),
    context,
  );
  assert.equal(missingCsrf.status, 403);

  const response = await handler(
    request(url, {
      headers: {
        Cookie: cookie,
        "X-MMQ-CSRF": csrfToken,
      },
    }),
    context,
  );
  assert.equal(response.status, 200);
  const page = await json(response);
  assert.equal(page.total_rows, 1);
  assert.equal(page.rows[0].receipt_id, "receipt-1");
  assert.equal(repository.exportInputs[0]?.limit, 20);

  const csvResponse = await handler(
    request(
      `/api/admin/export?scope=formal&format=trials.csv`
        + `&export_id=54cc2f77-683e-4f79-9c25-b98cf010d580`
        + `&offset=0`,
      {
        headers: {
          Cookie: cookie,
          "X-MMQ-CSRF": csrfToken,
        },
      },
    ),
    context,
  );
  assert.equal(csvResponse.status, 200);
  assert.equal(repository.exportInputs[1]?.limit, 500);

  const exportAudit = repository.audits.find(
    (entry) => entry.eventType === "export",
  );
  assert.equal(exportAudit?.exportId, exportId);
  assert.equal(exportAudit?.exportRowCount, 1);
  assert.equal(exportAudit?.deployment.trustedClientIp, context.ip);
});

test("logout requires the session CSRF token and clears cookie", async () => {
  const repository = new FakeAdminRepository();
  const { cookie, csrfToken } = await login(repository);
  const handler = createAdminLogoutHandler(() => repository);
  const missingCsrf = await handler(
    request("/api/admin/logout", {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: "https://survey.example",
      },
      body: "{}",
    }),
    context,
  );
  assert.equal(missingCsrf.status, 403);

  const response = await handler(
    request("/api/admin/logout", {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: "https://survey.example",
        "X-MMQ-CSRF": csrfToken,
      },
      body: "{}",
    }),
    context,
  );
  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("set-cookie") ?? "",
    /Max-Age=0/,
  );
  assert.equal(
    repository.audits.at(-1)?.eventType,
    "logout",
  );
});

test("tampered session cookie is rejected", async () => {
  const repository = new FakeAdminRepository();
  const { cookie } = await login(repository);
  const response = await createAdminStatsHandler(
    () => repository,
  )(
    request("/api/admin/stats", {
      headers: { Cookie: `${cookie}tampered` },
    }),
  );
  assert.equal(response.status, 401);
});
