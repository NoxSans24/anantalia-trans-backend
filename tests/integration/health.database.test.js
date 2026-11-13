import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../../src/app.js';
import { createLogger } from '../../src/lib/logger.js';
import { createTestPrismaClient } from './setup/database-setup.js';

test('GET /health can query the explicitly authorized disposable database', async () => {
  const prisma = await createTestPrismaClient();
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

test('authentication schema tables, indexes, triggers, and checks are installed', async () => {
  const prisma = await createTestPrismaClient();
  try {
    const tables = await prisma.$queryRaw`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('User', 'Role', 'Permission', 'UserRole', 'RolePermission', 'OIDCIdentity', 'AdminSession') ORDER BY table_name`;
    assert.deepEqual(tables.map(({ table_name }) => table_name), ['AdminSession', 'OIDCIdentity', 'Permission', 'Role', 'RolePermission', 'User', 'UserRole']);

    const indexes = await prisma.$queryRaw`SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname IN ('User_email_key', 'User_username_key', 'OIDCIdentity_issuer_subject_key', 'AdminSession_tokenHash_key') ORDER BY indexname`;
    assert.deepEqual(indexes.map(({ indexname }) => indexname), ['AdminSession_tokenHash_key', 'OIDCIdentity_issuer_subject_key', 'User_email_key', 'User_username_key']);

    const triggers = await prisma.$queryRaw`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('Role_code_immutable', 'User_normalize_identifiers', 'UserRole_super_admin_exclusive') ORDER BY tgname`;
    assert.deepEqual(triggers.map(({ tgname }) => tgname), ['Role_code_immutable', 'UserRole_super_admin_exclusive', 'User_normalize_identifiers']);

    const constraints = await prisma.$queryRaw`SELECT conname FROM pg_constraint WHERE conname IN ('User_email_normalized_check', 'User_username_normalized_check', 'AdminSession_absolute_expiry_check', 'AdminSession_activity_expiry_check') ORDER BY conname`;
    assert.deepEqual(constraints.map(({ conname }) => conname), ['AdminSession_absolute_expiry_check', 'AdminSession_activity_expiry_check', 'User_email_normalized_check', 'User_username_normalized_check']);

  } finally {
    await prisma.$disconnect();
  }
});
