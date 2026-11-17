import { randomUUID } from 'node:crypto';

export function createFinanceService({ repository, authorizationService, activityLog } = {}) {
  async function assertPermission(userId, permission) {
    if (authorizationService) {
      const allowed = await authorizationService.hasPermission(userId, permission);
      if (!allowed) {
        const err = new Error('Permission denied');
        err.code = 'FORBIDDEN';
        err.status = 403;
        throw err;
      }
    }
  }

  return {
    async listTransactions({ userId, query = {} } = {}) {
      await assertPermission(userId, 'FINANCE_VIEW');
      const limit = Math.min(Math.max(Number(query.limit) || 25, 1), 100);
      const offset = Math.max(Number(query.offset) || 0, 0);

      if (repository?.listTransactions) {
        return repository.listTransactions({ ...query, limit, offset });
      }
      return { items: [], page: { limit, offset, total: 0 } };
    },

    async getTransactionById({ userId, id } = {}) {
      await assertPermission(userId, 'FINANCE_VIEW');
      if (repository?.getTransactionById) {
        const item = await repository.getTransactionById(id);
        if (item) return { item };
      }
      const err = new Error('Transaction not found');
      err.code = 'NOT_FOUND';
      err.status = 404;
      throw err;
    },

    async createTransaction({ userId, input } = {}) {
      await assertPermission(userId, 'FINANCE_CREATE');
      const { type, amount, category, description, bookingId = null, date } = input ?? {};
      if (!['income', 'expense', 'refund'].includes(type) || !Number.isSafeInteger(amount) || amount <= 0) {
        const err = new Error('Valid transaction type (income/expense/refund) and positive integer amount required');
        err.code = 'INVALID_INPUT';
        err.status = 400;
        throw err;
      }
      const normalizedCategory = String(category ?? 'general').trim();
      if (!normalizedCategory) {
        const err = new Error('Transaction category is required');
        err.code = 'INVALID_INPUT';
        err.status = 400;
        throw err;
      }
      const normalizedDate = date ?? new Date().toISOString().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(normalizedDate))) {
        const err = new Error('Valid transaction date (YYYY-MM-DD) is required');
        err.code = 'INVALID_INPUT';
        err.status = 400;
        throw err;
      }

      const id = randomUUID();
      const transaction = {
        id,
        type,
        amount,
        category: typeof category === 'string' ? category.trim() : 'general',
        description: typeof description === 'string' ? description.trim() : null,
        bookingId: typeof bookingId === 'string' ? bookingId : null,
        date: typeof date === 'string' ? date : new Date().toISOString().slice(0, 10),
        status: 'recorded',
        createdAt: new Date().toISOString(),
      };

      if (repository?.createTransaction) {
        await repository.createTransaction(transaction);
      }

      if (activityLog?.log) {
        await activityLog.log({
          actor: userId,
          action: 'FINANCE_TRANSACTION_CREATED',
          resourceType: 'FinanceTransaction',
          resourceId: id,
          details: { type, amount },
        }).catch(() => {});
      }

      return { item: transaction };
    },

    async voidTransaction({ userId, id, reason } = {}) {
      await assertPermission(userId, 'FINANCE_UPDATE');
      if (!repository?.getTransactionById || !repository?.updateTransaction) {
        const err = new Error('Finance repository does not support voiding');
        err.code = 'NOT_SUPPORTED';
        err.status = 501;
        throw err;
      }
      const existing = await repository.getTransactionById(id);
      if (!existing) {
        const err = new Error('Transaction not found');
        err.code = 'NOT_FOUND';
        err.status = 404;
        throw err;
      }
      if (existing.status === 'void' || existing.status === 'reversed') {
        const err = new Error('Transaction is already voided');
        err.code = 'INVALID_TRANSITION';
        err.status = 400;
        throw err;
      }
      const cleanReason = String(reason ?? '').trim();
      const updatedDescription = cleanReason
        ? `${existing.description ? `${existing.description} | ` : ''}[VOID: ${cleanReason}]`
        : existing.description;
      const updated = await repository.updateTransaction(id, {
        status: 'void',
        description: updatedDescription,
      });
      if (activityLog?.log) {
        await activityLog.log({
          actor: userId,
          action: 'FINANCE_TRANSACTION_VOIDED',
          resourceType: 'FinanceTransaction',
          resourceId: id,
          details: { previousStatus: existing.status, reason: cleanReason || null },
        }).catch(() => {});
      } else if (activityLog?.record) {
        await activityLog.record({
          userId,
          action: 'FINANCE_TRANSACTION_VOIDED',
          entityType: 'finance_transaction',
          entityId: id,
          metadata: { previousStatus: existing.status, reason: cleanReason || null },
        });
      }
      return { item: updated };
    },

    async getFinanceSummary({ userId, query = {} } = {}) {
      await assertPermission(userId, 'FINANCE_VIEW');
      const note = 'Ringkasan finansial aktual berdasarkan transaksi tercatat (status void dikecualikan).';
      if (repository?.getSummary) {
        const summary = await repository.getSummary({
          fromDate: query.fromDate,
          toDate: query.toDate,
        });
        return {
          totalRevenue: summary.totalRevenue ?? 0,
          totalExpenses: summary.totalExpenses ?? 0,
          totalRefunds: summary.totalRefunds ?? 0,
          netProfit: summary.netProfit ?? 0,
          transactionCount: summary.transactionCount ?? 0,
          pendingInvoices: summary.pendingInvoices ?? 0,
          note,
        };
      }
      return {
        totalRevenue: 0,
        totalExpenses: 0,
        totalRefunds: 0,
        netProfit: 0,
        transactionCount: 0,
        pendingInvoices: 0,
        note,
      };
    },
  };
}
