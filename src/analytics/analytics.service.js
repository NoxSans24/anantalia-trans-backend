export function createAnalyticsService({ repository, authorizationService } = {}) {
  async function assertPermission(userId, permission) {
    if (authorizationService) {
      const allowed = await authorizationService.hasPermission(userId, permission);
      if (!allowed) {
        const err = new Error('Permission denied');
        err.code = 'FORBIDDEN';
        err.status = 403;
        throw err;
      }
    }
  }

  return {
    async getOverview({ userId, range = '30d' } = {}) {
      await assertPermission(userId, 'ANALYTICS_VIEW');
      if (repository?.getOverview) {
        return repository.getOverview({ range });
      }

      return {
        range,
        metrics: {
          totalBookings: 0,
          confirmedBookings: 0,
          fleetUtilizationRate: 0,
          averageDurationDays: 0,
        },
        traffic: {
          pageViews: 0,
          uniqueVisitors: 0,
        },
        notice: 'Metrik analytics operasional penuh menunggu konfirmasi sumber telemetry dan kebijakan privasi (Q-AUTH-006 / Q-WA-003 blocker).',
      };
    },

    async exportReport({ userId, format = 'json' } = {}) {
      await assertPermission(userId, 'ANALYTICS_EXPORT');
      if (repository?.exportReport) {
        return repository.exportReport({ format });
      }

      return {
        format,
        exportedAt: new Date().toISOString(),
        data: [],
      };
    },
  };
}
