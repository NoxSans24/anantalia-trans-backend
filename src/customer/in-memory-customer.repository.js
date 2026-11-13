export function createInMemoryCustomerRepository(initialData = []) {
  const customers = new Map(initialData.map((item) => [item.id, { ...item }]));

  return {
    async listCustomers({ q, status, includeInactive, limit = 25, offset = 0 } = {}) {
      let items = [...customers.values()];
      if (status === 'inactive') {
        items = items.filter((c) => c.isActive === false);
      } else if (!(status === 'all' || includeInactive === true || includeInactive === 'true')) {
        items = items.filter((c) => c.isActive !== false);
      }

      if (q && typeof q === 'string' && q.trim()) {
        const query = q.trim().toLowerCase();
        items = items.filter((c) =>
          c.id?.toLowerCase().includes(query) ||
          c.name?.toLowerCase().includes(query) ||
          c.phone?.includes(query) ||
          c.email?.toLowerCase().includes(query)
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

    async getCustomerById(id) {
      const item = customers.get(id);
      return item && item.isActive !== false ? { ...item } : null;
    },

    async getCustomerByIdAnyStatus(id) {
      const item = customers.get(id);
      return item ? { ...item } : null;
    },

    async findDuplicateCustomer({ phone, email, excludeId } = {}) {
      const normEmail = email ? email.toLowerCase() : null;
      for (const item of customers.values()) {
        if (item.isActive === false) continue;
        if (excludeId && item.id === excludeId) continue;
        if (phone && item.phone === phone) return { ...item };
        if (normEmail && item.email?.toLowerCase() === normEmail) return { ...item };
      }
      return null;
    },

    async createCustomer(record) {
      customers.set(record.id, { ...record });
      return { ...record };
    },

    async updateCustomer(record) {
      if (!customers.has(record.id)) return null;
      customers.set(record.id, { ...record });
      return { ...record };
    },

    async deactivateCustomer(id) {
      const item = customers.get(id);
      if (!item) return false;
      item.isActive = false;
      item.updatedAt = new Date().toISOString();
      return true;
    },

    clear() {
      customers.clear();
    },
  };
}
