export function createInMemoryContentRepository(initialData = []) {
  const contentMap = new Map(initialData.map((item) => [item.id, { ...item }]));

  return {
    async listContent({ status, section, q, limit = 25, offset = 0 } = {}) {
      let items = [...contentMap.values()];

      if (status && status !== 'all') {
        items = items.filter((c) => c.status === status);
      }
      if (section && section !== 'all') {
        items = items.filter((c) => c.section === section);
      }

      if (q && typeof q === 'string' && q.trim()) {
        const query = q.trim().toLowerCase();
        items = items.filter((c) =>
          c.title?.toLowerCase().includes(query) ||
          c.slug?.toLowerCase().includes(query) ||
          c.contentKey?.toLowerCase().includes(query) ||
          c.body?.toLowerCase().includes(query)
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

    async getContentById(id) {
      const item = contentMap.get(id);
      return item ? { ...item } : null;
    },

    async findBySlug(slug) {
      if (!slug) return null;
      const needle = String(slug).trim().toLowerCase();
      for (const item of contentMap.values()) {
        if (item.slug && item.slug.toLowerCase() === needle) return { ...item };
      }
      return null;
    },

    async createContent(record) {
      contentMap.set(record.id, { ...record });
      return { ...record };
    },

    async updateContent(record) {
      if (!contentMap.has(record.id)) return null;
      contentMap.set(record.id, { ...record });
      return { ...record };
    },

    async deleteContent(id) {
      return contentMap.delete(id);
    },

    clear() {
      contentMap.clear();
    },
  };
}
