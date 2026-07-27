import assert from "node:assert/strict";
import test from "node:test";
import {
  rowsToCsv,
  selectEffectiveAssignments,
  summarizeLedger,
} from "../randomization/ledger-lib.mjs";

const normal = {
  allocation_id: "allocation-1",
  token_hmac: "token-1",
  participant_id: "participant-1",
  format_assignment: "table",
  allocation_method: "variable_block",
  assigned_at: "2026-07-27T00:00:00.000Z",
};
const supersedingFallback = {
  allocation_id: "fallback-1",
  token_hmac: "token-1",
  participant_id: "fallback-participant-1",
  format_assignment: "video",
  allocation_method: "client_fallback",
  assigned_at: "2026-07-27T00:00:01.000Z",
};

test("effective ledger prefers a reconciled fallback over an unseen scheduled allocation", () => {
  assert.deepEqual(
    selectEffectiveAssignments([normal, supersedingFallback]),
    [supersedingFallback],
  );
});

test("summary distinguishes raw slots, effective starts, and sessions", () => {
  const assignments = [
    normal,
    supersedingFallback,
    {
      ...normal,
      allocation_id: "allocation-2",
      token_hmac: "token-2",
      participant_id: "participant-2",
      format_assignment: "graph",
      assigned_at: "2026-07-27T00:00:02.000Z",
    },
    {
      ...supersedingFallback,
      allocation_id: "fallback-3",
      token_hmac: "token-3",
      participant_id: "participant-3",
      assigned_at: "2026-07-27T00:00:03.000Z",
    },
    {
      ...supersedingFallback,
      allocation_id: "fallback-4",
      token_hmac: "token-4",
      participant_id: "participant-4",
      assigned_at: "2026-07-27T00:00:04.000Z",
    },
  ];
  const summary = summarizeLedger({
    schedule: {
      randomization_version: "mmq-randomization-2026-07-v1",
      schedule_sha256: "a".repeat(64),
      status: "active",
      total_slots: 3000,
    },
    assignments,
    sessions: [{}, {}, {}, {}, {}],
    exportedAt: "2026-07-27T00:10:00.000Z",
  });

  assert.equal(summary.scheduled_slots_assigned, 2);
  assert.equal(summary.scheduled_slots_remaining, 2998);
  assert.equal(summary.effective_started_identities, 4);
  assert.deepEqual(summary.effective_format_counts, {
    table: 0,
    graph: 1,
    video: 3,
  });
  assert.deepEqual(summary.effective_allocation_method_counts, {
    variable_block: 1,
    client_fallback: 3,
  });
  assert.equal(summary.session_records, 5);
  assert.equal(summary.consecutive_fallback_maximum, 2);
  assert.equal(summary.fallback_alert, true);
  assert.equal(summary.interpretation.assigned_is_not_submitted, true);
});

test("CSV export safely quotes commas, quotes, and newlines", () => {
  const csv = rowsToCsv(
    [{ id: "a", note: "one,\"two\"\nthree" }],
    ["id", "note"],
  );
  assert.equal(csv, 'id,note\r\na,"one,""two""\nthree"\r\n');
});
