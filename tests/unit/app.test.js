import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import test from 'node:test';
import { createApp } from '../../src/app.js';
import { validateEnv } from '../../src/config/env.js';
import { errorHandler } from '../../src/middlewares/error.middleware.js';
import { createLogger } from '../../src/lib/logger.js';
import { createPrismaClient } from '../../src/lib/prisma.js';

const databaseUrl = 'postgresql://test:test@127.0.0.1:5432/anantalia_dev';

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

test('app initializes with injected dependencies', async () => {
  const app = createApp({ prisma: { $queryRaw: async () => [] }, logger: createLogger(() => {}) });
  assert.equal(typeof app, 'function');
  await serve(app, async (base) => assert.equal((await fetch(`${base}/health`)).status, 200));
});

test('health reports application and database status with a timestamp', async () => {
  const app = createApp({ prisma: { $queryRaw: async () => [] }, logger: createLogger(() => {}) });
  await serve(app, async (base) => {
    const response = await fetch(`${base}/health`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.status, 'ok');
    assert.equal(body.checks.database, 'ok');
    assert.equal(Number.isNaN(Date.parse(body.timestamp)), false);
    assert.ok(response.headers.get('x-request-id'));
  });
});

test('health returns a safe unavailable response when database query fails', async () => {
  const logs = [];
  const secret = 'private-connection-detail';
  const app = createApp({ prisma: { $queryRaw: async () => { throw new Error(secret); } }, logger: createLogger((line) => logs.push(line)) });
  await serve(app, async (base) => {
    const response = await fetch(`${base}/health`);
    const body = await response.text();
    assert.equal(response.status, 503);
    assert.match(body, /unavailable/);
    assert.doesNotMatch(body, new RegExp(secret));
    assert.ok(logs.every((line) => !line.includes(secret)));
  });
});

test('unknown route returns 404', async () => {
  const app = createApp({ prisma: {}, logger: createLogger(() => {}) });
  await serve(app, async (base) => assert.equal((await fetch(`${base}/missing`)).status, 404));
});

test('error response does not expose internal exception text', async () => {
  const app = express();
  app.get('/failure', (req, res, next) => next(new Error('secret database detail')));
  app.use(errorHandler);
  await serve(app, async (base) => {
    const response = await fetch(`${base}/failure`);
    const body = await response.text();
    assert.equal(response.status, 500);
    assert.doesNotMatch(body, /secret database detail/);
  });
});

test('JSON request body limit is enforced', async () => {
  const app = express();
  app.use(express.json({ limit: '100kb' }));
  app.post('/payload', (req, res) => res.json({ received: true }));
  app.use(errorHandler);
  await serve(app, async (base) => {
    const response = await fetch(`${base}/payload`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'x'.repeat(110 * 1024) }),
    });
    assert.equal(response.status, 413);
  });
});

test('required environment is validated without disclosing values', () => {
  assert.throws(() => validateEnv({}), /DATABASE_URL is required/);
  assert.throws(() => validateEnv({ DATABASE_URL: 'mysql://host/db' }), /PostgreSQL database/);
  assert.deepEqual(validateEnv({ DATABASE_URL: databaseUrl }).port, 3000);
});

test('Prisma initializes with a PostgreSQL adapter and requires a URL', async () => {
  assert.throws(() => createPrismaClient(), /DATABASE_URL is required/);
  const prisma = createPrismaClient(databaseUrl);
  assert.equal(typeof prisma.$queryRaw, 'function');
  await prisma.$disconnect();
});
