const FORMATS = ["table", "graph", "video"];
const METHODS = ["variable_block", "client_fallback"];

function emptyCounts(keys) {
  return Object.fromEntries(keys.map((key) => [key, 0]));
}

export function selectEffectiveAssignments(assignments) {
  const byToken = new Map();
  for (const assignment of assignments) {
    const current = byToken.get(assignment.token_hmac);
    if (
      !current
      || (
        current.allocation_method === "variable_block"
        && assignment.allocation_method === "client_fallback"
      )
    ) {
      byToken.set(assignment.token_hmac, assignment);
    }
  }
  return [...byToken.values()];
}

export function longestFallbackRun(assignments) {
  const ordered = [...assignments].sort((left, right) =>
    String(left.assigned_at).localeCompare(String(right.assigned_at))
    || String(left.allocation_id).localeCompare(String(right.allocation_id))
  );
  let current = 0;
  let longest = 0;
  for (const assignment of ordered) {
    if (assignment.allocation_method === "client_fallback") {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

export function summarizeLedger({
  schedule,
  assignments,
  sessions,
  exportedAt = new Date().toISOString(),
}) {
  const effectiveAssignments = selectEffectiveAssignments(assignments);
  const formatCounts = emptyCounts(FORMATS);
  const methodCounts = emptyCounts(METHODS);
  for (const assignment of effectiveAssignments) {
    if (assignment.format_assignment in formatCounts) {
      formatCounts[assignment.format_assignment] += 1;
    }
    if (assignment.allocation_method in methodCounts) {
      methodCounts[assignment.allocation_method] += 1;
    }
  }
  const effectiveStarted = effectiveAssignments.length;
  const fallbackCount = methodCounts.client_fallback;
  const fallbackRate = effectiveStarted === 0
    ? 0
    : fallbackCount / effectiveStarted;
  const consecutiveFallbackMaximum =
    longestFallbackRun(effectiveAssignments);
  const scheduledSlotsAssigned = assignments.filter(
    (assignment) => assignment.allocation_method === "variable_block",
  ).length;

  return {
    schema_version: 1,
    exported_at: exportedAt,
    randomization_version: schedule.randomization_version,
    schedule_sha256: schedule.schedule_sha256,
    schedule_status: schedule.status,
    schedule_total_slots: Number(schedule.total_slots),
    scheduled_slots_assigned: scheduledSlotsAssigned,
    scheduled_slots_remaining:
      Number(schedule.total_slots) - scheduledSlotsAssigned,
    effective_started_identities: effectiveStarted,
    effective_format_counts: formatCounts,
    effective_allocation_method_counts: methodCounts,
    raw_assignment_records: assignments.length,
    session_records: sessions.length,
    fallback_rate: fallbackRate,
    fallback_rate_percent: Number((fallbackRate * 100).toFixed(4)),
    consecutive_fallback_maximum: consecutiveFallbackMaximum,
    fallback_alert:
      fallbackRate > 0.01 || consecutiveFallbackMaximum >= 3,
    interpretation: {
      assigned_is_not_submitted: true,
      note:
        "This database records allocation starts, not completed Netlify Forms submissions. Join locally on allocation_id, participant_id, or session_id before reporting submitted counts.",
    },
  };
}

function csvCell(value) {
  if (value === null || value === undefined) return "";
  const text = value instanceof Date ? value.toISOString() : String(value);
  return /[",\r\n]/.test(text)
    ? `"${text.replaceAll('"', '""')}"`
    : text;
}

export function rowsToCsv(rows, columns) {
  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(columns.map((column) => csvCell(row[column])).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}
