import express from 'express';

export function createDashboardRouter({ dashboardService, logger } = {}) {
  if (!dashboardService || !logger) throw new TypeError('Dashboard route dependencies are required');
  const router = express.Router();
  router.get('/summary', async (req, res) => {
    try {
      if (!req.userId) return res.status(401).json({ error: { code: 'UNAUTHENTICATED' }, requestId: req.id });
      return res.json(await dashboardService.getSummary({ actor: req.userId }));
    } catch (error) {
      logger.error('dashboard_summary_failed', { requestId: req.id, errorType: error?.constructor?.name ?? 'Error' });
      const status = error?.status === 'PERMISSION_DENIED' ? 403 : 500;
      return res.status(status).json({ error: { code: status === 403 ? 'FORBIDDEN' : 'INTERNAL_ERROR', message: status === 403 ? 'Permission denied' : 'An unexpected error occurred' }, requestId: req.id });
    }
  });
  return router;
}
