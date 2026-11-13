import assert from 'node:assert/strict';
import test from 'node:test';
import { seedRolesAndPermissions } from '../../src/lib/seed.js';

test('role-permission seed is idempotent and matches the approved six-action grants', async () => {
  const roles = new Map();
  const permissions = new Map();
  const grants = new Map();
  const tx = {
    role: { async upsert({ where, create }) { if (!roles.has(where.code)) roles.set(where.code, { id: where.code, ...create }); return roles.get(where.code); } },
    permission: { async upsert({ where, create }) { if (!permissions.has(where.code)) permissions.set(where.code, { id: where.code, ...create }); return permissions.get(where.code); } },
    rolePermission: {
      async deleteMany({ where }) { grants.set(where.roleId, []); },
      async createMany({ data }) { grants.get(data[0]?.roleId)?.push(...data); },
    },
  };
  const prisma = { async $transaction(callback) { return callback(tx); } };

  await seedRolesAndPermissions(prisma);
  const firstGrantCount = [...grants.values()].reduce((sum, rows) => sum + rows.length, 0);
  await seedRolesAndPermissions(prisma);
  assert.equal([...grants.values()].reduce((sum, rows) => sum + rows.length, 0), firstGrantCount);

  const codes = (role) => grants.get(role).map(({ permissionId }) => permissionId).sort();
  assert.deepEqual(codes('SUPER_ADMIN'), [...permissions.keys()].sort());
  assert.deepEqual(codes('ADMIN'), [
    'ANALYTICS_EXPORT', 'ANALYTICS_VIEW', 'BOOKING_APPROVE', 'BOOKING_CREATE', 'BOOKING_DELETE', 'BOOKING_EXPORT', 'BOOKING_UPDATE', 'BOOKING_VIEW',
    'CONTENT_APPROVE', 'CONTENT_CREATE', 'CONTENT_DELETE', 'CONTENT_EXPORT', 'CONTENT_UPDATE', 'CONTENT_VIEW',
    'CUSTOMER_CREATE', 'CUSTOMER_DELETE', 'CUSTOMER_EXPORT', 'CUSTOMER_UPDATE', 'CUSTOMER_VIEW',
    'DASHBOARD_VIEW', 'FINANCE_APPROVE', 'FINANCE_CREATE', 'FINANCE_DELETE', 'FINANCE_EXPORT', 'FINANCE_UPDATE', 'FINANCE_VIEW',
    'FLEET_APPROVE', 'FLEET_CREATE', 'FLEET_DELETE', 'FLEET_EXPORT', 'FLEET_UPDATE', 'FLEET_VIEW', 'MESSAGE_APPROVE', 'MESSAGE_CREATE',
    'MESSAGE_DELETE', 'MESSAGE_EXPORT', 'MESSAGE_UPDATE', 'MESSAGE_VIEW', 'PRICING_APPROVE', 'PRICING_CREATE', 'PRICING_DELETE',
    'PRICING_EXPORT', 'PRICING_UPDATE', 'PRICING_VIEW', 'SETTINGS_UPDATE', 'SETTINGS_VIEW', 'USER_VIEW',
  ].sort());
  assert.deepEqual(codes('STAFF'), ['BOOKING_APPROVE', 'BOOKING_UPDATE', 'BOOKING_VIEW', 'CONTENT_VIEW', 'CUSTOMER_VIEW', 'DASHBOARD_VIEW', 'FLEET_VIEW', 'MESSAGE_UPDATE', 'MESSAGE_VIEW', 'SETTINGS_UPDATE', 'SETTINGS_VIEW', 'ANALYTICS_VIEW'].sort());
  assert.equal(codes('STAFF').some((code) => code.startsWith('FINANCE_') || code.startsWith('PRICING_')), false);
  assert.equal(codes('ADMIN').some((code) => ['USER_CREATE', 'USER_UPDATE_ROLE', 'USER_UPDATE_STATUS', 'USER_DELETE'].includes(code)), false);
});
