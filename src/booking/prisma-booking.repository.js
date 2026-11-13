import { randomUUID } from 'node:crypto';

function toIso(value) {
  return value instanceof Date ? value.toISOString() : value;
}

function serializeBooking(record) {
  if (!record) return null;
  const activeAssignment = Array.isArray(record.unitAssignments) ? record.unitAssignments[0] ?? null : null;
  const { unitAssignments, ...rest } = record;
  return {
    ...rest,
    assignedUnit: activeAssignment?.unit ?? null,
    unitAssignment: activeAssignment
      ? {
          id: activeAssignment.id,
          unitId: activeAssignment.unitId,
          status: activeAssignment.status,
          assignedAt: toIso(activeAssignment.assignedAt),
          notes: activeAssignment.notes ?? null,
        }
      : null,
    createdAt: toIso(record.createdAt),
    updatedAt: toIso(record.updatedAt),
  };
}

export function createPrismaBookingRepository(prisma) {
  if (!prisma) throw new TypeError('Prisma client is required');

  return Object.freeze({
    async saveBooking(record) {
      const created = await prisma.booking.create({
        data: {
          id: record.id,
          bookingCode: record.bookingCode,
          customerName: record.customerName,
          whatsappPhone: record.whatsappPhone,
          categoryId: record.categoryId,
          modelId: record.modelId,
          rentalType: record.rentalType,
          startsOn: record.startsOn,
          endsOn: record.endsOn,
          pickupLocation: record.pickupLocation,
          additionalNotes: record.additionalNotes ?? null,
          status: record.status,
          statusLabel: record.statusLabel,
          ...(record.createdAt ? { createdAt: new Date(record.createdAt) } : {}),
          ...(record.updatedAt ? { updatedAt: new Date(record.updatedAt) } : {}),
        },
      });
      return serializeBooking(created);
    },

    async listBookings({ status, q, limit = 25, offset = 0 } = {}) {
      const query = typeof q === 'string' && q.trim() ? q.trim() : '';
      const where = {
        ...(status && status !== 'all' ? { status } : {}),
        ...(query
          ? {
              OR: [
                { bookingCode: { contains: query, mode: 'insensitive' } },
                { customerName: { contains: query, mode: 'insensitive' } },
                { whatsappPhone: { contains: query } },
                { pickupLocation: { contains: query, mode: 'insensitive' } },
              ],
            }
          : {}),
      };

      const [rows, total] = await Promise.all([
        prisma.booking.findMany({
          where,
          include: {
            unitAssignments: {
              where: { status: 'assigned' },
              include: { unit: { select: { id: true, plateNumber: true, year: true, status: true, modelId: true } } },
              orderBy: { assignedAt: 'desc' },
              take: 1,
            },
          },
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
        }),
        prisma.booking.count({ where }),
      ]);

      return {
        items: rows.map(serializeBooking),
        page: { limit, offset, total },
      };
    },

    async getBookingById(id) {
      const item = await prisma.booking.findUnique({
        where: { id },
        include: {
          unitAssignments: {
            where: { status: 'assigned' },
            include: { unit: { select: { id: true, plateNumber: true, year: true, status: true, modelId: true } } },
            orderBy: { assignedAt: 'desc' },
            take: 1,
          },
        },
      });
      return serializeBooking(item);
    },

    async getBookingByCode(bookingCode) {
      const item = await prisma.booking.findUnique({ where: { bookingCode } });
      return serializeBooking(item);
    },

    async findDuplicatePendingRequest({
      customerName,
      whatsappPhone,
      categoryId,
      modelId,
      rentalType,
      startsOn,
      endsOn,
      pickupLocation,
    } = {}) {
      const item = await prisma.booking.findFirst({
        where: {
          status: 'waiting_confirmation',
          whatsappPhone,
          categoryId,
          modelId,
          rentalType,
          startsOn,
          endsOn,
          customerName: { equals: String(customerName ?? '').trim(), mode: 'insensitive' },
          pickupLocation: { equals: String(pickupLocation ?? '').trim(), mode: 'insensitive' },
        },
      });
      return serializeBooking(item);
    },

    async findOverlappingBooking({ modelId, startsOn, endsOn, excludeId } = {}) {
      const item = await prisma.booking.findFirst({
        where: {
          modelId,
          status: 'confirmed',
          startsOn: { lte: endsOn },
          endsOn: { gte: startsOn },
          ...(excludeId ? { id: { not: excludeId } } : {}),
        },
        orderBy: { startsOn: 'asc' },
      });
      return serializeBooking(item);
    },

    async updateBooking(record) {
      const updated = await prisma.booking.update({
        where: { id: record.id },
        data: {
          ...(record.customerName !== undefined ? { customerName: record.customerName } : {}),
          ...(record.whatsappPhone !== undefined ? { whatsappPhone: record.whatsappPhone } : {}),
          ...(record.categoryId !== undefined ? { categoryId: record.categoryId } : {}),
          ...(record.modelId !== undefined ? { modelId: record.modelId } : {}),
          ...(record.rentalType !== undefined ? { rentalType: record.rentalType } : {}),
          ...(record.startsOn !== undefined ? { startsOn: record.startsOn } : {}),
          ...(record.endsOn !== undefined ? { endsOn: record.endsOn } : {}),
          ...(record.pickupLocation !== undefined ? { pickupLocation: record.pickupLocation } : {}),
          ...(record.additionalNotes !== undefined ? { additionalNotes: record.additionalNotes } : {}),
          status: record.status,
          statusLabel: record.statusLabel,
          updatedAt: record.updatedAt ? new Date(record.updatedAt) : new Date(),
        },
        include: {
          unitAssignments: {
            where: { status: 'assigned' },
            include: { unit: { select: { id: true, plateNumber: true, year: true, status: true, modelId: true } } },
            orderBy: { assignedAt: 'desc' },
            take: 1,
          },
        },
      });
      return serializeBooking(updated);
    },

    async releaseBookingAssignments(bookingId, bookingStatus) {
      const nextStatus = bookingStatus === 'completed' ? 'released' : 'cancelled';
      await prisma.bookingUnitAssignment.updateMany({
        where: { bookingId, status: 'assigned' },
        data: { status: nextStatus, releasedAt: new Date() },
      });
    },

    async listAvailableUnitsForBooking(bookingId) {
      const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
      if (!booking) return null;
      const units = await prisma.vehicleUnit.findMany({
        where: {
          isActive: true,
          status: { in: ['available', 'in_use', 'maintenance'] },
          OR: [
            { modelId: /^[0-9a-f-]{36}$/i.test(booking.modelId) ? booking.modelId : '00000000-0000-0000-0000-000000000000' },
            { model: { slug: booking.modelId } },
          ],
        },
        include: {
          model: { select: { id: true, name: true, slug: true } },
          bookingAssignments: {
            where: {
              status: 'assigned',
              bookingId: { not: bookingId },
              booking: {
                status: { notIn: ['cancelled', 'rejected', 'completed'] },
                startsOn: { lte: booking.endsOn },
                endsOn: { gte: booking.startsOn },
              },
            },
            select: { id: true, booking: { select: { bookingCode: true, startsOn: true, endsOn: true } } },
          },
          maintenances: {
            where: {
              status: { in: ['scheduled', 'in_progress'] },
              serviceDate: { gte: booking.startsOn, lte: booking.endsOn },
            },
            select: { id: true, serviceType: true, serviceDate: true },
          },
        },
        orderBy: { plateNumber: 'asc' },
      });
      const items = units.map((u) => {
        const conflictBooking = u.bookingAssignments[0]?.booking ?? null;
        const conflictMaint = u.maintenances[0] ?? null;
        const available = u.status !== 'maintenance' && u.status !== 'inactive' && !conflictBooking && !conflictMaint;
        const conflictReason = u.status === 'maintenance'
          ? 'Unit sedang dalam perawatan'
          : conflictBooking
            ? `Bentrok dengan ${conflictBooking.bookingCode} (${conflictBooking.startsOn} s/d ${conflictBooking.endsOn})`
            : conflictMaint
              ? `Jadwal servis ${conflictMaint.serviceType} (${conflictMaint.serviceDate})`
              : null;
        return {
          id: u.id,
          modelId: u.modelId,
          plateNumber: u.plateNumber,
          year: u.year,
          odometerKm: u.odometerKm,
          status: u.status,
          model: u.model,
          available,
          isAvailableForSchedule: available,
          conflictReason,
        };
      });
      return { bookingId, items };
    },

    async assignUnitTransaction({ bookingId, unitId, assignedBy = null, notes = null }) {
      return prisma.$transaction(async (tx) => {
        // Pessimistic row lock on VehicleUnit to prevent concurrent double-assignment
        const lockedUnits = await tx.$queryRaw`
          SELECT "id", "modelId", "plateNumber", "status", "isActive"
          FROM "VehicleUnit"
          WHERE "id" = ${unitId}::uuid
          FOR UPDATE
        `;
        const unit = lockedUnits[0];
        if (!unit) {
          const err = new Error('Unit fisik tidak ditemukan.');
          err.code = 'UNIT_NOT_FOUND';
          err.status = 404;
          throw err;
        }
        if (!unit.isActive || unit.status === 'inactive' || unit.status === 'maintenance') {
          const err = new Error(`Unit ${unit.plateNumber} sedang berstatus ${unit.status} dan tidak dapat ditugaskan.`);
          err.code = 'UNIT_UNAVAILABLE';
          err.status = 409;
          throw err;
        }

        const lockedBookings = await tx.$queryRaw`
          SELECT "id", "bookingCode", "modelId", "startsOn", "endsOn", "status"
          FROM "Booking"
          WHERE "id" = ${bookingId}::uuid
          FOR UPDATE
        `;
        const booking = lockedBookings[0];
        if (!booking) {
          const err = new Error('Pemesanan tidak ditemukan.');
          err.code = 'NOT_FOUND';
          err.status = 404;
          throw err;
        }
        if (['cancelled', 'rejected', 'completed'].includes(booking.status)) {
          const err = new Error('Pemesanan yang sudah selesai, dibatalkan, atau ditolak tidak dapat ditugaskan unit.');
          err.code = 'BOOKING_IMMUTABLE';
          err.status = 409;
          throw err;
        }

        const model = await tx.vehicleModel.findUnique({ where: { id: unit.modelId }, select: { id: true, slug: true } });
        if (booking.modelId !== unit.modelId && booking.modelId !== model?.slug) {
          const err = new Error(`Model unit ${unit.plateNumber} tidak sesuai dengan model pemesanan.`);
          err.code = 'UNIT_MODEL_MISMATCH';
          err.status = 422;
          throw err;
        }

        const conflictAssignment = await tx.bookingUnitAssignment.findFirst({
          where: {
            unitId,
            status: 'assigned',
            bookingId: { not: bookingId },
            booking: {
              status: { notIn: ['cancelled', 'rejected', 'completed'] },
              startsOn: { lte: booking.endsOn },
              endsOn: { gte: booking.startsOn },
            },
          },
          include: { booking: { select: { bookingCode: true, startsOn: true, endsOn: true } } },
        });
        if (conflictAssignment) {
          const b = conflictAssignment.booking;
          const err = new Error(`Unit ${unit.plateNumber} sudah ditugaskan ke ${b.bookingCode} (${b.startsOn} s/d ${b.endsOn}).`);
          err.code = 'UNIT_SCHEDULE_CONFLICT';
          err.status = 409;
          throw err;
        }

        const conflictMaint = await tx.vehicleMaintenance.findFirst({
          where: {
            unitId,
            status: { in: ['scheduled', 'in_progress'] },
            serviceDate: { gte: booking.startsOn, lte: booking.endsOn },
          },
        });
        if (conflictMaint) {
          const err = new Error(`Unit ${unit.plateNumber} memiliki jadwal servis (${conflictMaint.serviceType} pada ${conflictMaint.serviceDate}).`);
          err.code = 'UNIT_MAINTENANCE_CONFLICT';
          err.status = 409;
          throw err;
        }

        await tx.bookingUnitAssignment.updateMany({
          where: { bookingId, status: 'assigned' },
          data: { status: 'replaced', releasedAt: new Date() },
        });

        const assignment = await tx.bookingUnitAssignment.create({
          data: {
            id: randomUUID(),
            bookingId,
            unitId,
            status: 'assigned',
            assignedBy: assignedBy && /^[0-9a-f-]{36}$/i.test(assignedBy) ? assignedBy : null,
            notes: typeof notes === 'string' && notes.trim() ? notes.trim().slice(0, 500) : null,
          },
        });

        return {
          assignment,
          unit: { id: unit.id, plateNumber: unit.plateNumber, modelId: unit.modelId, status: unit.status },
        };
      });
    },
  });
}
