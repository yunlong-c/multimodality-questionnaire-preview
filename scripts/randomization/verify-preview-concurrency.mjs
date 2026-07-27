import { randomUUID } from "node:crypto";
import process from "node:process";

const CATALOG_HASH =
  "e435368f72846b356aa2f5106b47dfe1c35dbc65012125eefa199ed53e93a7ec";
const STIMULUS_SET_VERSION = "mmq-stimuli-2026-07-r1";

function optionValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

function positiveInteger(name, fallback) {
  const parsed = Number.parseInt(optionValue(name, String(fallback)), 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

const baseUrl = optionValue("--base-url");
if (!baseUrl) {
  throw new Error("--base-url is required.");
}
if (!process.argv.includes("--confirm-consumes-preview-slots")) {
  throw new Error(
    "This test consumes real preview allocation positions. "
      + "Pass --confirm-consumes-preview-slots to continue.",
  );
}

const parsedBaseUrl = new URL(baseUrl);
if (
  parsedBaseUrl.protocol !== "https:"
  || !parsedBaseUrl.hostname.endsWith(".netlify.app")
  || !(
    parsedBaseUrl.hostname.startsWith("deploy-preview-")
    || /^[0-9a-f]{24}--/.test(parsedBaseUrl.hostname)
  )
) {
  throw new Error(
    "The concurrency verifier only accepts a Netlify Deploy Preview URL.",
  );
}

const sameTokenRequests = positiveInteger("--same-token", 100);
const uniqueTokenRequests = positiveInteger("--unique-tokens", 100);
const endpoint = new URL("/api/allocate", parsedBaseUrl);

function percentile(sortedValues, proportion) {
  return sortedValues[
    Math.min(
      sortedValues.length - 1,
      Math.floor((sortedValues.length - 1) * proportion),
    )
  ];
}

function latencySummary(results) {
  const sorted = results.map((result) => result.durationMs).sort((a, b) => a - b);
  return {
    p50: Math.round(percentile(sorted, 0.5)),
    p95: Math.round(percentile(sorted, 0.95)),
    max: Math.round(sorted.at(-1)),
  };
}

function statusCounts(results) {
  return Object.fromEntries(
    [...new Set(results.map((result) => result.status))]
      .sort((a, b) => a - b)
      .map((status) => [
        status,
        results.filter((result) => result.status === status).length,
      ]),
  );
}

function errorCodeCounts(results) {
  const codes = results
    .filter((result) => result.status !== 200)
    .map((result) => result.body?.error?.code ?? "UNKNOWN_ERROR");
  return Object.fromEntries(
    [...new Set(codes)].sort().map((code) => [
      code,
      codes.filter((candidate) => candidate === code).length,
    ]),
  );
}

async function allocate(clientToken, sessionId) {
  const startedAt = performance.now();
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        client_token: clientToken,
        session_id: sessionId,
        catalog_hash: CATALOG_HASH,
        stimulus_set_version: STIMULUS_SET_VERSION,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const body = await response.json();
    return {
      status: response.status,
      body,
      durationMs: performance.now() - startedAt,
    };
  } catch (error) {
    return {
      status: 0,
      body: {
        error: {
          code: error instanceof Error ? error.name : "UNKNOWN_ERROR",
        },
      },
      durationMs: performance.now() - startedAt,
    };
  }
}

const sameClientToken = `preview-same-client-${randomUUID()}`;
const sameResults = await Promise.all(
  Array.from({ length: sameTokenRequests }, (_, index) =>
    allocate(
      sameClientToken,
      `preview-same-session-${index}-${randomUUID()}`,
    )),
);
const sameSuccesses = sameResults.filter((result) => result.status === 200);

const uniqueResults = await Promise.all(
  Array.from({ length: uniqueTokenRequests }, (_, index) =>
    allocate(
      `preview-unique-client-${index}-${randomUUID()}`,
      `preview-unique-session-${index}-${randomUUID()}`,
    )),
);
const uniqueSuccesses = uniqueResults.filter((result) => result.status === 200);

const sameAllocationIds = new Set(
  sameSuccesses.map((result) => result.body.allocation_id),
);
const sameParticipantIds = new Set(
  sameSuccesses.map((result) => result.body.participant_id),
);
const sameFormats = new Set(
  sameSuccesses.map((result) => result.body.format_assignment),
);
const uniqueAllocationIds = new Set(
  uniqueSuccesses.map((result) => result.body.allocation_id),
);
const uniqueParticipantIds = new Set(
  uniqueSuccesses.map((result) => result.body.participant_id),
);
const uniqueFormatCounts = Object.fromEntries(
  ["table", "graph", "video"].map((format) => [
    format,
    uniqueSuccesses.filter(
      (result) => result.body.format_assignment === format,
    ).length,
  ]),
);

const failures = [];
if (sameSuccesses.length !== sameTokenRequests) {
  failures.push("Not every same-token request succeeded.");
}
if (sameAllocationIds.size !== 1 || sameParticipantIds.size !== 1) {
  failures.push("Concurrent requests for one token created multiple assignments.");
}
if (sameFormats.size !== 1) {
  failures.push("Concurrent requests for one token returned different formats.");
}
if (
  sameSuccesses.filter((result) => result.body.is_returning === false).length
  !== 1
) {
  failures.push("The same-token batch did not issue exactly one new assignment.");
}
if (uniqueSuccesses.length !== uniqueTokenRequests) {
  failures.push("Not every unique-token request succeeded.");
}
if (
  uniqueAllocationIds.size !== uniqueTokenRequests
  || uniqueParticipantIds.size !== uniqueTokenRequests
) {
  failures.push("Unique-token requests did not receive unique assignments.");
}
if (
  [...sameSuccesses, ...uniqueSuccesses].some(
    (result) =>
      result.body.allocation_method !== "variable_block"
      || result.body.allocation_status !== "confirmed",
  )
) {
  failures.push("A successful preview request returned a non-confirmed allocation.");
}

console.log(JSON.stringify({
  base_url: parsedBaseUrl.origin,
  same_token: {
    requests: sameResults.length,
    successful: sameSuccesses.length,
    status_counts: statusCounts(sameResults),
    error_code_counts: errorCodeCounts(sameResults),
    distinct_allocation_ids: sameAllocationIds.size,
    distinct_participant_ids: sameParticipantIds.size,
    distinct_formats: [...sameFormats],
    first_issue_count: sameSuccesses.filter(
      (result) => result.body.is_returning === false,
    ).length,
    returning_count: sameSuccesses.filter(
      (result) => result.body.is_returning === true,
    ).length,
    latency_ms: latencySummary(sameResults),
  },
  unique_tokens: {
    requests: uniqueResults.length,
    successful: uniqueSuccesses.length,
    status_counts: statusCounts(uniqueResults),
    error_code_counts: errorCodeCounts(uniqueResults),
    distinct_allocation_ids: uniqueAllocationIds.size,
    distinct_participant_ids: uniqueParticipantIds.size,
    format_counts: uniqueFormatCounts,
    latency_ms: latencySummary(uniqueResults),
  },
  passed: failures.length === 0,
  failures,
}, null, 2));

if (failures.length !== 0) {
  process.exitCode = 1;
}
