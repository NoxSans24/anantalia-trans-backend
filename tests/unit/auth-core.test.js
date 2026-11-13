import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import test from 'node:test';
import { normalizeUserIdentifiers } from '../../src/auth/identity.js';
import { parseLoginInput } from '../../src/auth/login-input.js';
import { createAuthenticationMiddleware } from '../../src/middlewares/authentication.middleware.js';
import { createAuthorizationMiddleware } from '../../src/middlewares/authorization.middleware.js';
import { errorHandler } from '../../src/middlewares/error.middleware.js';

async function serve(app, check) {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await check(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function protectedApp({ authenticate, authorize }) {
  const app = express();
  app.get('/protected', createAuthenticationMiddleware(authenticate), createAuthorizationMiddleware(authorize), (req, res) => res.json({ ok: true }));
  app.use(errorHandler);
  return app;
}

test('login input accepts and normalizes exactly one approved identifier', () => {
  const email = parseLoginInput({ email: 'Mixed.Case@example.test', password: '  synthetic password  ' });
  const username = parseLoginInput({ username: 'Case Sensitive User', password: 'secret' });
  assert.equal(email.ok, true);
  assert.deepEqual(email.credentials.identity, { kind: 'email', value: 'mixed.case@example.test' });
  assert.equal(email.credentials.password, '  synthetic password  ');
  assert.deepEqual(username.credentials.identity, { kind: 'username', value: 'case sensitive user' });
});

test('user email and username are normalized before persistence', () => {
  assert.deepEqual(normalizeUserIdentifiers({ email: ' Person@Example.Test ', username: ' Admin.One ' }), {
    email: 'person@example.test',
    username: 'admin.one',
  });
  assert.throws(() => normalizeUserIdentifiers({ email: null, username: 'admin' }), /Identity must be a string/);
});

test('login input rejects missing, ambiguous, mistyped, empty, or extra fields generically', () => {
  for (const input of [null, [], {}, { email: 'a', username: 'b', password: 'x' }, { email: '', password: 'x' }, { email: '   ', password: 'x' }, { username: 1, password: 'x' }, { email: 'a', password: '' }, { email: 'a', password: 'x', role: 'SUPER_ADMIN' }]) {
    const result = parseLoginInput(input);
    assert.deepEqual(result, { ok: false, error: { code: 'INVALID_LOGIN_REQUEST', message: 'Invalid login request' } });
  }
});

test('authentication failure is generic and authorization does not run', async () => {
  let authorizationCalls = 0;
  const app = protectedApp({ authenticate: async () => null, authorize: async () => { authorizationCalls++; return true; } });
  await serve(app, async (base) => {
    const response = await fetch(`${base}/protected`);
    const body = await response.text();
    assert.equal(response.status, 401);
    assert.match(body, /Authentication required/);
    assert.doesNotMatch(body, /email|username|password|principal/i);
    assert.equal(authorizationCalls, 0);
  });
});

test('authorization runs only after a principal is provided by the authentication adapter', async () => {
  const principal = Object.freeze({ opaqueTestPrincipal: true });
  let receivedPrincipal;
  const app = protectedApp({ authenticate: async () => principal, authorize: async (received) => { receivedPrincipal = received; return true; } });
  await serve(app, async (base) => {
    const response = await fetch(`${base}/protected`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(receivedPrincipal, principal);
  });
});

test('authorization fails closed and returns no principal details', async () => {
  const principal = Object.freeze({ opaqueTestPrincipal: true });
  const app = protectedApp({ authenticate: async () => principal, authorize: async () => false });
  await serve(app, async (base) => {
    const response = await fetch(`${base}/protected`);
    const body = await response.text();
    assert.equal(response.status, 403);
    assert.match(body, /Access denied/);
    assert.doesNotMatch(body, /opaqueTestPrincipal/);
  });
});

test('authentication adapter errors reach the generic error handler without leaking details', async () => {
  const secretDetail = 'synthetic-verifier-internal-detail';
  const app = protectedApp({ authenticate: async () => { throw new Error(secretDetail); }, authorize: async () => true });
  await serve(app, async (base) => {
    const response = await fetch(`${base}/protected`);
    const body = await response.text();
    assert.equal(response.status, 500);
    assert.doesNotMatch(body, new RegExp(secretDetail));
    assert.match(body, /unexpected error/i);
  });
});

test('authentication and authorization adapters are mandatory', () => {
  assert.throws(() => createAuthenticationMiddleware(), /authentication adapter is required/);
  assert.throws(() => createAuthorizationMiddleware(), /authorization policy is required/);
});
