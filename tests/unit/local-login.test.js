import assert from 'node:assert/strict';
import test from 'node:test';
import { createLocalLoginService } from '../../src/auth/local-login-service.js';
import { createPrismaUserRepository } from '../../src/auth/prisma-user.repository.js';

const account = Object.freeze({
  id: 'internal-user-id',
  status: 'ACTIVE',
  deletedAt: null,
  passwordHash: '$argon2id$synthetic-hash',
});

function setup({ user = account, passwordMatches = true, repositoryError, verifierError } = {}) {
  const calls = { identity: null, verifier: 0, password: null, hash: null };
  const service = createLocalLoginService({
    userRepository: {
      async findForLocalLogin(identity) {
        calls.identity = identity;
        if (repositoryError) throw repositoryError;
        return user;
      },
    },
    async passwordVerifier(password, hash) {
      calls.verifier++;
      calls.password = password;
      calls.hash = hash;
      if (verifierError) throw verifierError;
      return passwordMatches;
    },
  });
  return { service, calls };
}

test('email and username login normalize the identifier and return only MFA-required status', async () => {
  for (const [input, expected] of [
    [{ email: '  Mixed.Case@Example.Test  ', password: '  exact password  ' }, { kind: 'email', value: 'mixed.case@example.test' }],
    [{ username: '  Mixed.User  ', password: '  exact password  ' }, { kind: 'username', value: 'mixed.user' }],
  ]) {
    const { service, calls } = setup();
    const result = await service(input);
    assert.deepEqual(calls.identity, expected);
    assert.equal(calls.password, input.password);
    assert.equal(calls.hash, account.passwordHash);
    assert.deepEqual(result, { status: 'PASSWORD_VERIFIED_MFA_REQUIRED', userId: 'internal-user-id' });
    assert.equal(Object.hasOwn(result, 'principal'), false);
    assert.equal(Object.hasOwn(result, 'session'), false);
  }
});

test('wrong password returns the same generic authentication failure', async () => {
  const { service, calls } = setup({ passwordMatches: false });
  assert.deepEqual(await service({ email: 'operator@example.test', password: 'wrong synthetic password' }), {
    status: 'AUTHENTICATION_FAILED',
    error: { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' },
  });
  assert.equal(calls.verifier, 1);
});

test('unknown, inactive, deleted, and OIDC-only accounts fail before password verification', async () => {
  for (const user of [
    null,
    { ...account, status: 'SUSPENDED' },
    { ...account, status: 'DISABLED' },
    { ...account, status: 'ACTIVE', deletedAt: new Date() },
    { ...account, status: 'ACTIVE', passwordHash: null },
    { ...account, status: 'ACTIVE', passwordHash: '' },
  ]) {
    const { service, calls } = setup({ user });
    const result = await service({ username: 'operator', password: 'synthetic password' });
    assert.deepEqual(result, {
      status: 'AUTHENTICATION_FAILED',
      error: { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' },
    });
    assert.equal(calls.verifier, 0);
  }
});

test('invalid identifier and empty password are rejected before repository lookup', async () => {
  for (const input of [
    { email: '   ', password: 'synthetic password' },
    { email: 'operator@example.test', password: '' },
    { email: 'operator@example.test', username: 'operator', password: 'synthetic password' },
    { username: 3, password: 'synthetic password' },
  ]) {
    const { service, calls } = setup();
    assert.deepEqual(await service(input), {
      status: 'INVALID_INPUT',
      error: { code: 'INVALID_LOGIN_REQUEST', message: 'Invalid login request' },
    });
    assert.equal(calls.identity, null);
    assert.equal(calls.verifier, 0);
  }
});

test('repository and verifier exceptions are replaced with generic errors and never logged', async (t) => {
  const logged = [];
  for (const name of ['log', 'info', 'warn', 'error']) t.mock.method(console, name, (...args) => logged.push(args));
  const privateEmail = 'private-account@example.test';
  const privatePassword = 'synthetic-private-password';
  const privateHash = '$argon2id$synthetic-private-hash';

  const repositoryFailure = setup({ repositoryError: new Error(`${privateEmail} ${privateHash}`) });
  await assert.rejects(
    repositoryFailure.service({ email: privateEmail, password: privatePassword }),
    (error) => error.message === 'Local authentication service unavailable'
      && !error.message.includes(privateEmail)
      && !error.message.includes(privatePassword)
      && !error.message.includes(privateHash),
  );

  const verifierFailure = setup({ verifierError: new Error(`${privatePassword} ${privateHash}`) });
  await assert.rejects(
    verifierFailure.service({ email: privateEmail, password: privatePassword }),
    (error) => error.message === 'Local authentication service unavailable'
      && !error.message.includes(privateEmail)
      && !error.message.includes(privatePassword)
      && !error.message.includes(privateHash),
  );
  assert.deepEqual(logged, []);
});

test('failure results do not contain account or credential values', async () => {
  const privateEmail = 'private-account@example.test';
  const privateUsername = 'private-username';
  const privatePassword = 'private-password-value';
  const privateHash = '$argon2id$private-hash-value';
  const { service } = setup({ user: { ...account, passwordHash: privateHash }, passwordMatches: false });
  const result = await service({ email: privateEmail, password: privatePassword });
  const output = JSON.stringify(result);
  for (const value of [privateEmail, privateUsername, privatePassword, privateHash]) assert.equal(output.includes(value), false);
});

test('Prisma repository queries canonical email or username and selects only the internal user id', async () => {
  let query;
  const repository = createPrismaUserRepository({
    user: { findUnique: async (input) => { query = input; return account; } },
  });
  await repository.findForLocalLogin({ kind: 'email', value: 'canonical@example.test' });
  assert.deepEqual(query, {
    where: { email: 'canonical@example.test' },
    select: { id: true, status: true, deletedAt: true, passwordHash: true },
  });
  await repository.findForLocalLogin({ kind: 'username', value: 'canonical-user' });
  assert.deepEqual(query, {
    where: { username: 'canonical-user' },
    select: { id: true, status: true, deletedAt: true, passwordHash: true },
  });
});

test('service and Prisma repository require injected dependencies', () => {
  assert.throws(() => createLocalLoginService(), /user repository is required/);
  assert.throws(() => createLocalLoginService({ userRepository: { findForLocalLogin() {} } }), /password verifier is required/);
  assert.throws(() => createPrismaUserRepository({}), /Prisma User model is required/);
});
