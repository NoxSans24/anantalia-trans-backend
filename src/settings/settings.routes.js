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

export function createSettingsRouter({ settingsService, logger } = {}) {
  const router = express.Router();

  router.get('/settings', async (req, res) => {
    try {
      const result = await settingsService.getAllSettings({ userId: req.userId });
      return res.status(200).json(result);
    } catch (error) {
      return sendRouteError(req, res, error, logger, 'settings_list_failed');
    }
  });

  router.get('/settings/:key', async (req, res) => {
    try {
      const result = await settingsService.getSettingByKey({ userId: req.userId, key: req.params.key });
      return res.status(200).json(result);
    } catch (error) {
      return sendRouteError(req, res, error, logger, 'settings_get_failed');
    }
  });

  router.patch('/settings/:key', async (req, res) => {
    try {
      const result = await settingsService.updateSetting({ userId: req.userId, key: req.params.key, value: req.body?.value });
      return res.status(200).json(result);
    } catch (error) {
      return sendRouteError(req, res, error, logger, 'settings_update_failed');
    }
  });

  router.get('/activity-logs', async (req, res) => {
    try {
      const result = await settingsService.listActivityLogs({
        userId: req.userId,
        action: req.query.action,
        resourceType: req.query.resourceType,
        q: req.query.q,
        limit: req.query.limit,
        offset: req.query.offset,
      });
      return res.status(200).json(result);
    } catch (error) {
      return sendRouteError(req, res, error, logger, 'activity_logs_list_failed');
    }
  });

  router.get('/system/status', async (req, res) => {
    try {
      const result = await settingsService.getSystemStatus({ userId: req.userId });
      return res.status(200).json(result);
    } catch (error) {
      return sendRouteError(req, res, error, logger, 'system_status_failed');
    }
  });

  router.post('/system/test-email', async (req, res) => {
    try {
      const result = await settingsService.testEmailIntegration({ userId: req.userId });
      return res.status(200).json(result);
    } catch (error) {
      return sendRouteError(req, res, error, logger, 'system_test_email_failed');
    }
  });

  router.post('/system/backup-export', async (req, res) => {
    try {
      const result = await settingsService.createConfigBackupSnapshot({ userId: req.userId });
      return res.status(200).json(result);
    } catch (error) {
      return sendRouteError(req, res, error, logger, 'system_backup_export_failed');
    }
  });

  return router;
}
