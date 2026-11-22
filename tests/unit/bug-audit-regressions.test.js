import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createApp } from '../../src/app.js';
import { createLogger } from '../../src/lib/logger.js';
import { createAdminAccountService } from '../../src/auth/admin-account-service.js';
import { createAdminAccountRouter } from '../../src/routes/admin-account.routes.js';
import { createMyProfileService } from '../../src/auth/my-profile-service.js';
import { createFleetService } from '../../src/fleet/fleet.service.js';
import { createFleetController } from '../../src/fleet/fleet.controller.js';
import { createAdminFleetRouter, createPublicFleetRouter } from '../../src/fleet/fleet.routes.js';
import { createInMemorySettingsRepository } from '../../src/settings/in-memory-settings.repository.js';
import { createPrismaSettingsRepository } from '../../src/settings/prisma-settings.repository.js';
import { createInboxService } from '../../src/inbox/inbox.service.js';
import { createInMemoryInboxRepository } from '../../src/inbox/in-memory-inbox.repository.js';
import { createContentService } from '../../src/content/content.service.js';
import { createInMemoryContentRepository } from '../../src/content/in-memory-content.repository.js';
import { createFinanceService } from '../../src/finance/finance.service.js';
import { createInMemoryFinanceRepository } from '../../src/finance/in-memory-finance.repository.js';
import { createPrismaFinanceRepository } from '../../src/finance/prisma-finance.repository.js';
import { createSettingsService } from '../../src/settings/settings.service.js';
import { createDashboardService } from '../../src/dashboard/dashboard.service.js';
import { createBookingService } from '../../src/booking/booking.service.js';
import { createAnalyticsService } from '../../src/analytics/analytics.service.js';

async function withServer(app, run) {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test('Bug 1 & 4: adminAccountService hashes password on createAdmin, enforces password rules, and ADMIN retains USER_VIEW read access', async () => {
  const users = new Map();
  const roles = new Map(['ADMIN', 'STAFF', 'SUPER_ADMIN'].map((code) => [code, { id: code, code }]));
  const links = [];
  const logs = [];
  const hashedCalls = [];

  const hydrate = (id) => {
    const u = users.get(id);
    return u ? { ...u, roles: links.filter((l) => l.userId === id).map((l) => ({ role: roles.get(l.roleId) })) } : null;
  };
  const prisma = {
    async $transaction(cb) {
      return cb(tx);
    },
    user: {
      async findMany() {
        return [...users.values()].map((u) => hydrate(u.id));
      },
      async findUnique({ where }) {
        return hydrate(where.id);
      },
    },
  };
  const tx = {
    user: {
      async findFirst({ where }) {
        return [...users.values()].find((u) => u.email === where.OR[0].email || u.username === where.OR[1].username) ?? null;
      },
      async create({ data, select }) {
        const user = { id: '00000000-0000-0000-0000-000000000099', status: 'ACTIVE', ...data, deletedAt: null };
        users.set(user.id, user);
        return Object.fromEntries(Object.keys(select).map((k) => [k, user[k]]));
      },
    },
    role: {
      async findMany({ where }) {
        return where.code.in.map((c) => roles.get(c)).filter(Boolean).map(({ id }) => ({ id }));
      },
    },
    userRole: {
      async createMany({ data }) {
        links.push(...data);
      },
    },
    activityLog: {
      async create({ data }) {
        logs.push(data);
        return data;
      },
    },
  };

  const authService = {
    async requirePermission(actor, permission) {
      if (actor === 'staff' && permission === 'USER_VIEW') throw Object.freeze({ status: 'PERMISSION_DENIED' });
    },
    async canManageUser(actor) {
      return actor === 'super-admin';
    },
  };
  const activityLog = { async log({ client, ...entry }) { return client.activityLog.create({ data: entry }); } };
  const passwordService = {
    async hash(plain) {
      hashedCalls.push(plain);
      return `argon2id-hashed:${plain.length}`;
    },
  };

  const service = createAdminAccountService({
    prisma,
    authService,
    activityLog,
    accountLifecycleService: { setStatus: async () => ({}), softDelete: async () => ({}) },
    passwordService,
  });

  await assert.rejects(
    service.createAdmin({ actor: 'super-admin', email: 'op@test.id', username: 'op1', roles: ['STAFF'], password: 'short' }),
    { status: 'INVALID_PASSWORD' },
  );

  const created = await service.createAdmin({
    actor: 'super-admin',
    email: 'Op.Baru@Anantalia.ID',
    username: 'op.baru',
    displayName: 'Operator Baru',
    roles: ['ADMIN'],
    password: 'StrongPassword123!',
  });

  assert.equal(hashedCalls[0], 'StrongPassword123!');
  assert.equal('password' in created, false);
  assert.equal('passwordHash' in created, false);
  assert.equal(users.get(created.id).passwordHash, 'argon2id-hashed:18');
  assert.equal(JSON.stringify(logs).includes('StrongPassword123!'), false);

  const router = createAdminAccountRouter({ adminAccountService: service, authService, activityLog, logger: createLogger(() => {}) });
  const app = createApp({
    logger: createLogger(() => {}),
    adminAccountRouter: router,
    authenticationMiddleware: (req, _res, next) => {
      req.userId = req.headers['x-actor'] || 'super-admin';
      next();
    },
    csrfMiddleware: { middleware: (_req, _res, next) => next(), guard: (_req, _res, next) => next() },
  });

  await withServer(app, async (base) => {
    // POST /api/admin/create requires non-empty valid password
    const badPw = await fetch(`${base}/api/admin/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-actor': 'super-admin' },
      body: JSON.stringify({ email: 'nopw@test.id', username: 'nopwuser', displayName: 'No PW', roles: ['STAFF'], password: '' }),
    });
    assert.equal(badPw.status, 400);
    const badPwBody = await badPw.json();
    assert.equal(badPwBody.error.code, 'INVALID_PASSWORD');

    // ADMIN with USER_VIEW can list and view account details, but STAFF cannot, and ADMIN still cannot mutate
    const adminList = await fetch(`${base}/api/admin/list`, { headers: { 'x-actor': 'admin-viewer' } });
    assert.equal(adminList.status, 200);
    assert.equal((await adminList.json()).admins.length, 1);

    const adminDetail = await fetch(`${base}/api/admin/${created.id}`, { headers: { 'x-actor': 'admin-viewer' } });
    assert.equal(adminDetail.status, 200);

    const staffList = await fetch(`${base}/api/admin/list`, { headers: { 'x-actor': 'staff' } });
    assert.equal(staffList.status, 403);

    const adminCreateAttempt = await fetch(`${base}/api/admin/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-actor': 'admin-viewer' },
      body: JSON.stringify({ email: 'other@test.id', username: 'other1', roles: ['STAFF'], password: 'StrongPassword123!' }),
    });
    assert.equal(adminCreateAttempt.status, 403);
  });
});

test('Bug 1: myProfileService preserves profile metadata across username/displayName updates and accepts image/jpg', async () => {
  const settingsRepo = createInMemorySettingsRepository();
  const user = { id: 'u-1', email: 'u1@test.id', username: 'oldname', displayName: 'Old Name', passwordHash: 'hash', status: 'ACTIVE', roles: [] };
  const prisma = {
    user: { async findUnique() { return { ...user }; } },
    async $transaction(cb) {
      return cb({
        user: { async update({ data }) { Object.assign(user, data); return { ...user }; } },
      });
    },
  };
  const service = createMyProfileService({
    prisma,
    passwordService: { hash: async () => 'h2' },
    activityLog: { log: async () => {} },
    settingsRepository: settingsRepo,
  });

  const tinyJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]).toString('base64');
  await service.updateProfileMeta('u-1', {
    phone: '+6281234567890',
    jobTitle: 'Manajer Operasional',
    avatarDataUrl: `data:image/jpg;base64,${tinyJpeg}`,
  });

  const afterUsername = await service.updateUsername('u-1', 'new_username');
  assert.equal(afterUsername.phone, '+6281234567890');
  assert.equal(afterUsername.jobTitle, 'Manajer Operasional');
  assert.match(afterUsername.avatarDataUrl, /^data:image\/jpeg;base64,/);

  const afterDisplay = await service.updateDisplayName('u-1', 'Nama Baru');
  assert.equal(afterDisplay.phone, '+6281234567890');
  assert.equal(afterDisplay.jobTitle, 'Manajer Operasional');
});

test('Bug 2: fleetService & fleetController support non-RFC UUIDs, serviceAlert alias, KPI summary fields, and specific error messages', async () => {
  const modelUuid = '00000000-0000-0000-0000-000000000010';
  const units = [];
  const futureDate = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const repo = {
    transaction: (work) => work(repo),
    model: {
      get: async (id) => (id === modelUuid ? { id: modelUuid, name: 'Hiace Premio', slug: 'hiace-premio' } : null),
      findBySlug: async (slug) => (slug === 'hiace-premio' ? { id: modelUuid, name: 'Hiace Premio', slug: 'hiace-premio' } : null),
    },
    unit: {
      list: async (where) => units.filter((u) => (!where.nextServiceDate?.gt || (u.nextServiceDate && u.nextServiceDate > where.nextServiceDate.gt))),
      count: async () => units.length,
      findByPlate: async (plate) => units.find((u) => u.plateNumber === plate) ?? null,
      create: async (data) => {
        const created = { ...data, version: 1, model: { id: modelUuid, name: 'Hiace Premio' } };
        units.push(created);
        return created;
      },
      get: async (id) => units.find((u) => u.id === id) ?? null,
    },
  };
  const fleetService = createFleetService({
    repository: repo,
    authorizationService: { requirePermission: async () => {} },
    activityLog: { log: async () => {} },
  });
  const app = createApp({
    logger: createLogger(() => {}),
    adminFleetRouter: createAdminFleetRouter({ fleetService, logger: createLogger(() => {}) }),
    authenticationMiddleware: (req, _res, next) => { req.userId = 'admin-1'; next(); },
    csrfMiddleware: { middleware: (_req, _res, next) => next(), guard: (_req, _res, next) => next() },
  });

  await withServer(app, async (base) => {
    // Slug modelId resolves cleanly even without RFC variant UUID
    const createdRes = await fetch(`${base}/api/v1/admin/vehicle-units`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modelId: 'hiace-premio', plateNumber: 'ab 1234 cd', year: 2026, nextServiceDate: futureDate }),
    });
    assert.equal(createdRes.status, 201);
    const { item } = await createdRes.json();
    assert.equal(item.plateNumber, 'AB 1234 CD');
    assert.equal(item.serviceAlert, 'ok');

    // Duplicate plate gives descriptive conflict message instead of "The request could not be completed"
    const dupRes = await fetch(`${base}/api/v1/admin/vehicle-units`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modelId: modelUuid, plateNumber: 'AB 1234 CD', year: 2026 }),
    });
    assert.equal(dupRes.status, 409);
    const dupBody = await dupRes.json();
    assert.notEqual(dupBody.error.message, 'The request could not be completed');
    assert.match(dupBody.error.message, /Nomor polisi/i);

    // Filter via serviceAlert=ok and inspect summary/total fields
    const listRes = await fetch(`${base}/api/v1/admin/vehicle-units?serviceAlert=ok`);
    assert.equal(listRes.status, 200);
    const listBody = await listRes.json();
    assert.equal(listBody.total, 1);
    assert.equal(listBody.summary.totalUnits, 1);
    assert.equal(listBody.summary.inUse, 0);
    assert.equal(listBody.summary.serviceDueOrOverdue, 0);
    assert.equal(listBody.items.length, 1);
  });
});

test('Bug 6, 7, 8, & 10: settingsRepository persists Inbox/Content across restarts, Inbox maps ID categories, Finance logs voids, Settings search avoids UUID ILIKE', async () => {
  // Bug 6 + 10: settingsRepository.getSetting/upsertSetting + Inbox Indonesian category mapping + Content revision persistence
  const settingsRepo = createInMemorySettingsRepository();
  assert.equal(typeof settingsRepo.getSetting, 'function');
  assert.equal(typeof settingsRepo.upsertSetting, 'function');

  const auth = { async hasPermission() { return true; } };
  const inboxRepo = createInMemoryInboxRepository();
  const inbox1 = createInboxService({ repository: inboxRepo, authorizationService: auth, settingsRepository: settingsRepo });
  const msg = await inbox1.submitPublicContactMessage({
    input: { senderName: 'Ani', senderEmail: 'ani@test.id', content: 'Unit terlambat datang', category: 'keluhan' },
  });
  assert.equal(msg.item.meta.category, 'complaint');
  assert.equal(msg.item.meta.priority, 'high');

  const inbox2 = createInboxService({ repository: inboxRepo, authorizationService: auth, settingsRepository: settingsRepo });
  const loadedMsg = await inbox2.getMessageById({ userId: 'u-1', id: msg.item.id });
  assert.equal(loadedMsg.item.meta.category, 'complaint');
  assert.equal(loadedMsg.item.meta.priority, 'high');

  const contentRepo = createInMemoryContentRepository();
  const content1 = createContentService({ repository: contentRepo, authorizationService: auth, settingsRepository: settingsRepo });
  const cCreated = await content1.createContent({ userId: 'u-1', input: { title: 'Artikel Test', slug: 'artikel-test' } });
  await content1.updateContent({ userId: 'u-1', id: cCreated.item.id, input: { title: 'Artikel Test v2' } });
  const content2 = createContentService({ repository: contentRepo, authorizationService: auth, settingsRepository: settingsRepo });
  const revs = await content2.getRevisions({ userId: 'u-1', id: cCreated.item.id });
  assert.equal(revs.items.length, 1);

  // Check createPrismaSettingsRepository also exposes getSetting / upsertSetting
  const prismaMock = {
    systemSetting: {
      findMany: async () => [],
      findUnique: async () => ({ key: 'k', value: 'v' }),
      upsert: async () => ({ key: 'k', value: 'v' }),
    },
  };
  const prismaSettingsRepo = createPrismaSettingsRepository(prismaMock);
  assert.deepEqual(await prismaSettingsRepo.getSetting('k'), { key: 'k', value: 'v' });

  // Bug 7: Finance void calls activityLog.log when available
  const finRepo = createInMemoryFinanceRepository();
  const finLogs = [];
  const finService = createFinanceService({
    repository: finRepo,
    authorizationService: auth,
    activityLog: { async log(entry) { finLogs.push(entry); } },
  });
  const tx = await finService.createTransaction({ userId: 'u-1', input: { type: 'income', amount: 500000 } });
  await finService.voidTransaction({ userId: 'u-1', id: tx.item.id, reason: 'Batalkan duplikat' });
  assert.equal(finLogs.some((l) => l.action === 'FINANCE_TRANSACTION_VOIDED' && l.resourceId === tx.item.id), true);

  // Bug 8: listActivityLogs must never query { actor: { contains: ... } } on UUID column
  let capturedWhere = null;
  const settingsSvc = createSettingsService({
    repository: settingsRepo,
    authorizationService: auth,
    prisma: {
      user: { async findMany() { return [{ id: '11111111-1111-4111-8111-111111111111', username: 'hendra', displayName: 'Hendra', email: 'h@test.id' }]; } },
      activityLog: {
        async findMany({ where }) { capturedWhere = where; return []; },
        async count() { return 0; },
      },
    },
  });
  await settingsSvc.listActivityLogs({ userId: 'u-1', q: 'hendra' });
  assert.equal(capturedWhere.OR.some((clause) => clause.actor && typeof clause.actor === 'object' && 'contains' in clause.actor), false);
  assert.equal(capturedWhere.OR.some((clause) => Array.isArray(clause.actor?.in) && clause.actor.in[0] === '11111111-1111-4111-8111-111111111111'), true);
});

test('BUG-NEW-001, BUG-NEW-003 & BUG-NEW-005: dashboard underVerification count, slug-based pricing snapshot, and finance pendingInvoices', async () => {
  // BUG-NEW-005: dashboard.service includes underVerification when repository.countBookings is present
  const dashSvc = createDashboardService({
    authorizationService: { requirePermission: async () => {} },
    repository: {
      countCategories: async () => 2,
      countModels: async () => 5,
      countRentalCapabilities: async () => 8,
      countBookings: async (where = {}) => {
        if (where.status === 'waiting_confirmation') return 3;
        if (where.status === 'under_verification') return 2;
        if (where.status === 'confirmed') return 4;
        if (where.status === 'completed') return 6;
        return 15;
      },
    },
  });
  const dashSummary = await dashSvc.getSummary({ actor: 'admin-1' });
  assert.equal(dashSummary.summary.bookings.underVerification, 2);
  assert.equal(dashSummary.summary.bookings.waitingConfirmation, 3);
  assert.equal(dashSummary.summary.bookings.total, 15);

  // BUG-NEW-001: booking.service matches PricingRule stored with model slug when booking uses model UUID
  const savedBookings = [];
  const modUuid = '00000000-0000-4000-8000-000000000022';
  const catUuid = '00000000-0000-4000-8000-000000000011';
  const bookingSvc = createBookingService({
    repository: {
      saveBooking: async (b) => { savedBookings.push(b); return b; },
    },
    fleetService: {
      findModelForPublicBooking: async ({ modelId, categoryId, rentalType }) => (
        modelId === modUuid && categoryId === catUuid && rentalType === 'with_driver'
          ? { id: modUuid, slug: 'toyota-hiace-premio', categoryId: catUuid, name: 'Toyota Hiace Premio' }
          : null
      ),
    },
    pricingRepository: {
      listPricing: async () => ({
        items: [{ id: 'prc-1', modelId: 'toyota-hiace-premio', rentalType: 'with_driver', billingUnit: 'day', baseRate: 1400000, currency: 'IDR', isActive: true }],
      }),
    },
    settingsRepository: createInMemorySettingsRepository(),
  });
  const bkRes = await bookingSvc.createPublicBookingRequest({
    customerName: 'Rina Kusuma',
    whatsappPhone: '+6281234567890',
    categoryId: catUuid,
    modelId: modUuid,
    rentalType: 'with_driver',
    startsOn: '2030-09-10',
    endsOn: '2030-09-12',
    pickupLocation: 'Stasiun Tugu Yogyakarta',
  });
  assert.equal(bkRes.priceSnapshot?.pricingRuleId, 'prc-1');
  assert.equal(bkRes.priceSnapshot?.agreedRate, 1400000);
  assert.equal(bkRes.priceSnapshot?.days, 3);
  assert.equal(bkRes.priceSnapshot?.totalAmount, 4200000);

  // BUG-NEW-003: prismaFinanceRepository.getSummary computes pendingInvoices from active unpaid bookings
  const finRepo = createPrismaFinanceRepository({
    financeTransaction: {
      aggregate: async ({ where }) => ({ _sum: { amount: where.type === 'income' ? 1400000 : 0 } }),
      count: async () => 1,
      findMany: async () => [{ bookingId: 'bk-paid-1' }],
    },
    booking: {
      findMany: async () => [
        { id: 'bk-paid-1', bookingCode: 'BK-001' },
        { id: 'bk-unpaid-2', bookingCode: 'BK-002' },
        { id: 'bk-unpaid-3', bookingCode: 'BK-003' },
      ],
    },
  });
  const finSummary = await finRepo.getSummary({});
  assert.equal(finSummary.pendingInvoices, 2);
});

test('Feature 3A: inbox reply email webhook handles empty config, success with secret header, 502/timeout failure, and safe retry', async () => {
  const prevUrl = process.env.SMTP_WEBHOOK_URL;
  const prevSecret = process.env.SMTP_WEBHOOK_SECRET;
  const seedMsg = {
    id: 'msg-email-1',
    senderName: 'Budi',
    senderEmail: 'budi@example.test',
    subject: 'Tanya Hiace',
    content: 'Mohon info sewa Hiace.',
    status: 'unread',
    createdAt: '2026-11-18T01:00:00.000Z',
  };

  try {
    // 1. Empty config saves internally without claiming sent
    delete process.env.SMTP_WEBHOOK_URL;
    delete process.env.SMTP_WEBHOOK_SECRET;
    const repoNoCfg = createInMemoryInboxRepository([{ ...seedMsg }]);
    const svcNoCfg = createInboxService({ repository: repoNoCfg, settingsRepository: createInMemorySettingsRepository() });
    const resNoCfg = await svcNoCfg.replyToMessage({
      userId: 'admin-1',
      id: 'msg-email-1',
      input: { subject: 'Re: Tanya Hiace', body: 'Tersedia mulai Besok.' },
    });
    assert.equal(resNoCfg.emailConfigured, false);
    assert.equal(resNoCfg.deliverySuccess, false);
    assert.equal(resNoCfg.reply.deliveryStatus, 'smtp_not_configured');
    assert.equal(resNoCfg.item.status, 'unread');

    // 2. Failing HTTP 500 + timeout saves failed reply and allows retry when healthy
    process.env.SMTP_WEBHOOK_URL = 'https://mailer.example.test/send';
    process.env.SMTP_WEBHOOK_SECRET = 'secret-xyz';
    let mode = 'http500';
    const captured = [];
    const mockFetch = async (url, init) => {
      captured.push({ url, init });
      if (mode === 'timeout') {
        const e = new Error('Timed out');
        e.name = 'TimeoutError';
        throw e;
      }
      if (mode === 'http500') {
        return new Response('err', { status: 500 });
      }
      return new Response('ok', { status: 200 });
    };

    const repoFail = createInMemoryInboxRepository([{ ...seedMsg }]);
    const svcFail = createInboxService({ repository: repoFail, settingsRepository: createInMemorySettingsRepository(), fetchImpl: mockFetch });
    const failRes = await svcFail.replyToMessage({
      userId: 'admin-1',
      id: 'msg-email-1',
      input: { subject: 'Re: Hiace', body: 'Balasan pertama' },
    });
    assert.equal(failRes.deliverySuccess, false);
    assert.equal(failRes.reply.deliveryStatus, 'failed');
    assert.match(failRes.reply.deliveryError, /HTTP 500/);
    assert.equal(failRes.item.status, 'unread');
    assert.equal(captured[0].init.headers.Authorization, 'Bearer secret-xyz');
    assert.equal(captured[0].init.headers['X-Webhook-Secret'], 'secret-xyz');

    mode = 'timeout';
    const timeoutRetry = await svcFail.retryReplyDelivery({ userId: 'admin-1', id: 'msg-email-1', replyId: failRes.reply.id });
    assert.equal(timeoutRetry.deliverySuccess, false);
    assert.equal(timeoutRetry.reply.deliveryStatus, 'failed');
    assert.match(timeoutRetry.reply.deliveryError, /Timeout/i);
    assert.equal(timeoutRetry.reply.attempts, 2);

    mode = 'ok';
    const okRetry = await svcFail.retryReplyDelivery({ userId: 'admin-1', id: 'msg-email-1', replyId: failRes.reply.id });
    assert.equal(okRetry.deliverySuccess, true);
    assert.equal(okRetry.reply.deliveryStatus, 'sent');
    assert.equal(okRetry.reply.attempts, 3);
    assert.equal(okRetry.item.status, 'replied');

    // Duplicate retry guard after sent
    await assert.rejects(
      svcFail.retryReplyDelivery({ userId: 'admin-1', id: 'msg-email-1', replyId: failRes.reply.id }),
      { code: 'ALREADY_SENT', status: 409 },
    );
  } finally {
    if (prevUrl === undefined) delete process.env.SMTP_WEBHOOK_URL; else process.env.SMTP_WEBHOOK_URL = prevUrl;
    if (prevSecret === undefined) delete process.env.SMTP_WEBHOOK_SECRET; else process.env.SMTP_WEBHOOK_SECRET = prevSecret;
  }
});

test('Feature 3B: CMS image upload validates signature, extension, path safety, and optional object storage webhook', async () => {
  const prevStorageUrl = process.env.OBJECT_STORAGE_UPLOAD_URL;
  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]);
  const validPngB64 = `data:image/png;base64,${pngBytes.toString('base64')}`;

  try {
    delete process.env.OBJECT_STORAGE_UPLOAD_URL;
    const settingsRepo = createInMemorySettingsRepository();
    const contentSvc = createContentService({
      repository: createInMemoryContentRepository(),
      settingsRepository: settingsRepo,
    });

    // Reject path traversal
    await assert.rejects(
      contentSvc.uploadContentImage({ userId: 'admin-1', input: { fileName: '../evil.png', mimeType: 'image/png', dataBase64: validPngB64 } }),
      { code: 'INVALID_FILE_NAME', status: 400 },
    );
    // Reject spoofed binary signature
    await assert.rejects(
      contentSvc.uploadContentImage({
        userId: 'admin-1',
        input: { fileName: 'hero.png', mimeType: 'image/png', dataBase64: Buffer.from('<?php echo 1; ?>').toString('base64') },
      }),
      { code: 'INVALID_IMAGE_SIGNATURE', status: 400 },
    );
    // Reject mismatched MIME/extension
    await assert.rejects(
      contentSvc.uploadContentImage({ userId: 'admin-1', input: { fileName: 'hero.jpg', mimeType: 'image/png', dataBase64: validPngB64 } }),
      { code: 'INVALID_FILE_EXTENSION', status: 400 },
    );
    // Reject SVG
    await assert.rejects(
      contentSvc.uploadContentImage({ userId: 'admin-1', input: { fileName: 'hero.svg', mimeType: 'image/svg+xml', dataBase64: Buffer.from('<svg></svg>').toString('base64') } }),
      { code: 'INVALID_MIME_TYPE', status: 400 },
    );

    // Valid PNG upload stored inline and served via getPublicMediaById
    const uploaded = await contentSvc.uploadContentImage({
      userId: 'admin-1',
      input: { fileName: 'Banner Promo.PNG', mimeType: 'image/png', dataBase64: validPngB64 },
    });
    assert.equal(uploaded.storageMode, 'database_inline');
    assert.match(uploaded.objectKey, /^cms-media\/[0-9a-f-]+\/banner-promo\.png$/);
    const served = await contentSvc.getPublicMediaById({ mediaId: uploaded.mediaId });
    assert.equal(served.mimeType, 'image/png');
    assert.deepEqual(served.buffer, pngBytes);

    // External object storage webhook success & failure
    process.env.OBJECT_STORAGE_UPLOAD_URL = 'https://cdn-upload.example.test/put';
    const extOkSvc = createContentService({
      repository: createInMemoryContentRepository(),
      settingsRepository: settingsRepo,
      fetchImpl: async () => new Response(JSON.stringify({ publicUrl: 'https://cdn.example.test/banner.png', objectKey: 'custom/banner.png' }), { status: 200 }),
    });
    const extRes = await extOkSvc.uploadContentImage({
      userId: 'admin-1',
      input: { fileName: 'banner.png', mimeType: 'image/png', dataBase64: validPngB64 },
    });
    assert.equal(extRes.storageMode, 'external_object_storage');
    assert.equal(extRes.imageUrl, 'https://cdn.example.test/banner.png');
    assert.equal(extRes.objectKey, 'custom/banner.png');
  } finally {
    if (prevStorageUrl === undefined) delete process.env.OBJECT_STORAGE_UPLOAD_URL; else process.env.OBJECT_STORAGE_UPLOAD_URL = prevStorageUrl;
  }
});

test('Feature 3C: public traffic analytics respects DNT/bots, deduplicates hits, and aggregates range counters', async () => {
  const analyticsSvc = createAnalyticsService({ settingsRepository: createInMemorySettingsRepository() });
  const t0 = new Date('2026-11-18T02:00:00.000Z');

  assert.deepEqual(await analyticsSvc.recordPageView({ path: '/', dnt: true, now: t0 }), { recorded: false, reason: 'dnt_respected' });
  assert.deepEqual(await analyticsSvc.recordPageView({ path: '/', userAgent: 'Googlebot/2.1', now: t0 }), { recorded: false, reason: 'bot_ignored' });
  await assert.rejects(analyticsSvc.recordPageView({ path: 'invalid-path', now: t0 }), { code: 'INVALID_INPUT', status: 400 });

  const h1 = await analyticsSvc.recordPageView({ path: '/pages/armada.html?q=hiace', visitorToken: 'vis-A', now: t0 });
  assert.equal(h1.recorded, true);
  assert.equal(h1.path, '/pages/armada.html');

  // Rapid duplicate within < 5s suppressed
  const hDup = await analyticsSvc.recordPageView({ path: '/pages/armada.html', visitorToken: 'vis-A', now: new Date(t0.getTime() + 1500) });
  assert.deepEqual(hDup, { recorded: false, reason: 'deduplicated' });

  // After 6s recorded again by same visitor -> 2 pageViews, still 1 uniqueVisitor
  await analyticsSvc.recordPageView({ path: '/pages/armada.html', visitorToken: 'vis-A', now: new Date(t0.getTime() + 6000) });
  // Different visitor 10 days ago (included in 30d, excluded in 7d)
  await analyticsSvc.recordPageView({ path: '/', visitorToken: 'vis-B', now: new Date(t0.getTime() - 10 * 86_400_000) });

  const over7d = await analyticsSvc.getOverview({ userId: 'admin-1', range: '7d', now: t0 });
  assert.equal(over7d.traffic.pageViews, 2);
  assert.equal(over7d.traffic.uniqueVisitors, 1);
  assert.equal(over7d.traffic.trackerStatus, 'active_receiving');

  const over30d = await analyticsSvc.getOverview({ userId: 'admin-1', range: '30d', now: t0 });
  assert.equal(over30d.traffic.pageViews, 3);
  assert.equal(over30d.traffic.uniqueVisitors, 2);
});

test('Feature 3D: myProfile email change OTP enforces SMTP check, uniqueness, attempt lock, one-time use, and no OTP log leak', async () => {
  const prevUrl = process.env.SMTP_WEBHOOK_URL;
  const user = { id: 'u-prof-1', email: 'old@example.test', username: 'prof1', displayName: 'Prof Satu', status: 'ACTIVE', deletedAt: null, roles: [] };
  const otherUser = { id: 'u-prof-2', email: 'taken@example.test' };
  const logs = [];
  let sentOtpText = '';

  const prisma = {
    user: {
      findUnique: async ({ where }) => {
        if (where.id === user.id) return { ...user };
        if (where.email === user.email) return { ...user };
        if (where.email === otherUser.email) return { ...otherUser };
        return null;
      },
      update: async ({ data }) => {
        Object.assign(user, data);
        return { ...user };
      },
    },
    activityLog: { async create({ data }) { logs.push(data); return data; } },
    async $transaction(cb) { return cb(prisma); },
  };
  const profileSvc = createMyProfileService({
    prisma,
    passwordService: { hash: async () => 'h' },
    activityLog: { async log(entry) { logs.push(entry); } },
    settingsRepository: createInMemorySettingsRepository(),
    fetchImpl: async (_url, init) => {
      const payload = JSON.parse(init.body);
      sentOtpText = payload.text;
      return new Response('ok', { status: 200 });
    },
  });

  try {
    // 1. Without SMTP_WEBHOOK_URL -> fail closed
    delete process.env.SMTP_WEBHOOK_URL;
    await assert.rejects(profileSvc.requestEmailChange(user.id, { newEmail: 'new@example.test' }), { status: 'EMAIL_SERVICE_NOT_CONFIGURED' });
    assert.equal(user.email, 'old@example.test');

    // 2. Duplicate email -> PROFILE_VALUE_IN_USE
    process.env.SMTP_WEBHOOK_URL = 'https://mailer.example.test/send';
    await assert.rejects(profileSvc.requestEmailChange(user.id, { newEmail: 'taken@example.test' }), { status: 'PROFILE_VALUE_IN_USE' });

    // 3. Request OTP succeeds, extract OTP from webhook payload, ensure logs never contain OTP
    const reqRes = await profileSvc.requestEmailChange(user.id, { newEmail: 'new@example.test' });
    assert.equal(reqRes.status, 'EMAIL_VERIFICATION_SENT');
    const otpMatch = sentOtpText.match(/\b(\d{6})\b/);
    assert.ok(otpMatch, 'OTP 6 digit must be sent to webhook');
    const otp = otpMatch[1];
    assert.equal(JSON.stringify(logs).includes(otp), false);

    // 4. Wrong OTP -> invalid, then verify valid OTP succeeds & cannot be reused
    const wrongOtp = otp === '000000' ? '111111' : '000000';
    await assert.rejects(profileSvc.confirmEmailChange(user.id, { newEmail: 'new@example.test', code: wrongOtp }), { status: 'EMAIL_OTP_INVALID' });
    const confirmed = await profileSvc.confirmEmailChange(user.id, { newEmail: 'new@example.test', code: otp });
    assert.equal(confirmed.email, 'new@example.test');
    await assert.rejects(profileSvc.confirmEmailChange(user.id, { newEmail: 'new@example.test', code: otp }), { status: 'EMAIL_OTP_EXPIRED_OR_INVALID' });

    // 5. Brute-force 5 wrong attempts triggers lockout
    await profileSvc.requestEmailChange(user.id, { newEmail: 'final@example.test' });
    for (let i = 0; i < 4; i += 1) {
      await assert.rejects(profileSvc.confirmEmailChange(user.id, { newEmail: 'final@example.test', code: '999999' }), { status: 'EMAIL_OTP_INVALID' });
    }
    await assert.rejects(profileSvc.confirmEmailChange(user.id, { newEmail: 'final@example.test', code: '999999' }), { status: 'EMAIL_OTP_MAX_ATTEMPTS' });
  } finally {
    if (prevUrl === undefined) delete process.env.SMTP_WEBHOOK_URL; else process.env.SMTP_WEBHOOK_URL = prevUrl;
  }
});

test('Anatalia Fleet Integration: deleteModel (hard vs safe deactivate), photo upload + magic-byte validation + orphan cleanup, public catalog, and WhatsApp default', async () => {
  const settingsRepo = createInMemorySettingsRepository();
  const catId = '11111111-1111-4111-8111-111111111111';
  const model1Id = '22222222-2222-4222-8222-222222222222';
  const model2Id = '33333333-3333-4333-8333-333333333333';
  const model3Id = '44444444-4444-4444-8444-444444444444';
  const models = new Map([
    [model1Id, {
      id: model1Id,
      categoryId: catId,
      slug: 'toyota-avanza-g',
      name: 'Toyota Avanza G',
      description: 'MPV keluarga nyaman',
      seatCount: 7,
      publicSpecs: null,
      isActive: true,
      isVerified: true,
      version: 1,
      category: { id: catId, slug: 'mpv', name: 'MPV Keluarga' },
      rentalOptions: [{ rentalType: 'with_driver', isEnabled: true }],
    }],
    [model2Id, {
      id: model2Id,
      categoryId: catId,
      slug: 'toyota-hiace-premio',
      name: 'Toyota Hiace Premio',
      description: 'Minibus rombongan',
      seatCount: 14,
      publicSpecs: null,
      isActive: true,
      isVerified: true,
      version: 1,
      category: { id: catId, slug: 'mpv', name: 'MPV Keluarga' },
      rentalOptions: [{ rentalType: 'with_driver', isEnabled: true }],
    }],
    [model3Id, {
      id: model3Id,
      categoryId: catId,
      slug: 'draft-model',
      name: 'Draft Model',
      description: 'Belum terverifikasi',
      seatCount: 5,
      publicSpecs: null,
      isActive: true,
      isVerified: false,
      version: 1,
      category: { id: catId, slug: 'mpv', name: 'MPV Keluarga' },
      rentalOptions: [{ rentalType: 'with_driver', isEnabled: true }],
    }],
  ]);
  const logs = [];
  const relationsByModel = new Map([
    [model1Id, { unitCount: 0, bookingCount: 0, hasRelations: false }],
    [model2Id, { unitCount: 2, bookingCount: 1, hasRelations: true }],
  ]);

  const repo = {
    transaction: (work) => work(repo),
    model: {
      get: async (id) => (models.has(id) ? { ...models.get(id) } : null),
      findBySlug: async (slug) => [...models.values()].find((m) => m.slug === slug) ?? null,
      update: async (id, data) => {
        const current = models.get(id);
        const updated = { ...current, ...data, version: current.version + 1 };
        models.set(id, updated);
        return { ...updated };
      },
      disableAllRentalOptions: async (id) => {
        const current = models.get(id);
        if (current) {
          current.rentalOptions = current.rentalOptions.map((o) => ({ ...o, isEnabled: false }));
        }
      },
      hasRelations: async (id) => relationsByModel.get(id) ?? { unitCount: 0, bookingCount: 0 },
      delete: async (id) => {
        const existing = models.get(id);
        models.delete(id);
        return existing;
      },
      countUsingMedia: async (mediaId, excludeModelId) => {
        let count = 0;
        for (const m of models.values()) {
          if (excludeModelId && m.id === excludeModelId) continue;
          if (m.publicSpecs?.imageMediaId === mediaId) count += 1;
        }
        return count;
      },
    },
    public: {
      catalog: async ({ q } = {}) => {
        const list = [...models.values()]
          .filter((m) => m.isActive && m.isVerified && (!q || m.name.toLowerCase().includes(q.toLowerCase())));
        return {
          models: list,
          total: list.length,
          pricingRules: [
            { id: 'pr-1', modelId: 'toyota-avanza-g', baseRate: 450000, currency: 'IDR', billingUnit: 'day', isActive: true },
            { id: 'pr-2', modelId: model2Id, baseRate: 1200000, currency: 'IDR', billingUnit: 'day', isActive: true },
          ],
          units: [
            { id: 'u-1', modelId: model1Id, status: 'available' },
            { id: 'u-2', modelId: model1Id, status: 'in_use' },
          ],
        };
      },
      modelByIdOrSlug: async (idOrSlug) => {
        const m = [...models.values()].find((item) => item.isActive && item.isVerified && (item.id === idOrSlug || item.slug === idOrSlug));
        if (!m) return null;
        return {
          model: m,
          pricingRules: [{ id: 'pr-1', modelId: m.slug, baseRate: 450000, currency: 'IDR', billingUnit: 'day', isActive: true }],
          units: [{ id: 'u-1', modelId: m.id, status: 'available' }],
        };
      },
    },
  };

  const fleetService = createFleetService({
    repository: repo,
    authorizationService: { requirePermission: async () => {}, hasPermission: async () => true },
    activityLog: { log: async (entry) => { logs.push(entry); } },
    settingsRepository: settingsRepo,
  });

  const app = createApp({
    logger: createLogger(() => {}),
    publicFleetRouter: createPublicFleetRouter({ fleetService, logger: createLogger(() => {}) }),
    adminFleetRouter: createAdminFleetRouter({ fleetService, logger: createLogger(() => {}) }),
    authenticationMiddleware: (req, _res, next) => { req.userId = 'admin-1'; next(); },
    csrfMiddleware: { middleware: (_req, _res, next) => next(), guard: (_req, _res, next) => next() },
  });

  // Valid minimal PNG magic bytes
  const validPngBase64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]).toString('base64');
  // Fake PNG containing HTML/script bytes
  const fakePngBase64 = Buffer.from('<script>alert(1)</script>').toString('base64');

  await withServer(app, async (base) => {
    // 1. Reject spoofed image magic bytes
    const badMagic = await fetch(`${base}/api/v1/admin/vehicle-models/upload-image`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fileName: 'car.png', mimeType: 'image/png', dataBase64: fakePngBase64 }),
    });
    assert.equal(badMagic.status, 400);

    // 2. Reject invalid extension / path traversal
    const badPath = await fetch(`${base}/api/v1/admin/vehicle-models/upload-image`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fileName: '../evil.png', mimeType: 'image/png', dataBase64: validPngBase64 }),
    });
    assert.equal(badPath.status, 400);

    // 3. Upload two valid PNG photos
    const up1 = await fetch(`${base}/api/v1/admin/vehicle-models/upload-image`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fileName: 'avanza.png', mimeType: 'image/png', dataBase64: validPngBase64 }),
    });
    assert.equal(up1.status, 201);
    const up1Body = await up1.json();
    assert.match(up1Body.imageUrl, /^\/api\/v1\/public\/vehicle-media\//);

    const up2 = await fetch(`${base}/api/v1/admin/vehicle-models/upload-image`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fileName: 'avanza-v2.png', mimeType: 'image/png', dataBase64: validPngBase64 }),
    });
    assert.equal(up2.status, 201);
    const up2Body = await up2.json();

    // 4. Attach photo 1 to model1 and verify serving headers
    const patch1 = await fetch(`${base}/api/v1/admin/vehicle-models/${model1Id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ publicSpecs: { imageUrl: up1Body.imageUrl, imageMediaId: up1Body.mediaId, transmission: 'Otomatis' } }),
    });
    assert.equal(patch1.status, 200);

    const mediaRes = await fetch(`${base}${up1Body.imageUrl}`);
    assert.equal(mediaRes.status, 200);
    assert.equal(mediaRes.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(mediaRes.headers.get('content-security-policy'), "default-src 'none'");

    // 5. Replace photo 1 with photo 2 -> photo 1 orphan is automatically cleaned up
    const patch2 = await fetch(`${base}/api/v1/admin/vehicle-models/${model1Id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ publicSpecs: { imageUrl: up2Body.imageUrl, imageMediaId: up2Body.mediaId, transmission: 'Otomatis' } }),
    });
    assert.equal(patch2.status, 200);
    const oldMediaRes = await fetch(`${base}${up1Body.imageUrl}`);
    assert.equal(oldMediaRes.status, 404);

    // 6. Public catalog exposes active+verified models with imageUrl & excludes unverified draft
    const catRes = await fetch(`${base}/api/v1/public/fleet-catalog`);
    assert.equal(catRes.status, 200);
    const catBody = await catRes.json();
    assert.equal(catBody.items.length, 2);
    const avanzaPub = catBody.items.find((i) => i.id === model1Id);
    assert.equal(avanzaPub.imageUrl, up2Body.imageUrl);
    assert.equal(avanzaPub.startingPrice, 450000);
    assert.equal(catBody.items.some((i) => i.id === model3Id), false);

    // 7. Public model detail lookup by slug works
    const detRes = await fetch(`${base}/api/v1/public/vehicle-models/toyota-avanza-g`);
    assert.equal(detRes.status, 200);
    const detBody = await detRes.json();
    assert.equal(detBody.item.id, model1Id);
    assert.equal(detBody.item.imageUrl, up2Body.imageUrl);

    // 8. Permanent delete model1 (no relations) -> hard delete + cleans up photo 2 + hidden from public
    const del1 = await fetch(`${base}/api/v1/admin/vehicle-models/${model1Id}?permanent=true`, { method: 'DELETE' });
    assert.equal(del1.status, 200);
    const del1Body = await del1.json();
    assert.equal(del1Body.deleted, true);
    assert.equal(del1Body.permanent, true);
    assert.equal(models.has(model1Id), false);
    const photo2AfterDelete = await fetch(`${base}${up2Body.imageUrl}`);
    assert.equal(photo2AfterDelete.status, 404);
    assert.equal(logs.some((l) => l.action === 'FLEET_MODEL_DELETED' && l.resourceId === model1Id), true);

    // 9. Permanent delete model2 (has units/bookings) -> safe deactivation + hidden from public catalog
    const del2 = await fetch(`${base}/api/v1/admin/vehicle-models/${model2Id}?permanent=true`, { method: 'DELETE' });
    assert.equal(del2.status, 200);
    const del2Body = await del2.json();
    assert.equal(del2Body.deleted, false);
    assert.equal(del2Body.deactivated, true);
    assert.equal(models.get(model2Id).isActive, false);
    assert.equal(models.get(model2Id).isVerified, false);

    const catAfter = await fetch(`${base}/api/v1/public/fleet-catalog`);
    const catAfterBody = await catAfter.json();
    assert.equal(catAfterBody.items.length, 0);
  });

  // 10. SettingsService public site config defaults to official WA 6281383333707 and overrides legacy placeholder
  const settingsSvc = createSettingsService({
    repository: settingsRepo,
    authorizationService: { hasPermission: async () => true },
  });
  const pubCfgDefault = await settingsSvc.getPublicSiteConfig();
  assert.equal(pubCfgDefault.whatsappNumber, '6281383333707');
  assert.equal(pubCfgDefault.supportEmail, 'Anantalia.trans80@gmail.com');
  assert.match(pubCfgDefault.address, /Gunung Sindur/i);
  assert.match(pubCfgDefault.instagramUrl, /instagram\.com\/anantalia_trans/i);
  assert.match(pubCfgDefault.tiktokUrl, /tiktok\.com\/@anantalia_trans/i);

  await settingsRepo.upsertSetting('whatsappNumber', '6281234567890');
  await settingsRepo.upsertSetting('supportEmail', 'info@anantaliatrans.com');
  await settingsRepo.upsertSetting('address', 'Sleman, D.I. Yogyakarta');
  const pubCfgSanitized = await settingsSvc.getPublicSiteConfig();
  assert.equal(pubCfgSanitized.whatsappNumber, '6281383333707');
  assert.equal(pubCfgSanitized.supportEmail, 'Anantalia.trans80@gmail.com');
  assert.match(pubCfgSanitized.address, /Gunung Sindur/i);
});

test('CMS validateSafeUrl accepts pasted external URLs, www. normalization, and data:image payloads', async () => {
  const { validateSafeUrl } = await import('../../src/content/content.service.js');
  assert.equal(validateSafeUrl('https://cdn.example.com/promo.jpg', { allowDataImage: true }), 'https://cdn.example.com/promo.jpg');
  assert.equal(validateSafeUrl('  www.example.com/banner.webp  ', { allowDataImage: true }), 'https://www.example.com/banner.webp');
  assert.equal(validateSafeUrl('/api/v1/public/content-media/abc', { allowDataImage: true }), '/api/v1/public/content-media/abc');
  assert.equal(
    validateSafeUrl('data:image/avif;base64, AAAA\nBBBB==', { allowDataImage: true }),
    'data:image/avif;base64,AAAABBBB==',
  );
  assert.throws(() => validateSafeUrl('javascript:alert(1)', { allowDataImage: true }), { code: 'INVALID_INPUT' });
});
