import {
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

export const ADMIN_COOKIE_NAME = "mmq_admin_session";
export const ADMIN_SESSION_TTL_SECONDS = 8 * 60 * 60;

interface SessionPayload {
  username: string;
  issued_at: number;
  expires_at: number;
  nonce: string;
}

export interface AdminSession {
  username: string;
  expiresAt: number;
  csrfToken: string;
}

export class AdminAuthError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AdminAuthError";
  }
}

function environment(name: string): string | null {
  return process.env[name]?.trim() || null;
}

function sessionSecret(): string | null {
  const value = environment("MMQ_ADMIN_SESSION_SECRET");
  return value && value.length >= 32 ? value : null;
}

function configuredUsername(): string | null {
  return environment("MMQ_ADMIN_USERNAME");
}

function configuredPasswordHash(): string | null {
  return environment("MMQ_ADMIN_PASSWORD_HASH");
}

function safeEqual(left: string | Buffer, right: string | Buffer): boolean {
  const leftBuffer = Buffer.isBuffer(left) ? left : Buffer.from(left);
  const rightBuffer = Buffer.isBuffer(right) ? right : Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length
    && timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function parsePasswordHash(
  encoded: string,
): { salt: Buffer; expected: Buffer } | null {
  const [algorithm, saltEncoded, hashEncoded, extra] =
    encoded.split(/[.$]/);
  if (
    algorithm !== "scrypt"
    || !saltEncoded
    || !hashEncoded
    || extra
  ) {
    return null;
  }
  try {
    const salt = Buffer.from(saltEncoded, "base64url");
    const expected = Buffer.from(hashEncoded, "base64url");
    if (
      salt.length < 16
      || expected.length < 32
      || expected.length > 64
    ) {
      return null;
    }
    return { salt, expected };
  } catch {
    return null;
  }
}

export function adminAuthenticationConfigured(): boolean {
  const username = configuredUsername();
  const passwordHash = configuredPasswordHash();
  return Boolean(
    username
    && passwordHash
    && parsePasswordHash(passwordHash)
    && sessionSecret(),
  );
}

export async function verifyAdminCredentials(
  username: string,
  password: string,
): Promise<boolean> {
  const expectedUsername = configuredUsername();
  const encodedHash = configuredPasswordHash();
  if (!expectedUsername || !encodedHash) {
    return false;
  }
  const parsed = parsePasswordHash(encodedHash);
  if (!parsed) {
    return false;
  }

  const derived = (await scrypt(
    password,
    parsed.salt,
    parsed.expected.length,
  )) as Buffer;
  return (
    safeEqual(username, expectedUsername)
    && safeEqual(derived, parsed.expected)
  );
}

function sign(value: string): string | null {
  const secret = sessionSecret();
  return secret
    ? createHmac("sha256", secret)
        .update(value)
        .digest("base64url")
    : null;
}

function csrfToken(payload: SessionPayload): string | null {
  return sign(
    `csrf:${payload.username}:${payload.nonce}:${payload.expires_at}`,
  );
}

export function createAdminSession(
  username: string,
  nowMs = Date.now(),
): { token: string; session: AdminSession } | null {
  if (
    !adminAuthenticationConfigured()
    || username !== configuredUsername()
  ) {
    return null;
  }
  const issuedAt = Math.floor(nowMs / 1000);
  const payload: SessionPayload = {
    username,
    issued_at: issuedAt,
    expires_at: issuedAt + ADMIN_SESSION_TTL_SECONDS,
    nonce: randomBytes(24).toString("base64url"),
  };
  const payloadEncoded = Buffer.from(
    JSON.stringify(payload),
    "utf8",
  ).toString("base64url");
  const signature = sign(payloadEncoded);
  const csrf = csrfToken(payload);
  if (!signature || !csrf) {
    return null;
  }
  return {
    token: `${payloadEncoded}.${signature}`,
    session: {
      username,
      expiresAt: payload.expires_at,
      csrfToken: csrf,
    },
  };
}

function parseCookies(header: string | null): Map<string, string> {
  const result = new Map<string, string>();
  for (const part of (header ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name && value) {
      result.set(name, value);
    }
  }
  return result;
}

export function readAdminSession(
  request: Request,
  nowMs = Date.now(),
): AdminSession | null {
  const token = parseCookies(
    request.headers.get("cookie"),
  ).get(ADMIN_COOKIE_NAME);
  if (!token) {
    return null;
  }
  const [payloadEncoded, signature, extra] = token.split(".");
  if (!payloadEncoded || !signature || extra) {
    return null;
  }
  const expectedSignature = sign(payloadEncoded);
  if (!expectedSignature || !safeEqual(signature, expectedSignature)) {
    return null;
  }

  try {
    const value = JSON.parse(
      Buffer.from(payloadEncoded, "base64url").toString("utf8"),
    ) as Partial<SessionPayload>;
    const nowSeconds = Math.floor(nowMs / 1000);
    if (
      typeof value.username !== "string"
      || typeof value.issued_at !== "number"
      || typeof value.expires_at !== "number"
      || typeof value.nonce !== "string"
      || value.username !== configuredUsername()
      || value.issued_at > nowSeconds + 60
      || value.expires_at <= nowSeconds
      || value.expires_at - value.issued_at
        !== ADMIN_SESSION_TTL_SECONDS
      || value.nonce.length < 32
    ) {
      return null;
    }
    const payload = value as SessionPayload;
    const csrf = csrfToken(payload);
    return csrf
      ? {
          username: payload.username,
          expiresAt: payload.expires_at,
          csrfToken: csrf,
        }
      : null;
  } catch {
    return null;
  }
}

export function sessionCookie(token: string): string {
  return [
    `${ADMIN_COOKIE_NAME}=${token}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
    `Max-Age=${ADMIN_SESSION_TTL_SECONDS}`,
  ].join("; ");
}

export function clearedSessionCookie(): string {
  return [
    `${ADMIN_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
    "Max-Age=0",
  ].join("; ");
}

export function requireAdminSession(request: Request): AdminSession {
  const session = readAdminSession(request);
  if (!session) {
    throw new AdminAuthError(
      401,
      "AUTHENTICATION_REQUIRED",
      "需要登录研究人员账户。",
    );
  }
  return session;
}

export function requireCsrf(
  request: Request,
  session: AdminSession,
): void {
  const supplied = request.headers.get("x-mmq-csrf") ?? "";
  if (!supplied || !safeEqual(supplied, session.csrfToken)) {
    throw new AdminAuthError(
      403,
      "CSRF_CHECK_FAILED",
      "请求安全校验失败，请刷新后台后重试。",
    );
  }
}

export function requireSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  const expectedOrigin = new URL(request.url).origin;
  if (
    origin !== expectedOrigin
    || (
      fetchSite
      && fetchSite !== "same-origin"
      && fetchSite !== "none"
    )
  ) {
    throw new AdminAuthError(
      403,
      "ORIGIN_CHECK_FAILED",
      "请求来源校验失败。",
    );
  }
}
