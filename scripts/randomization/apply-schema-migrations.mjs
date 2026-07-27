import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { getConnectionString, getDatabase } from "@netlify/database";

const MIGRATION_NAME_PATTERN = /^\d+_[a-z0-9_-]+\.sql$/;
const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const nativeMigrationsDirectory = path.join(
  repositoryRoot,
  "netlify",
  "database",
  "migrations",
);

export const defaultSchemaMigrationsDirectory = path.join(
  repositoryRoot,
  "netlify",
  "database",
  "schema-migrations",
);

export function canonicalizeMigrationSql(sql) {
  return sql.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

export function migrationSha256(sql) {
  return createHash("sha256")
    .update(canonicalizeMigrationSql(sql), "utf8")
    .digest("hex");
}

export async function assertNativeMigrationDirectoryEmpty(
  directory = nativeMigrationsDirectory,
) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return;
    }
    throw error;
  }

  const unexpected = entries.filter(
    (entry) => entry.isFile() || entry.isDirectory(),
  );
  if (unexpected.length !== 0) {
    throw new Error(
      "Netlify's native migration directory must stay empty while the guarded schema runner is enabled.",
    );
  }
}

export async function loadSchemaMigrations(
  directory = defaultSchemaMigrationsDirectory,
) {
  const entries = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, "en"));

  const invalid = entries.filter(
    (filename) => !MIGRATION_NAME_PATTERN.test(filename),
  );
  if (invalid.length !== 0) {
    throw new Error(
      `Invalid schema migration filename(s): ${invalid.join(", ")}`,
    );
  }

  return Promise.all(
    entries.map(async (filename) => {
      const sql = canonicalizeMigrationSql(
        await readFile(path.join(directory, filename), "utf8"),
      );
      return {
        name: filename.replace(/\.sql$/, ""),
        sha256: migrationSha256(sql),
        sql,
      };
    }),
  );
}

export function verifyAppliedMigration(applied, migration) {
  if (!applied) {
    return "apply";
  }
  if (applied.sha256 !== migration.sha256) {
    throw new Error(
      `Schema migration '${migration.name}' was changed after it was applied.`,
    );
  }
  return "skip";
}

function resolveConnectionString() {
  const explicit = process.env.MMQ_MIGRATION_DATABASE_URL?.trim();
  if (process.env.NETLIFY === "true" && explicit) {
    throw new Error(
      "MMQ_MIGRATION_DATABASE_URL must not be set on Netlify; the deploy-specific database branch must be selected automatically.",
    );
  }
  if (explicit) {
    return explicit;
  }
  return getConnectionString();
}

export async function applySchemaMigrations({
  directory = defaultSchemaMigrationsDirectory,
  connectionString = resolveConnectionString(),
  buildId = process.env.BUILD_ID?.trim() || "unknown",
  deployContext = process.env.CONTEXT?.trim() || "unknown",
  branch = process.env.BRANCH?.trim() || "unknown",
} = {}) {
  await assertNativeMigrationDirectoryEmpty();
  const migrations = await loadSchemaMigrations(directory);
  if (migrations.length === 0) {
    throw new Error("No schema migrations were found.");
  }

  const { pool } = getDatabase({ connectionString });
  const client = await pool.connect();
  const appliedNames = [];
  const skippedNames = [];
  const parsedConnection = new URL(connectionString);
  const databaseFingerprint = createHash("sha256")
    .update(
      `${parsedConnection.hostname.toLowerCase()}${parsedConnection.pathname}`,
      "utf8",
    )
    .digest("hex");

  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '10s'");
    await client.query("SET LOCAL statement_timeout = '60s'");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      ["mmq-schema-migrations-v1"],
    );
    await client.query(`
      CREATE TABLE IF NOT EXISTS mmq_schema_migrations (
        migration_name TEXT PRIMARY KEY,
        sha256 TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
        build_id TEXT NOT NULL,
        deploy_context TEXT NOT NULL,
        branch TEXT NOT NULL,
        database_fingerprint TEXT NOT NULL
          CHECK (database_fingerprint ~ '^[0-9a-f]{64}$'),
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    for (const migration of migrations) {
      const existingResult = await client.query(
        `SELECT migration_name, sha256
           FROM mmq_schema_migrations
          WHERE migration_name = $1
          FOR UPDATE`,
        [migration.name],
      );
      const decision = verifyAppliedMigration(
        existingResult.rows[0],
        migration,
      );
      if (decision === "skip") {
        skippedNames.push(migration.name);
        continue;
      }

      await client.query(migration.sql);
      await client.query(
        `INSERT INTO mmq_schema_migrations (
           migration_name,
           sha256,
           build_id,
           deploy_context,
           branch,
           database_fingerprint
         ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          migration.name,
          migration.sha256,
          buildId,
          deployContext,
          branch,
          databaseFingerprint,
        ],
      );
      appliedNames.push(migration.name);
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }

  return {
    applied: appliedNames,
    skipped: skippedNames,
    database_fingerprint: databaseFingerprint,
  };
}

async function main() {
  if (
    process.env.NETLIFY !== "true"
    && !process.env.MMQ_MIGRATION_DATABASE_URL?.trim()
  ) {
    console.log(
      "Skipping remote schema migrations outside Netlify; set MMQ_MIGRATION_DATABASE_URL for an explicit target.",
    );
    return;
  }

  const result = await applySchemaMigrations();
  console.log(JSON.stringify({
    schema_migrations_applied: result.applied,
    schema_migrations_skipped: result.skipped,
    database_fingerprint: result.database_fingerprint,
  }));
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await main();
}
