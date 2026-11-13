import assert from 'node:assert/strict';
import test from 'node:test';
import { createCurrentPrincipalService } from '../../src/auth/current-principal-service.js';

test('current principal returns only active account identity, roles, and deduplicated permissions', async () => {
  let args;
  const service = createCurrentPrincipalService({ prisma: { user: { findUnique: async (value) => {
    args = value;
    return {
      id: 'user-id', email: 'admin@example.test', username: 'admin', displayName: null, status: 'ACTIVE', deletedAt: null, passwordHash: 'never-return-this',
      roles: [
        { role: { code: 'ADMIN', permissions: [{ permission: { code: 'FLEET_VIEW' } }, { permission: { code: 'DASHBOARD_VIEW' } }] } },
        { role: { code: 'STAFF', permissions: [{ permission: { code: 'FLEET_VIEW' } }] } },
      ],
    };
  } } } });

  assert.deepEqual(await service.getPrincipal('user-id'), {
    user: {
      id: 'user-id', email: 'admin@example.test', username: 'admin', displayName: null,
      roles: ['ADMIN', 'STAFF'], permissions: ['DASHBOARD_VIEW', 'FLEET_VIEW'],
    },
  });
  assert.equal(args.where.id, 'user-id');
  assert.equal(args.select.passwordHash, undefined);
});

test('current principal denies missing or inactive accounts', async () => {
  const service = createCurrentPrincipalService({ prisma: { user: { findUnique: async () => ({ status: 'DISABLED' }) } } });
  assert.equal(await service.getPrincipal('disabled-id'), null);
});
