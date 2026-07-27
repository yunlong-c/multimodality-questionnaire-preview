import assert from "node:assert/strict";
import test, {
  afterEach,
  beforeEach,
} from "node:test";
import {
  collectionClosed,
  scheduleMismatch,
  scheduleExhausted,
} from "../_lib/randomization-errors.mts";
import {
  createAllocateHandler,
  createReconcileHandler,
} from "../_lib/randomization-http.mts";
import type {
  AllocateRepositoryInput,
  AllocationResult,
  RandomizationRepository,
  ReconcileRepositoryInput,
} from "../_lib/randomization-types.mts";
import {
  CATALOG_HASH,
  STIMULUS_SET_VERSION,
  tokenHmac,
} from "../_lib/randomization-validation.mts";

const originalSecret = process.env.MMQ_RANDOMIZATION_HMAC_SECRET;
const originalCollectionOpen = process.env.MMQ_FORMAL_COLLECTION_OPEN;
const testSecret = "test-only-secret-with-at-least-32-bytes-long";
const clientToken = "preview-client-00000000-0000-4000-8000-000000000001";
const requestedSessionId =
  "session-00000000-0000-4000-8000-000000000008";

class FakeRepository implements RandomizationRepository {
  allocateCalls: AllocateRepositoryInput[] = [];
  reconcileCalls: ReconcileRepositoryInput[] = [];
  allocateResult: AllocationResult = {
    record: {
      allocationId: "allocation-00000000-0000-4000-8000-000000000002",
      participantId: "participant-00000000-0000-4000-8000-000000000003",
      sessionId: "session-00000000-0000-4000-8000-000000000004",
      formatAssignment: "graph",
      allocationMethod: "variable_block",
      allocationStatus: "confirmed",
      assignedAt: "2026-07-27T01:00:00.000Z",
      fallbackReasonCode: null,
      fallbackReconciledAt: null,
    },
    isReturning: false,
  };
  reconcileResult: AllocationResult = {
    record: {
      allocationId: "fallback-allocation-00000000-0000-4000-8000-000000000005",
      participantId: "fallback-participant-00000000-0000-4000-8000-000000000006",
      sessionId: "fallback-session-00000000-0000-4000-8000-000000000007",
      formatAssignment: "video",
      allocationMethod: "client_fallback",
      allocationStatus: "confirmed",
      assignedAt: "2026-07-27T01:02:00.000Z",
      fallbackReasonCode: "allocation_timeout",
      fallbackReconciledAt: "2026-07-27T01:03:00.000Z",
    },
    isReturning: false,
  };
  allocateError: unknown;
  reconcileError: unknown;

  async allocate(input: AllocateRepositoryInput) {
    this.allocateCalls.push(input);
    if (this.allocateError) throw this.allocateError;
    return {
      ...this.allocateResult,
      record: {
        ...this.allocateResult.record,
        sessionId: input.sessionId,
      },
    };
  }

  async reconcile(input: ReconcileRepositoryInput) {
    this.reconcileCalls.push(input);
    if (this.reconcileError) throw this.reconcileError;
    return this.reconcileResult;
  }
}

function jsonRequest(pathname: string, body: unknown) {
  return new Request(`https://study.example${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function allocateBody(overrides: Record<string, unknown> = {}) {
  return {
    client_token: clientToken,
    session_id: requestedSessionId,
    catalog_hash: CATALOG_HASH,
    stimulus_set_version: STIMULUS_SET_VERSION,
    ...overrides,
  };
}

beforeEach(() => {
  process.env.MMQ_RANDOMIZATION_HMAC_SECRET = testSecret;
  process.env.MMQ_FORMAL_COLLECTION_OPEN = "true";
});

afterEach(() => {
  if (originalSecret === undefined) {
    delete process.env.MMQ_RANDOMIZATION_HMAC_SECRET;
  } else {
    process.env.MMQ_RANDOMIZATION_HMAC_SECRET = originalSecret;
  }
  if (originalCollectionOpen === undefined) {
    delete process.env.MMQ_FORMAL_COLLECTION_OPEN;
  } else {
    process.env.MMQ_FORMAL_COLLECTION_OPEN = originalCollectionOpen;
  }
});

test("allocate returns the formal randomization contract without schedule position", async () => {
  const repository = new FakeRepository();
  const response = await createAllocateHandler(() => repository)(
    jsonRequest("/api/allocate", allocateBody()),
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.format_assignment, "graph");
  assert.equal(body.allocation_method, "variable_block");
  assert.equal(body.allocation_status, "confirmed");
  assert.equal(body.dataset_classification, "formal");
  assert.equal(body.formal_collection_allowed, true);
  assert.equal(body.client_token, clientToken);
  assert.equal(body.session_id, requestedSessionId);
  assert.equal("schedule_position" in body, false);
  assert.equal("block_id" in body, false);
  assert.equal(repository.allocateCalls.length, 1);
  assert.equal(
    repository.allocateCalls[0].tokenHmac,
    tokenHmac(clientToken, testSecret),
  );
  assert.equal(repository.allocateCalls[0].sessionId, requestedSessionId);
});

test("allocate rejects a missing or malformed client session before storage", async () => {
  const repository = new FakeRepository();
  const response = await createAllocateHandler(() => repository)(
    jsonRequest("/api/allocate", allocateBody({ session_id: "short" })),
  );

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "INVALID_REQUEST");
  assert.equal(repository.allocateCalls.length, 0);
});

test("external collection gate blocks allocate and reconcile before storage", async () => {
  process.env.MMQ_FORMAL_COLLECTION_OPEN = "false";
  const repository = new FakeRepository();
  const allocateResponse = await createAllocateHandler(() => repository)(
    jsonRequest("/api/allocate", allocateBody()),
  );
  const reconcileResponse = await createReconcileHandler(() => repository)(
    jsonRequest("/api/allocate/reconcile", {
      ...allocateBody(),
      allocation_id:
        "fallback-allocation-00000000-0000-4000-8000-000000000005",
      participant_id:
        "fallback-participant-00000000-0000-4000-8000-000000000006",
      session_id:
        "fallback-session-00000000-0000-4000-8000-000000000007",
      format_assignment: "video",
      assigned_at: "2026-07-27T01:02:00.000Z",
      fallback_reason_code: "allocation_timeout",
    }),
  );

  assert.equal(allocateResponse.status, 423);
  assert.equal(
    (await allocateResponse.json()).error.code,
    "COLLECTION_CLOSED",
  );
  assert.equal(reconcileResponse.status, 423);
  assert.equal(
    (await reconcileResponse.json()).error.code,
    "COLLECTION_CLOSED",
  );
  assert.equal(repository.allocateCalls.length, 0);
  assert.equal(repository.reconcileCalls.length, 0);
});

test("collection gate is fail-closed when the environment value is missing", async () => {
  delete process.env.MMQ_FORMAL_COLLECTION_OPEN;
  const repository = new FakeRepository();
  const response = await createAllocateHandler(() => repository)(
    jsonRequest("/api/allocate", allocateBody()),
  );

  assert.equal(response.status, 423);
  assert.equal((await response.json()).error.code, "COLLECTION_CLOSED");
  assert.equal(repository.allocateCalls.length, 0);
});

test("catalog mismatch is a non-fallback 409 and never reaches storage", async () => {
  const repository = new FakeRepository();
  const response = await createAllocateHandler(() => repository)(
    jsonRequest(
      "/api/allocate",
      allocateBody({ catalog_hash: "0".repeat(64) }),
    ),
  );
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.equal(body.error.code, "CATALOG_MISMATCH");
  assert.equal(repository.allocateCalls.length, 0);
});

test("capacity and closed states keep their non-fallback codes", async () => {
  const exhausted = new FakeRepository();
  exhausted.allocateError = scheduleExhausted();
  const exhaustedResponse = await createAllocateHandler(() => exhausted)(
    jsonRequest("/api/allocate", allocateBody()),
  );
  assert.equal(exhaustedResponse.status, 409);
  assert.equal(
    (await exhaustedResponse.json()).error.code,
    "SCHEDULE_EXHAUSTED",
  );

  const closed = new FakeRepository();
  closed.allocateError = collectionClosed();
  const closedResponse = await createAllocateHandler(() => closed)(
    jsonRequest("/api/allocate", allocateBody()),
  );
  assert.equal(closedResponse.status, 423);
  assert.equal(
    (await closedResponse.json()).error.code,
    "COLLECTION_CLOSED",
  );
});

test("schedule commitment mismatch is a non-fallback 409", async () => {
  const repository = new FakeRepository();
  repository.allocateError = scheduleMismatch();
  const response = await createAllocateHandler(() => repository)(
    jsonRequest("/api/allocate", allocateBody()),
  );

  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, "SCHEDULE_MISMATCH");
});

test("unexpected storage failures become fallback-eligible 503 responses", async () => {
  const repository = new FakeRepository();
  repository.allocateError = new Error("database unavailable");
  const response = await createAllocateHandler(() => repository)(
    jsonRequest("/api/allocate", allocateBody()),
  );

  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "ALLOCATION_UNAVAILABLE");
});

test("reconcile preserves the provisional allocation identifiers and format", async () => {
  const repository = new FakeRepository();
  const requestBody = {
    ...allocateBody(),
    allocation_id:
      "fallback-allocation-00000000-0000-4000-8000-000000000005",
    participant_id:
      "fallback-participant-00000000-0000-4000-8000-000000000006",
    session_id:
      "fallback-session-00000000-0000-4000-8000-000000000007",
    format_assignment: "video",
    assigned_at: "2026-07-27T01:02:00.000Z",
    fallback_reason_code: "allocation_timeout",
  };
  const response = await createReconcileHandler(() => repository)(
    jsonRequest("/api/allocate/reconcile", requestBody),
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.allocation_id, requestBody.allocation_id);
  assert.equal(body.participant_id, requestBody.participant_id);
  assert.equal(body.session_id, requestBody.session_id);
  assert.equal(body.format_assignment, "video");
  assert.equal(body.allocation_method, "client_fallback");
  assert.equal(body.allocation_status, "confirmed");
  assert.equal(repository.reconcileCalls[0].allocationId, requestBody.allocation_id);
  assert.equal(repository.reconcileCalls[0].sessionId, requestBody.session_id);
});

test("invalid fallback metadata is rejected before reconciliation", async () => {
  const repository = new FakeRepository();
  const response = await createReconcileHandler(() => repository)(
    jsonRequest("/api/allocate/reconcile", {
      ...allocateBody(),
      allocation_id: "short",
      participant_id:
        "fallback-participant-00000000-0000-4000-8000-000000000006",
      session_id:
        "fallback-session-00000000-0000-4000-8000-000000000007",
      format_assignment: "video",
      assigned_at: "2026-07-27T01:02:00.000Z",
      fallback_reason_code: "allocation_timeout",
    }),
  );

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "INVALID_REQUEST");
  assert.equal(repository.reconcileCalls.length, 0);
});

test("a missing HMAC secret fails closed as ALLOCATION_UNAVAILABLE", async () => {
  delete process.env.MMQ_RANDOMIZATION_HMAC_SECRET;
  const repository = new FakeRepository();
  const response = await createAllocateHandler(() => repository)(
    jsonRequest("/api/allocate", allocateBody()),
  );

  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "ALLOCATION_UNAVAILABLE");
  assert.equal(repository.allocateCalls.length, 0);
});
