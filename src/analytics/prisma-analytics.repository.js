import { summarizeTrafficMap } from './analytics.service.js';

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
    async recordPageView({ dateIso, cleanPath, visitorHash } = {}) {
      if (typeof prisma.systemSetting?.findUnique !== 'function' || typeof prisma.systemSetting?.upsert !== 'function') {
        return { recorded: false, reason: 'storage_unavailable' };
      }
      const existing = await prisma.systemSetting.findUnique({ where: { key: 'analytics.traffic.daily' } });
      let currentMap = {};
      if (existing?.value) {
        try {
          const parsed = JSON.parse(existing.value);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) currentMap = parsed;
        } catch {
          currentMap = {};
        }
      }
      const bucket = currentMap[dateIso] && typeof currentMap[dateIso] === 'object'
        ? {
            pageViews: Number(currentMap[dateIso].pageViews) || 0,
            visitors: Array.isArray(currentMap[dateIso].visitors) ? [...currentMap[dateIso].visitors] : [],
          }
        : { pageViews: 0, visitors: [] };

      bucket.pageViews += 1;
      if (!bucket.visitors.includes(visitorHash) && bucket.visitors.length < 5000) {
        bucket.visitors.push(visitorHash);
      }

      const pruned = Object.fromEntries(
        Object.entries({ ...currentMap, [dateIso]: bucket })
          .sort(([a], [b]) => a.localeCompare(b))
          .slice(-120),
      );
      await prisma.systemSetting.upsert({
        where: { key: 'analytics.traffic.daily' },
        create: { key: 'analytics.traffic.daily', value: JSON.stringify(pruned) },
        update: { value: JSON.stringify(pruned) },
      });
      return { recorded: true, date: dateIso, path: cleanPath };
    },

    async getOverview({ range = '30d', now = new Date() } = {}) {
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

      let traffic = summarizeTrafficMap({}, range, now);
      let fleetUtilizationRate = 0;
      let notice = 'Tracker halaman publik aktif dan menunggu kunjungan pengunjung nyata (DNT dihormati).';

      if (typeof prisma.systemSetting?.findMany === 'function') {
        try {
          const settingsRows = await prisma.systemSetting.findMany({
            where: { key: { in: ['presentation.mode', 'demo.analytics.traffic', 'analytics.traffic.daily'] } },
          });
          const settingsMap = Object.fromEntries(settingsRows.map((row) => [row.key, row.value]));
          if (settingsMap['analytics.traffic.daily']) {
            const liveMap = JSON.parse(settingsMap['analytics.traffic.daily']);
            traffic = summarizeTrafficMap(liveMap, range, now);
            if (traffic.pageViews > 0) {
              notice = 'Statistik trafik website dihitung dari pelacak halaman publik anonim (tanpa menyimpan IP/PII).';
            }
          }
          if (traffic.pageViews === 0 && settingsMap['presentation.mode'] === 'true' && settingsMap['demo.analytics.traffic']) {
            const rows = JSON.parse(settingsMap['demo.analytics.traffic']);
            if (Array.isArray(rows) && rows.length > 0) {
              const sliceCount = range === '7d' ? 7 : rows.length;
              const selectedRows = rows.slice(-sliceCount);
              traffic = {
                ...traffic,
                uniqueVisitors: selectedRows.reduce((sum, r) => sum + (Number(r.uniqueVisitors) || 0), 0),
                pageViews: selectedRows.reduce((sum, r) => sum + (Number(r.pageViews) || 0), 0),
                trackerStatus: 'presentation_demo',
              };
              fleetUtilizationRate = 56.3;
              notice = '[SIMULASI DEMO PRESENTASI] Seluruh metrik trafik, utilitas unit demo (16 unit), dan statistik di halaman ini bersumber dari dataset presentasi demo (bukan catatan bisnis aktual).';
            }
          }
        } catch {
          // Keep safe defaults if setting is absent or malformed
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
        traffic,
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
