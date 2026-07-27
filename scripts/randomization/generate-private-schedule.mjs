import {
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  DEFAULT_RANDOMIZATION_VERSION,
  DEFAULT_TOTAL_SLOTS,
  generateSchedule,
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
const defaultPublicPath = path.join(
  repositoryRoot,
  "netlify",
  "randomization",
  "public-schedule-metadata.json",
);

function optionValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

const privatePath = path.resolve(
  repositoryRoot,
  optionValue("--private-output", defaultPrivatePath),
);
const publicPath = path.resolve(
  repositoryRoot,
  optionValue("--public-output", defaultPublicPath),
);
const randomizationVersion = optionValue(
  "--version",
  DEFAULT_RANDOMIZATION_VERSION,
);
const totalSlots = Number(optionValue("--slots", DEFAULT_TOTAL_SLOTS));
const force = process.argv.includes("--force");

if (!force) {
  try {
    await readFile(privatePath, "utf8");
    throw new Error(
      `Private schedule already exists at ${privatePath}. Use --force only if a new formal version is intended.`,
    );
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

const schedule = generateSchedule({
  randomizationVersion,
  totalSlots,
});
const validation = validateSchedule(schedule, {
  expectedTotalSlots: totalSlots,
  expectedRandomizationVersion: randomizationVersion,
});
if (!validation.valid) {
  throw new Error(validation.errors.join("\n"));
}

await mkdir(path.dirname(privatePath), { recursive: true });
await mkdir(path.dirname(publicPath), { recursive: true });
await writeFile(privatePath, `${JSON.stringify(schedule, null, 2)}\n`, {
  encoding: "utf8",
  mode: 0o600,
});
await writeFile(
  publicPath,
  `${JSON.stringify(publicScheduleMetadata(schedule), null, 2)}\n`,
  "utf8",
);

console.log(
  JSON.stringify({
    randomization_version: schedule.randomization_version,
    total_slots: schedule.total_slots,
    format_counts: validation.summary.format_counts,
    block_count: validation.summary.block_count,
    schedule_sha256: schedule.schedule_sha256,
    private_output: privatePath,
    public_output: publicPath,
  }, null, 2),
);
