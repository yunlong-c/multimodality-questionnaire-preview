export type SubmissionErrorCode =
  | "INVALID_REQUEST"
  | "PAYLOAD_TOO_LARGE"
  | "PAYLOAD_HASH_MISMATCH"
  | "SUBMISSION_RELEASE_MISMATCH"
  | "SUBMISSION_IDENTITY_MISMATCH"
  | "SUBMISSION_CONFLICT"
  | "SUBMISSIONS_CLOSED"
  | "SUBMISSION_UNAVAILABLE";

export class SubmissionError extends Error {
  readonly status: number;
  readonly code: SubmissionErrorCode;
  readonly retryable: boolean;

  constructor(
    status: number,
    code: SubmissionErrorCode,
    message: string,
    retryable = false,
  ) {
    super(message);
    this.name = "SubmissionError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

export function invalidSubmissionRequest(
  message = "The submission request is invalid.",
) {
  return new SubmissionError(400, "INVALID_REQUEST", message);
}

export function submissionTooLarge() {
  return new SubmissionError(
    413,
    "PAYLOAD_TOO_LARGE",
    "The submission request is too large.",
  );
}

export function submissionHashMismatch() {
  return new SubmissionError(
    422,
    "PAYLOAD_HASH_MISMATCH",
    "The submitted payload does not match its SHA-256 digest.",
  );
}

export function submissionReleaseMismatch() {
  return new SubmissionError(
    409,
    "SUBMISSION_RELEASE_MISMATCH",
    "The answer release does not match the published questionnaire.",
  );
}

export function submissionIdentityMismatch(
  message = "The submission identity does not match its allocation.",
) {
  return new SubmissionError(
    409,
    "SUBMISSION_IDENTITY_MISMATCH",
    message,
  );
}

export function submissionConflict() {
  return new SubmissionError(
    409,
    "SUBMISSION_CONFLICT",
    "This session already has a different authoritative answer.",
  );
}

export function submissionsClosed() {
  return new SubmissionError(
    423,
    "SUBMISSIONS_CLOSED",
    "New questionnaire submissions are not currently accepted.",
  );
}

export function submissionUnavailable() {
  return new SubmissionError(
    503,
    "SUBMISSION_UNAVAILABLE",
    "The authoritative submission service is temporarily unavailable.",
    true,
  );
}
