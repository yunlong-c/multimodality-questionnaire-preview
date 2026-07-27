import assert from "node:assert/strict";
import test from "node:test";
import { PostgresSubmissionRepository } from "../_lib/submission-database.mts";
import type {
  StoreSubmissionInput,
} from "../_lib/submission-types.mts";
import {
  CATALOG_HASH,
  STIMULUS_SET_VERSION,
  tokenHmac,
} from "../_lib/randomization-validation.mts";

const secret = "database-test-secret-with-at-least-32-bytes";
const clientToken =
  "preview-client-00000000-0000-4000-8000-000000000001";

function input(
  overrides: Partial<StoreSubmissionInput> = {},
): StoreSubmissionInput {
  return {
    clientToken,
    clientTokenHmac: tokenHmac(clientToken, secret),
    payloadJson: "{\"session\":{}}",
    payloadSha256: "a".repeat(64),
    sessionId: "session-00000000-0000-4000-8000-000000000002",
    participantId:
      "participant-00000000-0000-4000-8000-000000000003",
    datasetClassification: "test",
    formatAssignment: "table",
    stimulusSetVersion: STIMULUS_SET_VERSION,
    catalogHash: CATALOG_HASH,
    submittedAt: "2026-07-27T15:00:00.000Z",
    allocationId: null,
    randomizationVersion: null,
    allocationMethod: null,
    allocationStatus: null,
    assignedAt: null,
    fallbackReasonCode: null,
    fallbackReconciledAt: null,
    clientAttemptCount: 1,
    previousAttemptLatencyMs: null,
    receiptId: "receipt-00000000-0000-4000-8000-000000000004",
    conflictId: "conflict-00000000-0000-4000-8000-000000000005",
    mirrorId: "mirror-00000000-0000-4000-8000-000000000006",
    submissionsOpen: true,
    deploy: {
      trustedClientIp: "203.0.113.1",
      deployContext: "deploy-preview",
      deployId: "deploy-1",
      deployUrl: "https://preview.example",
      deployBranch: "branch",
      deployCommitRef: "abc123",
    },
    ...overrides,
  };
}

type QueryResult = {
  rows: Record<string, unknown>[];
  rowCount: number | null;
};

class FakeClient {
  queries: { text: string; values: unknown[] }[] = [];
  released = false;
  constructor(
    readonly respond: (
      text: string,
      values: unknown[],
    ) => QueryResult,
  ) {}

  async query(text: string, values: unknown[] = []): Promise<QueryResult> {
    this.queries.push({ text, values });
    return this.respond(text, values);
  }

  release(): void {
    this.released = true;
  }
}

function repository(client: FakeClient): PostgresSubmissionRepository {
  return new PostgresSubmissionRepository({
    connect: async () => client,
  } as never);
}

function empty(): QueryResult {
  return { rows: [], rowCount: 0 };
}

function existingRow(
  request: StoreSubmissionInput,
  hash = request.payloadSha256,
) {
  return {
    receipt_id: request.receiptId,
    session_id: request.sessionId,
    participant_id: request.participantId,
    dataset_classification: request.datasetClassification,
    client_token_hmac: request.clientTokenHmac,
    payload_sha256: hash,
    stored_at: "2026-07-27T15:00:01.000Z",
    mirror_state: "accepted",
  };
}

test("same-hash replay succeeds while new submissions are closed", async () => {
  const request = input({ submissionsOpen: false });
  const client = new FakeClient((text) => {
    if (text.includes("FROM mmq_submissions AS submission")) {
      return { rows: [existingRow(request)], rowCount: 1 };
    }
    return empty();
  });

  const result = await repository(client).store(request);

  assert.equal(result.isReplay, true);
  assert.equal(result.receiptId, request.receiptId);
  assert.equal(result.mirrorStatus, "accepted");
  assert.equal(
    client.queries.some(({ text }) => text.includes("INSERT INTO mmq_submissions")),
    false,
  );
  assert.equal(
    client.queries.some(({ text }) => text === "COMMIT"),
    true,
  );
});

test("different-hash replay records a conflict without overwriting", async () => {
  const request = input();
  const client = new FakeClient((text) => {
    if (text.includes("FROM mmq_submissions AS submission")) {
      return {
        rows: [existingRow(request, "b".repeat(64))],
        rowCount: 1,
      };
    }
    return empty();
  });

  await assert.rejects(
    repository(client).store(request),
    (error: unknown) => (
      typeof error === "object"
      && error !== null
      && "code" in error
      && error.code === "SUBMISSION_CONFLICT"
    ),
  );
  assert.equal(
    client.queries.some(({ text }) =>
      text.includes("INSERT INTO mmq_submission_conflicts")
    ),
    true,
  );
  assert.equal(
    client.queries.some(({ text }) => text.includes("UPDATE mmq_submissions")),
    false,
  );
  assert.equal(
    client.queries.some(({ text }) => text === "COMMIT"),
    true,
  );
});

test("closed gate rejects a genuinely new submission before inserts", async () => {
  const request = input({ submissionsOpen: false });
  const client = new FakeClient(() => empty());

  await assert.rejects(
    repository(client).store(request),
    (error: unknown) => (
      typeof error === "object"
      && error !== null
      && "code" in error
      && error.code === "SUBMISSIONS_CLOSED"
    ),
  );
  assert.equal(
    client.queries.some(({ text }) => text.includes("INSERT INTO mmq_submissions")),
    false,
  );
  assert.equal(
    client.queries.some(({ text }) => text === "ROLLBACK"),
    true,
  );
});

test("a new test answer and its mirror outbox commit atomically", async () => {
  const request = input();
  const client = new FakeClient((text) => {
    if (text.includes("INSERT INTO mmq_submissions")) {
      return {
        rows: [{
          receipt_id: request.receiptId,
          session_id: request.sessionId,
          participant_id: request.participantId,
          dataset_classification: request.datasetClassification,
          payload_sha256: request.payloadSha256,
          stored_at: "2026-07-27T15:00:01.000Z",
        }],
        rowCount: 1,
      };
    }
    return empty();
  });

  const result = await repository(client).store(request);

  assert.equal(result.isReplay, false);
  assert.equal(result.mirrorStatus, "pending");
  assert.equal(
    client.queries.some(({ text }) => text.includes("INSERT INTO mmq_submissions")),
    true,
  );
  assert.equal(
    client.queries.some(({ text }) =>
      text.includes("INSERT INTO mmq_submission_form_mirrors")
    ),
    true,
  );
  assert.equal(client.queries.at(-1)?.text, "COMMIT");
});

test("formal identity mismatch rolls back before authoritative storage", async () => {
  const request = input({
    datasetClassification: "formal",
    formatAssignment: "video",
    allocationId:
      "allocation-00000000-0000-4000-8000-000000000007",
    randomizationVersion: "mmq-randomization-2026-07-v1",
    allocationMethod: "variable_block",
    allocationStatus: "confirmed",
    assignedAt: "2026-07-27T14:59:00.000Z",
  });
  const client = new FakeClient((text) => {
    if (text.includes("FROM mmq_randomization_sessions")) {
      return {
        rows: [{
          session_allocation_id: request.allocationId,
          allocation_id: request.allocationId,
          randomization_version: request.randomizationVersion,
          token_hmac: "f".repeat(64),
          participant_id: request.participantId,
          format_assignment: request.formatAssignment,
          allocation_method: request.allocationMethod,
          allocation_status: "confirmed",
          assigned_at: request.assignedAt,
        }],
        rowCount: 1,
      };
    }
    return empty();
  });

  await assert.rejects(
    repository(client).store(request),
    (error: unknown) => (
      typeof error === "object"
      && error !== null
      && "code" in error
      && error.code === "SUBMISSION_IDENTITY_MISMATCH"
    ),
  );
  assert.equal(
    client.queries.some(({ text }) => text.includes("INSERT INTO mmq_submissions")),
    false,
  );
  assert.equal(client.queries.at(-1)?.text, "ROLLBACK");
  assert.equal(client.released, true);
});
