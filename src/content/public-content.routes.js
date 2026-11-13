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

export function createPublicContentRouter({ contentService, settingsService, logger } = {}) {
  const router = express.Router();

  router.get('/site-config', async (req, res) => {
    try {
      if (!settingsService?.getPublicSiteConfig) {
        return res.status(200).json({ companyName: 'Anantalia Trans', maintenanceMode: false });
      }
      const result = await settingsService.getPublicSiteConfig();
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(result);
    } catch (error) {
      return sendRouteError(req, res, error, logger, 'public_site_config_failed');
    }
  });

  router.get('/content', async (req, res) => {
    try {
      const result = await contentService.listPublicContent({
        section: req.query.section,
        limit: req.query.limit,
      });
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(result);
    } catch (error) {
      return sendRouteError(req, res, error, logger, 'public_content_list_failed');
    }
  });

  router.get('/content/:slug', async (req, res) => {
    try {
      const result = await contentService.getPublicContentBySlug({ slug: req.params.slug });
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(result);
    } catch (error) {
      return sendRouteError(req, res, error, logger, 'public_content_get_failed');
    }
  });

  return router;
}
