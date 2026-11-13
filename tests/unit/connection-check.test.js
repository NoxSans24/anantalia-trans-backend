import assert from 'node:assert/strict';
import test from 'node:test';
import { checkTestDatabase } from '../../connection-check.mjs';

const env = {
  NODE_ENV: 'test',
  DATABASE_TEST_OPT_IN: 'I_CONFIRM_DISPOSABLE_DATABASE',
  TEST_DATABASE_URL: 'postgresql://validation_user@127.0.0.1:5432/anantalia_validation_test?schema=public',
  TEST_DATABASE_NAME: 'anantalia_validation_test',
  TEST_DATABASE_ALLOWLIST: '127.0.0.1:5432/anantalia_validation_test',
};
const identity = {
  database: 'anantalia_validation_test',
  role: 'validation_user',
  server_address: '127.0.0.1',
  server_port: 5432,
};

test('test database preflight validates the exact connection identity', async () => {
  let connectedWith;
  const clientFactory = (url) => {
    connectedWith = url;
    return { $queryRaw: async () => [identity], $disconnect: async () => {} };
  };
  assert.deepEqual(await checkTestDatabase({ env, clientFactory }), identity);
  assert.equal(connectedWith, env.TEST_DATABASE_URL);
});

test('test database preflight rejects unauthorized targets before constructing a client', async () => {
  let clientCreated = false;
  await assert.rejects(
    checkTestDatabase({ env: { ...env, TEST_DATABASE_URL: undefined, DATABASE_URL: 'postgresql://dev@127.0.0.1:5433/dev' }, clientFactory: () => { clientCreated = true; } }),
    /TEST_DATABASE_URL is required/,
  );
  assert.equal(clientCreated, false);
});

test('test database preflight rejects any server identity mismatch and closes the client', async () => {
  let disconnected = false;
  const clientFactory = () => ({
    $queryRaw: async () => [{ ...identity, database: 'anantalia_backend_dev' }],
    $disconnect: async () => { disconnected = true; },
  });
  await assert.rejects(checkTestDatabase({ env, clientFactory }), /identity mismatch: database/);
  assert.equal(disconnected, true);
});

test('test database preflight reports only a safe error code when the query fails', async () => {
  const clientFactory = () => ({
    $queryRaw: async () => { throw Object.assign(new Error('never expose this credential-bearing message'), { code: '28P01' }); },
    $disconnect: async () => {},
  });
  await assert.rejects(checkTestDatabase({ env, clientFactory }), (error) => {
    assert.match(error.message, /28P01/);
    assert.doesNotMatch(error.message, /credential-bearing/);
    return true;
  });
});

test('test database preflight accepts allowlisted port 5433 with container bridge IPv4 while rejecting public server IPs', async () => {
  const dockerEnv = {
    ...env,
    TEST_DATABASE_URL: 'postgresql://validation_user@127.0.0.1:5433/anantalia_validation_test?schema=public',
    TEST_DATABASE_ALLOWLIST: '127.0.0.1:5433/anantalia_validation_test',
  };
  const dockerIdentity = {
    database: 'anantalia_validation_test',
    role: 'validation_user',
    server_address: '172.17.0.2/32',
    server_port: 5432,
  };
  const verified = await checkTestDatabase({
    env: dockerEnv,
    clientFactory: () => ({ $queryRaw: async () => [dockerIdentity], $disconnect: async () => {} }),
  });
  assert.deepEqual(verified, {
    database: 'anantalia_validation_test',
    role: 'validation_user',
    server_address: '172.17.0.2',
    server_port: 5432,
  });

  await assert.rejects(
    checkTestDatabase({
      env: dockerEnv,
      clientFactory: () => ({ $queryRaw: async () => [{ ...dockerIdentity, server_address: '203.0.113.10/32' }], $disconnect: async () => {} }),
    }),
    /identity mismatch: server_address/,
  );
});
