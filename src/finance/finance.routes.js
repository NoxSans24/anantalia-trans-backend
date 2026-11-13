import express from 'express';

function sendRouteError(req, res, error, logger, event) {
  const status = Number.isInteger(error?.status) && error.status >= 400 && error.status < 500 ? error.status : 500;
  const code = status < 500 && typeof error?.code === 'string' ? error.code : 'INTERNAL_ERROR';
  const message = status < 500 && typeof error?.message === 'string' ? error.message : 'An unexpected error occurred';
  if (status >= 500) {
    logger?.error?.(event, { requestId: req.id, errorType: error?.constructor?.name ?? 'Error' });
  }
  return res.status(status).json({ error: { code, message } });
}

export function createFinanceRouter({ financeService, logger } = {}) {
  const router = express.Router();

  router.get('/finance', async (req, res) => {
    try {
      const result = await financeService.listTransactions({ userId: req.userId, query: req.query });
      return res.status(200).json(result);
    } catch (error) {
      return sendRouteError(req, res, error, logger, 'finance_list_failed');
    }
  });

  router.get('/finance/summary', async (req, res) => {
    try {
      const result = await financeService.getFinanceSummary({ userId: req.userId, query: req.query });
      return res.status(200).json(result);
    } catch (error) {
      return sendRouteError(req, res, error, logger, 'finance_summary_failed');
    }
  });

  router.get('/finance/:id', async (req, res) => {
    try {
      const result = await financeService.getTransactionById({ userId: req.userId, id: req.params.id });
      return res.status(200).json(result);
    } catch (error) {
      return sendRouteError(req, res, error, logger, 'finance_get_failed');
    }
  });

  router.post('/finance', async (req, res) => {
    try {
      const result = await financeService.createTransaction({ userId: req.userId, input: req.body });
      return res.status(201).json(result);
    } catch (error) {
      return sendRouteError(req, res, error, logger, 'finance_create_failed');
    }
  });

  router.post('/finance/:id/void', async (req, res) => {
    try {
      const result = await financeService.voidTransaction({
        userId: req.userId,
        id: req.params.id,
        reason: req.body?.reason,
      });
      return res.status(200).json(result);
    } catch (error) {
      return sendRouteError(req, res, error, logger, 'finance_void_failed');
    }
  });

  return router;
}
