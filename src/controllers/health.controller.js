export function createHealthController({ prisma, logger }) {
  return async function health(req, res) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return res.status(200).json({ status: 'ok', timestamp: new Date().toISOString(), checks: { database: 'ok' } });
    } catch (error) {
      logger.error('health_check_failed', { requestId: req.id, errorType: error?.constructor?.name ?? 'Error' });
      return res.status(503).json({ status: 'unavailable', timestamp: new Date().toISOString(), checks: { database: 'unavailable' }, requestId: req.id });
    }
  };
}
