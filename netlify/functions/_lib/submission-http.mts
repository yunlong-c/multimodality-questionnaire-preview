import { randomUUID } from "node:crypto";
import {
  invalidSubmissionRequest,
  SubmissionError,
  submissionTooLarge,
  submissionUnavailable,
} from "./submission-errors.mts";
import type {
  SubmissionDeployMetadata,
  SubmissionRepository,
} from "./submission-types.mts";
import {
  MAX_SUBMISSION_REQUEST_BYTES,
  parseSubmissionBody,
} from "./submission-validation.mts";

type RepositoryFactory = () => SubmissionRepository;
type MirrorDispatcher = (receiptId: string) => Promise<unknown>;

export interface SubmissionFunctionContext {
  ip?: string;
  deploy?: {
    context?: string;
    id?: string;
  };
  site?: {
    url?: string;
  };
  waitUntil?: (promise: Promise<unknown>) => void;
}

const JSON_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
};

function identifier(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

function optionalEnvironment(name: string): string | null {
  const value = process.env[name]?.trim();
  return value || null;
}

export function deploymentMetadata(
  context: SubmissionFunctionContext | undefined,
): SubmissionDeployMetadata {
  return {
    trustedClientIp: context?.ip?.trim() || null,
    deployContext:
      context?.deploy?.context?.trim()
      || optionalEnvironment("CONTEXT")
      || "unknown",
    deployId:
      context?.deploy?.id?.trim()
      || optionalEnvironment("DEPLOY_ID"),
    deployUrl:
      context?.site?.url?.trim()
      || optionalEnvironment("DEPLOY_PRIME_URL")
      || optionalEnvironment("URL"),
    deployBranch: optionalEnvironment("BRANCH"),
    deployCommitRef: optionalEnvironment("COMMIT_REF"),
  };
}

async function requestJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw invalidSubmissionRequest(
      "Content-Type must be application/json.",
    );
  }
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_SUBMISSION_REQUEST_BYTES) {
    throw submissionTooLarge();
  }
  try {
    return JSON.parse(text);
  } catch {
    throw invalidSubmissionRequest("The request body is not valid JSON.");
  }
}

function hmacSecret(): string {
  const secret = process.env.MMQ_RANDOMIZATION_HMAC_SECRET;
  if (!secret) {
    throw new Error("MMQ_RANDOMIZATION_HMAC_SECRET is not configured.");
  }
  return secret;
}

function errorResponse(error: unknown): Response {
  if (error instanceof SubmissionError) {
    return new Response(JSON.stringify({
      error: {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
      },
    }), {
      status: error.status,
      headers: JSON_HEADERS,
    });
  }
  console.error("[mmq-submission] authoritative submission failed", error);
  const unavailable = submissionUnavailable();
  return new Response(JSON.stringify({
    error: {
      code: unavailable.code,
      message: unavailable.message,
      retryable: unavailable.retryable,
    },
  }), {
    status: unavailable.status,
    headers: JSON_HEADERS,
  });
}

export function createSubmitHandler(
  repositoryFactory: RepositoryFactory,
  mirrorDispatcher?: MirrorDispatcher,
) {
  return async (
    request: Request,
    context?: SubmissionFunctionContext,
  ): Promise<Response> => {
    try {
      if (request.method !== "POST") {
        throw invalidSubmissionRequest("Only POST requests are accepted.");
      }
      const validated = parseSubmissionBody(
        await requestJson(request),
        hmacSecret(),
      );
      const result = await repositoryFactory().store({
        ...validated,
        receiptId: identifier("receipt"),
        conflictId: identifier("conflict"),
        mirrorId: identifier("mirror"),
        submissionsOpen: process.env.MMQ_SUBMISSIONS_OPEN === "true",
        deploy: deploymentMetadata(context),
      });
      if (!result.isReplay && mirrorDispatcher) {
        const mirrorPromise = mirrorDispatcher(result.receiptId).catch(
          (error) => {
            console.error(
              "[mmq-submission] immediate Forms mirror failed",
              error,
            );
          },
        );
        if (context?.waitUntil) {
          context.waitUntil(mirrorPromise);
        } else {
          await mirrorPromise;
        }
      }
      return new Response(JSON.stringify({
        receipt_id: result.receiptId,
        session_id: result.sessionId,
        participant_id: result.participantId,
        dataset_classification: result.datasetClassification,
        payload_sha256: result.payloadSha256,
        stored_at: result.storedAt,
        is_replay: result.isReplay,
        authority: "netlify_database",
        mirror_status: result.mirrorStatus,
      }), {
        status: result.isReplay ? 200 : 201,
        headers: JSON_HEADERS,
      });
    } catch (error) {
      return errorResponse(error);
    }
  };
}
