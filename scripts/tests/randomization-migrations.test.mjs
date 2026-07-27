import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertNativeMigrationDirectoryEmpty,
  canonicalizeMigrationSql,
  loadSchemaMigrations,
  migrationSha256,
  verifyAppliedMigration,
} from "../randomization/apply-schema-migrations.mjs";

test("schema migrations are loaded in deterministic filename order", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "mmq-schema-migrations-"),
  );
  await writeFile(path.join(directory, "0002_second.sql"), "SELECT 2;\n");
  await writeFile(path.join(directory, "0001_first.sql"), "SELECT 1;\n");

  const migrations = await loadSchemaMigrations(directory);

  assert.deepEqual(
    migrations.map((migration) => migration.name),
    ["0001_first", "0002_second"],
  );
  assert.equal(migrations[0].sha256, migrationSha256("SELECT 1;\n"));
});

test("migration hashes use canonical UTF-8 LF content", () => {
  assert.equal(
    migrationSha256("\uFEFFSELECT 1;\r\n"),
    migrationSha256("SELECT 1;\n"),
  );
  assert.equal(
    canonicalizeMigrationSql("\uFEFFSELECT 1;\rSELECT 2;\r\n"),
    "SELECT 1;\nSELECT 2;\n",
  );
});

test("a migration cannot be edited after its hash is recorded", () => {
  const migration = {
    name: "0001_first",
    sha256: migrationSha256("SELECT 1;\n"),
  };

  assert.equal(verifyAppliedMigration(undefined, migration), "apply");
  assert.equal(
    verifyAppliedMigration(
      { migration_name: migration.name, sha256: migration.sha256 },
      migration,
    ),
    "skip",
  );
  assert.throws(
    () => verifyAppliedMigration(
      { migration_name: migration.name, sha256: "0".repeat(64) },
      migration,
    ),
    /changed after it was applied/,
  );
});

test("unexpected files are rejected instead of silently ignored", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "mmq-schema-migrations-invalid-"),
  );
  await writeFile(path.join(directory, "notes.txt"), "not a migration");

  await assert.rejects(
    loadSchemaMigrations(directory),
    /Invalid schema migration filename/,
  );
});

test("the native migration directory must remain absent or empty", async () => {
  const emptyDirectory = await mkdtemp(
    path.join(os.tmpdir(), "mmq-native-migrations-empty-"),
  );
  await assert.doesNotReject(
    assertNativeMigrationDirectoryEmpty(emptyDirectory),
  );

  await writeFile(path.join(emptyDirectory, "0001_conflict.sql"), "SELECT 1;");
  await assert.rejects(
    assertNativeMigrationDirectoryEmpty(emptyDirectory),
    /native migration directory must stay empty/,
  );
});
