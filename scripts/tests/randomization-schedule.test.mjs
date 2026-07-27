import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  calculateScheduleSha256,
  DEFAULT_RANDOMIZATION_VERSION,
  generateSchedule,
  publicScheduleMetadata,
  validateSchedule,
} from "../randomization/schedule-lib.mjs";

function deterministicRandom(seed = 0x5eed1234) {
  let state = seed >>> 0;
  return (maximum) => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state % maximum;
  };
}

test("generator creates 3000 concealed, balanced variable-block slots", () => {
  const schedule = generateSchedule({
    generatedAt: "2026-07-27T00:00:00.000Z",
    randomInteger: deterministicRandom(),
  });
  const validation = validateSchedule(schedule);

  assert.equal(validation.valid, true, validation.errors.join("\n"));
  assert.equal(schedule.slots.length, 3000);
  assert.deepEqual(validation.summary.format_counts, {
    table: 1000,
    graph: 1000,
    video: 1000,
  });
  assert.deepEqual(
    new Set(schedule.slots.map((slot) => slot.block_size)),
    new Set([6, 9, 12]),
  );

  const runningCounts = { table: 0, graph: 0, video: 0 };
  let maximumImbalance = 0;
  for (const slot of schedule.slots) {
    runningCounts[slot.format_assignment] += 1;
    const values = Object.values(runningCounts);
    maximumImbalance = Math.max(
      maximumImbalance,
      Math.max(...values) - Math.min(...values),
    );
  }
  assert.ok(maximumImbalance <= 4);
});

test("schedule hash detects a changed future allocation", () => {
  const schedule = generateSchedule({
    generatedAt: "2026-07-27T00:00:00.000Z",
    randomInteger: deterministicRandom(),
  });
  const changed = structuredClone(schedule);
  changed.slots[0].format_assignment =
    changed.slots[0].format_assignment === "table" ? "graph" : "table";

  assert.notEqual(calculateScheduleSha256(changed), schedule.schedule_sha256);
  assert.equal(validateSchedule(changed).valid, false);
});

test("committed public metadata contains no slot order", async () => {
  const repositoryRoot = path.resolve(import.meta.dirname, "../..");
  const metadata = JSON.parse(
    await readFile(
      path.join(
        repositoryRoot,
        "netlify",
        "randomization",
        "public-schedule-metadata.json",
      ),
      "utf8",
    ),
  );

  assert.equal(
    metadata.randomization_version,
    DEFAULT_RANDOMIZATION_VERSION,
  );
  assert.match(metadata.schedule_sha256, /^[0-9a-f]{64}$/);
  assert.equal("slots" in metadata, false);
  assert.deepEqual(Object.keys(metadata).sort(), [
    "randomization_version",
    "schedule_sha256",
  ]);
});

test("public metadata is derived from a valid schedule only", () => {
  const schedule = generateSchedule({
    generatedAt: "2026-07-27T00:00:00.000Z",
    randomInteger: deterministicRandom(),
  });
  const metadata = publicScheduleMetadata(schedule);
  assert.equal(metadata.schedule_sha256, schedule.schedule_sha256);
  assert.equal("slots" in metadata, false);
});
