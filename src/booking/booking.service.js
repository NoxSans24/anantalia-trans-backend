import { randomBytes, randomUUID } from 'node:crypto';

const ALLOWED_STATUSES = new Set([
  'waiting_confirmation',
  'under_verification',
  'confirmed',
  'rejected',
  'cancelled',
  'completed',
]);

const ALLOWED_TRANSITIONS = Object.freeze({
  waiting_confirmation: ['under_verification', 'cancelled'],
  under_verification: ['confirmed', 'rejected', 'cancelled'],
  confirmed: ['completed', 'cancelled'],
  rejected: [],
  cancelled: [],
  completed: [],
});

const STATUS_LABELS = Object.freeze({
  waiting_confirmation: 'Menunggu Konfirmasi',
  under_verification: 'Sedang Diverifikasi',
  confirmed: 'Dikonfirmasi',
  rejected: 'Ditolak',
  cancelled: 'Dibatalkan',
  completed: 'Selesai',
});

function generateBookingCode() {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = 'BK-';
  const bytes = randomBytes(6);
  for (let i = 0; i < 6; i++) {
    code += chars[bytes[i] % chars.length];
    if (i === 2) code += '-';
  }
  return code;
}

function isValidIsoCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [yearStr, monthStr, dayStr] = value.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const utc = new Date(Date.UTC(year, month - 1, day));
  return (
    utc.getUTCFullYear() === year &&
    utc.getUTCMonth() === month - 1 &&
    utc.getUTCDate() === day
  );
}

function calcRentalDays(startsOn, endsOn) {
  if (!startsOn || !endsOn) return 1;
  const s = Date.parse(`${String(startsOn).slice(0, 10)}T00:00:00Z`);
  const e = Date.parse(`${String(endsOn).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return 1;
  return Math.max(1, Math.round((e - s) / 86400000) + 1);
}

export function createBookingService({ repository, authorizationService, activityLog, fleetService, pricingRepository, settingsRepository } = {}) {
  const localSnapshotStore = new Map();

  function parseSettingJson(raw) {
    if (!raw) return null;
    if (typeof raw === 'object') return raw;
    if (typeof raw === 'string') {
      try { return JSON.parse(raw); } catch { return null; }
    }
    return null;
  }

  async function loadSnapshot(bookingId) {
    if (!bookingId) return null;
    if (settingsRepository?.get) {
      const stored = parseSettingJson(await settingsRepository.get(`booking_snapshot:${bookingId}`).catch(() => null));
      if (stored && typeof stored === 'object') return stored;
    }
    return localSnapshotStore.get(bookingId) ?? null;
  }

  async function saveSnapshot(bookingId, snapshot) {
    if (!bookingId || !snapshot) return null;
    localSnapshotStore.set(bookingId, snapshot);
    if (settingsRepository?.set) {
      await settingsRepository.set(`booking_snapshot:${bookingId}`, JSON.stringify(snapshot)).catch(() => {});
    }
    return snapshot;
  }

  async function loadPricingMeta(ruleId) {
    if (!ruleId || !settingsRepository?.get) return null;
    const meta = parseSettingJson(await settingsRepository.get(`pricing_meta:${ruleId}`).catch(() => null));
    return meta && typeof meta === 'object' ? meta : null;
  }

  function isRuleValidForDate(meta, targetDate) {
    if (!meta) return true;
    const ref = typeof targetDate === 'string' && targetDate.length >= 10
      ? targetDate.slice(0, 10)
      : new Date().toISOString().slice(0, 10);
    if (meta.validFrom && ref < meta.validFrom) return false;
    if (meta.validUntil && ref > meta.validUntil) return false;
    return true;
  }

  async function buildPriceSnapshot({ modelId, modelSlug = null, rentalType, startsOn, endsOn, existingSnapshot, lock = false }) {
    if (existingSnapshot?.locked) {
      return existingSnapshot;
    }
    if (!pricingRepository?.listPricing) {
      return existingSnapshot ? { ...existingSnapshot, locked: Boolean(lock || existingSnapshot.locked) } : null;
    }

    const res = await pricingRepository.listPricing({ status: 'active', limit: 200 }).catch(() => ({ items: [] }));
    const rules = Array.isArray(res?.items) ? res.items : [];
    const validRules = [];
    for (const rule of rules) {
      const meta = await loadPricingMeta(rule.id);
      if (isRuleValidForDate(meta, startsOn)) {
        validRules.push({ ...rule, meta });
      }
    }

    const unitPriority = { day: 0, trip: 1, hour: 2 };
    validRules.sort((a, b) => (unitPriority[a.billingUnit] ?? 9) - (unitPriority[b.billingUnit] ?? 9));

    const matchesModel = (ruleModelId) =>
      ruleModelId === modelId || (modelSlug && ruleModelId === modelSlug);

    const matched =
      validRules.find((r) => matchesModel(r.modelId) && r.rentalType === rentalType) ||
      validRules.find((r) => matchesModel(r.modelId)) ||
      validRules.find((r) => !r.modelId && r.rentalType === rentalType);

    if (!matched) {
      return existingSnapshot ? { ...existingSnapshot, locked: Boolean(lock || existingSnapshot.locked) } : null;
    }

    const days = calcRentalDays(startsOn, endsOn);
    const originalRate = Number(matched.baseRate ?? 0);
    const discountPercent = Number(matched.meta?.discountPercent ?? 0);
    const effectiveRate = discountPercent > 0 && discountPercent <= 95
      ? Math.round(originalRate * (1 - discountPercent / 100))
      : originalRate;
    const billingUnit = matched.billingUnit || 'day';
    const totalAmount = effectiveRate > 0 ? (billingUnit === 'trip' ? effectiveRate : effectiveRate * days) : 0;

    return {
      pricingRuleId: matched.id,
      agreedRate: effectiveRate,
      originalRate,
      discountPercent,
      billingUnit,
      currency: matched.currency || 'IDR',
      days,
      totalAmount,
      capturedAt: existingSnapshot?.capturedAt || new Date().toISOString(),
      locked: Boolean(lock),
      ...(lock ? { lockedAt: new Date().toISOString() } : {}),
    };
  }

  return {
    async createPublicBookingRequest(input) {
      const {
        customerName,
        whatsappPhone,
        categoryId,
        modelId,
        rentalType,
        startsOn,
        endsOn,
        pickupLocation,
        additionalNotes = null,
      } = input ?? {};

      if (!customerName || typeof customerName !== 'string' || customerName.trim().length === 0 || customerName.length > 150) {
        const error = new Error('Invalid customer name (1-150 chars required)');
        error.code = 'INVALID_INPUT';
        error.status = 400;
        throw error;
      }

      const phoneRegex = /^\+[1-9]\d{6,14}$/;
      const cleanedPhone = typeof whatsappPhone === 'string' ? whatsappPhone.trim() : '';
      if (!phoneRegex.test(cleanedPhone)) {
        const error = new Error('Invalid phone number format (E.164 required, e.g. +628123456789)');
        error.code = 'INVALID_INPUT';
        error.status = 400;
        throw error;
      }

      if (!['self_drive', 'with_driver'].includes(rentalType)) {
        const error = new Error('Invalid rental type (self_drive or with_driver)');
        error.code = 'INVALID_INPUT';
        error.status = 400;
        throw error;
      }

      if (typeof categoryId !== 'string' || categoryId.trim().length === 0 || typeof modelId !== 'string' || modelId.trim().length === 0) {
        const error = new Error('Category ID and Model ID are required');
        error.code = 'INVALID_INPUT';
        error.status = 400;
        throw error;
      }

      if (!isValidIsoCalendarDate(startsOn) || !isValidIsoCalendarDate(endsOn) || startsOn > endsOn) {
        const error = new Error('Invalid dates (valid YYYY-MM-DD calendar date required and startsOn <= endsOn)');
        error.code = 'INVALID_INPUT';
        error.status = 400;
        throw error;
      }

      if (!pickupLocation || typeof pickupLocation !== 'string' || pickupLocation.trim().length < 3 || pickupLocation.length > 500) {
        const error = new Error('Invalid pickup location (3-500 chars required)');
        error.code = 'INVALID_INPUT';
        error.status = 400;
        throw error;
      }

      const cleanedCategoryId = categoryId.trim();
      const cleanedModelId = modelId.trim();

      // If fleetService is available, verify that category and model exist and match
      let resolvedModelSlug = null;
      if (fleetService?.findModelForPublicBooking) {
        const validModel = await fleetService.findModelForPublicBooking({
          modelId: cleanedModelId,
          categoryId: cleanedCategoryId,
          rentalType,
        });
        if (!validModel) {
          const error = new Error('Selected vehicle model is not available for this rental type');
          error.code = 'SELECTION_UNAVAILABLE';
          error.status = 422;
          throw error;
        }
        resolvedModelSlug = validModel.slug ?? null;
      }

      if (repository?.findDuplicatePendingRequest) {
        const existingDuplicate = await repository.findDuplicatePendingRequest({
          customerName: customerName.trim(),
          whatsappPhone: cleanedPhone,
          categoryId: cleanedCategoryId,
          modelId: cleanedModelId,
          rentalType,
          startsOn,
          endsOn,
          pickupLocation: pickupLocation.trim(),
        });
        if (existingDuplicate) {
          const error = new Error('Duplicate pending booking request already exists');
          error.code = 'DUPLICATE_BOOKING_REQUEST';
          error.status = 409;
          throw error;
        }
      }

      if (repository?.findOverlappingBooking) {
        const conflict = await repository.findOverlappingBooking({
          modelId: cleanedModelId,
          startsOn,
          endsOn,
        });
        if (conflict) {
          const error = new Error(`Jadwal armada bentrok dengan pemesanan ${conflict.bookingCode} (${conflict.startsOn} s/d ${conflict.endsOn}).`);
          error.code = 'BOOKING_SCHEDULE_CONFLICT';
          error.status = 409;
          throw error;
        }
      }

      const id = randomUUID();
      let bookingCode = generateBookingCode();
      if (repository?.getBookingByCode) {
        for (let attempt = 0; attempt < 10; attempt++) {
          const collision = await repository.getBookingByCode(bookingCode);
          if (!collision) break;
          bookingCode = generateBookingCode();
        }
      }
      const status = 'waiting_confirmation';
      const createdAt = new Date().toISOString();

      const bookingRecord = {
        id,
        bookingCode,
        customerName: customerName.trim(),
        whatsappPhone: cleanedPhone,
        categoryId: cleanedCategoryId,
        modelId: cleanedModelId,
        rentalType,
        startsOn,
        endsOn,
        pickupLocation: pickupLocation.trim(),
        additionalNotes: typeof additionalNotes === 'string' && additionalNotes.trim().length > 0 ? additionalNotes.trim().slice(0, 2000) : null,
        status,
        statusLabel: STATUS_LABELS[status],
        createdAt,
        updatedAt: createdAt,
      };

      if (repository?.saveBooking) {
        await repository.saveBooking(bookingRecord);
      }

      const priceSnapshot = await buildPriceSnapshot({
        modelId: cleanedModelId,
        modelSlug: resolvedModelSlug,
        rentalType,
        startsOn,
        endsOn,
        lock: false,
      });
      if (priceSnapshot) {
        await saveSnapshot(id, priceSnapshot);
      }

      return {
        bookingCode,
        status,
        statusLabel: STATUS_LABELS[status],
        createdAt,
        ...(priceSnapshot ? { priceSnapshot } : {}),
        whatsapp: {
          available: false,
          url: null,
          note: 'Nomor WhatsApp resmi bisnis sedang menunggu konfirmasi bisnis (Q-WA-001 blocker).',
        },
        notice: 'Permintaan tersimpan dan menunggu konfirmasi admin. Ini belum merupakan reservasi terkonfirmasi.',
      };
    },

    async listBookings({ userId, query = {} } = {}) {
      if (authorizationService) {
        const allowed = await authorizationService.hasPermission(userId, 'BOOKING_VIEW');
        if (!allowed) {
          const err = new Error('Permission denied');
          err.code = 'FORBIDDEN';
          err.status = 403;
          throw err;
        }
      }

      const limit = Math.min(Math.max(Number(query.limit) || 25, 1), 100);
      const offset = Math.max(Number(query.offset) || 0, 0);

      if (repository?.listBookings) {
        const result = await repository.listBookings({ ...query, limit, offset });
        const enrichedItems = await Promise.all(
          (result.items || []).map(async (item) => ({
            ...item,
            priceSnapshot: await loadSnapshot(item.id),
          })),
        );
        return { ...result, items: enrichedItems };
      }

      return {
        items: [],
        page: { limit, offset, total: 0 },
      };
    },

    async getBookingById({ userId, id } = {}) {
      if (authorizationService) {
        const allowed = await authorizationService.hasPermission(userId, 'BOOKING_VIEW');
        if (!allowed) {
          const err = new Error('Permission denied');
          err.code = 'FORBIDDEN';
          err.status = 403;
          throw err;
        }
      }

      if (repository?.getBookingById) {
        const item = await repository.getBookingById(id);
        if (!item) {
          const err = new Error('Booking not found');
          err.code = 'NOT_FOUND';
          err.status = 404;
          throw err;
        }
        return { item: { ...item, priceSnapshot: await loadSnapshot(item.id) } };
      }

      const err = new Error('Booking not found');
      err.code = 'NOT_FOUND';
      err.status = 404;
      throw err;
    },

    async updateBookingStatus({ userId, id, newStatus, reason = null } = {}) {
      if (authorizationService) {
        const allowed = (await authorizationService.hasPermission(userId, 'BOOKING_APPROVE'))
          || (await authorizationService.hasPermission(userId, 'BOOKING_UPDATE'));
        if (!allowed) {
          const err = new Error('Permission denied');
          err.code = 'FORBIDDEN';
          err.status = 403;
          throw err;
        }
      }

      if (!ALLOWED_STATUSES.has(newStatus)) {
        const err = new Error('Invalid status code');
        err.code = 'INVALID_STATUS';
        err.status = 400;
        throw err;
      }

      let currentBooking = null;
      if (repository?.getBookingById) {
        currentBooking = await repository.getBookingById(id);
      }

      if (!currentBooking) {
        const err = new Error('Booking not found');
        err.code = 'NOT_FOUND';
        err.status = 404;
        throw err;
      }

      const allowedNext = ALLOWED_TRANSITIONS[currentBooking.status] ?? [];
      if (!allowedNext.includes(newStatus)) {
        const err = new Error(`Cannot transition from ${currentBooking.status} to ${newStatus}`);
        err.code = 'INVALID_STATUS_TRANSITION';
        err.status = 409;
        throw err;
      }

      if (newStatus === 'confirmed' && repository?.findOverlappingBooking) {
        const conflict = await repository.findOverlappingBooking({
          modelId: currentBooking.modelId,
          startsOn: currentBooking.startsOn,
          endsOn: currentBooking.endsOn,
          excludeId: id,
        });
        if (conflict) {
          const err = new Error(`Tidak dapat mengonfirmasi: jadwal bentrok dengan pemesanan ${conflict.bookingCode} (${conflict.startsOn} s/d ${conflict.endsOn}).`);
          err.code = 'BOOKING_SCHEDULE_CONFLICT';
          err.status = 409;
          throw err;
        }
      }

      const updated = {
        ...currentBooking,
        status: newStatus,
        statusLabel: STATUS_LABELS[newStatus],
        updatedAt: new Date().toISOString(),
      };

      if (repository?.updateBooking) {
        await repository.updateBooking(updated);
      }
      if (['cancelled', 'rejected', 'completed'].includes(newStatus) && repository?.releaseBookingAssignments) {
        await repository.releaseBookingAssignments(id, newStatus);
      }

      let priceSnapshot = await loadSnapshot(id);
      if (['confirmed', 'in_progress', 'completed'].includes(newStatus) && !priceSnapshot?.locked) {
        let modelSlug = null;
        if (fleetService?.findModelForPublicBooking && currentBooking.categoryId && currentBooking.modelId && currentBooking.rentalType) {
          const matchedModel = await fleetService.findModelForPublicBooking({
            modelId: currentBooking.modelId,
            categoryId: currentBooking.categoryId,
            rentalType: currentBooking.rentalType,
          }).catch(() => null);
          modelSlug = matchedModel?.slug ?? null;
        }
        priceSnapshot = await buildPriceSnapshot({
          modelId: currentBooking.modelId,
          modelSlug,
          rentalType: currentBooking.rentalType,
          startsOn: currentBooking.startsOn,
          endsOn: currentBooking.endsOn,
          existingSnapshot: priceSnapshot,
          lock: true,
        });
        if (priceSnapshot) {
          await saveSnapshot(id, priceSnapshot);
        }
      }

      if (activityLog?.log) {
        await activityLog.log({
          actor: userId,
          action: 'BOOKING_STATUS_TRANSITION',
          resourceType: 'Booking',
          resourceId: id,
          details: { fromStatus: currentBooking.status, toStatus: newStatus, reason },
        }).catch(() => {});
      }

      return {
        id,
        previousStatus: currentBooking.status,
        status: newStatus,
        statusLabel: STATUS_LABELS[newStatus],
        updatedAt: updated.updatedAt,
        ...(priceSnapshot ? { priceSnapshot } : {}),
      };
    },

    async updateBookingDetails({ userId, id, patch = {} } = {}) {
      if (authorizationService) {
        const allowed = await authorizationService.hasPermission(userId, 'BOOKING_UPDATE');
        if (!allowed) {
          const err = new Error('Permission denied');
          err.code = 'FORBIDDEN';
          err.status = 403;
          throw err;
        }
      }

      const currentBooking = repository?.getBookingById ? await repository.getBookingById(id) : null;
      if (!currentBooking) {
        const err = new Error('Booking not found');
        err.code = 'NOT_FOUND';
        err.status = 404;
        throw err;
      }

      if (['completed', 'cancelled', 'rejected'].includes(currentBooking.status)) {
        const err = new Error('Pemesanan yang sudah selesai, dibatalkan, atau ditolak tidak dapat diubah.');
        err.code = 'BOOKING_IMMUTABLE';
        err.status = 409;
        throw err;
      }

      const nextStartsOn = patch.startsOn ?? currentBooking.startsOn;
      const nextEndsOn = patch.endsOn ?? currentBooking.endsOn;
      if (!isValidIsoCalendarDate(nextStartsOn) || !isValidIsoCalendarDate(nextEndsOn) || nextStartsOn > nextEndsOn) {
        const err = new Error('Tanggal mulai dan selesai tidak valid (startsOn <= endsOn).');
        err.code = 'INVALID_INPUT';
        err.status = 400;
        throw err;
      }

      const nextRentalType = patch.rentalType ?? currentBooking.rentalType;
      if (!['self_drive', 'with_driver'].includes(nextRentalType)) {
        const err = new Error('Jenis layanan sewa tidak valid.');
        err.code = 'INVALID_INPUT';
        err.status = 400;
        throw err;
      }

      const nextPickupLocation = patch.pickupLocation !== undefined ? String(patch.pickupLocation).trim() : currentBooking.pickupLocation;
      if (!nextPickupLocation || nextPickupLocation.length < 3 || nextPickupLocation.length > 500) {
        const err = new Error('Lokasi penjemputan minimal 3 karakter.');
        err.code = 'INVALID_INPUT';
        err.status = 400;
        throw err;
      }

      const nextCategoryId = patch.categoryId !== undefined ? String(patch.categoryId).trim() : currentBooking.categoryId;
      const nextModelId = patch.modelId !== undefined ? String(patch.modelId).trim() : currentBooking.modelId;

      let updatedModelSlug = null;
      if (
        fleetService?.findModelForPublicBooking &&
        (nextModelId !== currentBooking.modelId || nextCategoryId !== currentBooking.categoryId || nextRentalType !== currentBooking.rentalType)
      ) {
        const validModel = await fleetService.findModelForPublicBooking({
          modelId: nextModelId,
          categoryId: nextCategoryId,
          rentalType: nextRentalType,
        });
        if (!validModel) {
          const err = new Error('Model armada tidak tersedia untuk jenis layanan yang dipilih.');
          err.code = 'SELECTION_UNAVAILABLE';
          err.status = 422;
          throw err;
        }
        updatedModelSlug = validModel.slug ?? null;
      } else if (fleetService?.findModelForPublicBooking) {
        const matchedModel = await fleetService.findModelForPublicBooking({
          modelId: nextModelId,
          categoryId: nextCategoryId,
          rentalType: nextRentalType,
        }).catch(() => null);
        updatedModelSlug = matchedModel?.slug ?? null;
      }

      if (repository?.findOverlappingBooking) {
        const conflict = await repository.findOverlappingBooking({
          modelId: nextModelId,
          startsOn: nextStartsOn,
          endsOn: nextEndsOn,
          excludeId: id,
        });
        if (conflict) {
          const err = new Error(`Jadwal armada bentrok dengan pemesanan ${conflict.bookingCode} (${conflict.startsOn} s/d ${conflict.endsOn}).`);
          err.code = 'BOOKING_SCHEDULE_CONFLICT';
          err.status = 409;
          throw err;
        }
      }

      const nextNotes =
        patch.additionalNotes !== undefined
          ? (typeof patch.additionalNotes === 'string' && patch.additionalNotes.trim().length > 0
              ? patch.additionalNotes.trim().slice(0, 2000)
              : null)
          : currentBooking.additionalNotes;

      const updated = {
        ...currentBooking,
        categoryId: nextCategoryId,
        modelId: nextModelId,
        rentalType: nextRentalType,
        startsOn: nextStartsOn,
        endsOn: nextEndsOn,
        pickupLocation: nextPickupLocation,
        additionalNotes: nextNotes,
        updatedAt: new Date().toISOString(),
      };

      const saved = repository?.updateBooking ? await repository.updateBooking(updated) : updated;

      const existingSnapshot = await loadSnapshot(id);
      const nextSnapshot = await buildPriceSnapshot({
        modelId: nextModelId,
        modelSlug: updatedModelSlug,
        rentalType: nextRentalType,
        startsOn: nextStartsOn,
        endsOn: nextEndsOn,
        existingSnapshot,
        lock: Boolean(existingSnapshot?.locked || ['confirmed', 'in_progress', 'completed'].includes(saved.status)),
      });
      if (nextSnapshot) {
        await saveSnapshot(id, nextSnapshot);
      }

      if (activityLog?.log) {
        await activityLog.log({
          actor: userId,
          action: 'BOOKING_UPDATED',
          resourceType: 'Booking',
          resourceId: id,
          details: { startsOn: nextStartsOn, endsOn: nextEndsOn, modelId: nextModelId },
        }).catch(() => {});
      }

      return { item: { ...saved, priceSnapshot: nextSnapshot ?? existingSnapshot ?? null } };
    },

    async listAvailableUnitsForBooking({ userId, bookingId } = {}) {
      if (authorizationService) {
        const allowed = await authorizationService.hasPermission(userId, 'BOOKING_VIEW');
        if (!allowed) {
          const err = new Error('Permission denied');
          err.code = 'FORBIDDEN';
          err.status = 403;
          throw err;
        }
      }
      if (!repository?.listAvailableUnitsForBooking) {
        return { bookingId, items: [] };
      }
      const result = await repository.listAvailableUnitsForBooking(bookingId);
      if (!result) {
        const err = new Error('Booking not found');
        err.code = 'NOT_FOUND';
        err.status = 404;
        throw err;
      }
      if (Array.isArray(result)) return { bookingId, items: result };
      return result;
    },

    async assignUnitToBooking({ userId, bookingId, unitId, notes } = {}) {
      if (authorizationService) {
        const [canUpdate, canApprove] = await Promise.all([
          authorizationService.hasPermission(userId, 'BOOKING_UPDATE'),
          authorizationService.hasPermission(userId, 'BOOKING_APPROVE'),
        ]);
        if (!canUpdate && !canApprove) {
          const err = new Error('Permission denied');
          err.code = 'FORBIDDEN';
          err.status = 403;
          throw err;
        }
      }
      if (typeof unitId !== 'string' || !unitId.trim()) {
        const err = new Error('unitId wajib diisi');
        err.code = 'INVALID_INPUT';
        err.status = 400;
        throw err;
      }
      if (!repository?.assignUnitTransaction) {
        const err = new Error('Penugasan unit tidak tersedia pada repository ini.');
        err.code = 'UNSUPPORTED';
        err.status = 501;
        throw err;
      }

      const result = await repository.assignUnitTransaction({
        bookingId,
        unitId: unitId.trim(),
        assignedBy: userId ?? null,
        notes: typeof notes === 'string' && notes.trim() ? notes.trim().slice(0, 500) : null,
      });

      if (activityLog?.log) {
        await activityLog.log({
          actor: userId,
          action: 'BOOKING_UNIT_ASSIGNED',
          resourceType: 'Booking',
          resourceId: bookingId,
          details: {
            unitId: result.assignment.unitId,
            plateNumber: result.unit?.plateNumber ?? null,
            assignmentId: result.assignment.id,
          },
        }).catch(() => {});
      }

      const [updatedBooking, priceSnapshot] = await Promise.all([
        repository.getBookingById ? repository.getBookingById(bookingId) : Promise.resolve(result.booking ?? null),
        loadSnapshot(bookingId),
      ]);
      return {
        item: {
          ...(updatedBooking ?? { id: bookingId, assignedUnit: result.unit }),
          ...(priceSnapshot ? { priceSnapshot } : {}),
        },
        assignment: {
          ...result.assignment,
          unit: result.unit,
        },
      };
    },
  };
}
