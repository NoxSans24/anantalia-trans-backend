import assert from 'node:assert/strict';
import test from 'node:test';
import { createDashboardService } from '../../src/dashboard/dashboard.service.js';

test('dashboard summary returns only database counts and requires dashboard permission', async () => {
  const calls = [];
  const service = createDashboardService({
    authorizationService: { requirePermission: async (...args) => calls.push(['permission', ...args]) },
    repository: {
      countCategories: async () => 3,
      countModels: async (where) => { calls.push(['models', where]); return where.isVerified ? 2 : 5; },
      countRentalCapabilities: async (where) => { calls.push(['capabilities', where]); return 4; },
    },
  });
  assert.deepEqual(await service.getSummary({ actor: 'operator-id' }), {
    summary: { vehicleCategories: 3, activeModels: 5, verifiedModels: 2, pendingVerificationModels: 5, publicRentalCapabilities: 4 },
  });
  assert.deepEqual(calls[0], ['permission', 'operator-id', 'DASHBOARD_VIEW']);
});

test('dashboard permission denial fails before reading metrics', async () => {
  let read = false;
  const service = createDashboardService({
    authorizationService: { requirePermission: async () => { throw Object.freeze({ status: 'PERMISSION_DENIED' }); } },
    repository: { countCategories: async () => { read = true; }, countModels: async () => { read = true; }, countRentalCapabilities: async () => { read = true; } },
  });
  await assert.rejects(service.getSummary({ actor: 'staff-id' }), (error) => error.status === 'PERMISSION_DENIED');
  assert.equal(read, false);
});
