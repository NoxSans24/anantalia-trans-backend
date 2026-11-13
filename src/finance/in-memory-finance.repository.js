export function createInMemoryFinanceRepository(initialData = []) {
  const transactions = new Map(initialData.map((item) => [item.id, { ...item }]));

  return {
    async listTransactions({ type, category, q, status, fromDate, toDate, bookingId, limit = 25, offset = 0 } = {}) {
      let items = [...transactions.values()];

      if (type) items = items.filter((t) => t.type === type);
      if (category) items = items.filter((t) => t.category === category);
      if (status) items = items.filter((t) => (t.status || 'recorded') === status);
      if (bookingId) items = items.filter((t) => t.bookingId === bookingId);
      if (fromDate) items = items.filter((t) => String(t.date || t.createdAt || '').slice(0, 10) >= fromDate);
      if (toDate) items = items.filter((t) => String(t.date || t.createdAt || '').slice(0, 10) <= toDate);
      if (q) {
        const needle = String(q).trim().toLowerCase();
        if (needle) {
          items = items.filter((t) =>
            `${t.id || ''} ${t.category || ''} ${t.description || ''} ${t.bookingId || ''} ${t.date || ''}`
              .toLowerCase()
              .includes(needle),
          );
        }
      }

      items.sort((a, b) => new Date(b.date || b.createdAt) - new Date(a.date || a.createdAt));
      const total = items.length;
      const paginated = items.slice(offset, offset + limit);

      return {
        items: paginated,
        page: { limit, offset, total },
      };
    },

    async getTransactionById(id) {
      const item = transactions.get(id);
      return item ? { ...item } : null;
    },

    async createTransaction(record) {
      transactions.set(record.id, { ...record });
      return { ...record };
    },

    async updateTransaction(id, updates) {
      const existing = transactions.get(id);
      if (!existing) return null;
      const updated = {
        ...existing,
        ...updates,
        updatedAt: new Date().toISOString(),
      };
      transactions.set(id, updated);
      return { ...updated };
    },

    async getSummary({ fromDate, toDate } = {}) {
      let totalRevenue = 0;
      let totalExpenses = 0;
      let totalRefunds = 0;
      let transactionCount = 0;
      for (const t of transactions.values()) {
        const txDate = String(t.date || t.createdAt || '').slice(0, 10);
        if (fromDate && txDate < fromDate) continue;
        if (toDate && txDate > toDate) continue;
        if (t.status === 'void' || t.status === 'reversed') continue;
        transactionCount += 1;
        const amt = Number(t.amount) || 0;
        if (t.type === 'income') totalRevenue += amt;
        else if (t.type === 'expense') totalExpenses += amt;
        else if (t.type === 'refund') totalRefunds += amt;
      }
      return {
        totalRevenue,
        totalExpenses,
        totalRefunds,
        netProfit: totalRevenue - totalExpenses - totalRefunds,
        transactionCount,
      };
    },

    clear() {
      transactions.clear();
    },
  };
}
