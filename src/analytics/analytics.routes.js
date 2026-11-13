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

export function createAnalyticsRouter({ analyticsService, logger } = {}) {
  const router = express.Router();

  router.get('/analytics/overview', async (req, res) => {
    try {
      const result = await analyticsService.getOverview({ userId: req.userId, range: req.query.range });
      return res.status(200).json(result);
    } catch (error) {
      return sendRouteError(req, res, error, logger, 'analytics_overview_failed');
    }
  });

  router.get('/analytics/export', async (req, res) => {
    try {
      const result = await analyticsService.exportReport({ userId: req.userId, format: req.query.format });
      return res.status(200).json(result);
    } catch (error) {
      return sendRouteError(req, res, error, logger, 'analytics_export_failed');
    }
  });

  return router;
}
