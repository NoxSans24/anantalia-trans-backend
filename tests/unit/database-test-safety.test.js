import assert from 'node:assert/strict';
import test from 'node:test';
import { getAuthorizedTestDatabase, resolvePrismaDatasource } from '../../src/config/prisma-migration-safety.js';
import { runPrismaMigrationTest } from '../../scripts/prisma-migrate-test.js';
import { runDisposableDbSuite } from '../../scripts/run-disposable-db-suite.js';
import { createTestPrismaClient, dropTestDatabase, getTestDatabaseConfig } from '../integration/setup/database-setup.js';

const database = 'anantalia_validation_test';
const testUrl = `postgresql://validation_user@127.0.0.1:5432/${database}?schema=public`;
const devUrl = 'postgresql://application@127.0.0.1:5433/anantalia_backend_dev?schema=public';
const prodUrl = 'postgresql://application@db.example.invalid:5432/anantalia_backend_prod?schema=public';

function validEnv(overrides = {}) {
  return {
    NODE_ENV: 'test',
    DATABASE_TEST_OPT_IN: 'I_CONFIRM_DISPOSABLE_DATABASE',
    TEST_DATABASE_URL: testUrl,
    TEST_DATABASE_NAME: database,
    TEST_DATABASE_ALLOWLIST: `127.0.0.1:5432/${database}`,
    ...overrides,
  };
}

test('requires opt-in and test mode; DATABASE_URL is never a test fallback', () => {
  assert.throws(() => getAuthorizedTestDatabase(validEnv({ DATABASE_TEST_OPT_IN: '' })), /opt-in/);
  assert.throws(() => getAuthorizedTestDatabase(validEnv({ NODE_ENV: 'development' })), /NODE_ENV/);
  assert.throws(() => getAuthorizedTestDatabase(validEnv({ TEST_DATABASE_URL: undefined, DATABASE_URL: devUrl })), /TEST_DATABASE_URL/);
  assert.throws(() => resolvePrismaDatasource({ argv: ['node', 'prisma', 'migrate', 'deploy'], env: validEnv({ TEST_DATABASE_URL: undefined, DATABASE_URL: devUrl }) }), /TEST_DATABASE_URL/);
});

test('rejects missing URL and any database other than the approved disposable target', () => {
  assert.throws(() => getAuthorizedTestDatabase(validEnv({ TEST_DATABASE_URL: '' })), /TEST_DATABASE_URL/);
  assert.throws(() => getAuthorizedTestDatabase(validEnv({ TEST_DATABASE_NAME: 'anantalia_backend_dev' })), /TEST_DATABASE_NAME/);
  assert.throws(() => getAuthorizedTestDatabase(validEnv({ TEST_DATABASE_URL: 'postgresql://validation_user@127.0.0.1:5432/anantalia_backend_dev' })), /approved local test database/);
  assert.throws(() => getAuthorizedTestDatabase(validEnv({ TEST_DATABASE_URL: 'postgresql://validation_user@127.0.0.1:5432/anantalia_backend_prod' })), /approved local test database/);
});

test('rejects wrong role, non-loopback host, wrong port, and non-allowlisted target', () => {
  for (const url of [
    `postgresql://other_role@127.0.0.1:5432/${database}`,
    `postgresql://validation_user@db.example.invalid:5432/${database}`,
    `postgresql://validation_user@[::1]:5432/${database}`,
    `postgresql://validation_user@127.0.0.1:5439/${database}`,
    `postgresql://validation_user@localhost:5432/${database}`,
    `postgresql://validation_user@127.0.0.1/${database}`,
    `postgresql://validation_user@127.0.0.1:5432/${database}?sslmode=require`,
  ]) assert.throws(() => getAuthorizedTestDatabase(validEnv({ TEST_DATABASE_URL: url })), /approved local test database/);
  assert.throws(() => getAuthorizedTestDatabase(validEnv({ TEST_DATABASE_ALLOWLIST: `127.0.0.1:5432/other_test` })), /ALLOWLIST/);
  assert.throws(() => getAuthorizedTestDatabase(validEnv({ TEST_DATABASE_URL: `postgresql://validation_user@127.0.0.1:5433/${database}` })), /ALLOWLIST/);
  const dockerUrl = `postgresql://validation_user@127.0.0.1:5433/${database}?schema=public`;
  const dockerConfig = getAuthorizedTestDatabase(validEnv({
    TEST_DATABASE_URL: dockerUrl,
    TEST_DATABASE_ALLOWLIST: `127.0.0.1:5433/${database}`,
  }));
  assert.equal(dockerConfig.port, 5433);
  assert.equal(dockerConfig.target, `127.0.0.1:5433/${database}`);
  assert.throws(() => getAuthorizedTestDatabase(validEnv({
    TEST_DATABASE_NAME: 'anantalia_backend_dev',
    TEST_DATABASE_URL: 'postgresql://validation_user@127.0.0.1:5433/anantalia_backend_dev?schema=public',
    TEST_DATABASE_ALLOWLIST: '127.0.0.1:5433/anantalia_backend_dev',
  })), /TEST_DATABASE_NAME/);
});

test('accepts exact configuration and sends Prisma migrate deploy only to TEST_DATABASE_URL', () => {
  assert.equal(getAuthorizedTestDatabase(validEnv()).connectionString, testUrl);
  assert.equal(getTestDatabaseConfig(validEnv()).databaseName, database);
  assert.deepEqual(resolvePrismaDatasource({ argv: ['node', 'prisma', 'migrate', 'deploy'], env: validEnv({ DATABASE_URL: devUrl }) }), { url: testUrl });
  assert.deepEqual(resolvePrismaDatasource({ argv: ['node', 'prisma', 'migrate', 'deploy'], env: validEnv({ DATABASE_URL: prodUrl }) }), { url: testUrl });
  assert.deepEqual(resolvePrismaDatasource({ argv: ['node', 'prisma', '--config', 'prisma.config.js', 'db', 'execute'], env: validEnv({ DATABASE_URL: devUrl }) }), { url: testUrl });
});

test('development and production URLs cannot become the testing datasource', () => {
  assert.throws(() => resolvePrismaDatasource({ argv: ['node', 'prisma', 'migrate', 'deploy'], env: { NODE_ENV: 'development', DATABASE_URL: devUrl } }), /safety check failed/);
  assert.throws(() => getAuthorizedTestDatabase(validEnv({ TEST_DATABASE_URL: devUrl })), /approved local test database/);
  assert.throws(() => getAuthorizedTestDatabase(validEnv({ TEST_DATABASE_URL: prodUrl })), /approved local test database/);
  assert.deepEqual(resolvePrismaDatasource({ argv: ['node', 'prisma', 'migrate', 'deploy'], env: { NODE_ENV: 'production', DATABASE_URL: prodUrl } }), { url: prodUrl });
});

test('invalid authorization never starts Prisma or constructs a database client', async () => {
  let spawned = false;
  let clientCreated = false;
  assert.throws(() => runPrismaMigrationTest({ env: validEnv({ TEST_DATABASE_URL: '', DATABASE_URL: devUrl }), spawnProcess: () => { spawned = true; } }), /TEST_DATABASE_URL/);
  await assert.rejects(createTestPrismaClient({ env: { DATABASE_URL: devUrl }, clientFactory: () => { clientCreated = true; } }), /explicitly authorized/);
  assert.equal(spawned, false);
  assert.equal(clientCreated, false);
});

test('runPrismaMigrationTest verifies SQL preflight before spawning Prisma migrate deploy', async () => {
  const order = [];
  await runPrismaMigrationTest({
    env: validEnv(),
    preflight: async () => {
      order.push('preflight');
    },
    spawnProcess: () => {
      order.push('spawn');
      return {
        once(event, handler) {
          if (event === 'close') setImmediate(() => handler(0));
        },
      };
    },
  });
  assert.deepEqual(order, ['preflight', 'spawn']);

  let spawnedOnFailedPreflight = false;
  await assert.rejects(
    runPrismaMigrationTest({
      env: validEnv(),
      preflight: async () => {
        throw new Error('Database preflight identity mismatch: database');
      },
      spawnProcess: () => {
        spawnedOnFailedPreflight = true;
      },
    }),
    /Database preflight identity mismatch/,
  );
  assert.equal(spawnedOnFailedPreflight, false);
});

test('cleanup rejects databases not owned and registered by this process', async () => {
  const Client = () => { throw new Error('no database connection is allowed in this test'); };
  await assert.rejects(dropTestDatabase(database, { env: validEnv(), Client }), /explicitly authorized/);
  await assert.rejects(dropTestDatabase('unrelated_test', { env: validEnv(), Client }), /explicitly authorized/);
  await assert.rejects(runDisposableDbSuite({ env: validEnv({ DATABASE_TEST_OPT_IN: '' }) }), /opt-in is required/);
});
