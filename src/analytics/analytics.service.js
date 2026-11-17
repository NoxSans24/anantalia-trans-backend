import { createHash } from 'node:crypto';

const TRAFFIC_SETTING_KEY = 'analytics.traffic.daily';
const BOT_UA_PATTERN = /bot|crawler|spider|headless|slurp|prerender/i;
const TRAFFIC_DEFINITIONS = Object.freeze({
  pageViews: 'Total pemuatan halaman publik non-bot yang valid pada rentang tanggal aktif (deduplikasi 5 detik).',
  uniqueVisitors: 'Estimasi pengunjung unik terdeduplikasi berdasarkan hash token sesi anonim harian (tanpa menyimpan IP atau PII).',
});

function parseRangeDays(range) {
  if (range === '7d') return 7;
  if (range === '90d') return 90;
  return 30;
}

export function normalizePublicPath(rawPath) {
  if (typeof rawPath !== 'string') return null;
  const trimmed = rawPath.trim();
  if (!trimmed.startsWith('/')) return null;
  const clean = trimmed.split(/[?#]/)[0].trim().slice(0, 120);
  return clean || '/';
}

export function summarizeTrafficMap(dailyMap = {}, range = '30d', now = new Date()) {
  const days = parseRangeDays(range);
  const cutoffIso = new Date(now.getTime() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  let pageViews = 0;
  const uniqueSet = new Set();

  for (const [dateIso, entry] of Object.entries(dailyMap || {})) {
    if (dateIso < cutoffIso || !entry || typeof entry !== 'object') continue;
    pageViews += Number(entry.pageViews) || 0;
    if (Array.isArray(entry.visitors)) {
      for (const v of entry.visitors) uniqueSet.add(v);
    }
  }

  return {
    pageViews,
    uniqueVisitors: uniqueSet.size,
    trackerStatus: pageViews > 0 ? 'active_receiving' : 'active_waiting_traffic',
    definitions: TRAFFIC_DEFINITIONS,
  };
}

export function createAnalyticsService({ repository, authorizationService, settingsRepository } = {}) {
  const localTrafficStore = new Map();
  const recentHits = new Map();

  async function readDailyTraffic() {
    if (settingsRepository?.get) {
      try {
        const raw = await settingsRepository.get(TRAFFIC_SETTING_KEY);
        if (raw && typeof raw === 'string') {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
        }
      } catch {
        // Fallback to local store
      }
    }
    return Object.fromEntries(localTrafficStore.entries());
  }

  async function writeDailyTraffic(mapObj) {
    const pruned = Object.fromEntries(
      Object.entries(mapObj)
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-120),
    );
    localTrafficStore.clear();
    for (const [k, v] of Object.entries(pruned)) localTrafficStore.set(k, v);
    if (settingsRepository?.set) {
      try {
        await settingsRepository.set(TRAFFIC_SETTING_KEY, JSON.stringify(pruned));
      } catch {
        // Retain in-memory fallback
      }
    }
    return pruned;
  }

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
    async recordPageView({ path: pagePath, visitorToken, userAgent = '', dnt = false, now = new Date() } = {}) {
      if (dnt === true || dnt === '1' || dnt === 'true') {
        return { recorded: false, reason: 'dnt_respected' };
      }
      if (typeof userAgent === 'string' && BOT_UA_PATTERN.test(userAgent)) {
        return { recorded: false, reason: 'bot_ignored' };
      }
      const cleanPath = normalizePublicPath(pagePath);
      if (!cleanPath) {
        const err = new Error('Path halaman tidak valid (harus diawali /)');
        err.code = 'INVALID_INPUT';
        err.status = 400;
        throw err;
      }

      const nowMs = now instanceof Date ? now.getTime() : Date.now();
      const dateIso = new Date(nowMs).toISOString().slice(0, 10);
      const tokenSeed = typeof visitorToken === 'string' && visitorToken.trim()
        ? visitorToken.trim().slice(0, 64)
        : 'anonymous-session';
      const visitorHash = createHash('sha256')
        .update(`${dateIso}:${tokenSeed}`)
        .digest('hex')
        .slice(0, 16);

      const hitKey = `${visitorHash}:${cleanPath}`;
      const lastHitMs = recentHits.get(hitKey);
      if (lastHitMs !== undefined && nowMs - lastHitMs < 5000) {
        return { recorded: false, reason: 'deduplicated' };
      }
      recentHits.set(hitKey, nowMs);
      if (recentHits.size > 1000) {
        const firstKey = recentHits.keys().next().value;
        if (firstKey) recentHits.delete(firstKey);
      }

      if (repository?.recordPageView) {
        return repository.recordPageView({ dateIso, cleanPath, visitorHash });
      }

      const currentMap = await readDailyTraffic();
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
      await writeDailyTraffic({ ...currentMap, [dateIso]: bucket });
      return { recorded: true, date: dateIso, path: cleanPath };
    },

    async getOverview({ userId, range = '30d', now = new Date() } = {}) {
      await assertPermission(userId, 'ANALYTICS_VIEW');
      if (repository?.getOverview) {
        return repository.getOverview({ range, now });
      }

      const dailyMap = await readDailyTraffic();
      const traffic = summarizeTrafficMap(dailyMap, range, now);
      return {
        range,
        metrics: {
          totalBookings: 0,
          confirmedBookings: 0,
          fleetUtilizationRate: 0,
          averageDurationDays: 0,
        },
        traffic,
        notice: traffic.pageViews > 0
          ? 'Statistik trafik website dihitung dari pelacak halaman publik anonim (tanpa menyimpan IP/PII).'
          : 'Tracker halaman publik aktif dan menunggu kunjungan pengunjung nyata (DNT dihormati).',
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
