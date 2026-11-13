import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../../src/app.js';
import { createFleetService } from '../../src/fleet/fleet.service.js';
import { createPrismaFleetRepository } from '../../src/fleet/prisma-fleet.repository.js';
import { createPublicFleetRouter, createAdminFleetRouter } from '../../src/fleet/fleet.routes.js';
import { createDashboardService } from '../../src/dashboard/dashboard.service.js';
import { createPrismaDashboardRepository } from '../../src/dashboard/prisma-dashboard.repository.js';
import { createDashboardRouter } from '../../src/dashboard/dashboard.routes.js';
import { createBookingService } from '../../src/booking/booking.service.js';
import { createPrismaBookingRepository } from '../../src/booking/prisma-booking.repository.js';
import { createPublicBookingRouter, createAdminBookingRouter } from '../../src/booking/booking.routes.js';
import { createPricingService } from '../../src/pricing/pricing.service.js';
import { createPrismaPricingRepository } from '../../src/pricing/prisma-pricing.repository.js';
import { createPricingRouter } from '../../src/pricing/pricing.routes.js';
import { createFinanceService } from '../../src/finance/finance.service.js';
import { createPrismaFinanceRepository } from '../../src/finance/prisma-finance.repository.js';
import { createFinanceRouter } from '../../src/finance/finance.routes.js';

function createStatefulPrismaStore() {
  const tables = {
    vehicleCategory: new Map(),
    vehicleModel: new Map(),
    vehicleRentalOption: new Map(),
    booking: new Map(),
    pricingRule: new Map(),
    financeTransaction: new Map(),
  };

  const prisma = {
    $transaction: async (fn) => fn(prisma),
    vehicleCategory: {
      findMany: async ({ where = {} } = {}) => {
        let rows = [...tables.vehicleCategory.values()];
        if (where.isActive !== undefined) rows = rows.filter((r) => r.isActive === where.isActive);
        return rows;
      },
      count: async ({ where = {} } = {}) => {
        let rows = [...tables.vehicleCategory.values()];
        if (where.isActive !== undefined) rows = rows.filter((r) => r.isActive === where.isActive);
        return rows.length;
      },
      findUnique: async ({ where }) => tables.vehicleCategory.get(where.id) ?? null,
      create: async ({ data }) => {
        const now = new Date();
        const row = { ...data, isActive: data.isActive ?? true, sortOrder: data.sortOrder ?? 0, createdAt: now, updatedAt: now };
        tables.vehicleCategory.set(row.id, row);
        return row;
      },
      update: async ({ where, data }) => {
        const existing = tables.vehicleCategory.get(where.id);
        const updated = { ...existing, ...data, updatedAt: new Date() };
        tables.vehicleCategory.set(where.id, updated);
        return updated;
      },
    },
    vehicleModel: {
      findMany: async ({ where = {} } = {}) => {
        let rows = [...tables.vehicleModel.values()];
        if (where.isActive !== undefined) rows = rows.filter((r) => r.isActive === where.isActive);
        if (where.isVerified !== undefined) rows = rows.filter((r) => r.isVerified === where.isVerified);
        if (where.categoryId !== undefined) rows = rows.filter((r) => r.categoryId === where.categoryId);
        return rows.map((m) => ({
          ...m,
          category: tables.vehicleCategory.get(m.categoryId) ?? null,
          rentalOptions: [...tables.vehicleRentalOption.values()].filter((o) => o.modelId === m.id),
        }));
      },
      count: async ({ where = {} } = {}) => {
        let rows = [...tables.vehicleModel.values()];
        if (where.isActive !== undefined) rows = rows.filter((r) => r.isActive === where.isActive);
        if (where.isVerified !== undefined) rows = rows.filter((r) => r.isVerified === where.isVerified);
        return rows.length;
      },
      findUnique: async ({ where }) => {
        const m = tables.vehicleModel.get(where.id);
        if (!m) return null;
        return {
          ...m,
          category: tables.vehicleCategory.get(m.categoryId) ?? null,
          rentalOptions: [...tables.vehicleRentalOption.values()].filter((o) => o.modelId === m.id),
        };
      },
      create: async ({ data }) => {
        const now = new Date();
        const row = { ...data, isActive: data.isActive ?? true, isVerified: data.isVerified ?? false, createdAt: now, updatedAt: now };
        tables.vehicleModel.set(row.id, row);
        return { ...row, category: tables.vehicleCategory.get(row.categoryId) ?? null };
      },
      update: async ({ where, data }) => {
        const existing = tables.vehicleModel.get(where.id);
        const updated = { ...existing, ...data, updatedAt: new Date() };
        tables.vehicleModel.set(where.id, updated);
        return {
          ...updated,
          category: tables.vehicleCategory.get(updated.categoryId) ?? null,
          rentalOptions: [...tables.vehicleRentalOption.values()].filter((o) => o.modelId === updated.id),
        };
      },
    },
    vehicleRentalOption: {
      createMany: async ({ data }) => {
        for (const item of data) {
          tables.vehicleRentalOption.set(`${item.modelId}:${item.rentalType}`, { ...item, updatedAt: new Date() });
        }
        return { count: data.length };
      },
      upsert: async ({ where, create, update }) => {
        const key = `${where.modelId_rentalType.modelId}:${where.modelId_rentalType.rentalType}`;
        const existing = tables.vehicleRentalOption.get(key);
        const next = existing ? { ...existing, ...update, updatedAt: new Date() } : { ...create, updatedAt: new Date() };
        tables.vehicleRentalOption.set(key, next);
        return next;
      },
      findMany: async ({ where = {} } = {}) => {
        let rows = [...tables.vehicleRentalOption.values()];
        if (where.isEnabled !== undefined) rows = rows.filter((r) => r.isEnabled === where.isEnabled);
        return rows;
      },
      count: async ({ where = {} } = {}) => {
        let rows = [...tables.vehicleRentalOption.values()];
        if (where.isEnabled !== undefined) rows = rows.filter((r) => r.isEnabled === where.isEnabled);
        return rows.length;
      },
    },
    booking: {
      create: async ({ data }) => {
        const now = new Date();
        const row = { ...data, createdAt: now, updatedAt: now };
        tables.booking.set(row.id, row);
        return row;
      },
      findUnique: async ({ where }) => {
        if (where.id) return tables.booking.get(where.id) ?? null;
        if (where.bookingCode) return [...tables.booking.values()].find((r) => r.bookingCode === where.bookingCode) ?? null;
        return null;
      },
      findFirst: async ({ where }) => {
        return [...tables.booking.values()].find((r) =>
          r.status === where.status
          && r.whatsappPhone === where.whatsappPhone
          && r.categoryId === where.categoryId
          && r.modelId === where.modelId
          && r.rentalType === where.rentalType
          && r.startsOn === where.startsOn
          && r.endsOn === where.endsOn) ?? null;
      },
      findMany: async ({ where = {}, skip = 0, take = 25 } = {}) => {
        let rows = [...tables.booking.values()];
        if (where.status) rows = rows.filter((r) => r.status === where.status);
        return rows.slice(skip, skip + take);
      },
      count: async ({ where = {} } = {}) => {
        let rows = [...tables.booking.values()];
        if (where.status) rows = rows.filter((r) => r.status === where.status);
        return rows.length;
      },
      update: async ({ where, data }) => {
        const existing = tables.booking.get(where.id);
        const updated = { ...existing, ...data, updatedAt: new Date() };
        tables.booking.set(where.id, updated);
        return updated;
      },
    },
    pricingRule: {
      findMany: async () => [...tables.pricingRule.values()],
      count: async () => tables.pricingRule.size,
    },
    financeTransaction: {
      findMany: async () => [...tables.financeTransaction.values()],
      count: async () => tables.financeTransaction.size,
    },
  };

  return prisma;
}

function buildAppInstance(prisma, rolePermissionsByUser) {
  const authorizationService = {
    hasPermission: async (userId, perm) => Boolean(rolePermissionsByUser[userId]?.includes(perm)),
    requirePermission: async (userId, perm) => {
      if (!rolePermissionsByUser[userId]?.includes(perm)) {
        const err = new Error('Permission denied');
        err.status = 'PERMISSION_DENIED';
        throw err;
      }
    },
    authorize: async ({ principal, permission }) => ({
      allowed: Boolean(rolePermissionsByUser[principal?.userId]?.includes(permission)),
    }),
  };
  const activityLog = { log: async () => {}, record: async () => {} };
  const fleetService = createFleetService({
    repository: createPrismaFleetRepository(prisma),
    authorizationService,
    activityLog,
  });
  const bookingService = createBookingService({
    repository: createPrismaBookingRepository(prisma),
    authorizationService,
    activityLog,
    fleetService,
  });
  const dashboardService = createDashboardService({
    repository: createPrismaDashboardRepository(prisma),
    authorizationService,
  });
  const pricingService = createPricingService({
    repository: createPrismaPricingRepository(prisma),
    authorizationService,
    activityLog,
  });
  const financeService = createFinanceService({
    repository: createPrismaFinanceRepository(prisma),
    authorizationService,
    activityLog,
  });

  const logger = { info() {}, warn() {}, error() {} };
  return createApp({
    prisma,
    logger,
    publicFleetRouter: createPublicFleetRouter({ fleetService, logger }),
    adminFleetRouter: createAdminFleetRouter({ fleetService, logger }),
    publicBookingRouter: createPublicBookingRouter({ bookingService, logger }),
    adminBookingRouter: createAdminBookingRouter({ bookingService, logger }),
    dashboardRouter: createDashboardRouter({ dashboardService, logger }),
    pricingRouter: createPricingRouter({ pricingService, logger }),
    financeRouter: createFinanceRouter({ financeService, logger }),
    authenticationMiddleware: (req, _res, next) => {
      const uid = req.headers['x-test-user'] || 'admin-1';
      req.userId = uid;
      req.auth = { userId: uid };
      next();
    },
  });
}

test('Cross-app operational flow: Public catalog -> Public booking -> Admin dashboard & transitions -> Restart persistence -> RBAC enforcement', async () => {
  const sharedPrisma = createStatefulPrismaStore();
  const catId = '11111111-1111-4111-8111-111111111111';
  const modId = '22222222-2222-4222-8222-222222222222';
  await sharedPrisma.vehicleCategory.create({
    data: { id: catId, slug: 'mpv-premium', name: 'MPV Premium', isActive: true, sortOrder: 1 },
  });
  await sharedPrisma.vehicleModel.create({
    data: { id: modId, categoryId: catId, slug: 'alphard-transformer', name: 'Toyota Alphard Transformer', seatCount: 6, isActive: true, isVerified: true },
  });
  await sharedPrisma.vehicleRentalOption.createMany({
    data: [
      { modelId: modId, rentalType: 'with_driver', isEnabled: true },
      { modelId: modId, rentalType: 'self_drive', isEnabled: false },
    ],
  });

  const permissions = {
    'admin-1': [
      'DASHBOARD_VIEW',
      'BOOKING_VIEW',
      'BOOKING_UPDATE',
      'BOOKING_APPROVE',
      'PRICING_VIEW',
      'FINANCE_VIEW',
    ],
    'staff-1': [
      'DASHBOARD_VIEW',
      'BOOKING_VIEW',
      'BOOKING_UPDATE',
    ],
  };

  // Start server #1
  const app1 = buildAppInstance(sharedPrisma, permissions);
  const server1 = app1.listen(0, '127.0.0.1');
  await new Promise((r) => server1.once('listening', r));
  const base1 = `http://127.0.0.1:${server1.address().port}`;

  try {
    // 1. Public Website fetches verified models
    const pubModelsRes = await fetch(`${base1}/api/v1/public/vehicle-models?categoryId=${catId}&rentalType=with_driver`);
    assert.equal(pubModelsRes.status, 200);
    const pubModels = await pubModelsRes.json();
    assert.equal(pubModels.items.length, 1);
    assert.equal(pubModels.items[0].id, modId);

    // 2. Public Website submits booking request
    const bookingPayload = {
      customerName: 'Budi Santoso',
      whatsappPhone: '+6281234567890',
      categoryId: catId,
      modelId: modId,
      rentalType: 'with_driver',
      startsOn: '2030-08-10',
      endsOn: '2030-08-12',
      pickupLocation: 'Bandara YIA Kulon Progo',
      additionalNotes: 'Jemput pukul 09.00 WIB',
    };
    const createRes = await fetch(`${base1}/api/v1/public/booking-requests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(bookingPayload),
    });
    assert.equal(createRes.status, 201);
    const created = await createRes.json();
    assert.match(created.bookingCode, /^BK-[A-Z0-9]{3}-[A-Z0-9]{3}$/);
    assert.equal(created.status, 'waiting_confirmation');
    assert.equal(created.whatsapp.available, false);

    // 3. Duplicate submission is rejected with 409
    const dupRes = await fetch(`${base1}/api/v1/public/booking-requests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(bookingPayload),
    });
    assert.equal(dupRes.status, 409);

    // 4. Admin Panel checks Dashboard Summary
    const dashRes = await fetch(`${base1}/api/v1/admin/dashboard/summary`, {
      headers: { 'x-test-user': 'admin-1' },
    });
    assert.equal(dashRes.status, 200);
    const dashBody = await dashRes.json();
    assert.equal(dashBody.summary.bookings.total, 1);
    assert.equal(dashBody.summary.bookings.waitingConfirmation, 1);

    // 5. Admin Panel lists bookings, reads the internal ID, and transitions: waiting_confirmation -> under_verification -> confirmed
    const adminListRes = await fetch(`${base1}/api/v1/admin/bookings`, {
      headers: { 'x-test-user': 'admin-1' },
    });
    assert.equal(adminListRes.status, 200);
    const adminListBody = await adminListRes.json();
    assert.equal(adminListBody.items.length, 1);
    const bookingId = adminListBody.items[0].id;
    assert.equal(adminListBody.items[0].bookingCode, created.bookingCode);

    const patch1 = await fetch(`${base1}/api/v1/admin/bookings/${bookingId}/status`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-test-user': 'staff-1' },
      body: JSON.stringify({ status: 'under_verification' }),
    });
    assert.equal(patch1.status, 200);

    const patch2 = await fetch(`${base1}/api/v1/admin/bookings/${bookingId}/status`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-test-user': 'admin-1' },
      body: JSON.stringify({ status: 'confirmed' }),
    });
    assert.equal(patch2.status, 200);
  } finally {
    await new Promise((r) => server1.close(r));
  }

  // 6. Simulate Server Restart: instantiate a brand-new app & repositories over the persistent store
  const app2 = buildAppInstance(sharedPrisma, permissions);
  const server2 = app2.listen(0, '127.0.0.1');
  await new Promise((r) => server2.once('listening', r));
  const base2 = `http://127.0.0.1:${server2.address().port}`;

  try {
    const listAfterRestart = await fetch(`${base2}/api/v1/admin/bookings`, {
      headers: { 'x-test-user': 'admin-1' },
    });
    assert.equal(listAfterRestart.status, 200);
    const listBody = await listAfterRestart.json();
    assert.equal(listBody.items.length, 1);
    assert.equal(listBody.items[0].status, 'confirmed');
    assert.equal(listBody.items[0].customerName, 'Budi Santoso');

    const dashAfterRestart = await fetch(`${base2}/api/v1/admin/dashboard/summary`, {
      headers: { 'x-test-user': 'admin-1' },
    });
    const dashBody2 = await dashAfterRestart.json();
    assert.equal(dashBody2.summary.bookings.confirmed, 1);

    // 7. Verify RBAC: STAFF is denied pricing & finance (403), ADMIN is allowed (200)
    const staffPricing = await fetch(`${base2}/api/v1/admin/pricing`, {
      headers: { 'x-test-user': 'staff-1' },
    });
    assert.equal(staffPricing.status, 403);

    const staffFinance = await fetch(`${base2}/api/v1/admin/finance`, {
      headers: { 'x-test-user': 'staff-1' },
    });
    assert.equal(staffFinance.status, 403);

    const adminPricing = await fetch(`${base2}/api/v1/admin/pricing`, {
      headers: { 'x-test-user': 'admin-1' },
    });
    assert.equal(adminPricing.status, 200);
  } finally {
    await new Promise((r) => server2.close(r));
  }
});
