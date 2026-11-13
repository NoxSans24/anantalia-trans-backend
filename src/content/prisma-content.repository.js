function toIso(value) {
  return value instanceof Date ? value.toISOString() : value;
}

function serializeContent(record) {
  if (!record) return null;
  return {
    ...record,
    createdAt: toIso(record.createdAt),
    updatedAt: toIso(record.updatedAt),
  };
}

export function createPrismaContentRepository(prisma) {
  if (!prisma) throw new TypeError('Prisma client is required');

  return Object.freeze({
    async listContent({ status, section, q, limit = 25, offset = 0 } = {}) {
      const query = typeof q === 'string' && q.trim() ? q.trim() : '';
      const where = {
        ...(status && status !== 'all' ? { status } : {}),
        ...(section && section !== 'all' ? { section } : {}),
        ...(query
          ? {
              OR: [
                { title: { contains: query, mode: 'insensitive' } },
                { slug: { contains: query, mode: 'insensitive' } },
                { contentKey: { contains: query, mode: 'insensitive' } },
                { body: { contains: query, mode: 'insensitive' } },
              ],
            }
          : {}),
      };

      const [rows, total] = await Promise.all([
        prisma.contentItem.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
        }),
        prisma.contentItem.count({ where }),
      ]);

      return {
        items: rows.map(serializeContent),
        page: { limit, offset, total },
      };
    },

    async getContentById(id) {
      const item = await prisma.contentItem.findUnique({ where: { id } });
      return serializeContent(item);
    },

    async findBySlug(slug) {
      if (!slug) return null;
      if (typeof prisma.contentItem?.findFirst === 'function') {
        const item = await prisma.contentItem.findFirst({ where: { slug } });
        return serializeContent(item);
      }
      const item = await prisma.contentItem.findUnique({ where: { slug } });
      return serializeContent(item);
    },

    async createContent(record) {
      const created = await prisma.contentItem.create({
        data: {
          id: record.id,
          title: record.title,
          slug: record.slug ?? null,
          contentKey: record.contentKey ?? null,
          body: record.body ?? '',
          section: record.section ?? 'general',
          status: record.status ?? 'draft',
          ...(record.createdAt ? { createdAt: new Date(record.createdAt) } : {}),
          ...(record.updatedAt ? { updatedAt: new Date(record.updatedAt) } : {}),
        },
      });
      return serializeContent(created);
    },

    async updateContent(record) {
      const updated = await prisma.contentItem.update({
        where: { id: record.id },
        data: {
          title: record.title,
          slug: record.slug ?? null,
          body: record.body ?? '',
          section: record.section ?? 'general',
          status: record.status,
          updatedAt: record.updatedAt ? new Date(record.updatedAt) : new Date(),
        },
      });
      return serializeContent(updated);
    },

    async deleteContent(id) {
      await prisma.contentItem.delete({ where: { id } });
      return true;
    },
  });
}
