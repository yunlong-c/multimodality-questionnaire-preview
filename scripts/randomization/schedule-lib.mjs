import {
  createHash,
  randomInt,
} from "node:crypto";

export const SCHEDULE_SCHEMA_VERSION = 1;
export const GENERATOR_VERSION = "mmq-schedule-generator-v1";
export const DEFAULT_RANDOMIZATION_VERSION =
  "mmq-randomization-2026-07-v1";
export const DEFAULT_TOTAL_SLOTS = 3000;
export const ALLOWED_BLOCK_SIZES = Object.freeze([6, 9, 12]);
export const FORMATS = Object.freeze(["table", "graph", "video"]);

function stableJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map(stableJsonValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableJsonValue(value[key])]),
    );
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(stableJsonValue(value));
}

export function scheduleDigestPayload(schedule) {
  return {
    schema_version: schedule.schema_version,
    generator_version: schedule.generator_version,
    randomization_version: schedule.randomization_version,
    generated_at: schedule.generated_at,
    total_slots: schedule.total_slots,
    allowed_block_sizes: schedule.allowed_block_sizes,
    slots: schedule.slots.map((slot) => ({
      position: slot.position,
      block_id: slot.block_id,
      block_size: slot.block_size,
      block_position: slot.block_position,
      format_assignment: slot.format_assignment,
    })),
  };
}

export function calculateScheduleSha256(schedule) {
  return createHash("sha256")
    .update(canonicalJson(scheduleDigestPayload(schedule)), "utf8")
    .digest("hex");
}

function shuffle(values, randomInteger = randomInt) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInteger(index + 1);
    [result[index], result[swapIndex]] = [
      result[swapIndex],
      result[index],
    ];
  }
  return result;
}

function chooseBlockSize(remaining, randomInteger = randomInt) {
  const candidates = ALLOWED_BLOCK_SIZES.filter(
    (size) => size <= remaining && remaining - size !== 3,
  );
  if (candidates.length === 0) {
    throw new Error(
      `Cannot complete a schedule with ${remaining} slots remaining.`,
    );
  }
  return candidates[randomInteger(candidates.length)];
}

export function generateSchedule({
  randomizationVersion = DEFAULT_RANDOMIZATION_VERSION,
  totalSlots = DEFAULT_TOTAL_SLOTS,
  generatedAt = new Date().toISOString(),
  randomInteger = randomInt,
} = {}) {
  if (
    !Number.isSafeInteger(totalSlots)
    || totalSlots <= 0
    || totalSlots % FORMATS.length !== 0
  ) {
    throw new Error("totalSlots must be a positive multiple of 3.");
  }
  if (totalSlots < Math.min(...ALLOWED_BLOCK_SIZES)) {
    throw new Error("totalSlots is too small for the allowed block sizes.");
  }
  if (!/^[a-z0-9][a-z0-9._-]{4,127}$/i.test(randomizationVersion)) {
    throw new Error("randomizationVersion has an invalid format.");
  }

  const slots = [];
  let remaining = totalSlots;
  let blockNumber = 0;

  while (remaining > 0) {
    const blockSize = chooseBlockSize(remaining, randomInteger);
    const repetitions = blockSize / FORMATS.length;
    const formats = shuffle(
      FORMATS.flatMap((format) =>
        Array.from({ length: repetitions }, () => format)
      ),
      randomInteger,
    );
    blockNumber += 1;
    const blockId = `B${String(blockNumber).padStart(4, "0")}`;

    for (let blockIndex = 0; blockIndex < formats.length; blockIndex += 1) {
      slots.push({
        position: slots.length + 1,
        block_id: blockId,
        block_size: blockSize,
        block_position: blockIndex + 1,
        format_assignment: formats[blockIndex],
      });
    }
    remaining -= blockSize;
  }

  const schedule = {
    schema_version: SCHEDULE_SCHEMA_VERSION,
    generator_version: GENERATOR_VERSION,
    randomization_version: randomizationVersion,
    generated_at: generatedAt,
    total_slots: totalSlots,
    allowed_block_sizes: [...ALLOWED_BLOCK_SIZES],
    slots,
  };
  return {
    ...schedule,
    schedule_sha256: calculateScheduleSha256(schedule),
  };
}

export function validateSchedule(schedule, {
  expectedTotalSlots = DEFAULT_TOTAL_SLOTS,
  expectedRandomizationVersion = DEFAULT_RANDOMIZATION_VERSION,
} = {}) {
  const errors = [];
  if (!schedule || typeof schedule !== "object") {
    return { valid: false, errors: ["Schedule must be a JSON object."] };
  }
  if (schedule.schema_version !== SCHEDULE_SCHEMA_VERSION) {
    errors.push(`schema_version must be ${SCHEDULE_SCHEMA_VERSION}.`);
  }
  if (schedule.generator_version !== GENERATOR_VERSION) {
    errors.push(`generator_version must be '${GENERATOR_VERSION}'.`);
  }
  if (schedule.randomization_version !== expectedRandomizationVersion) {
    errors.push(
      `randomization_version must be '${expectedRandomizationVersion}'.`,
    );
  }
  if (schedule.total_slots !== expectedTotalSlots) {
    errors.push(`total_slots must be ${expectedTotalSlots}.`);
  }
  if (
    canonicalJson(schedule.allowed_block_sizes)
    !== canonicalJson(ALLOWED_BLOCK_SIZES)
  ) {
    errors.push("allowed_block_sizes must be exactly [6,9,12].");
  }
  if (!Array.isArray(schedule.slots)) {
    errors.push("slots must be an array.");
    return { valid: false, errors };
  }
  if (schedule.slots.length !== schedule.total_slots) {
    errors.push("slots length must equal total_slots.");
  }

  const formatCounts = Object.fromEntries(FORMATS.map((format) => [format, 0]));
  const blocks = new Map();

  schedule.slots.forEach((slot, slotIndex) => {
    const expectedPosition = slotIndex + 1;
    if (slot.position !== expectedPosition) {
      errors.push(`Slot ${slotIndex + 1} has a non-contiguous position.`);
    }
    if (!FORMATS.includes(slot.format_assignment)) {
      errors.push(`Slot ${slot.position} has an invalid format.`);
    } else {
      formatCounts[slot.format_assignment] += 1;
    }
    if (!ALLOWED_BLOCK_SIZES.includes(slot.block_size)) {
      errors.push(`Slot ${slot.position} has an invalid block_size.`);
    }
    const block = blocks.get(slot.block_id) ?? [];
    block.push(slot);
    blocks.set(slot.block_id, block);
  });

  const expectedPerFormat = expectedTotalSlots / FORMATS.length;
  FORMATS.forEach((format) => {
    if (formatCounts[format] !== expectedPerFormat) {
      errors.push(
        `${format} count must be ${expectedPerFormat}, found ${formatCounts[format]}.`,
      );
    }
  });

  let expectedBlockNumber = 1;
  for (const [blockId, blockSlots] of blocks) {
    const expectedBlockId = `B${String(expectedBlockNumber).padStart(4, "0")}`;
    if (blockId !== expectedBlockId) {
      errors.push(`Expected block '${expectedBlockId}', found '${blockId}'.`);
    }
    const blockSize = blockSlots[0]?.block_size;
    if (
      !ALLOWED_BLOCK_SIZES.includes(blockSize)
      || blockSlots.length !== blockSize
    ) {
      errors.push(`Block '${blockId}' has an inconsistent size.`);
    }
    const blockCounts = Object.fromEntries(
      FORMATS.map((format) => [format, 0]),
    );
    blockSlots.forEach((slot, blockIndex) => {
      if (slot.block_size !== blockSize) {
        errors.push(`Block '${blockId}' mixes block sizes.`);
      }
      if (slot.block_position !== blockIndex + 1) {
        errors.push(`Block '${blockId}' has non-contiguous positions.`);
      }
      if (FORMATS.includes(slot.format_assignment)) {
        blockCounts[slot.format_assignment] += 1;
      }
    });
    FORMATS.forEach((format) => {
      if (blockCounts[format] !== blockSize / FORMATS.length) {
        errors.push(`Block '${blockId}' is not balanced for ${format}.`);
      }
    });
    expectedBlockNumber += 1;
  }

  const calculatedHash = calculateScheduleSha256(schedule);
  if (schedule.schedule_sha256 !== calculatedHash) {
    errors.push("schedule_sha256 does not match the schedule contents.");
  }

  return {
    valid: errors.length === 0,
    errors,
    summary: {
      total_slots: schedule.slots.length,
      format_counts: formatCounts,
      block_count: blocks.size,
      schedule_sha256: calculatedHash,
    },
  };
}

export function publicScheduleMetadata(schedule) {
  const validation = validateSchedule(schedule, {
    expectedTotalSlots: schedule.total_slots,
    expectedRandomizationVersion: schedule.randomization_version,
  });
  if (!validation.valid) {
    throw new Error(
      `Cannot publish invalid schedule metadata:\n${validation.errors.join("\n")}`,
    );
  }
  return {
    randomization_version: schedule.randomization_version,
    schedule_sha256: schedule.schedule_sha256,
  };
}
