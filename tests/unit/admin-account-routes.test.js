import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createApp } from '../../src/app.js';
import { createLogger } from '../../src/lib/logger.js';
import { createAdminAccountRouter } from '../../src/routes/admin-account.routes.js';

async function withServer(app, run) {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function buildApp(listAdmins) {
  const router = createAdminAccountRouter({
    adminAccountService: { listAdmins },
    authService: { requirePermission: async () => {}, canManageUser: async () => true },
    activityLog: {},
    logger: createLogger(() => {}),
  });
  return createApp({
    logger: createLogger(() => {}),
    adminAccountRouter: router,
    authenticationMiddleware: (req, _res, next) => { req.userId = 'authenticated-admin'; next(); },
    csrfMiddleware: { middleware: (_req, _res, next) => next(), guard: (_req, _res, next) => next() },
  });
}

test('admin account pagination applies defaults and strict numeric values', async () => {
  const calls = [];
  await withServer(buildApp(async (...args) => { calls.push(args); return []; }), async (base) => {
    let response = await fetch(`${base}/api/admin/list`);
    assert.equal(response.status, 200);
    response = await fetch(`${base}/api/admin/list?limit=75&offset=5`);
    assert.equal(response.status, 200);
    response = await fetch(`${base}/api/admin/not-a-uuid`);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: { code: 'INVALID_ID' } });
  });
  assert.deepEqual(calls, [[50, 0], [75, 5]]);
});

test('admin account pagination rejects malformed, negative, zero-limit, and unsafe values before query', async () => {
  let calls = 0;
  await withServer(buildApp(async () => { calls += 1; return []; }), async (base) => {
    for (const query of ['limit=-1', 'limit=0', 'limit=101', 'limit=2.5', 'limit=3abc', 'offset=-1', 'offset=9007199254740992']) {
      const response = await fetch(`${base}/api/admin/list?${query}`);
      assert.equal(response.status, 400, query);
      assert.deepEqual(await response.json(), { error: { code: 'INVALID_PAGINATION' } });
    }
  });
  assert.equal(calls, 0);
});
