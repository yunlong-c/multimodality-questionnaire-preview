import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");

async function source(...segments: string[]): Promise<string> {
  return readFile(path.join(repositoryRoot, ...segments), "utf8");
}

test("authoritative answer migration is append-only and separates conflicts", async () => {
  const migration = await source(
    "netlify",
    "database",
    "schema-migrations",
    "0002_create_authoritative_submissions.sql",
  );

  assert.match(migration, /CREATE TABLE mmq_submissions/);
  assert.match(migration, /session_id TEXT NOT NULL UNIQUE/);
  assert.match(migration, /payload_json TEXT NOT NULL/);
  assert.match(migration, /assigned_at TIMESTAMPTZ/);
  assert.match(migration, /fallback_reason_code TEXT/);
  assert.match(migration, /fallback_reconciled_at TIMESTAMPTZ/);
  assert.match(migration, /CREATE TABLE mmq_submission_conflicts/);
  assert.match(migration, /attempted_payload_sha256 TEXT NOT NULL/);
  assert.doesNotMatch(
    migration,
    /mmq_submission_conflicts[\s\S]*attempted_payload_json/i,
  );
});

test("the authoritative row and Forms outbox are created in one transaction", async () => {
  const implementation = await source(
    "netlify",
    "functions",
    "_lib",
    "submission-database.mts",
  );

  assert.match(implementation, /client\.query\("BEGIN"\)/);
  assert.match(implementation, /pg_advisory_xact_lock/);
  assert.match(implementation, /INSERT INTO mmq_submissions/);
  assert.match(
    implementation,
    /INSERT INTO mmq_submission_form_mirrors/,
  );
  assert.match(implementation, /client\.query\("COMMIT"\)/);
  assert.match(implementation, /client\.query\("ROLLBACK"\)/);
  assert.match(
    implementation,
    /existing\.payload_sha256 === input\.payloadSha256/,
  );
});

test("formal submissions are verified against allocation and session ledgers", async () => {
  const implementation = await source(
    "netlify",
    "functions",
    "_lib",
    "submission-database.mts",
  );

  assert.match(implementation, /mmq_randomization_sessions/);
  assert.match(implementation, /mmq_randomization_assignments/);
  assert.match(implementation, /row\.token_hmac !== input\.clientTokenHmac/);
  assert.match(
    implementation,
    /row\.format_assignment !== input\.formatAssignment/,
  );
  assert.match(
    implementation,
    /row\.randomization_version !== input\.randomizationVersion/,
  );
  assert.match(
    implementation,
    /row\.fallback_reason_code \?\? null/,
  );
  assert.match(
    implementation,
    /input\.fallbackReconciledAt/,
  );
});

test("submission and scheduled mirror functions expose the intended contracts", async () => {
  const submit = await source(
    "netlify",
    "functions",
    "submit.mts",
  );
  const scheduled = await source(
    "netlify",
    "functions",
    "submission-form-mirror.mts",
  );

  assert.match(submit, /path: "\/api\/submit"/);
  assert.match(submit, /method: "POST"/);
  assert.match(submit, /aggregateBy: \["domain", "ip"\]/);
  assert.match(scheduled, /schedule: "0 \*\/2 \* \* \*"/);
});

test("Forms status is named accepted and never overstated as verified", async () => {
  const mirror = await source(
    "netlify",
    "functions",
    "_lib",
    "submission-mirror.mts",
  );
  assert.match(mirror, /state = 'accepted'/);
  assert.doesNotMatch(mirror, /state = 'verified'/);
  assert.match(mirror, /FOR UPDATE OF mirror SKIP LOCKED/);
  assert.match(mirror, /lease_expires_at/);
});
