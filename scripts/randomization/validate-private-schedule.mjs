import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  DEFAULT_RANDOMIZATION_VERSION,
  DEFAULT_TOTAL_SLOTS,
  publicScheduleMetadata,
  validateSchedule,
} from "./schedule-lib.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const defaultPrivatePath = path.join(
  repositoryRoot,
  ".private",
  "randomization",
  `${DEFAULT_RANDOMIZATION_VERSION}.json`,
);
const inputPath = path.resolve(
  repositoryRoot,
  process.argv[2] ?? defaultPrivatePath,
);
const schedule = JSON.parse(await readFile(inputPath, "utf8"));
const validation = validateSchedule(schedule, {
  expectedTotalSlots: DEFAULT_TOTAL_SLOTS,
  expectedRandomizationVersion: DEFAULT_RANDOMIZATION_VERSION,
});

if (!validation.valid) {
  console.error(validation.errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    valid: true,
    ...validation.summary,
    public_metadata: publicScheduleMetadata(schedule),
  }, null, 2));
}
