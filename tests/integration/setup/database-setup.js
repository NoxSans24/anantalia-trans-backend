import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import pg from 'pg';
import { getAuthorizedTestDatabase, getTestServerIdentityMismatches } from '../../../src/config/prisma-migration-safety.js';

const execFileAsync = promisify(execFile);
const createdDatabases = new Map();
function fail() {
  throw new Error('Database tests require an explicitly authorized disposable TEST_DATABASE_URL');
}

export function getTestDatabaseConfig(env = process.env) {
  try { return getAuthorizedTestDatabase(env); } catch { fail(); }
}

async function assertPgIdentity(client, config, databaseName) {
  let identity;
  try {
    const result = await client.query('SELECT current_database() AS database_name, current_user AS role_name, inet_server_addr()::text AS server_address, inet_server_port() AS server_port');
    identity = result.rows[0];
  } catch {
    fail();
  }
  const mismatches = getTestServerIdentityMismatches(identity, config, { expectedDatabase: databaseName });
  if (!identity || mismatches.length > 0) fail();
}

export async function createTestPrismaClient({ env = process.env, clientFactory } = {}) {
  const config = getTestDatabaseConfig(env);
  let prisma;
  try {
    const createClient = clientFactory ?? (await import('../../../src/lib/prisma.js')).createPrismaClient;
    prisma = createClient(config.connectionString);
    const [identity] = await prisma.$queryRaw`SELECT current_database() AS database_name, current_user AS role_name, inet_server_addr()::text AS server_address, inet_server_port() AS server_port`;
    const mismatches = getTestServerIdentityMismatches(identity, config, { expectedDatabase: config.databaseName });
    if (!identity || mismatches.length > 0) fail();
    return prisma;
  } catch {
    await prisma?.$disconnect?.().catch(() => {});
    fail();
  }
}

export async function createTestPgClient({ env = process.env, Client = pg.Client } = {}) {
  const config = getTestDatabaseConfig(env);
  let client;
  try {
    client = new Client({ connectionString: config.connectionString });
    await client.connect();
    await assertPgIdentity(client, config, config.databaseName);
    return client;
  } catch {
    await client?.end().catch(() => {});
    fail();
  }
}

export async function createTestDatabase({ env = process.env, Client = pg.Client, runMigrations = execFileAsync } = {}) {
  const config = getTestDatabaseConfig(env);
  if (createdDatabases.has(config.databaseName)) fail();

  const adminUrl = new URL(config.connectionString);
  adminUrl.pathname = '/postgres';
  let client;
  try {
    client = new Client({ connectionString: adminUrl.toString() });
    await client.connect();
    await assertPgIdentity(client, config, 'postgres');
    await client.query(`CREATE DATABASE "${config.databaseName}"`);
    createdDatabases.set(config.databaseName, config.target);
  } catch {
    await client?.end().catch(() => {});
    fail();
  }
  await client.end().catch(() => {});

  try {
    await runMigrations(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
      cwd: process.cwd(),
      env: { ...env, NODE_ENV: 'test' },
      windowsHide: true,
    });
    const prisma = await createTestPrismaClient({ env });
    await prisma.$disconnect();
    return config.connectionString;
  } catch {
    await dropTestDatabase(config.databaseName, { env, Client });
    fail();
  }
}

export async function dropTestDatabase(databaseName, { env = process.env, Client = pg.Client } = {}) {
  const config = getTestDatabaseConfig(env);
  if (databaseName !== config.databaseName || createdDatabases.get(databaseName) !== config.target) fail();

  const adminUrl = new URL(config.connectionString);
  adminUrl.pathname = '/postgres';
  let client;
  try {
    client = new Client({ connectionString: adminUrl.toString() });
    await client.connect();
    await assertPgIdentity(client, config, 'postgres');
    await client.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
      [databaseName],
    );
    await client.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
    createdDatabases.delete(databaseName);
  } catch {
    fail();
  } finally {
    await client?.end().catch(() => {});
  }
}

