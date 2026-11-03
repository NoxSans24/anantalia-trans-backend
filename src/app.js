import { randomUUID } from 'node:crypto';
import express from 'express';
import { errorHandler } from './middlewares/error.middleware.js';
import { notFound } from './middlewares/not-found.middleware.js';
import { createHealthRouter } from './routes/health.routes.js';

export function createApp({ prisma, logger }) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    req.id = randomUUID();
    req.log = logger;
    res.setHeader('X-Request-Id', req.id);
    next();
  });
  app.use(express.json({ limit: '100kb' }));
  app.use('/health', createHealthRouter({ prisma, logger }));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
