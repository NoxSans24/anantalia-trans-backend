export function createInMemoryPricingRepository(initialData = []) {
  const pricing = new Map(initialData.map((item) => [item.id, { ...item }]));

  return {
    async listPricing({ modelId, rentalType, status, q, limit = 25, offset = 0 } = {}) {
      let items = [...pricing.values()];

      if (modelId) items = items.filter((p) => p.modelId === modelId);
      if (rentalType) items = items.filter((p) => p.rentalType === rentalType);
      if (status === 'active') items = items.filter((p) => p.isActive !== false);
      if (status === 'inactive') items = items.filter((p) => p.isActive === false);
      if (q && typeof q === 'string' && q.trim()) {
        const query = q.trim().toLowerCase();
        items = items.filter(
          (p) => p.modelId?.toLowerCase().includes(query) || p.notes?.toLowerCase().includes(query),
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

    async findActiveDuplicatePricing({ modelId, rentalType, billingUnit, excludeId } = {}) {
      for (const item of pricing.values()) {
        if (
          item.isActive !== false &&
          item.modelId === modelId &&
          item.rentalType === rentalType &&
          item.billingUnit === billingUnit &&
          (!excludeId || item.id !== excludeId)
        ) {
          return { ...item };
        }
      }
      return null;
    },

    async getPricingById(id) {
      const item = pricing.get(id);
      return item ? { ...item } : null;
    },

    async createPricing(record) {
      pricing.set(record.id, { ...record });
      return { ...record };
    },

    async updatePricing(record) {
      if (!pricing.has(record.id)) return null;
      pricing.set(record.id, { ...record });
      return { ...record };
    },

    async deletePricing(id) {
      return pricing.delete(id);
    },

    clear() {
      pricing.clear();
    },
  };
}
