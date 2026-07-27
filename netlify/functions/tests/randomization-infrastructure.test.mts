import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");

test("migration keeps schedules private and sessions separate from assignments", async () => {
  const migration = await readFile(
    path.join(
      repositoryRoot,
      "netlify",
      "database",
      "migrations",
      "0001_create_randomization_ledger.sql",
    ),
    "utf8",
  );

  assert.match(migration, /CREATE TABLE mmq_randomization_schedules/);
  assert.match(migration, /CREATE TABLE mmq_randomization_slots/);
  assert.match(migration, /CREATE TABLE mmq_randomization_assignments/);
  assert.match(migration, /CREATE TABLE mmq_randomization_sessions/);
  assert.match(
    migration,
    /allocation_method IN \('variable_block', 'client_fallback'\)/,
  );
  assert.doesNotMatch(migration, /INSERT INTO mmq_randomization_slots/i);
});

test("database allocator uses a transaction, advisory lock, and locked next slot", async () => {
  const implementation = await readFile(
    path.join(
      repositoryRoot,
      "netlify",
      "functions",
      "_lib",
      "randomization-database.mts",
    ),
    "utf8",
  );

  assert.match(implementation, /client\.query\("BEGIN"\)/);
  assert.match(implementation, /pg_advisory_xact_lock/);
  assert.match(
    implementation,
    /schedule\.schedule_sha256 !== scheduleSha256[\s\S]*throw scheduleMismatch\(\)/,
  );
  assert.match(
    implementation,
    /ORDER BY position\s+LIMIT 1\s+FOR UPDATE/,
  );
  assert.match(implementation, /client\.query\("COMMIT"\)/);
  assert.match(implementation, /client\.query\("ROLLBACK"\)/);
});

test("API entrypoints are POST-only and use non-overlapping paths", async () => {
  const allocate = await readFile(
    path.join(repositoryRoot, "netlify", "functions", "allocate.mts"),
    "utf8",
  );
  const reconcile = await readFile(
    path.join(
      repositoryRoot,
      "netlify",
      "functions",
      "allocate-reconcile.mts",
    ),
    "utf8",
  );

  assert.match(allocate, /path: "\/api\/allocate"/);
  assert.match(reconcile, /path: "\/api\/allocate\/reconcile"/);
  assert.match(allocate, /method: "POST"/);
  assert.match(reconcile, /method: "POST"/);
  for (const entrypoint of [allocate, reconcile]) {
    assert.match(entrypoint, /aggregateBy: \["domain", "ip"\]/);
    assert.match(entrypoint, /windowSize: 60/);
    assert.match(entrypoint, /windowLimit: 300/);
  }
});
