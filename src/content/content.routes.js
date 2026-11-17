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

export function createContentRouter({ contentService, logger } = {}) {
  const router = express.Router();

  router.get('/content', async (req, res) => {
    try {
      const result = await contentService.listContent({ userId: req.userId, query: req.query });
      return res.status(200).json(result);
    } catch (error) {
      return sendRouteError(req, res, error, logger, 'content_list_failed');
    }
  });

  router.get('/content/summary', async (req, res) => {
    try {
      const result = await contentService.getContentSummary({ userId: req.userId });
      return res.status(200).json(result);
    } catch (error) {
      return sendRouteError(req, res, error, logger, 'content_summary_failed');
    }
  });

  router.post('/content/bulk-status', async (req, res) => {
    try {
      const result = await contentService.bulkUpdateStatus({
        userId: req.userId,
        ids: req.body?.ids,
        status: req.body?.status,
      });
      return res.status(200).json(result);
    } catch (error) {
      return sendRouteError(req, res, error, logger, 'content_bulk_status_failed');
    }
  });

  router.get('/content/:id', async (req, res) => {
    try {
      const result = await contentService.getContentById({ userId: req.userId, id: req.params.id });
      return res.status(200).json(result);
    } catch (error) {
      return sendRouteError(req, res, error, logger, 'content_get_failed');
    }
  });

  router.get('/content/:id/revisions', async (req, res) => {
    try {
      const result = await contentService.getRevisions({ userId: req.userId, id: req.params.id });
      return res.status(200).json(result);
    } catch (error) {
      return sendRouteError(req, res, error, logger, 'content_revisions_failed');
    }
  });

  router.post('/content/:id/restore', async (req, res) => {
    try {
      const result = await contentService.restoreRevision({
        userId: req.userId,
        id: req.params.id,
        version: req.body?.version,
      });
      return res.status(200).json(result);
    } catch (error) {
      return sendRouteError(req, res, error, logger, 'content_restore_failed');
    }
  });

  router.post('/content/upload-image', async (req, res) => {
    try {
      const result = await contentService.uploadContentImage({ userId: req.userId, input: req.body });
      return res.status(201).json(result);
    } catch (error) {
      return sendRouteError(req, res, error, logger, 'content_upload_image_failed');
    }
  });

  router.post('/content', async (req, res) => {
    try {
      const result = await contentService.createContent({ userId: req.userId, input: req.body });
      return res.status(201).json(result);
    } catch (error) {
      return sendRouteError(req, res, error, logger, 'content_create_failed');
    }
  });

  router.patch('/content/:id', async (req, res) => {
    try {
      const result = await contentService.updateContent({ userId: req.userId, id: req.params.id, input: req.body });
      return res.status(200).json(result);
    } catch (error) {
      return sendRouteError(req, res, error, logger, 'content_update_failed');
    }
  });

  router.delete('/content/:id', async (req, res) => {
    try {
      const result = await contentService.deleteContent({ userId: req.userId, id: req.params.id });
      return res.status(200).json(result);
    } catch (error) {
      return sendRouteError(req, res, error, logger, 'content_delete_failed');
    }
  });

  return router;
}
