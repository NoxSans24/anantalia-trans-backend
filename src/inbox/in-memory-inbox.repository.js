export function createInMemoryInboxRepository(initialData = []) {
  const messages = new Map(initialData.map((item) => [item.id, { ...item, notes: item.notes ? [...item.notes] : [] }]));

  return {
    async listMessages({ status, q, limit = 25, offset = 0 } = {}) {
      let items = [...messages.values()];

      if (status && status !== 'all') {
        items = items.filter((m) => m.status === status);
      }

      if (q && typeof q === 'string' && q.trim()) {
        const query = q.trim().toLowerCase();
        items = items.filter((m) =>
          m.senderName?.toLowerCase().includes(query) ||
          m.senderEmail?.toLowerCase().includes(query) ||
          m.subject?.toLowerCase().includes(query) ||
          m.content?.toLowerCase().includes(query)
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

    async getMessageById(id) {
      const item = messages.get(id);
      return item ? { ...item } : null;
    },

    async createMessage(record) {
      const created = {
        ...record,
        notes: Array.isArray(record.notes) ? [...record.notes] : [],
      };
      messages.set(created.id, created);
      return { ...created };
    },

    async updateMessage(record) {
      if (!messages.has(record.id)) return null;
      messages.set(record.id, { ...record });
      return { ...record };
    },

    async addNote({ messageId, note, authorId }) {
      const item = messages.get(messageId);
      if (!item) return null;
      const noteEntry = {
        id: `note-${Date.now()}`,
        note,
        authorId,
        createdAt: new Date().toISOString(),
      };
      if (!Array.isArray(item.notes)) item.notes = [];
      item.notes.push(noteEntry);
      return noteEntry;
    },

    clear() {
      messages.clear();
    },
  };
}
