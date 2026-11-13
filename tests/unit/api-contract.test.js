import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import express from 'express';
import test from 'node:test';
import { createAuthorizationService } from '../../src/auth/authorization-service.js';
import { createFleetService } from '../../src/fleet/fleet.service.js';
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

test('Contract: createAuthorizationService exposes hasPermission compatible with all business services', async () => {
  const mockPrisma = {
    userRole: {
      findMany: async ({ where }) => {
        if (where.userId === 'admin-1') {
          return [{ role: { permissions: [{ permission: { code: 'CUSTOMER_VIEW' } }, { permission: { code: 'PRICING_VIEW' } }] } }];
        }
        return [];
      },
    },
  };
  const authService = createAuthorizationService({ prisma: mockPrisma });
  assert.equal(typeof authService.hasPermission, 'function');
  assert.equal(await authService.hasPermission('admin-1', 'CUSTOMER_VIEW'), true);
  assert.equal(await authService.hasPermission('admin-1', 'USER_DELETE'), false);
  assert.equal(await authService.hasPermission(null, 'CUSTOMER_VIEW'), false);
});

test('Contract: createFleetService exposes findModelForPublicBooking with UUID and rentalType validation', async () => {
  const validCatId = '00000000-0000-4000-8000-000000000001';
  const validModelId = '00000000-0000-4000-8000-000000000002';
  const fleetService = createFleetService({
    repository: {
      public: {
        models: async (where) => {
          if (where.id === validModelId && where.categoryId === validCatId) {
            return [{ id: validModelId, categoryId: validCatId, name: 'Innova Zenix' }];
          }
          return [];
        },
      },
    },
    authorizationService: { requirePermission: async () => {} },
    activityLog: { log: async () => {} },
  });

  assert.equal(typeof fleetService.findModelForPublicBooking, 'function');
  const found = await fleetService.findModelForPublicBooking({
    modelId: validModelId,
    categoryId: validCatId,
    rentalType: 'with_driver',
  });
  assert.equal(found?.id, validModelId);

  // Invalid UUID or unsupported rentalType returns null
  assert.equal(await fleetService.findModelForPublicBooking({ modelId: 'not-a-uuid', categoryId: validCatId, rentalType: 'with_driver' }), null);
  assert.equal(await fleetService.findModelForPublicBooking({ modelId: validModelId, categoryId: validCatId, rentalType: 'invalid_type' }), null);
});

test('Contract: HTTP routes for customer, pricing, finance, inbox, content, analytics, and settings match frontend expectations', async () => {
  const granted = new Set([
    'CUSTOMER_VIEW', 'CUSTOMER_CREATE', 'CUSTOMER_UPDATE', 'CUSTOMER_DELETE',
    'PRICING_VIEW', 'PRICING_CREATE', 'PRICING_UPDATE', 'PRICING_DELETE',
    'FINANCE_VIEW', 'FINANCE_CREATE',
    'MESSAGE_VIEW', 'MESSAGE_UPDATE',
    'CONTENT_VIEW', 'CONTENT_CREATE', 'CONTENT_UPDATE', 'CONTENT_DELETE',
    'ANALYTICS_VIEW', 'ANALYTICS_EXPORT',
    'SETTINGS_VIEW', 'SETTINGS_UPDATE',
  ]);
  const authorizationService = {
    hasPermission: async (userId, perm) => userId === 'admin' && granted.has(perm),
  };

  const inboxRepo = createInMemoryInboxRepository([
    { id: 'msg-1', senderName: 'Siti', senderEmail: 'siti@example.com', subject: 'Tanya sewa', content: 'Info Hiace', status: 'unread', createdAt: '2026-11-05T10:00:00.000Z' },
  ]);

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.userId = req.headers['x-test-user']; next(); });
  app.use('/api/v1/admin', createCustomerRouter({ customerService: createCustomerService({ repository: createInMemoryCustomerRepository(), authorizationService }) }));
  app.use('/api/v1/admin', createPricingRouter({ pricingService: createPricingService({ repository: createInMemoryPricingRepository(), authorizationService }) }));
  app.use('/api/v1/admin', createFinanceRouter({ financeService: createFinanceService({ repository: createInMemoryFinanceRepository(), authorizationService }) }));
  app.use('/api/v1/admin', createInboxRouter({ inboxService: createInboxService({ repository: inboxRepo, authorizationService }) }));
  app.use('/api/v1/admin', createContentRouter({ contentService: createContentService({ repository: createInMemoryContentRepository(), authorizationService }) }));
  app.use('/api/v1/admin', createAnalyticsRouter({ analyticsService: createAnalyticsService({ authorizationService }) }));
  app.use('/api/v1/admin', createSettingsRouter({ settingsService: createSettingsService({ repository: createInMemorySettingsRepository(), authorizationService }) }));

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api/v1/admin`;
  const headers = { 'content-type': 'application/json', 'x-test-user': 'admin' };

  try {
    // 1. Customers CRUD contract
    const cCreate = await fetch(`${base}/customers`, { method: 'POST', headers, body: JSON.stringify({ name: 'Rina', phone: '+62811223344', email: 'rina@example.com' }) });
    assert.equal(cCreate.status, 201);
    const { item: customer } = await cCreate.json();
    assert.equal(customer.name, 'Rina');

    const cList = await (await fetch(`${base}/customers?q=rina`, { headers })).json();
    assert.equal(cList.items.length, 1);
    assert.equal(cList.page.total, 1);

    const cPatch = await fetch(`${base}/customers/${customer.id}`, { method: 'PATCH', headers, body: JSON.stringify({ notes: 'Pelanggan tetap' }) });
    assert.equal(cPatch.status, 200);
    assert.equal((await cPatch.json()).item.notes, 'Pelanggan tetap');

    const cDel = await fetch(`${base}/customers/${customer.id}`, { method: 'DELETE', headers });
    assert.equal(cDel.status, 200);
    assert.equal((await cDel.json()).success, true);

    // 2. Pricing CRUD contract
    const pCreate = await fetch(`${base}/pricing`, { method: 'POST', headers, body: JSON.stringify({ modelId: 'm-1', rentalType: 'with_driver', baseRate: 850000 }) });
    assert.equal(pCreate.status, 201);
    const { item: pricing } = await pCreate.json();
    assert.equal(pricing.baseRate, 850000);
    assert.equal(pricing.billingUnit, 'day');

    const pDel = await fetch(`${base}/pricing/${pricing.id}`, { method: 'DELETE', headers });
    assert.equal(pDel.status, 200);

    // 3. Finance contract (list, create, summary shape)
    const fCreate = await fetch(`${base}/finance`, { method: 'POST', headers, body: JSON.stringify({ type: 'income', amount: 1500000, category: 'booking', description: 'DP Sewa' }) });
    assert.equal(fCreate.status, 201);
    const fSummary = await (await fetch(`${base}/finance/summary`, { headers })).json();
    assert.equal(fSummary.totalRevenue, 1500000);
    assert.equal(fSummary.totalExpenses, 0);
    assert.equal(fSummary.netProfit, 1500000);
    assert.equal(fSummary.transactionCount, 1);
    assert.equal(typeof fSummary.note, 'string');

    // 4. Inbox contract (list, status patch, note creation, 404 on missing message)
    const mStatus = await fetch(`${base}/messages/msg-1/status`, { method: 'PATCH', headers, body: JSON.stringify({ status: 'read' }) });
    assert.equal(mStatus.status, 200);
    assert.equal((await mStatus.json()).item.status, 'read');

    const mNote = await fetch(`${base}/messages/msg-1/notes`, { method: 'POST', headers, body: JSON.stringify({ note: 'Sudah dihubungi' }) });
    assert.equal(mNote.status, 201);
    assert.equal((await fetch(`${base}/messages/missing-id/notes`, { method: 'POST', headers, body: JSON.stringify({ note: 'Test' }) })).status, 404);

    // 5. Content contract
    const cntCreate = await fetch(`${base}/content`, { method: 'POST', headers, body: JSON.stringify({ title: 'Panduan Sewa', slug: 'panduan-sewa', section: 'faq' }) });
    assert.equal(cntCreate.status, 201);
    const { item: contentItem } = await cntCreate.json();
    assert.equal(contentItem.status, 'draft');
    assert.equal((await fetch(`${base}/content/${contentItem.id}`, { method: 'DELETE', headers })).status, 200);

    // 6. Analytics & Settings contract
    const aOverview = await (await fetch(`${base}/analytics/overview?range=7d`, { headers })).json();
    assert.equal(aOverview.range, '7d');
    assert.equal(typeof aOverview.metrics.totalBookings, 'number');

    const sPatch = await fetch(`${base}/settings/companyName`, { method: 'PATCH', headers, body: JSON.stringify({ value: 'PT Anantalia Trans' }) });
    assert.equal(sPatch.status, 200);
    const sAll = await (await fetch(`${base}/settings`, { headers })).json();
    assert.equal(sAll.settings.companyName, 'PT Anantalia Trans');
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('Contract: docs/api/openapi.yaml documents all mounted API paths', () => {
  const openapiPath = path.resolve(import.meta.dirname, '../../docs/api/openapi.yaml');
  const openapiText = fs.readFileSync(openapiPath, 'utf8');

  const expectedPaths = [
    '/health:',
    '/api/v1/public/rental-types:',
    '/api/v1/public/vehicle-categories:',
    '/api/v1/public/vehicle-models:',
    '/api/v1/public/booking-requests:',
    '/auth/csrf:',
    '/auth/login:',
    '/auth/mfa/verify:',
    '/auth/session:',
    '/auth/me:',
    '/auth/session/rotate:',
    '/auth/sessions/revoke-all:',
    '/auth/logout:',
    '/api/admin/create:',
    '/api/admin/list:',
    '/api/admin/{id}:',
    '/api/admin/{id}/role:',
    '/api/me:',
    '/api/me/mfa/status:',
    '/api/me/mfa/totp/enroll:',
    '/api/me/mfa/totp/confirm:',
    '/api/me/mfa/totp/revoke:',
    '/api/v1/admin/dashboard/summary:',
    '/api/v1/admin/bookings:',
    '/api/v1/admin/bookings/{id}:',
    '/api/v1/admin/bookings/{id}/status:',
    '/api/v1/admin/customers:',
    '/api/v1/admin/customers/{id}:',
    '/api/v1/admin/pricing:',
    '/api/v1/admin/pricing/{id}:',
    '/api/v1/admin/finance:',
    '/api/v1/admin/finance/summary:',
    '/api/v1/admin/finance/{id}:',
    '/api/v1/admin/messages:',
    '/api/v1/admin/messages/{id}:',
    '/api/v1/admin/messages/{id}/status:',
    '/api/v1/admin/messages/{id}/notes:',
    '/api/v1/admin/content:',
    '/api/v1/admin/content/{id}:',
    '/api/v1/admin/analytics/overview:',
    '/api/v1/admin/analytics/export:',
    '/api/v1/admin/settings:',
    '/api/v1/admin/settings/{key}:',
  ];

  for (const routeKey of expectedPaths) {
    assert.equal(openapiText.includes(routeKey), true, `Missing path in openapi.yaml: ${routeKey}`);
  }
});
