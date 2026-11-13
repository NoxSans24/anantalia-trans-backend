function toIso(value) {
  return value instanceof Date ? value.toISOString() : value;
}

function serializePricing(record) {
  if (!record) return null;
  return {
    ...record,
    createdAt: toIso(record.createdAt),
    updatedAt: toIso(record.updatedAt),
  };
}

export function createPrismaPricingRepository(prisma) {
  if (!prisma) throw new TypeError('Prisma client is required');

  return Object.freeze({
    async listPricing({ modelId, rentalType, status, q, limit = 25, offset = 0 } = {}) {
      const query = typeof q === 'string' && q.trim() ? q.trim() : '';
      const where = {
        ...(modelId ? { modelId } : {}),
        ...(rentalType ? { rentalType } : {}),
        ...(status === 'active' ? { isActive: true } : status === 'inactive' ? { isActive: false } : {}),
        ...(query
          ? {
              OR: [
                { modelId: { contains: query, mode: 'insensitive' } },
                { notes: { contains: query, mode: 'insensitive' } },
              ],
            }
          : {}),
      };

      const [rows, total] = await Promise.all([
        prisma.pricingRule.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
        }),
        prisma.pricingRule.count({ where }),
      ]);

      return {
        items: rows.map(serializePricing),
        page: { limit, offset, total },
      };
    },

    async findActiveDuplicatePricing({ modelId, rentalType, billingUnit, excludeId } = {}) {
      if (typeof prisma.pricingRule?.findFirst !== 'function') return null;
      const item = await prisma.pricingRule.findFirst({
        where: {
          modelId,
          rentalType,
          billingUnit,
          isActive: true,
          ...(excludeId ? { id: { not: excludeId } } : {}),
        },
      });
      return serializePricing(item);
    },

    async getPricingById(id) {
      const item = await prisma.pricingRule.findUnique({ where: { id } });
      return serializePricing(item);
    },

    async createPricing(record) {
      const created = await prisma.pricingRule.create({
        data: {
          id: record.id,
          modelId: record.modelId,
          rentalType: record.rentalType,
          baseRate: record.baseRate,
          currency: record.currency ?? 'IDR',
          billingUnit: record.billingUnit ?? 'day',
          notes: record.notes ?? null,
          isActive: record.isActive ?? true,
          ...(record.createdAt ? { createdAt: new Date(record.createdAt) } : {}),
          ...(record.updatedAt ? { updatedAt: new Date(record.updatedAt) } : {}),
        },
      });
      return serializePricing(created);
    },

    async updatePricing(record) {
      const updated = await prisma.pricingRule.update({
        where: { id: record.id },
        data: {
          baseRate: record.baseRate,
          billingUnit: record.billingUnit,
          notes: record.notes ?? null,
          isActive: record.isActive,
          updatedAt: record.updatedAt ? new Date(record.updatedAt) : new Date(),
        },
      });
      return serializePricing(updated);
    },

    async deletePricing(id) {
      await prisma.pricingRule.delete({ where: { id } });
      return true;
    },
  });
}
