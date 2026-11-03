import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../../src/app.js';
import { createLogger } from '../../src/lib/logger.js';
import { createPrismaClient } from '../../src/lib/prisma.js';

const configuredUrl = process.env.DATABASE_URL;
let isLocalDevelopmentDatabase = false;
try {
  const url = new URL(configuredUrl);
  isLocalDevelopmentDatabase = process.env.NODE_ENV === 'development'
    && /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(url.hostname)
    && /_dev(?:elopment)?$/i.test(url.pathname.slice(1));
} catch {}

test('GET /health can query the configured local development database', { skip: !isLocalDevelopmentDatabase && 'Requires a local development database ending in _dev' }, async () => {
  const prisma = createPrismaClient(configuredUrl);
  const server = createApp({ prisma, logger: createLogger(() => {}) }).listen(0, '127.0.0.1');
  try {
    await new Promise((resolve, reject) => server.once('listening', resolve).once('error', reject));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/health`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).checks.database, 'ok');
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await prisma.$disconnect();
  }
});
