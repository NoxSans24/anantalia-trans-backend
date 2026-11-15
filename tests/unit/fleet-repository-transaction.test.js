import assert from 'node:assert/strict';
import test from 'node:test';
import { createPrismaFleetRepository } from '../../src/fleet/prisma-fleet.repository.js';
import { createActivityLogService } from '../../src/auth/activity-log-service.js';
import { createFleetService } from '../../src/fleet/fleet.service.js';

test('createPrismaFleetRepository exposes activityLog inside transactions so category and model mutations persist audit logs', async () => {
  const createdLogs = [];
  const createdCategories = [];
  const txPrisma = {
    vehicleCategory: {
      create: async ({ data }) => {
        const row = { id: '11111111-1111-4111-8111-111111111111', isActive: true, ...data };
        createdCategories.push(row);
        return row;
      },
    },
    activityLog: {
      create: async ({ data }) => {
        createdLogs.push(data);
        return { id: 'log-1', ...data };
      },
    },
  };
  const rootPrisma = {
    $transaction: async (work) => work(txPrisma),
    activityLog: txPrisma.activityLog,
  };

  const repository = createPrismaFleetRepository(rootPrisma);
  const activityLog = createActivityLogService({ prisma: rootPrisma });
  const authorizationService = {
    requirePermission: async () => true,
  };
  const fleetService = createFleetService({ repository, authorizationService, activityLog });

  const item = await fleetService.createCategory({
    actor: '22222222-2222-4222-8222-222222222222',
    input: { name: 'Minibus Pariwisata', slug: 'minibus-pariwisata', description: 'Untuk rombongan' },
  });

  assert.equal(item.slug, 'minibus-pariwisata');
  assert.equal(createdCategories.length, 1);
  assert.equal(createdLogs.length, 1);
  assert.equal(createdLogs[0].action, 'FLEET_CATEGORY_CREATED');
  assert.equal(createdLogs[0].resourceType, 'VehicleCategory');
  assert.equal(createdLogs[0].resourceId, item.id);
});
