import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import test from 'node:test';
import { createBookingService } from '../../src/booking/booking.service.js';
import { createAdminBookingRouter, createPublicBookingRouter } from '../../src/booking/booking.routes.js';
import { createInMemoryBookingRepository } from '../../src/booking/in-memory-booking.repository.js';

async function serve(check, { fleetService } = {}) {
  const repository = createInMemoryBookingRepository();
  const bookingService = createBookingService({
    repository,
    authorizationService: { hasPermission: async (userId) => userId === 'admin' },
    fleetService,
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.userId = req.headers['x-test-user']; next(); });
  app.use('/api/v1/public', createPublicBookingRouter({ bookingService }));
  app.use('/api/v1/admin', createAdminBookingRouter({ bookingService }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try { await check(`http://127.0.0.1:${server.address().port}`); }
  finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
}

const valid = {
  customerName: 'Budi', whatsappPhone: '+6281234567890', categoryId: 'c1', modelId: 'm1',
  rentalType: 'with_driver', startsOn: '2030-01-01', endsOn: '2030-01-02', pickupLocation: 'Bandara YIA',
};
const post = (base, body) => fetch(`${base}/api/v1/public/booking-requests`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('public booking creation returns 201 without WhatsApp link; invalid input, impossible calendar date, and duplicates are rejected', async () => {
  await serve(async (base) => {
    const ok = await post(base, valid);
    assert.equal(ok.status, 201);
    const body = await ok.json();
    assert.match(body.bookingCode, /^BK-[A-Z0-9]{3}-[A-Z0-9]{3}$/);
    assert.equal(body.status, 'waiting_confirmation');
    assert.equal(body.statusLabel, 'Menunggu Konfirmasi');
    assert.equal(body.whatsapp.available, false);
    assert.equal(body.whatsapp.url, null);

    // Duplicate pending request is rejected with 409 DUPLICATE_BOOKING_REQUEST
    const dup = await post(base, valid);
    assert.equal(dup.status, 409);
    const dupBody = await dup.json();
    assert.equal(dupBody.error.code, 'DUPLICATE_BOOKING_REQUEST');

    // Same-day rental (startsOn === endsOn) is allowed
    const sameDay = await post(base, { ...valid, startsOn: '2030-03-10', endsOn: '2030-03-10' });
    assert.equal(sameDay.status, 201);

    // Impossible calendar dates (e.g. Feb 30, Month 13) are rejected with 400
    assert.equal((await post(base, { ...valid, startsOn: '2030-02-30', endsOn: '2030-03-01' })).status, 400);
    assert.equal((await post(base, { ...valid, startsOn: '2030-13-01', endsOn: '2030-13-02' })).status, 400);

    // Missing categoryId / modelId / invalid phone / reverse dates / short pickupLocation
    assert.equal((await post(base, { ...valid, categoryId: '' })).status, 400);
    assert.equal((await post(base, { ...valid, modelId: '' })).status, 400);
    assert.equal((await post(base, { ...valid, whatsappPhone: '0812' })).status, 400);
    assert.equal((await post(base, { ...valid, startsOn: '2030-02-01', endsOn: '2030-01-02' })).status, 400);
    assert.equal((await post(base, { ...valid, pickupLocation: 'AB' })).status, 400);
  });
});

test('public booking verifies categoryId, modelId, and rentalType relation via fleetService when provided', async () => {
  const mockFleetService = {
    async findModelForPublicBooking({ modelId, categoryId, rentalType }) {
      if (modelId === 'm1' && categoryId === 'c1' && rentalType === 'with_driver') {
        return { id: 'm1', categoryId: 'c1', name: 'Hiace Premio' };
      }
      return null;
    },
  };
  await serve(async (base) => {
    assert.equal((await post(base, valid)).status, 201);
    const mismatch = await post(base, { ...valid, rentalType: 'self_drive' });
    assert.equal(mismatch.status, 422);
    const mismatchBody = await mismatch.json();
    assert.equal(mismatchBody.error.code, 'SELECTION_UNAVAILABLE');
  }, { fleetService: mockFleetService });
});

test('admin booking routes enforce permission, detail lookup, and state transitions', async () => {
  await serve(async (base) => {
    await post(base, valid);
    assert.equal((await fetch(`${base}/api/v1/admin/bookings`, { headers: { 'x-test-user': 'staff' } })).status, 403);
    const list = await (await fetch(`${base}/api/v1/admin/bookings`, { headers: { 'x-test-user': 'admin' } })).json();
    assert.equal(list.items.length, 1);
    const id = list.items[0].id;

    // Detail lookup
    const detailRes = await fetch(`${base}/api/v1/admin/bookings/${id}`, { headers: { 'x-test-user': 'admin' } });
    assert.equal(detailRes.status, 200);
    const detail = await detailRes.json();
    assert.equal(detail.item.id, id);
    assert.equal((await fetch(`${base}/api/v1/admin/bookings/non-existent`, { headers: { 'x-test-user': 'admin' } })).status, 404);

    // Status transitions
    const patch = (status) => fetch(`${base}/api/v1/admin/bookings/${id}/status`, { method: 'PATCH', headers: { 'content-type': 'application/json', 'x-test-user': 'admin' }, body: JSON.stringify({ status }) });
    assert.equal((await patch('completed')).status, 409);
    assert.equal((await patch('under_verification')).status, 200);
    assert.equal((await patch('bogus')).status, 400);
  });
});

test('schedule overlap conflict with confirmed booking is rejected on create, confirm, and edit; cancelled bookings do not block', async () => {
  await serve(async (base) => {
    await post(base, valid);
    const list1 = await (await fetch(`${base}/api/v1/admin/bookings`, { headers: { 'x-test-user': 'admin' } })).json();
    const firstId = list1.items[0].id;

    // Pending request for overlapping dates is allowed while first is unconfirmed
    const pendingOverlap = await post(base, {
      ...valid,
      customerName: 'Andi',
      whatsappPhone: '+6281555666777',
      startsOn: '2030-01-02',
      endsOn: '2030-01-03',
    });
    assert.equal(pendingOverlap.status, 201);

    // Confirm first booking (waiting_confirmation -> under_verification -> confirmed)
    const patchStatus = (id, status) =>
      fetch(`${base}/api/v1/admin/bookings/${id}/status`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-test-user': 'admin' },
        body: JSON.stringify({ status }),
      });
    assert.equal((await patchStatus(firstId, 'under_verification')).status, 200);
    assert.equal((await patchStatus(firstId, 'confirmed')).status, 200);

    // Confirming Andi's overlapping booking is now rejected with 409 BOOKING_SCHEDULE_CONFLICT
    const list2 = await (await fetch(`${base}/api/v1/admin/bookings`, { headers: { 'x-test-user': 'admin' } })).json();
    const andiBooking = list2.items.find((b) => b.customerName === 'Andi');
    assert.equal((await patchStatus(andiBooking.id, 'under_verification')).status, 200);
    const confirmOverlap = await patchStatus(andiBooking.id, 'confirmed');
    assert.equal(confirmOverlap.status, 409);
    assert.equal((await confirmOverlap.json()).error.code, 'BOOKING_SCHEDULE_CONFLICT');

    // New booking request overlapping confirmed booking -> 409 BOOKING_SCHEDULE_CONFLICT
    const overlap = await post(base, {
      ...valid,
      customerName: 'Siti',
      whatsappPhone: '+6281999888777',
      startsOn: '2030-01-02',
      endsOn: '2030-01-04',
    });
    assert.equal(overlap.status, 409);
    assert.equal((await overlap.json()).error.code, 'BOOKING_SCHEDULE_CONFLICT');

    // Different non-overlapping dates -> 201
    const second = await post(base, {
      ...valid,
      customerName: 'Siti',
      whatsappPhone: '+6281999888777',
      startsOn: '2030-01-05',
      endsOn: '2030-01-06',
    });
    assert.equal(second.status, 201);

    const list3 = await (await fetch(`${base}/api/v1/admin/bookings`, { headers: { 'x-test-user': 'admin' } })).json();
    const sitiBooking = list3.items.find((b) => b.customerName === 'Siti');

    // Admin updating sitiBooking into confirmed firstBooking's dates -> 409
    const badEdit = await fetch(`${base}/api/v1/admin/bookings/${sitiBooking.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-test-user': 'admin' },
      body: JSON.stringify({ startsOn: '2030-01-01', endsOn: '2030-01-03' }),
    });
    assert.equal(badEdit.status, 409);

    // Admin updating sitiBooking to non-overlapping dates -> 200
    const goodEdit = await fetch(`${base}/api/v1/admin/bookings/${sitiBooking.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-test-user': 'admin' },
      body: JSON.stringify({ startsOn: '2030-01-07', endsOn: '2030-01-08', pickupLocation: 'Stasiun Tugu' }),
    });
    assert.equal(goodEdit.status, 200);
    assert.equal((await goodEdit.json()).item.pickupLocation, 'Stasiun Tugu');

    // Cancelling firstBooking frees its dates
    assert.equal((await patchStatus(firstId, 'cancelled')).status, 200);
    const rebookFreedDates = await post(base, {
      ...valid,
      customerName: 'Dewi',
      whatsappPhone: '+6281555666888',
    });
    assert.equal(rebookFreedDates.status, 201);
  });
});
