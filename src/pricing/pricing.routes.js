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

export function createPricingRouter({ pricingService, logger } = {}) {
  const router = express.Router();

  router.get('/pricing', async (req, res) => {
    try {
      const result = await pricingService.listPricing({ userId: req.userId, query: req.query });
      return res.status(200).json(result);
    } catch (error) {
      return sendRouteError(req, res, error, logger, 'pricing_list_failed');
    }
  });

  router.get('/pricing/:id', async (req, res) => {
    try {
      const result = await pricingService.getPricingById({ userId: req.userId, id: req.params.id });
      return res.status(200).json(result);
    } catch (error) {
      return sendRouteError(req, res, error, logger, 'pricing_get_failed');
    }
  });

  router.post('/pricing', async (req, res) => {
    try {
      const result = await pricingService.createPricing({ userId: req.userId, input: req.body });
      return res.status(201).json(result);
    } catch (error) {
      return sendRouteError(req, res, error, logger, 'pricing_create_failed');
    }
  });

  router.patch('/pricing/:id', async (req, res) => {
    try {
      const result = await pricingService.updatePricing({ userId: req.userId, id: req.params.id, input: req.body });
      return res.status(200).json(result);
    } catch (error) {
      return sendRouteError(req, res, error, logger, 'pricing_update_failed');
    }
  });

  router.delete('/pricing/:id', async (req, res) => {
    try {
      const result = await pricingService.deletePricing({ userId: req.userId, id: req.params.id });
      return res.status(200).json(result);
    } catch (error) {
      return sendRouteError(req, res, error, logger, 'pricing_delete_failed');
    }
  });

  return router;
}
