import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../../src/app.js';
import { createCsrfMiddleware } from '../../src/middlewares/csrf.middleware.js';
import { createFleetService } from '../../src/fleet/fleet.service.js';
import { createAdminFleetRouter } from '../../src/fleet/fleet.routes.js';
import { createDashboardService } from '../../src/dashboard/dashboard.service.js';
import { createDashboardRouter } from '../../src/dashboard/dashboard.routes.js';
import { createBookingService } from '../../src/booking/booking.service.js';
import { createAdminBookingRouter } from '../../src/booking/booking.routes.js';
import { createInMemoryBookingRepository } from '../../src/booking/in-memory-booking.repository.js';
import { createCustomerService } from '../../src/customer/customer.service.js';
import { createCustomerRouter } from '../../src/customer/customer.routes.js';
import { createInMemoryCustomerRepository } from '../../src/customer/in-memory-customer.repository.js';
import { createPricingService } from '../../src/pricing/pricing.service.js';
import { createPricingRouter } from '../../src/pricing/pricing.routes.js';
import { createInMemoryPricingRepository } from '../../src/pricing/in-memory-pricing.repository.js';
import { createFinanceService } from '../../src/finance/finance.service.js';
import { createFinanceRouter } from '../../src/finance/finance.routes.js';
import { createInMemoryFinanceRepository } from '../../src/finance/in-memory-finance.repository.js';
import { createInboxService } from '../../src/inbox/inbox.service.js';
import { createInboxRouter } from '../../src/inbox/inbox.routes.js';
import { createInMemoryInboxRepository } from '../../src/inbox/in-memory-inbox.repository.js';
import { createContentService } from '../../src/content/content.service.js';
import { createContentRouter } from '../../src/content/content.routes.js';
import { createInMemoryContentRepository } from '../../src/content/in-memory-content.repository.js';
import { createAnalyticsService } from '../../src/analytics/analytics.service.js';
import { createAnalyticsRouter } from '../../src/analytics/analytics.routes.js';
import { createSettingsService } from '../../src/settings/settings.service.js';
import { createSettingsRouter } from '../../src/settings/settings.routes.js';
import { createInMemorySettingsRepository } from '../../src/settings/in-memory-settings.repository.js';

const ROLE_PERMISSIONS = Object.freeze({
  STAFF: new Set([
    'DASHBOARD_VIEW', 'CUSTOMER_VIEW', 'BOOKING_VIEW', 'BOOKING_UPDATE', 'BOOKING_APPROVE',
    'FLEET_VIEW', 'ANALYTICS_VIEW', 'MESSAGE_VIEW', 'MESSAGE_UPDATE', 'CONTENT_VIEW',
    'SETTINGS_VIEW', 'SETTINGS_UPDATE',
  ]),
  ADMIN: new Set([
    'USER_VIEW', 'DASHBOARD_VIEW',
    'CUSTOMER_VIEW', 'CUSTOMER_CREATE', 'CUSTOMER_UPDATE', 'CUSTOMER_DELETE', 'CUSTOMER_EXPORT',
    'BOOKING_VIEW', 'BOOKING_CREATE', 'BOOKING_UPDATE', 'BOOKING_DELETE', 'BOOKING_EXPORT', 'BOOKING_APPROVE',
    'FLEET_VIEW', 'FLEET_CREATE', 'FLEET_UPDATE', 'FLEET_DELETE', 'FLEET_EXPORT', 'FLEET_APPROVE',
    'PRICING_VIEW', 'PRICING_CREATE', 'PRICING_UPDATE', 'PRICING_DELETE', 'PRICING_EXPORT', 'PRICING_APPROVE',
    'ANALYTICS_VIEW', 'ANALYTICS_EXPORT',
    'FINANCE_VIEW', 'FINANCE_CREATE', 'FINANCE_UPDATE', 'FINANCE_DELETE', 'FINANCE_EXPORT', 'FINANCE_APPROVE',
    'MESSAGE_VIEW', 'MESSAGE_CREATE', 'MESSAGE_UPDATE', 'MESSAGE_DELETE', 'MESSAGE_EXPORT', 'MESSAGE_APPROVE',
    'CONTENT_VIEW', 'CONTENT_CREATE', 'CONTENT_UPDATE', 'CONTENT_DELETE', 'CONTENT_EXPORT', 'CONTENT_APPROVE',
    'SETTINGS_VIEW', 'SETTINGS_UPDATE',
  ]),
  SUPER_ADMIN: new Set(['*']),
});

function createTestAuthorizationService(userRoles = {}) {
  const hasPermission = async (userId, permission) => {
    if (!userId) return false;
    const role = userRoles[userId];
    if (!role) return false;
    const grants = ROLE_PERMISSIONS[role];
    return Boolean(grants && (grants.has('*') || grants.has(permission)));
  };
  return Object.freeze({
    hasPermission,
    async requirePermission(userId, permission) {
      if (!(await hasPermission(userId, permission))) {
        const err = new Error('Permission denied');
        err.code = 'FORBIDDEN';
        err.status = 403;
        throw err;
      }
    },
  });
}

function buildAdminHttpApp() {
  const csrfMiddleware = createCsrfMiddleware({ secret: Buffer.alloc(32, 7) });
  const authorizationService = createTestAuthorizationService({
    'staff-1': 'STAFF',
    'admin-1': 'ADMIN',
    'super-1': 'SUPER_ADMIN',
  });
  const activityLog = { log: async () => {} };
  const logger = { info: () => {}, warn: () => {}, error: () => {} };
  const settingsRepository = createInMemorySettingsRepository();

  const fleetRepo = {
    transaction: (work) => work(fleetRepo),
    category: { list: async () => [], count: async () => 0 },
    model: { list: async () => [], count: async () => 0 },
    rentalOption: {},
    public: { rentalTypes: async () => [], categories: async () => [], models: async () => [], modelCount: async () => 0 },
  };
  const fleetService = createFleetService({ repository: fleetRepo, authorizationService, activityLog, settingsRepository });
  const dashboardService = createDashboardService({
    repository: {
      countCategories: async () => 0,
      countModels: async () => 0,
      countRentalCapabilities: async () => 0,
      countBookings: async () => 0,
    },
    authorizationService,
  });
  const bookingService = createBookingService({
    repository: createInMemoryBookingRepository([]),
    authorizationService,
    activityLog,
    fleetService,
    pricingRepository: createInMemoryPricingRepository([]),
    settingsRepository,
  });
  const customerService = createCustomerService({
    repository: createInMemoryCustomerRepository([]),
    authorizationService,
    activityLog,
  });
  const pricingService = createPricingService({
    repository: createInMemoryPricingRepository([]),
    authorizationService,
    activityLog,
    settingsRepository,
  });
  const financeService = createFinanceService({
    repository: createInMemoryFinanceRepository([]),
    authorizationService,
    activityLog,
  });
  const inboxService = createInboxService({
    repository: createInMemoryInboxRepository([]),
    authorizationService,
    activityLog,
    settingsRepository,
  });
  const contentService = createContentService({
    repository: createInMemoryContentRepository([]),
    authorizationService,
    activityLog,
    settingsRepository,
  });
  const analyticsService = createAnalyticsService({ authorizationService });
  const settingsService = createSettingsService({
    repository: settingsRepository,
    authorizationService,
    activityLog,
  });

  return createApp({
    logger,
    csrfMiddleware,
    authenticationMiddleware: (req, _res, next) => {
      const testUser = req.headers['x-test-user'];
      if (typeof testUser === 'string' && testUser) {
        req.userId = testUser;
      }
      next();
    },
    adminFleetRouter: createAdminFleetRouter({ fleetService, logger }),
    dashboardRouter: createDashboardRouter({ dashboardService, logger }),
    adminBookingRouter: createAdminBookingRouter({ bookingService, logger }),
    customerRouter: createCustomerRouter({ customerService, logger }),
    pricingRouter: createPricingRouter({ pricingService, logger }),
    financeRouter: createFinanceRouter({ financeService, logger }),
    inboxRouter: createInboxRouter({ inboxService, logger }),
    contentRouter: createContentRouter({ contentService, logger }),
    analyticsRouter: createAnalyticsRouter({ analyticsService, logger }),
    settingsRouter: createSettingsRouter({ settingsService, logger }),
  });
}

async function withServer(app, fn) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    return await fn(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('unauthenticated GET requests to every /api/v1/admin module return 401 UNAUTHENTICATED, never 403', async () => {
  const adminGetPaths = [
    '/api/v1/admin/dashboard/summary',
    '/api/v1/admin/vehicle-categories',
    '/api/v1/admin/vehicle-models',
    '/api/v1/admin/bookings',
    '/api/v1/admin/customers',
    '/api/v1/admin/pricing',
    '/api/v1/admin/finance',
    '/api/v1/admin/finance/summary',
    '/api/v1/admin/messages',
    '/api/v1/admin/content',
    '/api/v1/admin/analytics/overview',
    '/api/v1/admin/analytics/export?format=json',
    '/api/v1/admin/settings',
  ];

  await withServer(buildAdminHttpApp(), async (baseUrl) => {
    for (const path of adminGetPaths) {
      const response = await fetch(`${baseUrl}${path}`);
      const payload = await response.json();
      assert.equal(response.status, 401, `${path} should return 401 when unauthenticated, got ${response.status}`);
      assert.equal(payload.error?.code, 'UNAUTHENTICATED', `${path} should return error code UNAUTHENTICATED`);
    }
  });
});

test('expired session state-changing /api/v1/admin requests preserve CSRF check (403 CSRF_INVALID) and return 401 when CSRF is valid', async () => {
  await withServer(buildAdminHttpApp(), async (baseUrl) => {
    const noCsrf = await fetch(`${baseUrl}/api/v1/admin/customers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Should fail CSRF first' }),
    });
    assert.equal(noCsrf.status, 403);
    assert.equal((await noCsrf.json()).error?.code, 'CSRF_INVALID');

    const csrfProbe = await fetch(`${baseUrl}/api/v1/admin/dashboard/summary`);
    const cookieHeader = csrfProbe.headers.get('set-cookie');
    const match = cookieHeader?.match(/__csrf=([^;]+)/);
    assert.ok(match?.[1], 'CSRF cookie must be issued by middleware');

    const csrfToken = decodeURIComponent(match[1]);
    const mutations = [
      { method: 'POST', path: '/api/v1/admin/customers', body: { name: 'Expired Session' } },
      { method: 'POST', path: '/api/v1/admin/pricing', body: { modelId: '00000000-0000-4000-8000-000000000001', rentalType: 'with_driver', baseRate: 500000 } },
      { method: 'POST', path: '/api/v1/admin/finance', body: { type: 'income', amount: 100000 } },
      { method: 'POST', path: '/api/v1/admin/content', body: { title: 'Expired' } },
      { method: 'PATCH', path: '/api/v1/admin/settings/companyName', body: { value: 'Anatalia' } },
    ];

    for (const item of mutations) {
      const response = await fetch(`${baseUrl}${item.path}`, {
        method: item.method,
        headers: {
          'content-type': 'application/json',
          cookie: `__csrf=${encodeURIComponent(csrfToken)}`,
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify(item.body),
      });
      const payload = await response.json();
      assert.equal(response.status, 401, `${item.method} ${item.path} with expired session and valid CSRF must return 401`);
      assert.equal(payload.error?.code, 'UNAUTHENTICATED');
    }
  });
});

test('authenticated STAFF is denied restricted modules with 403 FORBIDDEN while permitted modules succeed', async () => {
  await withServer(buildAdminHttpApp(), async (baseUrl) => {
    const csrfProbe = await fetch(`${baseUrl}/api/v1/admin/bookings`, {
      headers: { 'x-test-user': 'staff-1' },
    });
    assert.equal(csrfProbe.status, 200);
    const csrfToken = decodeURIComponent(csrfProbe.headers.get('set-cookie').match(/__csrf=([^;]+)/)[1]);

    const deniedPaths = [
      { method: 'GET', path: '/api/v1/admin/pricing' },
      { method: 'GET', path: '/api/v1/admin/finance' },
      { method: 'GET', path: '/api/v1/admin/finance/summary' },
      { method: 'GET', path: '/api/v1/admin/analytics/export?format=json' },
      { method: 'POST', path: '/api/v1/admin/customers', body: { name: 'Forbidden For Staff' } },
      { method: 'POST', path: '/api/v1/admin/content', body: { title: 'Forbidden Create' } },
    ];

    for (const entry of deniedPaths) {
      const res = await fetch(`${baseUrl}${entry.path}`, {
        method: entry.method,
        headers: {
          'x-test-user': 'staff-1',
          'content-type': 'application/json',
          cookie: `__csrf=${encodeURIComponent(csrfToken)}`,
          'X-CSRF-Token': csrfToken,
        },
        ...(entry.body ? { body: JSON.stringify(entry.body) } : {}),
      });
      assert.equal(res.status, 403, `STAFF ${entry.method} ${entry.path} must return 403 FORBIDDEN`);
      assert.equal((await res.json()).error?.code, 'FORBIDDEN');
    }

    const adminFinance = await fetch(`${baseUrl}/api/v1/admin/finance`, {
      headers: { 'x-test-user': 'admin-1' },
    });
    assert.equal(adminFinance.status, 200);

    const superSettings = await fetch(`${baseUrl}/api/v1/admin/settings`, {
      headers: { 'x-test-user': 'super-1' },
    });
    assert.equal(superSettings.status, 200);
  });
});
