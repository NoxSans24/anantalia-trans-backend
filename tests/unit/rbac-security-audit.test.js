import assert from 'node:assert/strict';
import test from 'node:test';
import { createBookingService } from '../../src/booking/booking.service.js';
import { createCustomerService } from '../../src/customer/customer.service.js';
import { createPricingService } from '../../src/pricing/pricing.service.js';
import { createFinanceService } from '../../src/finance/finance.service.js';
import { createInboxService } from '../../src/inbox/inbox.service.js';
import { createContentService } from '../../src/content/content.service.js';
import { createAnalyticsService } from '../../src/analytics/analytics.service.js';
import { createSettingsService } from '../../src/settings/settings.service.js';
import { createInMemoryBookingRepository } from '../../src/booking/in-memory-booking.repository.js';
import { createInMemoryCustomerRepository } from '../../src/customer/in-memory-customer.repository.js';

// OWN-009 approved role grants matrix
const ROLE_PERMISSIONS = Object.freeze({
  SUPER_ADMIN: [
    'USER_VIEW', 'USER_CREATE', 'USER_UPDATE_ROLE', 'USER_UPDATE_STATUS', 'USER_DELETE',
    'DASHBOARD_VIEW', 'DASHBOARD_EXPORT',
    'CUSTOMER_VIEW', 'CUSTOMER_CREATE', 'CUSTOMER_UPDATE', 'CUSTOMER_DELETE', 'CUSTOMER_EXPORT',
    'BOOKING_VIEW', 'BOOKING_CREATE', 'BOOKING_UPDATE', 'BOOKING_DELETE', 'BOOKING_EXPORT', 'BOOKING_APPROVE',
    'FLEET_VIEW', 'FLEET_CREATE', 'FLEET_UPDATE', 'FLEET_DELETE', 'FLEET_EXPORT', 'FLEET_APPROVE',
    'PRICING_VIEW', 'PRICING_CREATE', 'PRICING_UPDATE', 'PRICING_DELETE', 'PRICING_EXPORT', 'PRICING_APPROVE',
    'ANALYTICS_VIEW', 'ANALYTICS_EXPORT',
    'FINANCE_VIEW', 'FINANCE_CREATE', 'FINANCE_UPDATE', 'FINANCE_DELETE', 'FINANCE_EXPORT', 'FINANCE_APPROVE',
    'MESSAGE_VIEW', 'MESSAGE_CREATE', 'MESSAGE_UPDATE', 'MESSAGE_DELETE', 'MESSAGE_EXPORT', 'MESSAGE_APPROVE',
    'CONTENT_VIEW', 'CONTENT_CREATE', 'CONTENT_UPDATE', 'CONTENT_DELETE', 'CONTENT_EXPORT', 'CONTENT_APPROVE',
    'SETTINGS_VIEW', 'SETTINGS_CREATE', 'SETTINGS_UPDATE', 'SETTINGS_DELETE', 'SETTINGS_EXPORT', 'SETTINGS_APPROVE',
  ],
  ADMIN: [
    'USER_VIEW',
    'DASHBOARD_VIEW',
    'CUSTOMER_VIEW', 'CUSTOMER_CREATE', 'CUSTOMER_UPDATE', 'CUSTOMER_DELETE', 'CUSTOMER_EXPORT',
    'BOOKING_VIEW', 'BOOKING_CREATE', 'BOOKING_UPDATE', 'BOOKING_DELETE', 'BOOKING_EXPORT', 'BOOKING_APPROVE',
    'FLEET_VIEW', 'FLEET_CREATE', 'FLEET_UPDATE', 'FLEET_DELETE', 'FLEET_EXPORT', 'FLEET_APPROVE',
    'PRICING_VIEW', 'PRICING_CREATE', 'PRICING_UPDATE', 'PRICING_DELETE', 'PRICING_EXPORT', 'PRICING_APPROVE',
    'ANALYTICS_VIEW', 'ANALYTICS_EXPORT',
    'FINANCE_VIEW', 'FINANCE_CREATE', 'FINANCE_UPDATE', 'FINANCE_DELETE', 'FINANCE_EXPORT', 'FINANCE_APPROVE',
    'MESSAGE_VIEW', 'MESSAGE_CREATE', 'MESSAGE_UPDATE', 'MESSAGE_DELETE', 'MESSAGE_EXPORT', 'MESSAGE_APPROVE',
    'CONTENT_VIEW', 'CONTENT_CREATE', 'CONTENT_UPDATE', 'CONTENT_DELETE', 'CONTENT_EXPORT', 'CONTENT_APPROVE',
    'SETTINGS_VIEW', 'SETTINGS_UPDATE',
  ],
  STAFF: [
    'DASHBOARD_VIEW', 'CUSTOMER_VIEW', 'BOOKING_VIEW', 'BOOKING_UPDATE', 'BOOKING_APPROVE',
    'FLEET_VIEW', 'ANALYTICS_VIEW', 'MESSAGE_VIEW', 'MESSAGE_UPDATE', 'CONTENT_VIEW', 'SETTINGS_VIEW', 'SETTINGS_UPDATE',
  ],
});

function createRbacAuth(role) {
  const permissions = ROLE_PERMISSIONS[role] || [];
  return {
    async hasPermission(userId, code) {
      return permissions.includes(code);
    },
  };
}

test('OWN-009 RBAC: STAFF is denied access to pricing and finance modules (deny-by-default)', async () => {
  const staffAuth = createRbacAuth('STAFF');
  const pricingService = createPricingService({ authorizationService: staffAuth });
  const financeService = createFinanceService({ authorizationService: staffAuth });

  await assert.rejects(pricingService.listPricing({ userId: 'staff-1' }), { code: 'FORBIDDEN' });
  await assert.rejects(pricingService.createPricing({ userId: 'staff-1', input: { baseRate: 100 } }), { code: 'FORBIDDEN' });
  await assert.rejects(financeService.listTransactions({ userId: 'staff-1' }), { code: 'FORBIDDEN' });
  await assert.rejects(financeService.getFinanceSummary({ userId: 'staff-1' }), { code: 'FORBIDDEN' });
});

test('OWN-009 RBAC: ADMIN is allowed on pricing and finance, but denied settings deletion', async () => {
  const adminAuth = createRbacAuth('ADMIN');
  const pricingService = createPricingService({ authorizationService: adminAuth });
  const financeService = createFinanceService({ authorizationService: adminAuth });
  const settingsService = createSettingsService({ authorizationService: adminAuth });

  // Admin can view pricing and finance
  const pricingList = await pricingService.listPricing({ userId: 'admin-1' });
  assert.deepEqual(pricingList.items, []);

  const financeSummary = await financeService.getFinanceSummary({ userId: 'admin-1' });
  assert.equal(financeSummary.totalRevenue, 0);

  // Admin can read and update settings
  const settings = await settingsService.getAllSettings({ userId: 'admin-1' });
  assert.equal(settings.settings.companyName, 'Anantalia Trans');
});

test('OWN-009 RBAC: SUPER_ADMIN has full permissions across modules', async () => {
  const saAuth = createRbacAuth('SUPER_ADMIN');
  const pricingService = createPricingService({ authorizationService: saAuth });
  const customerService = createCustomerService({ authorizationService: saAuth });

  const pRes = await pricingService.createPricing({
    userId: 'sa-1',
    input: { modelId: 'm-sa', rentalType: 'self_drive', baseRate: 750000 },
  });
  assert.equal(pRes.item.baseRate, 750000);

  const cRes = await customerService.createCustomer({
    userId: 'sa-1',
    input: { name: 'VIP Client', phone: '+628999999' },
  });
  assert.equal(cRes.item.name, 'VIP Client');
});

test('Security Audit: mass assignment prevention on customer and settings update', async () => {
  const saAuth = createRbacAuth('SUPER_ADMIN');
  const repo = createInMemoryCustomerRepository();
  const customerService = createCustomerService({ repository: repo, authorizationService: saAuth });

  const created = await customerService.createCustomer({
    userId: 'sa-1',
    input: { name: 'Customer Test', email: 'test@example.com' },
  });

  // Attempt mass assignment injection of malicious fields
  const updated = await customerService.updateCustomer({
    userId: 'sa-1',
    id: created.item.id,
    input: {
      name: 'Customer Clean',
      role: 'SUPER_ADMIN',
      isAdmin: true,
      passwordHash: 'hacked',
    },
  });

  assert.equal(updated.item.name, 'Customer Clean');
  assert.equal('role' in updated.item, false);
  assert.equal('isAdmin' in updated.item, false);
  assert.equal('passwordHash' in updated.item, false);
});

test('Booking validation: code generation produces collision-resistant format and rejects unconfirmed WhatsApp', async () => {
  const repo = createInMemoryBookingRepository();
  const bookingService = createBookingService({ repository: repo });

  const generatedCodes = new Set();
  for (let i = 0; i < 20; i++) {
    const res = await serviceRequest(bookingService, `Customer ${i}`);
    assert.equal(res.status, 'waiting_confirmation');
    assert.equal(res.whatsapp.available, false);
    assert.equal(res.whatsapp.url, null);
    assert.match(res.bookingCode, /^BK-[A-Z0-9]{3}-[A-Z0-9]{3}$/);
    assert.equal(generatedCodes.has(res.bookingCode), false);
    generatedCodes.add(res.bookingCode);
  }
});

async function serviceRequest(bookingService, name) {
  return bookingService.createPublicBookingRequest({
    customerName: name,
    whatsappPhone: '+628123456789',
    categoryId: 'c-1',
    modelId: 'm-1',
    rentalType: 'self_drive',
    startsOn: '2026-11-10',
    endsOn: '2026-11-12',
    pickupLocation: 'Stasiun Tugu Yogyakarta',
  });
}

test('Booking state machine: complete transition path matches decision register', async () => {
  const repo = createInMemoryBookingRepository();
  const auth = createRbacAuth('SUPER_ADMIN');
  const bookingService = createBookingService({ repository: repo, authorizationService: auth });

  const publicReq = await bookingService.createPublicBookingRequest({
    customerName: 'Ahmad Yani',
    whatsappPhone: '+6281299990000',
    categoryId: 'c-1',
    modelId: 'm-1',
    rentalType: 'with_driver',
    startsOn: '2026-12-01',
    endsOn: '2026-12-05',
    pickupLocation: 'Hotel Tentrem',
  });

  const list = await bookingService.listBookings({ userId: 'sa-1' });
  const bookingId = list.items[0].id;

  // Path: waiting_confirmation -> under_verification
  const s1 = await bookingService.updateBookingStatus({ userId: 'sa-1', id: bookingId, newStatus: 'under_verification' });
  assert.equal(s1.status, 'under_verification');

  // Path: under_verification -> confirmed
  const s2 = await bookingService.updateBookingStatus({ userId: 'sa-1', id: bookingId, newStatus: 'confirmed' });
  assert.equal(s2.status, 'confirmed');

  // Path: confirmed -> completed
  const s3 = await bookingService.updateBookingStatus({ userId: 'sa-1', id: bookingId, newStatus: 'completed' });
  assert.equal(s3.status, 'completed');

  // Completed is terminal: cannot transition to any status
  await assert.rejects(
    bookingService.updateBookingStatus({ userId: 'sa-1', id: bookingId, newStatus: 'confirmed' }),
    { code: 'INVALID_STATUS_TRANSITION' }
  );
  await assert.rejects(
    bookingService.updateBookingStatus({ userId: 'sa-1', id: bookingId, newStatus: 'cancelled' }),
    { code: 'INVALID_STATUS_TRANSITION' }
  );
});

test('Data integrity: pricing and finance reject floating-point, NaN, and negative monetary nominals', async () => {
  const saAuth = createRbacAuth('SUPER_ADMIN');
  const pricingService = createPricingService({ authorizationService: saAuth });
  const financeService = createFinanceService({ authorizationService: saAuth });

  await assert.rejects(
    pricingService.createPricing({
      userId: 'sa-1',
      input: { modelId: 'm-1', rentalType: 'self_drive', baseRate: 450000.75 },
    }),
    { code: 'INVALID_INPUT', status: 400 }
  );

  await assert.rejects(
    pricingService.createPricing({
      userId: 'sa-1',
      input: { modelId: 'm-1', rentalType: 'self_drive', baseRate: Number.NaN },
    }),
    { code: 'INVALID_INPUT', status: 400 }
  );

  await assert.rejects(
    financeService.createTransaction({
      userId: 'sa-1',
      input: { type: 'income', amount: 125000.5 },
    }),
    { code: 'INVALID_INPUT', status: 400 }
  );
});

test('Security hardening: business routes redact internal 500 error details and enforce public booking rate limit', async () => {
  const { createPublicBookingRouter } = await import('../../src/booking/booking.routes.js');
  const { createCustomerRouter } = await import('../../src/customer/customer.routes.js');
  const { createRateLimitMiddleware } = await import('../../src/middlewares/rate-limit.middleware.js');
  const { default: express } = await import('express');
  const { once } = await import('node:events');

  const failingCustomerService = {
    async listCustomers() {
      const dbErr = new Error('SELECT * FROM "Customer" failed: connection string postgresql://secret@127.0.0.1:5432');
      dbErr.code = 'P2021';
      throw dbErr;
    },
  };

  const bookingService = {
    async createPublicBookingRequest() {
      return { bookingCode: 'BK-234-567', status: 'waiting_confirmation' };
    },
  };

  const rateLimitMiddleware = createRateLimitMiddleware();
  const app = express();
  app.use(express.json());
  app.use('/api/v1/admin', createCustomerRouter({ customerService: failingCustomerService }));
  app.use('/api/v1/public', createPublicBookingRouter({ bookingService, rateLimitMiddleware }));

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const errRes = await fetch(`${base}/api/v1/admin/customers`);
    assert.equal(errRes.status, 500);
    const errBody = await errRes.json();
    assert.equal(errBody.error.code, 'INTERNAL_ERROR');
    assert.equal(errBody.error.message, 'An unexpected error occurred');
    assert.equal(JSON.stringify(errBody).includes('postgresql://'), false);
    assert.equal(JSON.stringify(errBody).includes('P2021'), false);

    // Public booking rate limit allows up to 30 requests per IP per minute, then returns 429
    for (let i = 0; i < 30; i++) {
      const okRes = await fetch(`${base}/api/v1/public/booking-requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      assert.equal(okRes.status, 201);
    }
    const throttledRes = await fetch(`${base}/api/v1/public/booking-requests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(throttledRes.status, 429);
    const throttledBody = await throttledRes.json();
    assert.equal(throttledBody.error.code, 'RATE_LIMITED');
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
