import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createTestPrismaClient } from './setup/database-setup.js';
import { createPrismaBookingRepository } from '../../src/booking/prisma-booking.repository.js';
import { createPrismaCustomerRepository } from '../../src/customer/prisma-customer.repository.js';
import { createPrismaPricingRepository } from '../../src/pricing/prisma-pricing.repository.js';
import { createPrismaFinanceRepository } from '../../src/finance/prisma-finance.repository.js';
import { createPrismaInboxRepository } from '../../src/inbox/prisma-inbox.repository.js';
import { createPrismaContentRepository } from '../../src/content/prisma-content.repository.js';
import { createPrismaSettingsRepository } from '../../src/settings/prisma-settings.repository.js';
import { createPrismaAnalyticsRepository } from '../../src/analytics/prisma-analytics.repository.js';

test('PostgreSQL business repositories persist records across client re-instantiation on authorized test DB', async () => {
  const prisma1 = await createTestPrismaClient();
  const runId = randomUUID().slice(0, 8);
  const bookingId = randomUUID();
  const customerId = randomUUID();
  const pricingId = randomUUID();
  const financeId = randomUUID();
  const messageId = randomUUID();
  const contentId = randomUUID();

  try {
    const bookingRepo1 = createPrismaBookingRepository(prisma1);
    const customerRepo1 = createPrismaCustomerRepository(prisma1);
    const pricingRepo1 = createPrismaPricingRepository(prisma1);
    const financeRepo1 = createPrismaFinanceRepository(prisma1);
    const inboxRepo1 = createPrismaInboxRepository(prisma1);
    const contentRepo1 = createPrismaContentRepository(prisma1);
    const settingsRepo1 = createPrismaSettingsRepository(prisma1);

    await bookingRepo1.saveBooking({
      id: bookingId,
      bookingCode: `BK-${runId.slice(0, 3).toUpperCase()}-${runId.slice(3, 6).toUpperCase()}`,
      customerName: `Integration User ${runId}`,
      whatsappPhone: '+6281234567890',
      categoryId: 'cat-int',
      modelId: 'mod-int',
      rentalType: 'with_driver',
      startsOn: '2030-06-01',
      endsOn: '2030-06-02',
      pickupLocation: 'Stasiun Tugu Yogyakarta',
      additionalNotes: null,
      status: 'waiting_confirmation',
      statusLabel: 'Menunggu Konfirmasi',
    });

    await customerRepo1.createCustomer({
      id: customerId,
      name: `Customer ${runId}`,
      phone: '+6281234567890',
      email: `cust-${runId}@example.invalid`,
      notes: 'Integration test record',
      isActive: true,
    });

    await pricingRepo1.createPricing({
      id: pricingId,
      modelId: `mod-${runId}`,
      rentalType: 'with_driver',
      baseRate: 750000,
      currency: 'IDR',
      billingUnit: 'day',
      notes: null,
      isActive: true,
    });

    await financeRepo1.createTransaction({
      id: financeId,
      type: 'income',
      amount: 750000,
      category: `test-${runId}`,
      description: 'Integration test transaction',
      bookingId,
      date: '2030-06-01',
      status: 'recorded',
    });

    await inboxRepo1.createMessage({
      id: messageId,
      senderName: `Sender ${runId}`,
      senderEmail: `sender-${runId}@example.invalid`,
      subject: 'Integration test',
      content: 'Message body',
      status: 'unread',
    });
    await inboxRepo1.addNote({ messageId, note: 'Internal note', authorId: 'admin' });

    await contentRepo1.createContent({
      id: contentId,
      title: `Content ${runId}`,
      slug: `slug-${runId}`,
      contentKey: `key-${runId}`,
      body: 'Body text',
      section: 'general',
      status: 'published',
    });

    await settingsRepo1.set('companyName', `Anantalia ${runId}`);
  } finally {
    await prisma1.$disconnect();
  }

  // Reconnect with a fresh Prisma client instance to verify persistence across restarts
  const prisma2 = await createTestPrismaClient();
  try {
    const bookingRepo2 = createPrismaBookingRepository(prisma2);
    const customerRepo2 = createPrismaCustomerRepository(prisma2);
    const pricingRepo2 = createPrismaPricingRepository(prisma2);
    const financeRepo2 = createPrismaFinanceRepository(prisma2);
    const inboxRepo2 = createPrismaInboxRepository(prisma2);
    const contentRepo2 = createPrismaContentRepository(prisma2);
    const settingsRepo2 = createPrismaSettingsRepository(prisma2);
    const analyticsRepo2 = createPrismaAnalyticsRepository(prisma2);

    const savedBooking = await bookingRepo2.getBookingById(bookingId);
    assert.equal(savedBooking?.customerName, `Integration User ${runId}`);

    const savedCustomer = await customerRepo2.getCustomerById(customerId);
    assert.equal(savedCustomer?.name, `Customer ${runId}`);

    const savedPricing = await pricingRepo2.getPricingById(pricingId);
    assert.equal(savedPricing?.baseRate, 750000);

    const savedFinance = await financeRepo2.getTransactionById(financeId);
    assert.equal(savedFinance?.amount, 750000);

    const savedMessage = await inboxRepo2.getMessageById(messageId);
    assert.equal(savedMessage?.notes?.length, 1);

    const savedContent = await contentRepo2.getContentById(contentId);
    assert.equal(savedContent?.slug, `slug-${runId}`);

    const savedSetting = await settingsRepo2.get('companyName');
    assert.equal(savedSetting, `Anantalia ${runId}`);

    const overview = await analyticsRepo2.getOverview({ range: '30d' });
    assert.equal(overview.metrics.totalBookings >= 1, true);
  } finally {
    // Clean up only the single records created by this test run
    await prisma2.inboxMessage.deleteMany({ where: { id: messageId } }).catch(() => {});
    await prisma2.contentItem.deleteMany({ where: { id: contentId } }).catch(() => {});
    await prisma2.pricingRule.deleteMany({ where: { id: pricingId } }).catch(() => {});
    await prisma2.financeTransaction.deleteMany({ where: { id: financeId } }).catch(() => {});
    await prisma2.customer.deleteMany({ where: { id: customerId } }).catch(() => {});
    await prisma2.booking.deleteMany({ where: { id: bookingId } }).catch(() => {});
    await prisma2.$disconnect();
  }
});
