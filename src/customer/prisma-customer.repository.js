function toIso(value) {
  return value instanceof Date ? value.toISOString() : value;
}

function serializeCustomer(record) {
  if (!record) return null;
  return {
    ...record,
    createdAt: toIso(record.createdAt),
    updatedAt: toIso(record.updatedAt),
  };
}

export function createPrismaCustomerRepository(prisma) {
  if (!prisma) throw new TypeError('Prisma client is required');

  return Object.freeze({
    async listCustomers({ q, status, includeInactive, limit = 25, offset = 0 } = {}) {
      const query = typeof q === 'string' && q.trim() ? q.trim() : '';
      const activeFilter =
        status === 'inactive'
          ? { isActive: false }
          : status === 'all' || includeInactive === true || includeInactive === 'true'
            ? {}
            : { isActive: true };

      const where = {
        ...activeFilter,
        ...(query
          ? {
              OR: [
                { name: { contains: query, mode: 'insensitive' } },
                { phone: { contains: query } },
                { email: { contains: query, mode: 'insensitive' } },
              ],
            }
          : {}),
      };

      const [rows, total] = await Promise.all([
        prisma.customer.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
        }),
        prisma.customer.count({ where }),
      ]);

      return {
        items: rows.map(serializeCustomer),
        page: { limit, offset, total },
      };
    },

    async getCustomerById(id) {
      const item = await prisma.customer.findUnique({ where: { id } });
      return item && item.isActive !== false ? serializeCustomer(item) : null;
    },

    async getCustomerByIdAnyStatus(id) {
      const item = await prisma.customer.findUnique({ where: { id } });
      return serializeCustomer(item);
    },

    async findDuplicateCustomer({ phone, email, excludeId } = {}) {
      if (typeof prisma.customer?.findFirst !== 'function') return null;
      const or = [];
      if (phone) or.push({ phone });
      if (email) or.push({ email: { equals: email, mode: 'insensitive' } });
      if (!or.length) return null;
      const item = await prisma.customer.findFirst({
        where: {
          isActive: true,
          OR: or,
          ...(excludeId ? { id: { not: excludeId } } : {}),
        },
      });
      return serializeCustomer(item);
    },

    async createCustomer(record) {
      const created = await prisma.customer.create({
        data: {
          id: record.id,
          name: record.name,
          phone: record.phone ?? null,
          email: record.email ?? null,
          notes: record.notes ?? null,
          isActive: record.isActive ?? true,
          ...(record.createdAt ? { createdAt: new Date(record.createdAt) } : {}),
          ...(record.updatedAt ? { updatedAt: new Date(record.updatedAt) } : {}),
        },
      });
      return serializeCustomer(created);
    },

    async updateCustomer(record) {
      const updated = await prisma.customer.update({
        where: { id: record.id },
        data: {
          name: record.name,
          phone: record.phone ?? null,
          email: record.email ?? null,
          notes: record.notes ?? null,
          ...(typeof record.isActive === 'boolean' ? { isActive: record.isActive } : {}),
          updatedAt: record.updatedAt ? new Date(record.updatedAt) : new Date(),
        },
      });
      return serializeCustomer(updated);
    },

    async deactivateCustomer(id) {
      await prisma.customer.update({
        where: { id },
        data: {
          isActive: false,
          updatedAt: new Date(),
        },
      });
      return true;
    },
  });
}
