import assert from 'node:assert/strict';
import test from 'node:test';
import { createBookingService } from '../../src/booking/booking.service.js';
import { createCustomerService } from '../../src/customer/customer.service.js';
import { createPricingService } from '../../src/pricing/pricing.service.js';
import { createFinanceService } from '../../src/finance/finance.service.js';
import { createInMemoryFinanceRepository } from '../../src/finance/in-memory-finance.repository.js';
import { createInboxService } from '../../src/inbox/inbox.service.js';
import { createInMemoryInboxRepository } from '../../src/inbox/in-memory-inbox.repository.js';
import { createContentService } from '../../src/content/content.service.js';
import { createInMemoryContentRepository } from '../../src/content/in-memory-content.repository.js';
import { createAnalyticsService } from '../../src/analytics/analytics.service.js';
import { createSettingsService } from '../../src/settings/settings.service.js';

function createMockAuth(permissions = []) {
  return {
    async hasPermission(userId, code) {
      return permissions.includes(code);
    },
  };
}

test('public booking request validates inputs and generates booking code with waiting_confirmation status', async () => {
  const saved = [];
  const repo = {
    async saveBooking(data) { saved.push(data); return data; },
  };
  const service = createBookingService({ repository: repo });

  // Valid submission
  const result = await service.createPublicBookingRequest({
    customerName: 'Budi Santoso',
    whatsappPhone: '+6281234567890',
    categoryId: 'c-uuid-1',
    modelId: 'm-uuid-1',
    rentalType: 'with_driver',
    startsOn: '2026-12-01',
    endsOn: '2026-12-03',
    pickupLocation: 'Bandara YIA Yogyakarta',
  });

  assert.equal(typeof result.bookingCode, 'string');
  assert.match(result.bookingCode, /^BK-[A-Z0-9]{3}-[A-Z0-9]{3}$/);
  assert.equal(result.status, 'waiting_confirmation');
  assert.equal(result.statusLabel, 'Menunggu Konfirmasi');
  assert.equal(result.whatsapp.available, false);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].customerName, 'Budi Santoso');

  // Invalid phone number
  await assert.rejects(
    service.createPublicBookingRequest({
      customerName: 'Budi',
      whatsappPhone: '0812345',
      categoryId: 'c-1',
      modelId: 'm-1',
      rentalType: 'with_driver',
      startsOn: '2026-12-01',
      endsOn: '2026-12-03',
      pickupLocation: 'Jogja',
    }),
    { code: 'INVALID_INPUT' }
  );

  // Invalid date range (endsOn < startsOn)
  await assert.rejects(
    service.createPublicBookingRequest({
      customerName: 'Budi',
      whatsappPhone: '+628123456789',
      categoryId: 'c-1',
      modelId: 'm-1',
      rentalType: 'with_driver',
      startsOn: '2026-12-05',
      endsOn: '2026-12-01',
      pickupLocation: 'Jogja',
    }),
    { code: 'INVALID_INPUT' }
  );
});

test('admin booking status transitions strictly enforce the state machine', async () => {
  let booking = {
    id: 'b-1',
    bookingCode: 'BK-AB-123',
    status: 'waiting_confirmation',
  };
  const repo = {
    async getBookingById(id) { return id === booking.id ? booking : null; },
    async updateBooking(data) { booking = { ...booking, ...data }; return booking; },
  };
  const auth = createMockAuth(['BOOKING_VIEW', 'BOOKING_APPROVE']);
  const service = createBookingService({ repository: repo, authorizationService: auth });

  // Valid transition: waiting_confirmation -> under_verification
  const trans1 = await service.updateBookingStatus({ userId: 'u-1', id: 'b-1', newStatus: 'under_verification' });
  assert.equal(trans1.status, 'under_verification');

  // Invalid transition: under_verification -> completed (must go through confirmed first)
  await assert.rejects(
    service.updateBookingStatus({ userId: 'u-1', id: 'b-1', newStatus: 'completed' }),
    { code: 'INVALID_STATUS_TRANSITION' }
  );

  // Valid transition: under_verification -> confirmed
  const trans2 = await service.updateBookingStatus({ userId: 'u-1', id: 'b-1', newStatus: 'confirmed' });
  assert.equal(trans2.status, 'confirmed');

  // Permission denied without BOOKING_APPROVE/UPDATE
  const unauthService = createBookingService({ repository: repo, authorizationService: createMockAuth([]) });
  await assert.rejects(
    unauthService.updateBookingStatus({ userId: 'u-2', id: 'b-1', newStatus: 'completed' }),
    { code: 'FORBIDDEN' }
  );
});

test('customer service enforces CRUD permissions and input validation', async () => {
  const customers = [];
  const repo = {
    async listCustomers({ limit, offset }) { return { items: customers.slice(offset, offset + limit), page: { limit, offset, total: customers.length } }; },
    async getCustomerById(id) { return customers.find((c) => c.id === id) ?? null; },
    async createCustomer(data) { customers.push(data); return data; },
  };
  const auth = createMockAuth(['CUSTOMER_VIEW', 'CUSTOMER_CREATE']);
  const service = createCustomerService({ repository: repo, authorizationService: auth });

  const res = await service.createCustomer({ userId: 'u-1', input: { name: 'Ihsan', phone: '+6281111111' } });
  assert.equal(res.item.name, 'Ihsan');
  assert.equal(customers.length, 1);

  const list = await service.listCustomers({ userId: 'u-1' });
  assert.equal(list.items.length, 1);
  assert.equal(list.page.total, 1);

  // Forbidden create with read-only
  const readOnlyService = createCustomerService({ repository: repo, authorizationService: createMockAuth(['CUSTOMER_VIEW']) });
  await assert.rejects(
    readOnlyService.createCustomer({ userId: 'u-staff', input: { name: 'Forbidden' } }),
    { code: 'FORBIDDEN' }
  );
});

test('pricing and finance modules deny access to unauthorized roles (STAFF)', async () => {
  const pricingService = createPricingService({ authorizationService: createMockAuth([]) });
  const financeService = createFinanceService({ authorizationService: createMockAuth([]) });

  await assert.rejects(pricingService.listPricing({ userId: 'u-staff' }), { code: 'FORBIDDEN' });
  await assert.rejects(pricingService.createPricing({ userId: 'u-staff', input: {} }), { code: 'FORBIDDEN' });

  await assert.rejects(financeService.listTransactions({ userId: 'u-staff' }), { code: 'FORBIDDEN' });
  await assert.rejects(financeService.createTransaction({ userId: 'u-staff', input: {} }), { code: 'FORBIDDEN' });

  // Authorized Admin can list & create
  const adminAuth = createMockAuth(['PRICING_VIEW', 'PRICING_CREATE', 'FINANCE_VIEW', 'FINANCE_CREATE']);
  const authPricing = createPricingService({ authorizationService: adminAuth });
  const authFinance = createFinanceService({ authorizationService: adminAuth });

  const pRes = await authPricing.createPricing({ userId: 'u-admin', input: { modelId: 'm-1', rentalType: 'self_drive', baseRate: 500000 } });
  assert.equal(pRes.item.baseRate, 500000);

  const fRes = await authFinance.createTransaction({ userId: 'u-admin', input: { type: 'income', amount: 500000 } });
  assert.equal(fRes.item.amount, 500000);
});

test('inbox, content, analytics, and settings services respond properly within permissions', async () => {
  const allAuth = createMockAuth(['MESSAGE_VIEW', 'MESSAGE_UPDATE', 'CONTENT_VIEW', 'ANALYTICS_VIEW', 'SETTINGS_VIEW', 'SETTINGS_UPDATE']);
  const inbox = createInboxService({ authorizationService: allAuth });
  const content = createContentService({ authorizationService: allAuth });
  const analytics = createAnalyticsService({ authorizationService: allAuth });
  const settings = createSettingsService({ authorizationService: allAuth });

  // Messages
  const msgs = await inbox.listMessages({ userId: 'u-1' });
  assert.deepEqual(msgs.items, []);

  // Content
  const cList = await content.listContent({ userId: 'u-1' });
  assert.deepEqual(cList.items, []);

  // Analytics
  const overview = await analytics.getOverview({ userId: 'u-1' });
  assert.equal(overview.range, '30d');
  assert.equal(overview.metrics.totalBookings, 0);

  // Settings
  const allSettings = await settings.getAllSettings({ userId: 'u-1' });
  assert.equal(allSettings.settings.companyName, 'Anantalia Trans');

  const updatedSetting = await settings.updateSetting({ userId: 'u-1', key: 'officePhone', value: '+62274123456' });
  assert.equal(updatedSetting.value, '+62274123456');

  // Reject unallowlisted setting key
  await assert.rejects(
    settings.updateSetting({ userId: 'u-1', key: 'secretDatabasePassword', value: 'leak' }),
    { code: 'INVALID_INPUT' }
  );
});

test('customerService validates phone/email, prevents phone/email duplicates, allows same name, and supports reactivation', async () => {
  const { createInMemoryCustomerRepository } = await import('../../src/customer/in-memory-customer.repository.js');
  const repo = createInMemoryCustomerRepository();
  const auth = createMockAuth(['CUSTOMER_VIEW', 'CUSTOMER_CREATE', 'CUSTOMER_UPDATE', 'CUSTOMER_DELETE']);
  const customerService = createCustomerService({ repository: repo, authorizationService: auth });

  await assert.rejects(
    customerService.createCustomer({ userId: 'u-1', input: { name: 'Budi', phone: 'abc' } }),
    { code: 'INVALID_INPUT' },
  );
  await assert.rejects(
    customerService.createCustomer({ userId: 'u-1', input: { name: 'Budi', email: 'not-an-email' } }),
    { code: 'INVALID_INPUT' },
  );

  const first = await customerService.createCustomer({
    userId: 'u-1',
    input: { name: 'Budi Santoso', phone: '+62 812-3456-7890', email: 'BUDI@EXAMPLE.COM' },
  });
  assert.equal(first.item.phone, '+6281234567890');
  assert.equal(first.item.email, 'budi@example.com');

  // Same name with different contact is allowed
  const sameName = await customerService.createCustomer({
    userId: 'u-1',
    input: { name: 'Budi Santoso', phone: '+6281999888777', email: 'budi2@example.com' },
  });
  assert.notEqual(sameName.item.id, first.item.id);

  // Duplicate phone or email is rejected with 409 CUSTOMER_DUPLICATE
  await assert.rejects(
    customerService.createCustomer({ userId: 'u-1', input: { name: 'Lain', phone: '+6281234567890' } }),
    { code: 'CUSTOMER_DUPLICATE', status: 409 },
  );
  await assert.rejects(
    customerService.createCustomer({ userId: 'u-1', input: { name: 'Lain', email: 'budi@example.com' } }),
    { code: 'CUSTOMER_DUPLICATE', status: 409 },
  );

  // Deactivate and reactivate
  await customerService.deleteCustomer({ userId: 'u-1', id: first.item.id });
  const inactiveList = await customerService.listCustomers({ userId: 'u-1', query: { status: 'inactive' } });
  assert.equal(inactiveList.items.length, 1);

  const reactivated = await customerService.updateCustomer({
    userId: 'u-1',
    id: first.item.id,
    input: { isActive: true },
  });
  assert.equal(reactivated.item.isActive, true);
});

test('pricingService validates rentalType/billingUnit, prevents active duplicate rules, and logs rate history', async () => {
  const { createInMemoryPricingRepository } = await import('../../src/pricing/in-memory-pricing.repository.js');
  const repo = createInMemoryPricingRepository();
  const auth = createMockAuth(['PRICING_VIEW', 'PRICING_CREATE', 'PRICING_UPDATE', 'PRICING_DELETE']);
  const logs = [];
  const pricingService = createPricingService({
    repository: repo,
    authorizationService: auth,
    activityLog: { async log(entry) { logs.push(entry); } },
  });

  await assert.rejects(
    pricingService.createPricing({ userId: 'u-1', input: { modelId: 'hiace', rentalType: 'invalid', baseRate: 500000 } }),
    { code: 'INVALID_INPUT' },
  );

  const created = await pricingService.createPricing({
    userId: 'u-1',
    input: { modelId: 'hiace-premio', rentalType: 'with_driver', billingUnit: 'day', baseRate: 1200000 },
  });
  assert.equal(created.item.baseRate, 1200000);

  // Duplicate active rule for same modelId + rentalType + billingUnit -> 409 PRICING_CONFLICT
  await assert.rejects(
    pricingService.createPricing({
      userId: 'u-1',
      input: { modelId: 'hiace-premio', rentalType: 'with_driver', billingUnit: 'day', baseRate: 1300000 },
    }),
    { code: 'PRICING_CONFLICT', status: 409 },
  );

  // Update logs previous & next baseRate
  const updated = await pricingService.updatePricing({
    userId: 'u-1',
    id: created.item.id,
    input: { baseRate: 1350000, isActive: false },
  });
  assert.equal(updated.item.baseRate, 1350000);
  assert.equal(updated.item.isActive, false);
  const updateLog = logs.find((l) => l.action === 'PRICING_UPDATED');
  assert.equal(updateLog?.details?.fromBaseRate, 1200000);
  assert.equal(updateLog?.details?.toBaseRate, 1350000);

  // Once deactivated, creating a new active rule for same combo is allowed
  const replacement = await pricingService.createPricing({
    userId: 'u-1',
    input: { modelId: 'hiace-premio', rentalType: 'with_driver', billingUnit: 'day', baseRate: 1400000 },
  });
  assert.equal(replacement.item.baseRate, 1400000);
});

test('financeService supports refund, filters, and excludes void transactions from summary', async () => {
  const repository = createInMemoryFinanceRepository();
  const logs = [];
  const financeService = createFinanceService({
    repository,
    authorizationService: createMockAuth(['FINANCE_VIEW', 'FINANCE_CREATE', 'FINANCE_UPDATE']),
    activityLog: { async record(entry) { logs.push(entry); } },
  });

  await assert.rejects(
    financeService.createTransaction({ userId: 'u-1', input: { type: 'income', amount: 100000, date: 'invalid-date' } }),
    { code: 'INVALID_INPUT' },
  );

  const tx1 = await financeService.createTransaction({
    userId: 'u-1',
    input: { type: 'income', amount: 2500000, category: 'sewa_korporat', date: '2026-11-10', bookingId: 'bk-101', description: 'DP Sewa' },
  });
  const tx2 = await financeService.createTransaction({
    userId: 'u-1',
    input: { type: 'expense', amount: 500000, category: 'bbm', date: '2026-11-11', description: 'Solar Armada' },
  });
  const tx3 = await financeService.createTransaction({
    userId: 'u-1',
    input: { type: 'refund', amount: 200000, category: 'refund_dp', date: '2026-11-12', bookingId: 'bk-101', description: 'Potongan batal sebagian' },
  });

  const filtered = await financeService.listTransactions({
    userId: 'u-1',
    query: { q: 'solar', fromDate: '2026-11-11', toDate: '2026-11-11' },
  });
  assert.equal(filtered.items.length, 1);
  assert.equal(filtered.items[0].id, tx2.item.id);

  let summary = await financeService.getFinanceSummary({ userId: 'u-1' });
  assert.equal(summary.totalRevenue, 2500000);
  assert.equal(summary.totalExpenses, 500000);
  assert.equal(summary.totalRefunds, 200000);
  assert.equal(summary.netProfit, 1800000);
  assert.equal(summary.transactionCount, 3);

  // Void tx1 and verify summary excludes it & activityLog records it
  const voided = await financeService.voidTransaction({ userId: 'u-1', id: tx1.item.id, reason: 'Salah input nominal' });
  assert.equal(voided.item.status, 'void');
  assert.ok(voided.item.description.includes('[VOID: Salah input nominal]'));
  assert.ok(logs.some((l) => l.action === 'FINANCE_TRANSACTION_VOIDED' && l.entityId === tx1.item.id));

  summary = await financeService.getFinanceSummary({ userId: 'u-1' });
  assert.equal(summary.totalRevenue, 0);
  assert.equal(summary.totalExpenses, 500000);
  assert.equal(summary.totalRefunds, 200000);
  assert.equal(summary.netProfit, -700000);
  assert.equal(summary.transactionCount, 2);

  // Double-void rejected
  await assert.rejects(
    financeService.voidTransaction({ userId: 'u-1', id: tx1.item.id, reason: 'Duplicate void' }),
    { code: 'INVALID_TRANSITION' },
  );
  assert.ok(tx3.item.type === 'refund');
});

test('contentService enforces slug uniqueness, HTML sanitization, scheduling, revisions, and public visibility', async () => {
  const repository = createInMemoryContentRepository();
  const logs = [];
  const contentService = createContentService({
    repository,
    authorizationService: createMockAuth(['CONTENT_VIEW', 'CONTENT_CREATE', 'CONTENT_UPDATE', 'CONTENT_APPROVE', 'CONTENT_DELETE']),
    activityLog: { async log(entry) { logs.push(entry); } },
  });

  // Reject unsafe CTA URL
  await assert.rejects(
    contentService.createContent({
      userId: 'u-1',
      input: { title: 'Bad Banner', section: 'hero', meta: { ctaUrl: 'javascript:alert(1)' } },
    }),
    { code: 'INVALID_INPUT' },
  );

  // Create draft with XSS script tag -> sanitized
  const created = await contentService.createContent({
    userId: 'u-1',
    input: {
      title: 'Promo Akhir Tahun',
      slug: 'promo-akhir-tahun',
      section: 'promo',
      status: 'draft',
      body: '<p>Diskon sewa</p><script>alert("xss")</script>',
      meta: { ctaLabel: 'Pesan Sekarang', ctaUrl: '/pages/armada.html', sortOrder: 1 },
    },
  });
  assert.ok(!created.item.body.includes('<script>'));
  assert.ok(created.item.body.includes('<p>Diskon sewa</p>'));

  // Draft must NOT be exposed on public endpoints
  let pubList = await contentService.listPublicContent({ section: 'promo' });
  assert.equal(pubList.items.length, 0);
  await assert.rejects(contentService.getPublicContentBySlug({ slug: 'promo-akhir-tahun' }), { code: 'NOT_FOUND' });

  // Duplicate slug -> 409
  await assert.rejects(
    contentService.createContent({
      userId: 'u-1',
      input: { title: 'Promo Lain', slug: 'promo-akhir-tahun', section: 'promo' },
    }),
    { code: 'CONTENT_SLUG_CONFLICT', status: 409 },
  );

  // Publish -> visible publicly, revision created
  await contentService.updateContent({
    userId: 'u-1',
    id: created.item.id,
    input: { status: 'published', body: '<p>Diskon 20% armada</p>' },
  });
  pubList = await contentService.listPublicContent({ section: 'promo' });
  assert.equal(pubList.items.length, 1);
  assert.equal(pubList.items[0].slug, 'promo-akhir-tahun');

  // Check revisions and restore v1
  const revs = await contentService.getRevisions({ userId: 'u-1', id: created.item.id });
  assert.equal(revs.items.length, 1);
  assert.equal(revs.items[0].status, 'draft');

  // Future scheduled content must NOT be live yet
  const futureDate = new Date(Date.now() + 86_400_000).toISOString();
  const futureItem = await contentService.createContent({
    userId: 'u-1',
    input: {
      title: 'Banner Tahun Baru',
      slug: 'banner-tahun-baru',
      section: 'hero',
      status: 'scheduled',
      meta: { publishAt: futureDate },
    },
  });
  const pubHero = await contentService.listPublicContent({ section: 'hero' });
  assert.equal(pubHero.items.length, 0);

  // Summary counts
  const summary = await contentService.getContentSummary({ userId: 'u-1' });
  assert.equal(summary.total, 2);
  assert.equal(summary.published, 1);
  assert.equal(summary.scheduled, 1);
  assert.ok(futureItem.item.id);
});

test('inboxService supports public contact intake, metadata, templates, honest SMTP fallback, and summary', async () => {
  const repository = createInMemoryInboxRepository();
  const logs = [];
  const inboxService = createInboxService({
    repository,
    authorizationService: createMockAuth(['MESSAGE_VIEW', 'MESSAGE_UPDATE']),
    activityLog: { async log(entry) { logs.push(entry); } },
  });

  // Honeypot spam rejection
  await assert.rejects(
    inboxService.submitPublicContactMessage({
      input: { senderName: 'Bot', senderEmail: 'bot@spam.com', content: 'Buy now!', website: 'http://spam.tld' },
    }),
    { code: 'SPAM_DETECTED', status: 400 },
  );

  // Valid public contact intake
  const submitted = await inboxService.submitPublicContactMessage({
    input: {
      senderName: 'Dewi Anggraini',
      senderEmail: 'dewi@example.com',
      phone: '081234567890',
      subject: 'Tanya Tarif Hiace',
      content: 'Mohon info tarif sewa Hiace Premio untuk 3 hari ke Bandung.',
      category: 'pricing',
    },
  });
  assert.equal(submitted.item.status, 'unread');
  assert.equal(submitted.item.meta.category, 'pricing');

  // Update metadata
  const metaUpdated = await inboxService.updateMessageMeta({
    userId: 'u-admin',
    id: submitted.item.id,
    input: { priority: 'high', starred: true, assigneeName: 'CS Budi', labels: ['Perlu Follow-up'] },
  });
  assert.equal(metaUpdated.item.meta.priority, 'high');
  assert.equal(metaUpdated.item.meta.starred, true);

  // Reply without SMTP configured -> recorded honestly, emailConfigured: false
  const replyRes = await inboxService.replyToMessage({
    userId: 'u-admin',
    id: submitted.item.id,
    input: { subject: 'Re: Tanya Tarif Hiace', body: 'Tarif Hiace Premio mulai Rp 1.500.000/hari.' },
  });
  assert.equal(replyRes.emailConfigured, false);
  assert.equal(replyRes.reply.deliveryStatus, 'smtp_not_configured');

  // Templates CRUD
  const tpl = await inboxService.saveTemplate({
    userId: 'u-admin',
    input: { name: 'Info Harga Sewa', category: 'pricing', subject: 'Penawaran Tarif', body: 'Terima kasih...' },
  });
  let templates = await inboxService.listTemplates({ userId: 'u-admin' });
  assert.equal(templates.items.length, 1);
  await inboxService.deleteTemplate({ userId: 'u-admin', templateId: tpl.item.id });
  templates = await inboxService.listTemplates({ userId: 'u-admin' });
  assert.equal(templates.items.length, 0);

  // Summary
  const summary = await inboxService.getInboxSummary({ userId: 'u-admin' });
  assert.equal(summary.total, 1);
  assert.equal(summary.unread, 1);
  assert.equal(summary.highPriority, 1);
});

test('settingsService enforces RBAC, exposes public site config, honest system status, and safe config backup', async () => {
  const { createSettingsService } = await import('../../src/settings/settings.service.js');
  const { createInMemorySettingsRepository } = await import('../../src/settings/in-memory-settings.repository.js');
  const repo = createInMemorySettingsRepository();
  const logs = [];
  const restrictedService = createSettingsService({
    repository: repo,
    authorizationService: createMockAuth(['PROFILE_VIEW']),
    activityLog: { async log(entry) { logs.push(entry); } },
  });
  await assert.rejects(restrictedService.getAllSettings({ userId: 'u-staff' }), { status: 403 });
  await assert.rejects(restrictedService.getSystemStatus({ userId: 'u-staff' }), { status: 403 });

  const adminService = createSettingsService({
    repository: repo,
    authorizationService: createMockAuth(['SETTINGS_VIEW', 'SETTINGS_UPDATE']),
    activityLog: { async log(entry) { logs.push(entry); } },
  });
  await adminService.updateSetting({ userId: 'u-admin', key: 'maintenanceMode', value: 'true' });
  const pubCfg = await adminService.getPublicSiteConfig();
  assert.equal(pubCfg.maintenanceMode, true);

  const status = await adminService.getSystemStatus({ userId: 'u-admin' });
  assert.equal(status.database.status, 'in_memory');
  assert.equal(status.maintenanceMode, true);
  assert.equal(status.integrations[0].configured, Boolean(process.env.SMTP_WEBHOOK_URL));

  const emailTest = await adminService.testEmailIntegration({ userId: 'u-admin' });
  if (!process.env.SMTP_WEBHOOK_URL) {
    assert.equal(emailTest.ok, false);
    assert.equal(emailTest.configured, false);
  }

  const backup = await adminService.createConfigBackupSnapshot({ userId: 'u-admin' });
  assert.equal(backup.snapshot.format, 'anantalia-config-snapshot-v1');
  assert.equal(backup.meta.status, 'success');
  assert.ok(logs.some((l) => l.action === 'SYSTEM_BACKUP_EXPORTED'));
});

test('bookingService captures priceSnapshot on create and locks it on confirmed status even when pricingRule changes later', async () => {
  const { createBookingService } = await import('../../src/booking/booking.service.js');
  const { createInMemoryBookingRepository } = await import('../../src/booking/in-memory-booking.repository.js');
  const { createInMemoryPricingRepository } = await import('../../src/pricing/in-memory-pricing.repository.js');
  const { createInMemorySettingsRepository } = await import('../../src/settings/in-memory-settings.repository.js');

  const bookingRepo = createInMemoryBookingRepository();
  const pricingRepo = createInMemoryPricingRepository();
  const settingsRepo = createInMemorySettingsRepository();
  const auth = createMockAuth(['BOOKING_VIEW', 'BOOKING_APPROVE', 'BOOKING_UPDATE', 'PRICING_CREATE', 'PRICING_UPDATE']);

  const pricingService = createPricingService({ repository: pricingRepo, authorizationService: auth });
  const ruleRes = await pricingService.createPricing({
    userId: 'u-admin',
    input: { modelId: 'avanza-2024', rentalType: 'self_drive', billingUnit: 'day', baseRate: 450000 },
  });

  const bookingService = createBookingService({
    repository: bookingRepo,
    authorizationService: auth,
    pricingRepository: pricingRepo,
    settingsRepository: settingsRepo,
  });

  const created = await bookingService.createPublicBookingRequest({
    customerName: 'Siti Aminah',
    whatsappPhone: '+6281234567890',
    categoryId: 'mpv',
    modelId: 'avanza-2024',
    rentalType: 'self_drive',
    startsOn: '2026-12-10',
    endsOn: '2026-12-12',
    pickupLocation: 'Stasiun Gambir',
  });
  assert.equal(created.priceSnapshot?.agreedRate, 450000);
  assert.equal(created.priceSnapshot?.days, 3);
  assert.equal(created.priceSnapshot?.totalAmount, 1350000);
  assert.equal(created.priceSnapshot?.locked, false);

  const list = await bookingService.listBookings({ userId: 'u-admin' });
  const bookingId = list.items[0].id;
  assert.equal(list.items[0].priceSnapshot?.totalAmount, 1350000);

  await bookingService.updateBookingStatus({
    userId: 'u-admin',
    id: bookingId,
    newStatus: 'under_verification',
  });
  const confirmed = await bookingService.updateBookingStatus({
    userId: 'u-admin',
    id: bookingId,
    newStatus: 'confirmed',
  });
  assert.equal(confirmed.priceSnapshot?.locked, true);
  assert.equal(confirmed.priceSnapshot?.totalAmount, 1350000);

  // Change pricing rule rate AFTER confirmation
  await pricingService.updatePricing({
    userId: 'u-admin',
    id: ruleRes.item.id,
    input: { baseRate: 600000 },
  });

  const afterPriceChange = await bookingService.getBookingById({ userId: 'u-admin', id: bookingId });
  assert.equal(afterPriceChange.item.priceSnapshot?.locked, true);
  assert.equal(afterPriceChange.item.priceSnapshot?.agreedRate, 450000);
  assert.equal(afterPriceChange.item.priceSnapshot?.totalAmount, 1350000);
});
