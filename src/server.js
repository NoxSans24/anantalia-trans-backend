import { createApp } from './app.js';
import { validateEnv } from './config/env.js';
import { logger } from './lib/logger.js';
import { createPrismaClient } from './lib/prisma.js';

const config = validateEnv();
const prisma = createPrismaClient(config.databaseUrl);
const server = createApp({ prisma, logger }).listen(config.port, config.host, () => {
  logger.info('server_started');
});

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('server_stopping');
  server.close(async (error) => {
    try {
      await prisma.$disconnect();
      logger.info('server_stopped');
      if (error) process.exitCode = 1;
    } catch {
      process.exitCode = 1;
    }
  });
  const timeout = setTimeout(() => {
    server.closeAllConnections();
    process.exitCode = 1;
  }, 10_000);
  timeout.unref();
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
