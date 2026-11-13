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

export function createPublicContactRouter({ inboxService, rateLimitMiddleware, logger } = {}) {
  const router = express.Router();
  const limitMiddleware = typeof rateLimitMiddleware === 'function' ? rateLimitMiddleware : (_req, _res, next) => next();

  router.post('/contact-messages', limitMiddleware, async (req, res) => {
    try {
      const result = await inboxService.submitPublicContactMessage({ input: req.body });
      return res.status(201).json(result);
    } catch (error) {
      return sendRouteError(req, res, error, logger, 'public_contact_submit_failed');
    }
  });

  return router;
}
