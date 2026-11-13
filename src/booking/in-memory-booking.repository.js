export function createInMemoryBookingRepository(initialData = []) {
  const bookings = new Map(initialData.map((item) => [item.id, { ...item }]));

  return {
    async saveBooking(record) {
      bookings.set(record.id, { ...record });
      return { ...record };
    },

    async listBookings({ status, q, limit = 25, offset = 0 } = {}) {
      let items = [...bookings.values()];

      if (status && status !== 'all') {
        items = items.filter((b) => b.status === status);
      }

      if (q && typeof q === 'string' && q.trim()) {
        const query = q.trim().toLowerCase();
        items = items.filter((b) =>
          b.bookingCode?.toLowerCase().includes(query) ||
          b.customerName?.toLowerCase().includes(query) ||
          b.whatsappPhone?.includes(query) ||
          b.pickupLocation?.toLowerCase().includes(query)
        );
      }

      items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      const total = items.length;
      const paginated = items.slice(offset, offset + limit);

      return {
        items: paginated,
        page: { limit, offset, total },
      };
    },

    async getBookingById(id) {
      const item = bookings.get(id);
      return item ? { ...item } : null;
    },

    async getBookingByCode(bookingCode) {
      for (const item of bookings.values()) {
        if (item.bookingCode === bookingCode) return { ...item };
      }
      return null;
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
      const normName = String(customerName ?? '').trim().toLowerCase();
      const normPickup = String(pickupLocation ?? '').trim().toLowerCase();
      for (const item of bookings.values()) {
        if (
          item.status === 'waiting_confirmation' &&
          item.whatsappPhone === whatsappPhone &&
          item.categoryId === categoryId &&
          item.modelId === modelId &&
          item.rentalType === rentalType &&
          item.startsOn === startsOn &&
          item.endsOn === endsOn &&
          String(item.customerName ?? '').trim().toLowerCase() === normName &&
          String(item.pickupLocation ?? '').trim().toLowerCase() === normPickup
        ) {
          return { ...item };
        }
      }
      return null;
    },

    async findOverlappingBooking({ modelId, startsOn, endsOn, excludeId } = {}) {
      for (const item of bookings.values()) {
        if (
          item.modelId === modelId &&
          item.status === 'confirmed' &&
          item.startsOn <= endsOn &&
          item.endsOn >= startsOn &&
          (!excludeId || item.id !== excludeId)
        ) {
          return { ...item };
        }
      }
      return null;
    },

    async updateBooking(record) {
      if (!bookings.has(record.id)) return null;
      bookings.set(record.id, { ...record });
      return { ...record };
    },

    clear() {
      bookings.clear();
    },
  };
}
