export type PublicErrorCode =
  | "INVALID_REQUEST"
  | "CATALOG_MISMATCH"
  | "SCHEDULE_MISMATCH"
  | "SCHEDULE_EXHAUSTED"
  | "COLLECTION_CLOSED"
  | "ALLOCATION_UNAVAILABLE";

export class RandomizationError extends Error {
  readonly status: number;
  readonly code: PublicErrorCode;

  constructor(status: number, code: PublicErrorCode, message: string) {
    super(message);
    this.name = "RandomizationError";
    this.status = status;
    this.code = code;
  }
}

export function invalidRequest(message = "The request is invalid.") {
  return new RandomizationError(400, "INVALID_REQUEST", message);
}

export function catalogMismatch() {
  return new RandomizationError(
    409,
    "CATALOG_MISMATCH",
    "The questionnaire release does not match the active study release.",
  );
}

export function scheduleMismatch() {
  return new RandomizationError(
    409,
    "SCHEDULE_MISMATCH",
    "The active allocation schedule does not match the published randomization commitment.",
  );
}

export function scheduleExhausted() {
  return new RandomizationError(
    409,
    "SCHEDULE_EXHAUSTED",
    "The formal allocation schedule has reached capacity.",
  );
}

export function collectionClosed() {
  return new RandomizationError(
    423,
    "COLLECTION_CLOSED",
    "Formal data collection is not currently open.",
  );
}

export function allocationUnavailable() {
  return new RandomizationError(
    503,
    "ALLOCATION_UNAVAILABLE",
    "The allocation service is temporarily unavailable.",
  );
}
