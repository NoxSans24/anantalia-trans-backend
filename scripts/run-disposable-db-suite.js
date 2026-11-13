import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAuthorizedTestDatabase } from '../src/config/prisma-migration-safety.js';
import { createTestDatabase, dropTestDatabase } from '../tests/integration/setup/database-setup.js';
import { checkTestDatabase } from '../connection-check.mjs';

function runCommand(command, args, env) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env,
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', (error) => rejectPromise(error));
    child.once('close', (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`Command ${args.join(' ')} exited with status ${code}`));
    });
  });
}

export async function runDisposableDbSuite({ env = process.env, keepDatabase = false } = {}) {
  const authorized = getAuthorizedTestDatabase(env);
  let createdHere = false;
  try {
    try {
      await createTestDatabase({ env });
      createdHere = true;
    } catch {
      await checkTestDatabase({ env });
      await runCommand(process.execPath, ['scripts/prisma-migrate-test.js'], env);
    }

    await checkTestDatabase({ env });
    const integrationFiles = readdirSync(resolve(process.cwd(), 'tests/integration'))
      .filter((name) => name.endsWith('.test.js'))
      .sort()
      .map((name) => `tests/integration/${name}`);

    await runCommand(process.execPath, ['--test', '--test-concurrency=1', ...integrationFiles], env);
  } finally {
    if (createdHere && !keepDatabase) {
      await dropTestDatabase(authorized.databaseName, { env });
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const keepDatabase = process.argv.includes('--keep-db');
    await runDisposableDbSuite({ keepDatabase });
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
