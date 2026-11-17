import express from 'express';

function sendRouteError(req, res, error, logger, event) {
  const status = Number.isInteger(error?.status) && error.status >= 400 && error.status < 500
    ? error.status
    : [502, 503].includes(error?.status)
      ? error.status
      : 500;
  const code = status < 500 || status === 502 || status === 503 ? (error?.code || 'ERROR') : 'INTERNAL_ERROR';
  const message = status < 500 || status === 502 || status === 503 ? (error?.message || 'Request failed') : 'An unexpected error occurred';
  if (status >= 500) {
    logger?.error?.(event, { requestId: req.id, errorType: error?.constructor?.name ?? 'Error' });
  }
  return res.status(status).json({ error: { code, message } });
}

export function createInboxRouter({ inboxService, logger } = {}) {
  const router = express.Router();

  router.get('/messages', async (req, res) => {
    try {
      const result = await inboxService.listMessages({ userId: req.userId, query: req.query });
      return res.status(200).json(result);
    } catch (error) {
      return sendRouteError(req, res, error, logger, 'inbox_list_failed');
    }
  });

  router.get('/messages/summary', async (req, res) => {
    try {
      const result = await inboxService.getInboxSummary({ userId: req.userId });
      return res.status(200).json(result);
    } catch (error) {
      return sendRouteError(req, res, error, logger, 'inbox_summary_failed');
    }
  });

  router.get('/messages/templates', async (req, res) => {
    try {
      const result = await inboxService.listTemplates({ userId: req.userId });
      return res.status(200).json(result);
    } catch (error) {
      return sendRouteError(req, res, error, logger, 'inbox_templates_list_failed');
    }
  });

  router.post('/messages/templates', async (req, res) => {
    try {
      const result = await inboxService.saveTemplate({ userId: req.userId, input: req.body });
      return res.status(201).json(result);
    } catch (error) {
      return sendRouteError(req, res, error, logger, 'inbox_templates_save_failed');
    }
  });

  router.delete('/messages/templates/:templateId', async (req, res) => {
    try {
      const result = await inboxService.deleteTemplate({ userId: req.userId, templateId: req.params.templateId });
      return res.status(200).json(result);
    } catch (error) {
      return sendRouteError(req, res, error, logger, 'inbox_templates_delete_failed');
    }
  });

  router.post('/messages/bulk-status', async (req, res) => {
    try {
      const result = await inboxService.bulkUpdateStatus({
        userId: req.userId,
        ids: req.body?.ids,
        status: req.body?.status,
      });
      return res.status(200).json(result);
    } catch (error) {
      return sendRouteError(req, res, error, logger, 'inbox_bulk_status_failed');
    }
  });

  router.get('/messages/:id', async (req, res) => {
    try {
      const result = await inboxService.getMessageById({ userId: req.userId, id: req.params.id });
      return res.status(200).json(result);
    } catch (error) {
      return sendRouteError(req, res, error, logger, 'inbox_get_failed');
    }
  });

  router.patch('/messages/:id/status', async (req, res) => {
    try {
      const result = await inboxService.updateMessageStatus({ userId: req.userId, id: req.params.id, status: req.body?.status });
      return res.status(200).json(result);
    } catch (error) {
      return sendRouteError(req, res, error, logger, 'inbox_status_failed');
    }
  });

  router.patch('/messages/:id/meta', async (req, res) => {
    try {
      const result = await inboxService.updateMessageMeta({ userId: req.userId, id: req.params.id, input: req.body });
      return res.status(200).json(result);
    } catch (error) {
      return sendRouteError(req, res, error, logger, 'inbox_meta_failed');
    }
  });

  router.post('/messages/:id/reply', async (req, res) => {
    try {
      const result = await inboxService.replyToMessage({ userId: req.userId, id: req.params.id, input: req.body });
      return res.status(200).json(result);
    } catch (error) {
      return sendRouteError(req, res, error, logger, 'inbox_reply_failed');
    }
  });

  router.post('/messages/:id/reply-retry', async (req, res) => {
    try {
      const result = await inboxService.retryReplyDelivery({
        userId: req.userId,
        id: req.params.id,
        replyId: req.body?.replyId,
      });
      return res.status(200).json(result);
    } catch (error) {
      return sendRouteError(req, res, error, logger, 'inbox_reply_retry_failed');
    }
  });

  router.post('/messages/:id/notes', async (req, res) => {
    try {
      const result = await inboxService.addInternalNote({ userId: req.userId, id: req.params.id, note: req.body?.note });
      return res.status(201).json(result);
    } catch (error) {
      return sendRouteError(req, res, error, logger, 'inbox_note_failed');
    }
  });

  return router;
}
