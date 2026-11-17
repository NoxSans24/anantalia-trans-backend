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
import { createAdminFleetRouter } from '../../src/fleet/fleet.routes.js';
import { createInMemorySettingsRepository } from '../../src/settings/in-memory-settings.repository.js';
import { createPrismaSettingsRepository } from '../../src/settings/prisma-settings.repository.js';
import { createInboxService } from '../../src/inbox/inbox.service.js';
import { createInMemoryInboxRepository } from '../../src/inbox/in-memory-inbox.repository.js';
import { createContentService } from '../../src/content/content.service.js';
import { createInMemoryContentRepository } from '../../src/content/in-memory-content.repository.js';
import { createFinanceService } from '../../src/finance/finance.service.js';
import { createInMemoryFinanceRepository } from '../../src/finance/in-memory-finance.repository.js';
import { createSettingsService } from '../../src/settings/settings.service.js';

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
