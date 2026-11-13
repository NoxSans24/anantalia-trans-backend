import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createTestPrismaClient } from './setup/database-setup.js';
import { createPrismaFleetRepository } from '../../src/fleet/prisma-fleet.repository.js';
import { createFleetService } from '../../src/fleet/fleet.service.js';
import { createPrismaBookingRepository } from '../../src/booking/prisma-booking.repository.js';
import { createBookingService } from '../../src/booking/booking.service.js';
import { createPrismaPricingRepository } from '../../src/pricing/prisma-pricing.repository.js';
import { createPricingService } from '../../src/pricing/pricing.service.js';
import { createPrismaFinanceRepository } from '../../src/finance/prisma-finance.repository.js';
import { createFinanceService } from '../../src/finance/finance.service.js';
import { createPrismaSettingsRepository } from '../../src/settings/prisma-settings.repository.js';

const ALLOW_ALL_AUTH = Object.freeze({
  hasPermission: async () => true,
  requirePermission: async () => true,
});
const NOOP_ACTIVITY = Object.freeze({ log: async () => {} });

test('real PostgreSQL validates booking/unit concurrency locks, maintenance guards, optimistic locking, immutable snapshots, and finance ledger', async () => {
  const prisma1 = await createTestPrismaClient();
  const prisma2 = await createTestPrismaClient();
  const suffix = randomUUID().slice(0, 8);
  const actorId = randomUUID();
  let categoryId = null;
  let modelId = null;
  let unitAId = null;
  let unitBId = null;
  let unitNoHistoryId = null;
  let pricingId = null;
  const bookingIds = [];
  const financeIds = [];

  try {
    await prisma1.user.create({
      data: {
        id: actorId,
        email: `t7-actor-${suffix}@example.invalid`,
        username: `t7_actor_${suffix}`,
        status: 'ACTIVE',
      },
    });
    const settingsRepository = createPrismaSettingsRepository(prisma1);
    const fleetService = createFleetService({
      repository: createPrismaFleetRepository(prisma1),
      authorizationService: ALLOW_ALL_AUTH,
      activityLog: NOOP_ACTIVITY,
      settingsRepository,
    });
    const pricingRepo = createPrismaPricingRepository(prisma1);
    const pricingService = createPricingService({
      repository: pricingRepo,
      authorizationService: ALLOW_ALL_AUTH,
      activityLog: NOOP_ACTIVITY,
      settingsRepository,
    });
    const bookingService1 = createBookingService({
      repository: createPrismaBookingRepository(prisma1),
      authorizationService: ALLOW_ALL_AUTH,
      activityLog: NOOP_ACTIVITY,
      fleetService,
      pricingRepository: pricingRepo,
      settingsRepository,
    });
    const bookingService2 = createBookingService({
      repository: createPrismaBookingRepository(prisma2),
      authorizationService: ALLOW_ALL_AUTH,
      activityLog: NOOP_ACTIVITY,
      fleetService: createFleetService({
        repository: createPrismaFleetRepository(prisma2),
        authorizationService: ALLOW_ALL_AUTH,
        activityLog: NOOP_ACTIVITY,
        settingsRepository: createPrismaSettingsRepository(prisma2),
      }),
      pricingRepository: createPrismaPricingRepository(prisma2),
      settingsRepository: createPrismaSettingsRepository(prisma2),
    });
    const financeService = createFinanceService({
      repository: createPrismaFinanceRepository(prisma1),
      authorizationService: ALLOW_ALL_AUTH,
      activityLog: NOOP_ACTIVITY,
    });

    const cat = await fleetService.createCategory({
      actor: actorId,
      input: { slug: `t7-cat-${suffix}`, name: `T7 Category ${suffix}` },
    });
    categoryId = cat.id;

    const model = await fleetService.createModel({
      actor: actorId,
      input: { categoryId, slug: `t7-model-${suffix}`, name: `T7 MPV ${suffix}`, seatCount: 7 },
    });
    modelId = model.id;
    await fleetService.updateModel({ actor: actorId, id: modelId, input: { isVerified: true } });
    await fleetService.setRentalOption({ actor: actorId, modelId, rentalType: 'with_driver', isEnabled: true });

    const pricing = await pricingService.createPricing({
      userId: actorId,
      input: { modelId, rentalType: 'with_driver', billingUnit: 'day', baseRate: 900000, currency: 'IDR' },
    });
    pricingId = pricing.item.id;

    const unitA = await fleetService.createVehicleUnit({
      actor: actorId,
      input: { modelId, plateNumber: `B 91${suffix.slice(0, 2).toUpperCase()} T7A`, year: 2025, status: 'available' },
    });
    unitAId = unitA.id;
    const unitB = await fleetService.createVehicleUnit({
      actor: actorId,
      input: { modelId, plateNumber: `B 92${suffix.slice(0, 2).toUpperCase()} T7B`, year: 2025, status: 'available' },
    });
    unitBId = unitB.id;
    const unitNoHistory = await fleetService.createVehicleUnit({
      actor: actorId,
      input: { modelId, plateNumber: `B 93${suffix.slice(0, 2).toUpperCase()} T7C`, year: 2024, status: 'available' },
    });
    unitNoHistoryId = unitNoHistory.id;

    // Optimistic locking check on VehicleUnit
    const updatedUnit = await fleetService.updateVehicleUnit({
      actor: actorId,
      id: unitAId,
      input: { notes: 'v2 update', version: unitA.version },
    });
    assert.equal(updatedUnit.version, unitA.version + 1);
    await assert.rejects(
      fleetService.updateVehicleUnit({
        actor: actorId,
        id: unitAId,
        input: { notes: 'stale write', version: unitA.version },
      }),
      (err) => (err?.status ?? err?.code) === 'CONCURRENCY_CONFLICT',
    );

    const booking1 = await bookingService1.createPublicBookingRequest({
      customerName: 'T7 Guest One',
      whatsappPhone: '+6281234567001',
      rentalType: 'with_driver',
      categoryId,
      modelId,
      pickupLocation: 'Jakarta Selatan',
      startsOn: '2026-12-20',
      endsOn: '2026-12-22',
    });
    const booking1Row = await prisma1.booking.findUnique({ where: { bookingCode: booking1.bookingCode } });
    assert.ok(booking1Row?.id);
    bookingIds.push(booking1Row.id);

    const booking2 = await bookingService1.createPublicBookingRequest({
      customerName: 'T7 Guest Two',
      whatsappPhone: '+6281234567002',
      rentalType: 'with_driver',
      categoryId,
      modelId,
      pickupLocation: 'Jakarta Pusat',
      startsOn: '2026-12-21',
      endsOn: '2026-12-23',
    });
    const booking2Row = await prisma1.booking.findUnique({ where: { bookingCode: booking2.bookingCode } });
    assert.ok(booking2Row?.id);
    bookingIds.push(booking2Row.id);

    const availBefore = await bookingService1.listAvailableUnitsForBooking({ userId: actorId, bookingId: booking1Row.id });
    assert.equal(availBefore.bookingId, booking1Row.id);
    assert.equal(availBefore.items.find((u) => u.id === unitAId)?.available, true);
    assert.equal(availBefore.items.find((u) => u.id === unitBId)?.available, true);

    // Concurrent double-assignment of unitA across two separate Prisma clients/pools
    const results = await Promise.allSettled([
      bookingService1.assignUnitToBooking({ userId: actorId, bookingId: booking1Row.id, unitId: unitAId }),
      bookingService2.assignUnitToBooking({ userId: actorId, bookingId: booking2Row.id, unitId: unitAId }),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    assert.equal(fulfilled.length, 1, 'Strictly one concurrent unit assignment may succeed');
    assert.equal(rejected.length, 1, 'Competing concurrent unit assignment must fail');
    assert.equal(rejected[0].reason?.code, 'UNIT_SCHEDULE_CONFLICT');
    assert.equal(rejected[0].reason?.status, 409);

    const winningBookingId = fulfilled[0].value.assignment.bookingId;
    const losingBookingId = winningBookingId === booking1Row.id ? booking2Row.id : booking1Row.id;
    // Reassign winning booking from unitA -> unitB, verify replaced history retained
    await bookingService1.assignUnitToBooking({ userId: actorId, bookingId: winningBookingId, unitId: unitBId, notes: 'Unit replacement' });
    const historyRows = await prisma1.bookingUnitAssignment.findMany({
      where: { bookingId: winningBookingId },
      orderBy: { assignedAt: 'asc' },
    });
    assert.equal(historyRows.length, 2);
    assert.equal(historyRows[0].status, 'replaced');
    assert.ok(historyRows[0].releasedAt instanceof Date);
    assert.equal(historyRows[1].status, 'assigned');
    assert.equal(historyRows[1].unitId, unitBId);

    const availConflict = await bookingService1.listAvailableUnitsForBooking({ userId: actorId, bookingId: losingBookingId });
    const blockedUnitB = availConflict.items.find((u) => u.id === unitBId);
    assert.equal(blockedUnitB?.available, false);
    assert.ok(blockedUnitB?.conflictReason?.includes('Bentrok'));
    assert.equal(availConflict.items.find((u) => u.id === unitAId)?.available, true);

    // Confirm winning booking locks immutable priceSnapshot even if PricingRule changes later
    await bookingService1.updateBookingStatus({ userId: actorId, id: winningBookingId, newStatus: 'under_verification' });
    const confirmed = await bookingService1.updateBookingStatus({ userId: actorId, id: winningBookingId, newStatus: 'confirmed' });
    const snapshotBefore = confirmed.priceSnapshot;
    assert.equal(snapshotBefore.agreedRate, 900000);
    assert.equal(snapshotBefore.days, 3);
    assert.equal(snapshotBefore.totalAmount, 2700000);
    assert.equal(snapshotBefore.locked, true);

    await pricingService.updatePricing({ userId: actorId, id: pricingId, input: { baseRate: 1500000 } });
    const fetchedAfterRateChange = await bookingService1.getBookingById({ userId: actorId, id: winningBookingId });
    assert.equal(fetchedAfterRateChange.item.priceSnapshot.agreedRate, 900000);
    assert.equal(fetchedAfterRateChange.item.priceSnapshot.totalAmount, 2700000);

    // Maintenance guard & status preservation when cancelling booking
    await fleetService.updateVehicleUnit({ actor: actorId, id: unitBId, input: { status: 'maintenance' } });
    await assert.rejects(
      bookingService1.assignUnitToBooking({
        userId: actorId,
        bookingId: losingBookingId,
        unitId: unitBId,
      }),
      (err) => err?.code === 'UNIT_UNAVAILABLE',
    );
    await bookingService1.updateBookingStatus({ userId: actorId, id: winningBookingId, newStatus: 'cancelled', reason: 'Test release' });
    const unitBAfterCancel = await prisma1.vehicleUnit.findUnique({ where: { id: unitBId } });
    assert.equal(unitBAfterCancel.status, 'maintenance', 'Releasing booking assignments must not overwrite maintenance status');

    // Deleting unit with history soft-deactivates instead of deleting rows; unit without history deletes cleanly
    const delWithHistory = await fleetService.deleteVehicleUnit({ actor: actorId, id: unitAId });
    assert.equal(delWithHistory.deleted, false);
    assert.equal(delWithHistory.deactivated, true);
    assert.equal(delWithHistory.item.status, 'inactive');

    const delClean = await fleetService.deleteVehicleUnit({ actor: actorId, id: unitNoHistoryId });
    assert.equal(delClean.deleted, true);
    unitNoHistoryId = null;

    // Finance persistence, summary, refund & void exclusion in PostgreSQL
    const finDate = '2026-12-21';
    const inc = await financeService.createTransaction({
      userId: actorId,
      input: { type: 'income', amount: 2700000, category: 'rental', bookingId: winningBookingId, date: finDate },
    });
    const exp = await financeService.createTransaction({
      userId: actorId,
      input: { type: 'expense', amount: 400000, category: 'fuel', date: finDate },
    });
    const ref = await financeService.createTransaction({
      userId: actorId,
      input: { type: 'refund', amount: 200000, category: 'refund', bookingId: winningBookingId, date: finDate },
    });
    financeIds.push(inc.item.id, exp.item.id, ref.item.id);

    const summaryBeforeVoid = await financeService.getFinanceSummary({
      userId: actorId,
      query: { fromDate: finDate, toDate: finDate },
    });
    assert.equal(summaryBeforeVoid.totalRevenue, 2700000);
    assert.equal(summaryBeforeVoid.totalExpenses, 400000);
    assert.equal(summaryBeforeVoid.totalRefunds, 200000);
    assert.equal(summaryBeforeVoid.netProfit, 2100000);

    await financeService.voidTransaction({ userId: actorId, id: exp.item.id, reason: 'Duplicate bill' });
    const summaryAfterVoid = await financeService.getFinanceSummary({
      userId: actorId,
      query: { fromDate: finDate, toDate: finDate },
    });
    assert.equal(summaryAfterVoid.totalExpenses, 0);
    assert.equal(summaryAfterVoid.netProfit, 2500000);
  } finally {
    if (financeIds.length) {
      await prisma1.financeTransaction.deleteMany({ where: { id: { in: financeIds } } }).catch(() => {});
    }
    if (bookingIds.length) {
      await prisma1.bookingUnitAssignment.deleteMany({ where: { bookingId: { in: bookingIds } } }).catch(() => {});
      await prisma1.systemSetting.deleteMany({
        where: { key: { in: bookingIds.map((bId) => `booking_snapshot:${bId}`) } },
      }).catch(() => {});
      await prisma1.booking.deleteMany({ where: { id: { in: bookingIds } } }).catch(() => {});
    }
    const leftoverUnits = [unitAId, unitBId, unitNoHistoryId].filter(Boolean);
    if (leftoverUnits.length) {
      await prisma1.vehicleMaintenance.deleteMany({ where: { unitId: { in: leftoverUnits } } }).catch(() => {});
      await prisma1.vehicleUnit.deleteMany({ where: { id: { in: leftoverUnits } } }).catch(() => {});
    }
    if (pricingId) {
      await prisma1.pricingRule.deleteMany({ where: { id: pricingId } }).catch(() => {});
    }
    if (modelId) {
      await prisma1.vehicleRentalOption.deleteMany({ where: { modelId } }).catch(() => {});
      await prisma1.vehicleModel.deleteMany({ where: { id: modelId } }).catch(() => {});
    }
    if (categoryId) {
      await prisma1.vehicleCategory.deleteMany({ where: { id: categoryId } }).catch(() => {});
    }
    await prisma1.user.deleteMany({ where: { id: actorId } }).catch(() => {});
    await prisma1.$disconnect().catch(() => {});
    await prisma2.$disconnect().catch(() => {});
  }
});
