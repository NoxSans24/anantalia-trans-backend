function toIso(value) {
  return value instanceof Date ? value.toISOString() : value;
}

function serializeTransaction(record) {
  if (!record) return null;
  return {
    ...record,
    createdAt: toIso(record.createdAt),
    updatedAt: toIso(record.updatedAt),
  };
}

export function createPrismaFinanceRepository(prisma) {
  if (!prisma) throw new TypeError('Prisma client is required');

  return Object.freeze({
    async listTransactions({ type, category, q, status, fromDate, toDate, bookingId, limit = 25, offset = 0 } = {}) {
      const dateFilter =
        fromDate || toDate
          ? {
              date: {
                ...(fromDate ? { gte: fromDate } : {}),
                ...(toDate ? { lte: toDate } : {}),
              },
            }
          : {};
      const searchFilter = q
        ? {
            OR: [
              { category: { contains: q, mode: 'insensitive' } },
              { description: { contains: q, mode: 'insensitive' } },
              { bookingId: { contains: q, mode: 'insensitive' } },
              { date: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {};
      const where = {
        ...(type ? { type } : {}),
        ...(category ? { category } : {}),
        ...(status ? { status } : {}),
        ...(bookingId ? { bookingId } : {}),
        ...dateFilter,
        ...searchFilter,
      };

      const [rows, total] = await Promise.all([
        prisma.financeTransaction.findMany({
          where,
          orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
          take: limit,
          skip: offset,
        }),
        prisma.financeTransaction.count({ where }),
      ]);

      return {
        items: rows.map(serializeTransaction),
        page: { limit, offset, total },
      };
    },

    async getTransactionById(id) {
      const item = await prisma.financeTransaction.findUnique({ where: { id } });
      return serializeTransaction(item);
    },

    async createTransaction(record) {
      const created = await prisma.financeTransaction.create({
        data: {
          id: record.id,
          type: record.type,
          amount: record.amount,
          category: record.category ?? 'general',
          description: record.description ?? null,
          bookingId: record.bookingId ?? null,
          date: record.date,
          status: record.status ?? 'recorded',
          ...(record.createdAt ? { createdAt: new Date(record.createdAt) } : {}),
        },
      });
      return serializeTransaction(created);
    },

    async updateTransaction(id, updates) {
      if (typeof prisma.financeTransaction?.update !== 'function') return null;
      const updated = await prisma.financeTransaction.update({
        where: { id },
        data: updates,
      });
      return serializeTransaction(updated);
    },

    async getSummary({ fromDate, toDate } = {}) {
      const dateFilter =
        fromDate || toDate
          ? {
              date: {
                ...(fromDate ? { gte: fromDate } : {}),
                ...(toDate ? { lte: toDate } : {}),
              },
            }
          : {};
      const activeWhere = {
        status: { notIn: ['void', 'reversed'] },
        ...dateFilter,
      };
      const [incomeAgg, expenseAgg, refundAgg, transactionCount] = await Promise.all([
        prisma.financeTransaction.aggregate({
          where: { ...activeWhere, type: 'income' },
          _sum: { amount: true },
        }),
        prisma.financeTransaction.aggregate({
          where: { ...activeWhere, type: 'expense' },
          _sum: { amount: true },
        }),
        prisma.financeTransaction.aggregate({
          where: { ...activeWhere, type: 'refund' },
          _sum: { amount: true },
        }),
        prisma.financeTransaction.count({ where: activeWhere }),
      ]);

      const totalRevenue = Number(incomeAgg?._sum?.amount ?? 0);
      const totalExpenses = Number(expenseAgg?._sum?.amount ?? 0);
      const totalRefunds = Number(refundAgg?._sum?.amount ?? 0);

      return {
        totalRevenue,
        totalExpenses,
        totalRefunds,
        netProfit: totalRevenue - totalExpenses - totalRefunds,
        transactionCount,
      };
    },
  });
}
