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

export function createCustomerRouter({ customerService, logger } = {}) {
  const router = express.Router();

  router.get('/customers', async (req, res) => {
    try {
      const result = await customerService.listCustomers({ userId: req.userId, query: req.query });
      return res.status(200).json(result);
    } catch (error) {
      return sendRouteError(req, res, error, logger, 'customer_list_failed');
    }
  });

  router.get('/customers/:id', async (req, res) => {
    try {
      const result = await customerService.getCustomerById({ userId: req.userId, id: req.params.id });
      return res.status(200).json(result);
    } catch (error) {
      return sendRouteError(req, res, error, logger, 'customer_get_failed');
    }
  });

  router.post('/customers', async (req, res) => {
    try {
      const result = await customerService.createCustomer({ userId: req.userId, input: req.body });
      return res.status(201).json(result);
    } catch (error) {
      return sendRouteError(req, res, error, logger, 'customer_create_failed');
    }
  });

  router.patch('/customers/:id', async (req, res) => {
    try {
      const result = await customerService.updateCustomer({ userId: req.userId, id: req.params.id, input: req.body });
      return res.status(200).json(result);
    } catch (error) {
      return sendRouteError(req, res, error, logger, 'customer_update_failed');
    }
  });

  router.delete('/customers/:id', async (req, res) => {
    try {
      const result = await customerService.deleteCustomer({ userId: req.userId, id: req.params.id });
      return res.status(200).json(result);
    } catch (error) {
      return sendRouteError(req, res, error, logger, 'customer_delete_failed');
    }
  });

  return router;
}
