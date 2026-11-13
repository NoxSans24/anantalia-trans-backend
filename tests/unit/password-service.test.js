import assert from 'node:assert/strict';
import test from 'node:test';
import { hashPassword, validatePasswordConfiguration, verifyPassword } from '../../src/auth/password-service.js';

// Test-only low-cost work factors; production parameters remain pending.
const testOnlyParameters = Object.freeze({
  ARGON2_MEMORY_COST: '32',
  ARGON2_TIME_COST: '2',
  ARGON2_PARALLELISM: '1',
  ARGON2_HASH_LENGTH: '16',
});

async function withParameters(callback, parameters = testOnlyParameters) {
  const names = Object.keys(testOnlyParameters);
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  for (const name of names) {
    if (parameters[name] === undefined) delete process.env[name];
    else process.env[name] = parameters[name];
  }
  try {
    return await callback();
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
}

test('Argon2id hashes verify correctly and use a fresh salt for each hash', async () => withParameters(async () => {
  const password = '  synthetic password must remain unchanged  ';
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  assert.match(first, /^\$argon2id\$v=\d+\$m=32,p=1,t=2\$/);
  assert.notEqual(first, second);
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword(password.trim(), first), false);
  assert.equal(await verifyPassword('incorrect synthetic password', first), false);
}));

test('invalid encoded hashes fail closed', async () => withParameters(async () => {
  assert.equal(await verifyPassword('synthetic password', ''), false);
  assert.equal(await verifyPassword('synthetic password', '$argon2i$invalid'), false);
  assert.equal(await verifyPassword('synthetic password', '$argon2id$invalid'), false);
}));

test('empty and non-string passwords are rejected without normalization', async () => withParameters(async () => {
  for (const password of ['', null, undefined, 123, Buffer.from('synthetic')]) {
    await assert.rejects(hashPassword(password), (error) => error instanceof TypeError && error.message === 'Password must be a non-empty string');
    await assert.rejects(verifyPassword(password, 'invalid'), (error) => error instanceof TypeError && error.message === 'Password must be a non-empty string');
  }
}));

test('missing or invalid Argon2id configuration fails closed, including production use', async () => {
  const invalidConfigurations = [
    {},
    { ...testOnlyParameters, ARGON2_MEMORY_COST: '0' },
    { ...testOnlyParameters, ARGON2_TIME_COST: 'not-a-number' },
    { ...testOnlyParameters, ARGON2_PARALLELISM: '0' },
    { ...testOnlyParameters, ARGON2_HASH_LENGTH: '3' },
    { ...testOnlyParameters, ARGON2_MEMORY_COST: '8', ARGON2_PARALLELISM: '2' },
  ];
  for (const parameters of invalidConfigurations) {
    await withParameters(async () => {
      await assert.rejects(hashPassword('synthetic password'), /Argon2id parameters are missing or invalid/);
      await assert.rejects(verifyPassword('synthetic password', '$argon2id$invalid'), /Argon2id parameters are missing or invalid/);
    }, parameters);
  }
  await withParameters(async () => {
    const previousEnvironment = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await assert.rejects(hashPassword('synthetic password'), /Argon2id parameters are missing or invalid/);
    } finally {
      if (previousEnvironment === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousEnvironment;
    }
  }, {});
});

test('password configuration can be checked at startup without hashing or database access', () => {
  const config = validatePasswordConfiguration({
    ARGON2_MEMORY_COST: '19456',
    ARGON2_TIME_COST: '2',
    ARGON2_PARALLELISM: '1',
    ARGON2_HASH_LENGTH: '32',
  });
  assert.deepEqual(config, { memoryCost: 19456, timeCost: 2, parallelism: 1, hashLength: 32 });
  assert.throws(() => validatePasswordConfiguration({}), /Argon2id parameters/);
});

test('passwords and hashes are not logged or included in errors', async (t) => withParameters(async () => {
  const password = 'synthetic-secret-that-must-not-be-logged';
  const logged = [];
  for (const name of ['log', 'info', 'warn', 'error']) t.mock.method(console, name, (...args) => logged.push(args));

  const hash = await hashPassword(password);
  assert.equal(hash.includes(password), false);
  assert.equal(await verifyPassword(password, hash), true);
  await assert.rejects(hashPassword(''), (error) => !error.message.includes(password) && !error.message.includes(hash));
  assert.deepEqual(logged, []);
}));
