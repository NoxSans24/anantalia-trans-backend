import { checkTestDatabase } from '../../connection-check.mjs';
import { getTestDatabaseConfig } from './setup/database-setup.js';

try {
  const { target } = getTestDatabaseConfig();
  await checkTestDatabase();
  process.stdout.write(`Database test target authorized and SQL preflight verified: ${target}\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
