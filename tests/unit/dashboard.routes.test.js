import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import test from 'node:test';
import { createDashboardRouter } from '../../src/dashboard/dashboard.routes.js';
import { createLogger } from '../../src/lib/logger.js';

async function serve(app, check) {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try { await check(`http://127.0.0.1:${server.address().port}`); }
  finally { server.closeAllConnections(); await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

test('dashboard summary route requires a principal and returns live summary', async () => {
  const app = express();
  app.use((req, _res, next) => { if (req.headers.authorization === 'Bearer operator') req.userId = 'operator-id'; req.id = 'request-id'; next(); });
  app.use('/api/v1/admin/dashboard', createDashboardRouter({ dashboardService: { getSummary: async ({ actor }) => ({ summary: { actor } }) }, logger: createLogger(() => {}) }));
  await serve(app, async (base) => {
    assert.equal((await fetch(`${base}/api/v1/admin/dashboard/summary`)).status, 401);
    const response = await fetch(`${base}/api/v1/admin/dashboard/summary`, { headers: { authorization: 'Bearer operator' } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { summary: { actor: 'operator-id' } });
  });
});

test('dashboard route maps permission denial and hides internal errors', async () => {
  const app = express();
  app.use((req, _res, next) => { req.userId = 'operator-id'; req.id = 'request-id'; next(); });
  app.use('/api/v1/admin/dashboard', createDashboardRouter({ dashboardService: { getSummary: async () => { throw Object.freeze({ status: 'PERMISSION_DENIED', secret: 'private' }); } }, logger: createLogger(() => {}) }));
  await serve(app, async (base) => {
    const response = await fetch(`${base}/api/v1/admin/dashboard/summary`);
    assert.equal(response.status, 403);
    assert.doesNotMatch(await response.text(), /private/);
  });
});
