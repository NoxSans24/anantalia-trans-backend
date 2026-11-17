import { randomUUID } from 'node:crypto';
import express from 'express';
import cookieParser from 'cookie-parser';
import { errorHandler } from './middlewares/error.middleware.js';
import { notFound } from './middlewares/not-found.middleware.js';
import { createHealthRouter } from './routes/health.routes.js';

export function createApp({
  prisma,
  logger,
  authRouter,
  adminAccountRouter,
  profileRouter,
  publicFleetRouter,
  adminFleetRouter,
  dashboardRouter,
  publicBookingRouter,
  publicContentRouter,
  publicContactRouter,
  adminBookingRouter,
  customerRouter,
  pricingRouter,
  financeRouter,
  inboxRouter,
  contentRouter,
  analyticsRouter,
  settingsRouter,
  authenticationMiddleware,
  csrfMiddleware,
  trustProxy = 'loopback',
} = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxy);
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    req.id = randomUUID();
    req.log = logger;
    res.setHeader('X-Request-Id', req.id);
    next();
  });
  app.use('/api/v1/admin/content/upload-image', express.json({ limit: '3mb' }));
  app.use('/api/me/meta', express.json({ limit: '500kb' }));
  app.use(express.json({ limit: '100kb' }));
  app.use((req, res, next) => {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) req.body = {};
    next();
  });
  app.use(cookieParser());
  app.use('/health', createHealthRouter({ prisma, logger }));
  if (publicFleetRouter) app.use('/api/v1/public', publicFleetRouter);
  if (publicBookingRouter) app.use('/api/v1/public', publicBookingRouter);
  if (publicContentRouter) app.use('/api/v1/public', publicContentRouter);
  if (publicContactRouter) app.use('/api/v1/public', publicContactRouter);
  if (authRouter) {
    app.use('/auth', authRouter);
  }
  const hasProtectedRouters = adminAccountRouter || profileRouter || adminFleetRouter
    || dashboardRouter || adminBookingRouter || customerRouter || pricingRouter
    || financeRouter || inboxRouter || contentRouter || analyticsRouter || settingsRouter;

  if (authenticationMiddleware && hasProtectedRouters) {
    app.use(authenticationMiddleware);
    if (csrfMiddleware) app.use('/api', csrfMiddleware.middleware, csrfMiddleware.guard);
    if (adminAccountRouter) app.use('/api', adminAccountRouter);
    if (profileRouter) app.use('/api', profileRouter);
    app.use('/api/v1/admin', (req, res, next) => {
      if (!req.userId) {
        return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } });
      }
      return next();
    });
    if (adminFleetRouter) app.use('/api/v1/admin', adminFleetRouter);
    if (dashboardRouter) app.use('/api/v1/admin/dashboard', dashboardRouter);
    if (adminBookingRouter) app.use('/api/v1/admin', adminBookingRouter);
    if (customerRouter) app.use('/api/v1/admin', customerRouter);
    if (pricingRouter) app.use('/api/v1/admin', pricingRouter);
    if (financeRouter) app.use('/api/v1/admin', financeRouter);
    if (inboxRouter) app.use('/api/v1/admin', inboxRouter);
    if (contentRouter) app.use('/api/v1/admin', contentRouter);
    if (analyticsRouter) app.use('/api/v1/admin', analyticsRouter);
    if (settingsRouter) app.use('/api/v1/admin', settingsRouter);
  }
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
