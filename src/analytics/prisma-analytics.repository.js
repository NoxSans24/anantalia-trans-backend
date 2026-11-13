function computeDurationDays(startsOn, endsOn) {
  if (typeof startsOn !== 'string' || typeof endsOn !== 'string') return 0;
  const start = Date.parse(`${startsOn}T00:00:00Z`);
  const end = Date.parse(`${endsOn}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 0;
  return Math.floor((end - start) / 86_400_000) + 1;
}

export function createPrismaAnalyticsRepository(prisma) {
  if (!prisma) throw new TypeError('Prisma client is required');

  return Object.freeze({
    async getOverview({ range = '30d' } = {}) {
      const [totalBookings, confirmedBookings, bookingDates] = await Promise.all([
        prisma.booking.count(),
        prisma.booking.count({ where: { status: { in: ['confirmed', 'completed'] } } }),
        prisma.booking.findMany({
          select: { startsOn: true, endsOn: true },
          take: 500,
          orderBy: { createdAt: 'desc' },
        }),
      ]);

      let averageDurationDays = 0;
      if (bookingDates.length > 0) {
        const sumDays = bookingDates.reduce(
          (acc, row) => acc + computeDurationDays(row.startsOn, row.endsOn),
          0,
        );
        averageDurationDays = Number((sumDays / bookingDates.length).toFixed(1));
      }

      let pageViews = 0;
      let uniqueVisitors = 0;
      let fleetUtilizationRate = 0;
      let notice = 'Metrik analytics operasional penuh menunggu konfirmasi sumber telemetry dan kebijakan privasi (Q-AUTH-006 / Q-WA-003 blocker).';

      if (typeof prisma.systemSetting?.findMany === 'function') {
        try {
          const settingsRows = await prisma.systemSetting.findMany({
            where: { key: { in: ['presentation.mode', 'demo.analytics.traffic'] } },
          });
          const settingsMap = Object.fromEntries(settingsRows.map((row) => [row.key, row.value]));
          if (settingsMap['presentation.mode'] === 'true' && settingsMap['demo.analytics.traffic']) {
            const rows = JSON.parse(settingsMap['demo.analytics.traffic']);
            if (Array.isArray(rows) && rows.length > 0) {
              const sliceCount = range === '7d' ? 7 : rows.length;
              const selectedRows = rows.slice(-sliceCount);
              uniqueVisitors = selectedRows.reduce((sum, r) => sum + (Number(r.uniqueVisitors) || 0), 0);
              pageViews = selectedRows.reduce((sum, r) => sum + (Number(r.pageViews) || 0), 0);
              fleetUtilizationRate = 56.3;
              notice = '[SIMULASI DEMO PRESENTASI] Seluruh metrik trafik, utilitas unit demo (16 unit), dan statistik di halaman ini bersumber dari dataset presentasi demo (bukan catatan bisnis aktual).';
            }
          }
        } catch {
          // Keep safe zero defaults if demo setting is absent or malformed
        }
      }

      return {
        range,
        metrics: {
          totalBookings,
          confirmedBookings,
          fleetUtilizationRate,
          averageDurationDays,
        },
        traffic: {
          pageViews,
          uniqueVisitors,
        },
        notice,
      };
    },

    async exportReport({ format = 'json' } = {}) {
      const rows = await prisma.booking.findMany({
        select: {
          bookingCode: true,
          rentalType: true,
          startsOn: true,
          endsOn: true,
          status: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });

      return {
        format,
        exportedAt: new Date().toISOString(),
        data: rows.map((row) => ({
          ...row,
          createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
        })),
      };
    },
  });
}
