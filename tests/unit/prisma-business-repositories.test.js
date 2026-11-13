import assert from 'node:assert/strict';
import test from 'node:test';
import { createPrismaBookingRepository } from '../../src/booking/prisma-booking.repository.js';
import { createPrismaCustomerRepository } from '../../src/customer/prisma-customer.repository.js';
import { createPrismaPricingRepository } from '../../src/pricing/prisma-pricing.repository.js';
import { createPrismaFinanceRepository } from '../../src/finance/prisma-finance.repository.js';
import { createPrismaInboxRepository } from '../../src/inbox/prisma-inbox.repository.js';
import { createPrismaContentRepository } from '../../src/content/prisma-content.repository.js';
import { createPrismaSettingsRepository } from '../../src/settings/prisma-settings.repository.js';
import { createPrismaAnalyticsRepository } from '../../src/analytics/prisma-analytics.repository.js';
import { createPrismaDashboardRepository } from '../../src/dashboard/prisma-dashboard.repository.js';
import { createBookingService } from '../../src/booking/booking.service.js';
import { createCustomerService } from '../../src/customer/customer.service.js';
import { createPricingService } from '../../src/pricing/pricing.service.js';
import { createFinanceService } from '../../src/finance/finance.service.js';
import { createInboxService } from '../../src/inbox/inbox.service.js';
import { createContentService } from '../../src/content/content.service.js';
import { createSettingsService } from '../../src/settings/settings.service.js';
import { createAnalyticsService } from '../../src/analytics/analytics.service.js';
import { createDashboardService } from '../../src/dashboard/dashboard.service.js';

/**
 * Stateful fake Prisma client backing all business tables in memory with Date objects
 * to verify serialization, filtering, aggregation, and persistence across repository re-instantiation.
 */
function createStatefulPrismaMock() {
  const tables = {
    booking: new Map(),
    customer: new Map(),
    pricingRule: new Map(),
    financeTransaction: new Map(),
    inboxMessage: new Map(),
    inboxMessageNote: new Map(),
    contentItem: new Map(),
    systemSetting: new Map(),
  };

  function matchesWhere(row, where = {}) {
    for (const [key, cond] of Object.entries(where)) {
      if (key === 'OR' && Array.isArray(cond)) {
        if (!cond.some((sub) => matchesWhere(row, sub))) return false;
        continue;
      }
      if (cond && typeof cond === 'object' && !Array.isArray(cond) && !(cond instanceof Date)) {
        if ('contains' in cond) {
          const val = String(row[key] ?? '');
          const needle = String(cond.contains);
          const match = cond.mode === 'insensitive'
            ? val.toLowerCase().includes(needle.toLowerCase())
            : val.includes(needle);
          if (!match) return false;
          continue;
        }
        if ('equals' in cond) {
          const val = String(row[key] ?? '');
          const target = String(cond.equals);
          const match = cond.mode === 'insensitive'
            ? val.toLowerCase() === target.toLowerCase()
            : val === target;
          if (!match) return false;
          continue;
        }
        if ('in' in cond && Array.isArray(cond.in)) {
          if (!cond.in.includes(row[key])) return false;
          continue;
        }
        if ('notIn' in cond && Array.isArray(cond.notIn)) {
          if (cond.notIn.includes(row[key])) return false;
          continue;
        }
        if ('gte' in cond || 'lte' in cond) {
          const val = String(row[key] ?? '');
          if ('gte' in cond && val < String(cond.gte)) return false;
          if ('lte' in cond && val > String(cond.lte)) return false;
          continue;
        }
      }
      if (row[key] !== cond) return false;
    }
    return true;
  }

  return {
    _tables: tables,
    vehicleCategory: { count: async () => 4 },
    vehicleModel: { count: async (args) => (args?.where?.isVerified === false ? 1 : 6) },
    vehicleRentalOption: { count: async () => 8 },
    booking: {
      create: async ({ data }) => {
        const record = { ...data, createdAt: data.createdAt ?? new Date(), updatedAt: data.updatedAt ?? new Date() };
        tables.booking.set(record.id, record);
        return { ...record };
      },
      findMany: async ({ where, take = 25, skip = 0 } = {}) => {
        const rows = [...tables.booking.values()].filter((r) => matchesWhere(r, where));
        rows.sort((a, b) => b.createdAt - a.createdAt);
        return rows.slice(skip, skip + take).map((r) => ({ ...r }));
      },
      count: async ({ where } = {}) => [...tables.booking.values()].filter((r) => matchesWhere(r, where)).length,
      findUnique: async ({ where }) => {
        if (where.id) return tables.booking.get(where.id) ?? null;
        if (where.bookingCode) {
          for (const r of tables.booking.values()) if (r.bookingCode === where.bookingCode) return { ...r };
        }
        return null;
      },
      findFirst: async ({ where }) => {
        for (const r of tables.booking.values()) if (matchesWhere(r, where)) return { ...r };
        return null;
      },
      update: async ({ where, data }) => {
        const existing = tables.booking.get(where.id);
        const updated = { ...existing, ...data };
        tables.booking.set(where.id, updated);
        return { ...updated };
      },
    },
    customer: {
      create: async ({ data }) => {
        const record = { ...data, createdAt: data.createdAt ?? new Date(), updatedAt: data.updatedAt ?? new Date() };
        tables.customer.set(record.id, record);
        return { ...record };
      },
      findMany: async ({ where, take = 25, skip = 0 } = {}) => {
        const rows = [...tables.customer.values()].filter((r) => matchesWhere(r, where));
        return rows.slice(skip, skip + take).map((r) => ({ ...r }));
      },
      count: async ({ where } = {}) => [...tables.customer.values()].filter((r) => matchesWhere(r, where)).length,
      findUnique: async ({ where }) => tables.customer.get(where.id) ?? null,
      update: async ({ where, data }) => {
        const existing = tables.customer.get(where.id);
        const updated = { ...existing, ...data };
        tables.customer.set(where.id, updated);
        return { ...updated };
      },
    },
    pricingRule: {
      create: async ({ data }) => {
        const record = { ...data, createdAt: data.createdAt ?? new Date(), updatedAt: data.updatedAt ?? new Date() };
        tables.pricingRule.set(record.id, record);
        return { ...record };
      },
      findMany: async ({ where, take = 25, skip = 0 } = {}) => {
        const rows = [...tables.pricingRule.values()].filter((r) => matchesWhere(r, where));
        return rows.slice(skip, skip + take).map((r) => ({ ...r }));
      },
      count: async ({ where } = {}) => [...tables.pricingRule.values()].filter((r) => matchesWhere(r, where)).length,
      findUnique: async ({ where }) => tables.pricingRule.get(where.id) ?? null,
      update: async ({ where, data }) => {
        const existing = tables.pricingRule.get(where.id);
        const updated = { ...existing, ...data };
        tables.pricingRule.set(where.id, updated);
        return { ...updated };
      },
      delete: async ({ where }) => {
        tables.pricingRule.delete(where.id);
        return {};
      },
    },
    financeTransaction: {
      create: async ({ data }) => {
        const record = { ...data, createdAt: data.createdAt ?? new Date(), updatedAt: new Date() };
        tables.financeTransaction.set(record.id, record);
        return { ...record };
      },
      findMany: async ({ where, take = 25, skip = 0 } = {}) => {
        const rows = [...tables.financeTransaction.values()].filter((r) => matchesWhere(r, where));
        return rows.slice(skip, skip + take).map((r) => ({ ...r }));
      },
      count: async ({ where } = {}) => [...tables.financeTransaction.values()].filter((r) => matchesWhere(r, where)).length,
      findUnique: async ({ where }) => tables.financeTransaction.get(where.id) ?? null,
      aggregate: async ({ where }) => {
        const rows = [...tables.financeTransaction.values()].filter((r) => matchesWhere(r, where));
        const sum = rows.reduce((acc, r) => acc + Number(r.amount || 0), 0);
        return { _sum: { amount: sum } };
      },
    },
    inboxMessage: {
      create: async ({ data }) => {
        const id = data.id ?? 'msg-uuid-1';
        const record = { ...data, id, createdAt: new Date(), updatedAt: new Date() };
        tables.inboxMessage.set(id, record);
        return { ...record, notes: [] };
      },
      findMany: async ({ where, take = 25, skip = 0 } = {}) => {
        const rows = [...tables.inboxMessage.values()].filter((r) => matchesWhere(r, where));
        return rows.slice(skip, skip + take).map((r) => ({
          ...r,
          notes: [...tables.inboxMessageNote.values()].filter((n) => n.messageId === r.id),
        }));
      },
      count: async ({ where } = {}) => [...tables.inboxMessage.values()].filter((r) => matchesWhere(r, where)).length,
      findUnique: async ({ where }) => {
        const msg = tables.inboxMessage.get(where.id);
        if (!msg) return null;
        return {
          ...msg,
          notes: [...tables.inboxMessageNote.values()].filter((n) => n.messageId === msg.id),
        };
      },
      update: async ({ where, data }) => {
        const existing = tables.inboxMessage.get(where.id);
        const updated = { ...existing, ...data };
        tables.inboxMessage.set(where.id, updated);
        return {
          ...updated,
          notes: [...tables.inboxMessageNote.values()].filter((n) => n.messageId === updated.id),
        };
      },
    },
    inboxMessageNote: {
      create: async ({ data }) => {
        const id = `note-${tables.inboxMessageNote.size + 1}`;
        const record = { id, ...data, createdAt: new Date() };
        tables.inboxMessageNote.set(id, record);
        return { ...record };
      },
    },
    contentItem: {
      create: async ({ data }) => {
        const record = { ...data, createdAt: new Date(), updatedAt: new Date() };
        tables.contentItem.set(record.id, record);
        return { ...record };
      },
      findMany: async ({ where, take = 25, skip = 0 } = {}) => {
        const rows = [...tables.contentItem.values()].filter((r) => matchesWhere(r, where));
        return rows.slice(skip, skip + take).map((r) => ({ ...r }));
      },
      count: async ({ where } = {}) => [...tables.contentItem.values()].filter((r) => matchesWhere(r, where)).length,
      findUnique: async ({ where }) => tables.contentItem.get(where.id) ?? null,
      update: async ({ where, data }) => {
        const existing = tables.contentItem.get(where.id);
        const updated = { ...existing, ...data };
        tables.contentItem.set(where.id, updated);
        return { ...updated };
      },
      delete: async ({ where }) => {
        tables.contentItem.delete(where.id);
        return {};
      },
    },
    systemSetting: {
      findMany: async () => [...tables.systemSetting.values()],
      findUnique: async ({ where }) => tables.systemSetting.get(where.key) ?? null,
      upsert: async ({ where, create, update }) => {
        const existing = tables.systemSetting.get(where.key);
        const saved = existing ? { ...existing, ...update } : { ...create, updatedAt: new Date() };
        tables.systemSetting.set(where.key, saved);
        return saved;
      },
    },
  };
}

test('Prisma business repositories persist data across service/repository re-instantiation (simulated server restart)', async () => {
  const prisma = createStatefulPrismaMock();
  const allowAll = {
    hasPermission: async () => true,
    requirePermission: async () => {},
  };

  // --- Phase 1: Write data using initial repository & service instances ---
  {
    const bookingService = createBookingService({
      repository: createPrismaBookingRepository(prisma),
      authorizationService: allowAll,
    });
    const customerService = createCustomerService({
      repository: createPrismaCustomerRepository(prisma),
      authorizationService: allowAll,
    });
    const pricingService = createPricingService({
      repository: createPrismaPricingRepository(prisma),
      authorizationService: allowAll,
    });
    const financeService = createFinanceService({
      repository: createPrismaFinanceRepository(prisma),
      authorizationService: allowAll,
    });
    const inboxRepo = createPrismaInboxRepository(prisma);
    const inboxService = createInboxService({
      repository: inboxRepo,
      authorizationService: allowAll,
    });
    const contentService = createContentService({
      repository: createPrismaContentRepository(prisma),
      authorizationService: allowAll,
    });
    const settingsService = createSettingsService({
      repository: createPrismaSettingsRepository(prisma),
      authorizationService: allowAll,
    });

    const bk = await bookingService.createPublicBookingRequest({
      customerName: 'Dewi Sartika',
      whatsappPhone: '+6281234567899',
      categoryId: 'cat-1',
      modelId: 'mod-1',
      rentalType: 'with_driver',
      startsOn: '2030-05-01',
      endsOn: '2030-05-03',
      pickupLocation: 'Bandara YIA',
    });
    assert.match(bk.bookingCode, /^BK-[A-Z0-9]{3}-[A-Z0-9]{3}$/);

    // Duplicate check works via Prisma repository
    await assert.rejects(
      bookingService.createPublicBookingRequest({
        customerName: 'Dewi Sartika',
        whatsappPhone: '+6281234567899',
        categoryId: 'cat-1',
        modelId: 'mod-1',
        rentalType: 'with_driver',
        startsOn: '2030-05-01',
        endsOn: '2030-05-03',
        pickupLocation: 'Bandara YIA',
      }),
      { code: 'DUPLICATE_BOOKING_REQUEST' },
    );

    await customerService.createCustomer({ userId: 'u-1', input: { name: 'PT Maju Jaya', phone: '+628111222333', email: 'info@majujaya.id' } });
    await pricingService.createPricing({ userId: 'u-1', input: { modelId: 'mod-1', rentalType: 'with_driver', baseRate: 950000 } });
    await financeService.createTransaction({ userId: 'u-1', input: { type: 'income', amount: 950000, category: 'booking' } });
    await financeService.createTransaction({ userId: 'u-1', input: { type: 'expense', amount: 150000, category: 'fuel' } });
    await inboxRepo.createMessage({ id: 'msg-100', senderName: 'Andi', senderEmail: 'andi@mail.com', subject: 'Sewa Bus', content: 'Mohon info' });
    await inboxService.updateMessageStatus({ userId: 'u-1', id: 'msg-100', status: 'read' });
    await inboxService.addInternalNote({ userId: 'u-1', id: 'msg-100', note: 'Sudah ditindaklanjuti' });
    await contentService.createContent({ userId: 'u-1', input: { title: 'Syarat Sewa', slug: 'syarat-sewa', section: 'legal', status: 'published' } });
    await settingsService.updateSetting({ userId: 'u-1', key: 'companyName', value: 'PT Anantalia Trans Nusantara' });
  }

  // --- Phase 2: Simulate server restart by creating brand-new repository & service instances over the same database ---
  {
    const bookingService = createBookingService({
      repository: createPrismaBookingRepository(prisma),
      authorizationService: allowAll,
    });
    const customerService = createCustomerService({
      repository: createPrismaCustomerRepository(prisma),
      authorizationService: allowAll,
    });
    const pricingService = createPricingService({
      repository: createPrismaPricingRepository(prisma),
      authorizationService: allowAll,
    });
    const financeService = createFinanceService({
      repository: createPrismaFinanceRepository(prisma),
      authorizationService: allowAll,
    });
    const inboxService = createInboxService({
      repository: createPrismaInboxRepository(prisma),
      authorizationService: allowAll,
    });
    const contentService = createContentService({
      repository: createPrismaContentRepository(prisma),
      authorizationService: allowAll,
    });
    const settingsService = createSettingsService({
      repository: createPrismaSettingsRepository(prisma),
      authorizationService: allowAll,
    });
    const analyticsService = createAnalyticsService({
      repository: createPrismaAnalyticsRepository(prisma),
      authorizationService: allowAll,
    });
    const dashboardService = createDashboardService({
      repository: createPrismaDashboardRepository(prisma),
      authorizationService: allowAll,
    });

    const bookings = await bookingService.listBookings({ userId: 'u-1', query: { q: 'Dewi' } });
    assert.equal(bookings.items.length, 1);
    assert.equal(typeof bookings.items[0].createdAt, 'string');

    // Confirm booking and verify analytics + dashboard reflect persistent booking counts
    await bookingService.updateBookingStatus({ userId: 'u-1', id: bookings.items[0].id, newStatus: 'under_verification' });
    await bookingService.updateBookingStatus({ userId: 'u-1', id: bookings.items[0].id, newStatus: 'confirmed' });

    const customers = await customerService.listCustomers({ userId: 'u-1', query: { q: 'Maju' } });
    assert.equal(customers.items.length, 1);
    // Soft delete customer
    await customerService.deleteCustomer({ userId: 'u-1', id: customers.items[0].id });
    assert.equal((await customerService.listCustomers({ userId: 'u-1' })).items.length, 0);

    const pricing = await pricingService.listPricing({ userId: 'u-1', query: { modelId: 'mod-1' } });
    assert.equal(pricing.items.length, 1);
    assert.equal(pricing.items[0].baseRate, 950000);

    const financeSummary = await financeService.getFinanceSummary({ userId: 'u-1' });
    assert.equal(financeSummary.totalRevenue, 950000);
    assert.equal(financeSummary.totalExpenses, 150000);
    assert.equal(financeSummary.netProfit, 800000);
    assert.equal(financeSummary.transactionCount, 2);

    const msg = await inboxService.getMessageById({ userId: 'u-1', id: 'msg-100' });
    assert.equal(msg.item.status, 'read');
    assert.equal(msg.item.notes.length, 1);
    assert.equal(msg.item.notes[0].note, 'Sudah ditindaklanjuti');

    const content = await contentService.listContent({ userId: 'u-1', query: { section: 'legal' } });
    assert.equal(content.items.length, 1);
    assert.equal(content.items[0].slug, 'syarat-sewa');

    const settings = await settingsService.getAllSettings({ userId: 'u-1' });
    assert.equal(settings.settings.companyName, 'PT Anantalia Trans Nusantara');

    const analytics = await analyticsService.getOverview({ userId: 'u-1', range: '30d' });
    assert.equal(analytics.metrics.totalBookings, 1);
    assert.equal(analytics.metrics.confirmedBookings, 1);
    assert.equal(analytics.metrics.averageDurationDays, 3);

    const dash = await dashboardService.getSummary({ actor: 'u-1' });
    assert.equal(dash.summary.bookings.total, 1);
    assert.equal(dash.summary.bookings.confirmed, 1);
    assert.equal(dash.summary.bookings.waitingConfirmation, 0);
  }
});
