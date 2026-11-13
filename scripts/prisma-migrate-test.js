import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkTestDatabase } from '../connection-check.mjs';
import { getAuthorizedTestDatabase } from '../src/config/prisma-migration-safety.js';
import { createTestPgClient } from '../tests/integration/setup/database-setup.js';

async function applyVerifiedMigrationsWithPg({ env = process.env } = {}) {
  const client = await createTestPgClient({ env });
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
        "id" VARCHAR(36) PRIMARY KEY,
        "checksum" VARCHAR(64) NOT NULL,
        "finished_at" TIMESTAMPTZ,
        "migration_name" VARCHAR(255) NOT NULL,
        "logs" TEXT,
        "rolled_back_at" TIMESTAMPTZ,
        "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "applied_steps_count" INTEGER NOT NULL DEFAULT 0
      )
    `);

    const migrationsRoot = resolve(process.cwd(), 'prisma/migrations');
    const entries = readdirSync(migrationsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));

    for (const migrationName of entries) {
      const sqlPath = join(migrationsRoot, migrationName, 'migration.sql');
      if (!existsSync(sqlPath)) continue;
      const existing = await client.query(
        'SELECT "id" FROM "_prisma_migrations" WHERE "migration_name" = $1 AND "finished_at" IS NOT NULL',
        [migrationName],
      );
      if (existing.rows.length > 0) {
        process.stdout.write(`Migration already applied: ${migrationName}\n`);
        continue;
      }

      const sql = readFileSync(sqlPath, 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          `INSERT INTO "_prisma_migrations" ("id", "checksum", "finished_at", "migration_name", "applied_steps_count")
           VALUES ($1, $2, now(), $3, 1)`,
          [randomUUID(), checksum, migrationName],
        );
        await client.query('COMMIT');
        process.stdout.write(`Applied migration: ${migrationName}\n`);
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      }
    }
  } finally {
    await client.end().catch(() => {});
  }
}

export function runPrismaMigrationTest({ env = process.env, spawnProcess = spawn, preflight = checkTestDatabase } = {}) {
  const authorized = getAuthorizedTestDatabase(env);
  return Promise.resolve()
    .then(() => preflight({ env }))
    .then(() => {
      const parsedUrl = new URL(authorized.connectionString);
      if (spawnProcess === spawn && !parsedUrl.password) {
        return applyVerifiedMigrationsWithPg({ env });
      }
      return new Promise((resolvePromise, rejectPromise) => {
        const child = spawnProcess(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
          cwd: process.cwd(),
          env: { ...env, NODE_ENV: 'test' },
          stdio: 'inherit',
          windowsHide: true,
        });
        child.once('error', () => rejectPromise(new Error('Prisma migration test process could not start')));
        child.once('close', (code) => code === 0 ? resolvePromise() : rejectPromise(new Error(`Prisma migration test exited with status ${code}`)));
      });
    });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await runPrismaMigrationTest();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
