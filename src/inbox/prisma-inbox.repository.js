function toIso(value) {
  return value instanceof Date ? value.toISOString() : value;
}

function serializeNote(note) {
  if (!note) return null;
  return {
    id: note.id,
    note: note.note,
    authorId: note.authorId ?? null,
    createdAt: toIso(note.createdAt),
  };
}

function serializeMessage(record) {
  if (!record) return null;
  return {
    ...record,
    createdAt: toIso(record.createdAt),
    updatedAt: toIso(record.updatedAt),
    notes: Array.isArray(record.notes) ? record.notes.map(serializeNote) : [],
  };
}

export function createPrismaInboxRepository(prisma) {
  if (!prisma) throw new TypeError('Prisma client is required');

  return Object.freeze({
    async listMessages({ status, q, limit = 25, offset = 0 } = {}) {
      const query = typeof q === 'string' && q.trim() ? q.trim() : '';
      const where = {
        ...(status && status !== 'all' ? { status } : {}),
        ...(query
          ? {
              OR: [
                { senderName: { contains: query, mode: 'insensitive' } },
                { senderEmail: { contains: query, mode: 'insensitive' } },
                { subject: { contains: query, mode: 'insensitive' } },
                { content: { contains: query, mode: 'insensitive' } },
              ],
            }
          : {}),
      };

      const [rows, total] = await Promise.all([
        prisma.inboxMessage.findMany({
          where,
          include: { notes: { orderBy: { createdAt: 'asc' } } },
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
        }),
        prisma.inboxMessage.count({ where }),
      ]);

      return {
        items: rows.map(serializeMessage),
        page: { limit, offset, total },
      };
    },

    async getMessageById(id) {
      const item = await prisma.inboxMessage.findUnique({
        where: { id },
        include: { notes: { orderBy: { createdAt: 'asc' } } },
      });
      return serializeMessage(item);
    },

    async createMessage(record) {
      const created = await prisma.inboxMessage.create({
        data: {
          ...(record.id ? { id: record.id } : {}),
          senderName: record.senderName,
          senderEmail: record.senderEmail ?? null,
          subject: record.subject ?? null,
          content: record.content,
          status: record.status ?? 'unread',
          ...(record.createdAt ? { createdAt: new Date(record.createdAt) } : {}),
          ...(record.updatedAt ? { updatedAt: new Date(record.updatedAt) } : {}),
        },
        include: { notes: { orderBy: { createdAt: 'asc' } } },
      });
      return serializeMessage(created);
    },

    async updateMessage(record) {
      const updated = await prisma.inboxMessage.update({
        where: { id: record.id },
        data: {
          status: record.status,
          updatedAt: record.updatedAt ? new Date(record.updatedAt) : new Date(),
        },
        include: { notes: { orderBy: { createdAt: 'asc' } } },
      });
      return serializeMessage(updated);
    },

    async addNote({ messageId, note, authorId }) {
      const created = await prisma.inboxMessageNote.create({
        data: {
          messageId,
          note,
          authorId: authorId ?? null,
        },
      });
      return serializeNote(created);
    },
  });
}
