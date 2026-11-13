import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import test from 'node:test';
import cookieParser from 'cookie-parser';
import { createAuthRouter } from '../../src/routes/auth.routes.js';
import { createLogger } from '../../src/lib/logger.js';

async function serve(app, check) {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try { await check(`http://127.0.0.1:${server.address().port}`); }
  finally { server.closeAllConnections(); await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

function testApp({ validCsrf = true, validSession = true } = {}) {
  const revoked = [];
  const clears = [];
  const adapter = {
    cookieName: '__session',
    validateFromCookie: async (req) => validSession && req.cookies.__session === 'session-token' ? { userId: 'user-id' } : null,
    clearCookie: (res) => { clears.push('__session'); res.clearCookie('__session'); },
  };
  const csrf = {
    middleware: (_req, _res, next) => next(),
    validateRequest: (_req, token) => validCsrf && token === 'csrf-token',
    clearCookie: (res) => { clears.push('__csrf'); res.clearCookie('__csrf'); },
    setSessionToken: () => {},
  };
  const router = createAuthRouter({
    orchestration: { login: async () => ({}), completeMfa: async () => ({}) },
    sessionService: { validateSession: async () => ({}), revokeSession: async () => ({}), revokeAllUserSessions: async (userId) => revoked.push(userId), rotateSession: async () => ({}) },
    sessionAdapter: adapter,
    csrfMiddleware: csrf,
    rateLimitMiddleware: { checkLogin: () => ({ allowed: true }), checkMfa: () => ({ allowed: true }) },
    logger: createLogger(() => {}),
  });
  const app = express(); app.use(express.json()); app.use(cookieParser()); app.use('/auth', router);
  return { app, revoked, clears };
}

test('revoke-all requires CSRF and a valid account session, then clears both cookies', async () => {
  const { app, revoked, clears } = testApp();
  await serve(app, async (base) => {
    const response = await fetch(`${base}/auth/sessions/revoke-all`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie: '__session=session-token' }, body: JSON.stringify({ csrfToken: 'csrf-token' }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'SESSIONS_REVOKED' });
    assert.deepEqual(revoked, ['user-id']); assert.deepEqual(clears, ['__session', '__csrf']);
  });
});

test('revoke-all denies invalid CSRF or session without revoking sessions', async (t) => {
  for (const options of [{ validCsrf: false }, { validSession: false }]) await t.test(JSON.stringify(options), async () => {
    const { app, revoked } = testApp(options);
    await serve(app, async (base) => {
      const response = await fetch(`${base}/auth/sessions/revoke-all`, {
        method: 'POST', headers: { 'content-type': 'application/json', cookie: '__session=session-token' }, body: JSON.stringify({ csrfToken: 'csrf-token' }),
      });
      assert.equal(response.status, options.validCsrf === false ? 403 : 401);
      assert.deepEqual(revoked, []);
    });
  });
});
