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

export function createPublicContentRouter({ contentService, settingsService, analyticsService, logger } = {}) {
  const router = express.Router();

  router.post('/analytics/pageview', async (req, res) => {
    try {
      if (!analyticsService?.recordPageView) {
        return res.status(202).json({ recorded: false, reason: 'analytics_unavailable' });
      }
      const dntHeader = req.get?.('dnt') === '1' || req.headers?.dnt === '1';
      const result = await analyticsService.recordPageView({
        path: req.body?.path,
        visitorToken: req.body?.visitorToken,
        userAgent: req.get?.('user-agent') || req.headers?.['user-agent'] || '',
        dnt: dntHeader || req.body?.dnt === true,
      });
      return res.status(202).json(result);
    } catch (error) {
      return sendRouteError(req, res, error, logger, 'public_analytics_pageview_failed');
    }
  });

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

  router.get('/content-media/:mediaId', async (req, res) => {
    try {
      const media = await contentService.getPublicMediaById({ mediaId: req.params.mediaId });
      if (media?.redirectUrl) {
        return res.redirect(302, media.redirectUrl);
      }
      res.setHeader('Content-Type', media.mimeType);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'");
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return res.status(200).send(media.buffer);
    } catch (error) {
      return sendRouteError(req, res, error, logger, 'public_content_media_failed');
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
