import type { Context } from "@netlify/functions";
import {
  adminAuthenticationConfigured,
  AdminAuthError,
  clearedSessionCookie,
  createAdminSession,
  readAdminSession,
  requireAdminSession,
  requireCsrf,
  requireSameOrigin,
  sessionCookie,
  verifyAdminCredentials,
} from "./admin-auth.mts";
import type {
  AdminExportFormat,
  AdminExportScope,
  AdminRepository,
  DeploymentMetadata,
} from "./admin-database.mts";

type RepositoryFactory = () => AdminRepository;
type NetlifyContext = Pick<Context, "ip" | "deploy">;

const JSON_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "Content-Type": "application/json; charset=utf-8",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

const EXPORT_FORMATS = new Set<AdminExportFormat>([
  "json",
  "participants.csv",
  "trials.csv",
  "mirrors.csv",
  "conflicts.csv",
]);
const JSON_EXPORT_PAGE_LIMIT = 20;
const CSV_EXPORT_PAGE_LIMIT = 500;

function responseJson(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...extraHeaders,
    },
  });
}

function deploymentMetadata(
  context: NetlifyContext,
): DeploymentMetadata {
  return {
    trustedClientIp: context.ip?.trim() || null,
    deployContext:
      context.deploy?.context?.trim()
      || process.env.CONTEXT?.trim()
      || null,
    deployId:
      context.deploy?.id?.trim()
      || process.env.DEPLOY_ID?.trim()
      || null,
    deployUrl:
      process.env.DEPLOY_PRIME_URL?.trim()
      || process.env.DEPLOY_URL?.trim()
      || null,
    branch: process.env.BRANCH?.trim() || null,
    commitRef: process.env.COMMIT_REF?.trim() || null,
  };
}

async function jsonBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new AdminAuthError(
      415,
      "CONTENT_TYPE_REQUIRED",
      "请求必须使用JSON格式。",
    );
  }
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > 8 * 1024) {
    throw new AdminAuthError(
      413,
      "REQUEST_TOO_LARGE",
      "登录请求过大。",
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new AdminAuthError(
      400,
      "INVALID_JSON",
      "请求不是有效的JSON。",
    );
  }
}

function errorResponse(error: unknown): Response {
  if (error instanceof AdminAuthError) {
    return responseJson(
      {
        error: {
          code: error.code,
          message: error.message,
        },
      },
      error.status,
    );
  }
  console.error("[mmq-admin] request failed", error);
  return responseJson(
    {
      error: {
        code: "ADMIN_SERVICE_ERROR",
        message: "研究数据服务暂时不可用，请稍后重试。",
      },
    },
    500,
  );
}

function assertMethod(request: Request, method: string): void {
  if (request.method !== method) {
    throw new AdminAuthError(
      405,
      "METHOD_NOT_ALLOWED",
      "不支持该请求方式。",
    );
  }
}

function stringCredentials(value: unknown): {
  username: string;
  password: string;
} {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
  ) {
    throw new AdminAuthError(
      400,
      "INVALID_CREDENTIALS",
      "请输入用户名和密码。",
    );
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.username !== "string"
    || typeof record.password !== "string"
    || record.username.length > 128
    || record.password.length > 1024
  ) {
    throw new AdminAuthError(
      400,
      "INVALID_CREDENTIALS",
      "请输入用户名和密码。",
    );
  }
  return {
    username: record.username,
    password: record.password,
  };
}

function parseExportRequest(request: Request): {
  scope: AdminExportScope;
  format: AdminExportFormat;
  snapshotAt: string;
  offset: number;
  exportId: string;
} {
  const url = new URL(request.url);
  const scope = url.searchParams.get("scope") ?? "formal";
  const format = url.searchParams.get("format") ?? "json";
  const snapshot =
    url.searchParams.get("snapshot_at")
    ?? new Date().toISOString();
  const offsetValue = url.searchParams.get("offset") ?? "0";
  const exportId = url.searchParams.get("export_id") ?? "";
  const offset = Number(offsetValue);
  if (scope !== "formal" && scope !== "all") {
    throw new AdminAuthError(
      400,
      "INVALID_EXPORT_SCOPE",
      "导出范围必须是formal或all。",
    );
  }
  if (!EXPORT_FORMATS.has(format as AdminExportFormat)) {
    throw new AdminAuthError(
      400,
      "INVALID_EXPORT_FORMAT",
      "不支持该导出格式。",
    );
  }
  if (
    !Number.isInteger(offset)
    || offset < 0
    || offset > 1_000_000
  ) {
    throw new AdminAuthError(
      400,
      "INVALID_EXPORT_OFFSET",
      "导出分页位置无效。",
    );
  }
  const parsedSnapshot = Date.parse(snapshot);
  if (!Number.isFinite(parsedSnapshot)) {
    throw new AdminAuthError(
      400,
      "INVALID_EXPORT_SNAPSHOT",
      "导出快照时间无效。",
    );
  }
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(exportId)
  ) {
    throw new AdminAuthError(
      400,
      "INVALID_EXPORT_ID",
      "导出编号无效。",
    );
  }
  return {
    scope,
    format: format as AdminExportFormat,
    snapshotAt: new Date(parsedSnapshot).toISOString(),
    offset,
    exportId,
  };
}

export function createAdminSessionHandler(): (
  request: Request,
) => Promise<Response> {
  return async (request) => {
    try {
      assertMethod(request, "GET");
      const session = readAdminSession(request);
      return responseJson({
        authenticated: Boolean(session),
        username: session?.username ?? null,
        configured: adminAuthenticationConfigured(),
        expires_at: session
          ? new Date(session.expiresAt * 1000).toISOString()
          : null,
        csrf_token: session?.csrfToken ?? null,
      });
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export function createAdminLoginHandler(
  repositoryFactory: RepositoryFactory,
): (
  request: Request,
  context: NetlifyContext,
) => Promise<Response> {
  return async (request, context) => {
    try {
      assertMethod(request, "POST");
      requireSameOrigin(request);
      if (!adminAuthenticationConfigured()) {
        throw new AdminAuthError(
          503,
          "ADMIN_NOT_CONFIGURED",
          "研究人员账户尚未完成配置。",
        );
      }
      const credentials = stringCredentials(
        await jsonBody(request),
      );
      const trustedClientIp = context.ip?.trim();
      if (!trustedClientIp) {
        throw new AdminAuthError(
          503,
          "CLIENT_ADDRESS_UNAVAILABLE",
          "暂时无法验证登录来源，请稍后重试。",
        );
      }
      const repository = repositoryFactory();
      if (
        !(await repository.consumeLoginAttempt(trustedClientIp))
      ) {
        await repository.recordAudit({
          eventType: "login_failure",
          deployment: deploymentMetadata(context),
        });
        throw new AdminAuthError(
          429,
          "LOGIN_RATE_LIMITED",
          "登录尝试过于频繁，请15分钟后重试。",
        );
      }
      const valid = await verifyAdminCredentials(
        credentials.username,
        credentials.password,
      );
      if (!valid) {
        await repository.recordAudit({
          eventType: "login_failure",
          deployment: deploymentMetadata(context),
        });
        throw new AdminAuthError(
          401,
          "INVALID_CREDENTIALS",
          "用户名或密码错误。",
        );
      }
      const created = createAdminSession(credentials.username);
      if (!created) {
        throw new AdminAuthError(
          503,
          "ADMIN_NOT_CONFIGURED",
          "研究人员账户尚未完成配置。",
        );
      }
      await repository.recordAudit({
        eventType: "login_success",
        deployment: deploymentMetadata(context),
      });
      return responseJson(
        {
          ok: true,
          username: created.session.username,
          expires_at: new Date(
            created.session.expiresAt * 1000,
          ).toISOString(),
          csrf_token: created.session.csrfToken,
        },
        200,
        {
          "Set-Cookie": sessionCookie(created.token),
        },
      );
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export function createAdminLogoutHandler(
  repositoryFactory: RepositoryFactory,
): (
  request: Request,
  context: NetlifyContext,
) => Promise<Response> {
  return async (request, context) => {
    try {
      assertMethod(request, "POST");
      requireSameOrigin(request);
      const session = requireAdminSession(request);
      requireCsrf(request, session);
      await repositoryFactory().recordAudit({
        eventType: "logout",
        deployment: deploymentMetadata(context),
      });
      return responseJson(
        { ok: true },
        200,
        { "Set-Cookie": clearedSessionCookie() },
      );
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export function createAdminStatsHandler(
  repositoryFactory: RepositoryFactory,
): (request: Request) => Promise<Response> {
  return async (request) => {
    try {
      assertMethod(request, "GET");
      requireAdminSession(request);
      return responseJson(await repositoryFactory().stats());
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export function createAdminExportHandler(
  repositoryFactory: RepositoryFactory,
): (
  request: Request,
  context: NetlifyContext,
) => Promise<Response> {
  return async (request, context) => {
    try {
      assertMethod(request, "GET");
      const session = requireAdminSession(request);
      requireCsrf(request, session);
      const parsed = parseExportRequest(request);
      const repository = repositoryFactory();
      const page = await repository.exportPage({
        format: parsed.format,
        scope: parsed.scope,
        snapshotAt: parsed.snapshotAt,
        offset: parsed.offset,
        limit:
          parsed.format === "json"
            ? JSON_EXPORT_PAGE_LIMIT
            : CSV_EXPORT_PAGE_LIMIT,
      });
      if (parsed.offset === 0) {
        await repository.recordAudit({
          eventType: "export",
          deployment: deploymentMetadata(context),
          exportId: parsed.exportId,
          exportScope: parsed.scope,
          exportFormat: parsed.format,
          exportRowCount: page.total_rows,
        });
      }
      return responseJson(page);
    } catch (error) {
      return errorResponse(error);
    }
  };
}
