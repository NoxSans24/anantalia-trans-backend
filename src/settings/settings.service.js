const ALLOWED_SETTING_KEYS = new Set([
  'companyName',
  'address',
  'officePhone',
  'businessHours',
  'currency',
  'defaultTimezone',
  'supportEmail',
  'companyDescription',
  'whatsappNumber',
  'websiteUrl',
  'operatingDays',
  'holidays',
  'dateFormat',
  'timeFormat',
  'websiteTitle',
  'websiteDescription',
  'maintenanceMode',
  'maintenanceMessage',
  'notifyNewMessage',
  'notifyNewBooking',
  'notifyPaymentUpdate',
  'notifyFleetMaintenance',
  'backupSchedule',
  'backupRetentionDays',
]);

const DEFAULT_SETTINGS = Object.freeze({
  companyName: 'Anantalia Trans',
  address: 'Sleman, D.I. Yogyakarta',
  officePhone: '',
  businessHours: '08:00 - 21:00 WIB',
  currency: 'IDR',
  defaultTimezone: 'Asia/Jakarta',
  supportEmail: 'info@anantaliatrans.com',
  companyDescription: 'Layanan sewa bus pariwisata, hiace, dan armada premium Anatalia Trans.',
  whatsappNumber: '6281234567890',
  websiteUrl: 'https://anantaliatrans.com',
  operatingDays: 'Senin - Minggu',
  holidays: 'Menyesuaikan jadwal operasional',
  dateFormat: 'DD/MM/YYYY',
  timeFormat: '24h',
  websiteTitle: 'Anatalia Trans — Sewa Bus Pariwisata & Armada Premium',
  websiteDescription: 'Solusi transportasi pariwisata, korporat, dan perjalanan keluarga terpercaya.',
  maintenanceMode: 'false',
  maintenanceMessage: 'Website sedang dalam pemeliharaan terjadwal. Silakan hubungi WhatsApp resmi kami untuk pemesanan mendesak.',
  notifyNewMessage: 'true',
  notifyNewBooking: 'true',
  notifyPaymentUpdate: 'true',
  notifyFleetMaintenance: 'true',
  backupSchedule: 'manual',
  backupRetentionDays: '30',
});

function sanitizeLogDetails(details) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return details ?? null;
  const clean = {};
  for (const [k, v] of Object.entries(details)) {
    if (/password|token|secret|key|hash/i.test(k)) continue;
    clean[k] = v;
  }
  return clean;
}

export function createSettingsService({ repository, authorizationService, activityLog, prisma } = {}) {
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
    async getAllSettings({ userId } = {}) {
      await assertPermission(userId, 'SETTINGS_VIEW');
      let current = {};
      if (repository?.getAll) {
        const raw = await repository.getAll();
        for (const [k, v] of Object.entries(raw || {})) {
          if (ALLOWED_SETTING_KEYS.has(k)) current[k] = v;
        }
      }
      return {
        settings: { ...DEFAULT_SETTINGS, ...current },
      };
    },

    async getPublicSiteConfig() {
      let current = {};
      if (repository?.getAll) {
        const raw = await repository.getAll();
        for (const [k, v] of Object.entries(raw || {})) {
          if (ALLOWED_SETTING_KEYS.has(k)) current[k] = v;
        }
      }
      const merged = { ...DEFAULT_SETTINGS, ...current };
      return {
        companyName: merged.companyName,
        companyDescription: merged.companyDescription,
        address: merged.address,
        officePhone: merged.officePhone,
        whatsappNumber: merged.whatsappNumber,
        supportEmail: merged.supportEmail,
        businessHours: merged.businessHours,
        operatingDays: merged.operatingDays,
        websiteTitle: merged.websiteTitle,
        websiteDescription: merged.websiteDescription,
        maintenanceMode: merged.maintenanceMode === 'true',
        maintenanceMessage: merged.maintenanceMessage,
      };
    },

    async getSettingByKey({ userId, key } = {}) {
      await assertPermission(userId, 'SETTINGS_VIEW');
      if (!ALLOWED_SETTING_KEYS.has(key)) {
        const err = new Error('Invalid or unallowlisted setting key');
        err.code = 'NOT_FOUND';
        err.status = 404;
        throw err;
      }

      let val = DEFAULT_SETTINGS[key];
      if (repository?.get) {
        const stored = await repository.get(key);
        if (stored !== undefined) val = stored;
      }

      return { key, value: val };
    },

    async updateSetting({ userId, key, value } = {}) {
      await assertPermission(userId, 'SETTINGS_UPDATE');
      if (!ALLOWED_SETTING_KEYS.has(key)) {
        const err = new Error('Invalid or unallowlisted setting key');
        err.code = 'INVALID_INPUT';
        err.status = 400;
        throw err;
      }

      if (typeof value !== 'string') {
        const err = new Error('Setting value must be a string');
        err.code = 'INVALID_INPUT';
        err.status = 400;
        throw err;
      }

      if (repository?.set) {
        await repository.set(key, value.trim());
      }

      if (activityLog?.log) {
        await activityLog.log({
          actor: userId,
          action: 'SETTING_UPDATED',
          resourceType: 'Setting',
          resourceId: null,
          details: { key, value: value.trim() },
        }).catch(() => {});
      }

      return { key, value: value.trim(), updatedAt: new Date().toISOString() };
    },

    async listActivityLogs({ userId, action, resourceType, q, limit = 25, offset = 0 } = {}) {
      await assertPermission(userId, 'SETTINGS_VIEW');
      if (!prisma?.activityLog) {
        return { items: [], page: { total: 0, limit, offset } };
      }
      const safeLimit = Math.min(Math.max(Number(limit) || 25, 1), 100);
      const safeOffset = Math.max(Number(offset) || 0, 0);
      const where = {};
      if (action && action !== 'all') where.action = action;
      if (resourceType && resourceType !== 'all') where.resourceType = resourceType;
      if (q && typeof q === 'string' && q.trim()) {
        const needle = q.trim();
        where.OR = [
          { action: { contains: needle, mode: 'insensitive' } },
          { resourceType: { contains: needle, mode: 'insensitive' } },
          { actor: { contains: needle, mode: 'insensitive' } },
        ];
      }
      const [rows, total] = await Promise.all([
        prisma.activityLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: safeLimit,
          skip: safeOffset,
        }),
        prisma.activityLog.count({ where }),
      ]);
      const actorIds = [...new Set(rows.map((r) => r.actor).filter(Boolean))];
      const users = actorIds.length && prisma.user
        ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, username: true, displayName: true, email: true } })
        : [];
      const userMap = new Map(users.map((u) => [u.id, u]));
      return {
        items: rows.map((row) => {
          const actorUser = userMap.get(row.actor);
          return {
            id: row.id,
            actor: row.actor,
            actorLabel: actorUser ? (actorUser.displayName || actorUser.username || actorUser.email) : row.actor,
            action: row.action,
            resourceType: row.resourceType,
            resourceId: row.resourceId,
            details: sanitizeLogDetails(row.details),
            createdAt: row.createdAt,
          };
        }),
        page: { total, limit: safeLimit, offset: safeOffset },
      };
    },

    async getSystemStatus({ userId } = {}) {
      await assertPermission(userId, 'SETTINGS_VIEW');
      let databaseStatus = 'in_memory';
      if (prisma?.$queryRaw) {
        try {
          await prisma.$queryRaw`SELECT 1`;
          databaseStatus = 'ok';
        } catch {
          databaseStatus = 'unavailable';
        }
      }
      const currentSettings = (await this.getAllSettings({ userId })).settings;
      let lastBackup = null;
      if (repository?.get) {
        const rawBackup = await repository.get('system_last_backup');
        if (rawBackup) {
          try { lastBackup = JSON.parse(rawBackup); } catch { lastBackup = null; }
        }
      }
      const smtpConfigured = Boolean(process.env.SMTP_WEBHOOK_URL);
      return {
        checkedAt: new Date().toISOString(),
        serverTime: new Date().toISOString(),
        appVersion: '1.0.0',
        nodeVersion: process.version,
        database: { status: databaseStatus },
        maintenanceMode: currentSettings.maintenanceMode === 'true',
        lastBackup,
        integrations: [
          {
            id: 'email_smtp_webhook',
            name: 'Layanan Email (SMTP_WEBHOOK_URL)',
            configured: smtpConfigured,
            status: smtpConfigured ? 'configured' : 'not_configured',
            canTest: true,
            note: smtpConfigured
              ? 'SMTP_WEBHOOK_URL terdeteksi. Gunakan tombol Uji Koneksi untuk verifikasi endpoint.'
              : 'SMTP_WEBHOOK_URL belum disetel di environment server; balasan pesan hanya tersimpan di dashboard.',
          },
          {
            id: 'whatsapp_official_link',
            name: 'Tautan WhatsApp Resmi',
            configured: Boolean(currentSettings.whatsappNumber),
            status: currentSettings.whatsappNumber ? 'ready_link' : 'not_configured',
            canTest: false,
            note: 'Menggunakan nomor WhatsApp resmi untuk tautan wa.me publik (bukan WhatsApp Business API otomatis).',
          },
        ],
      };
    },

    async testEmailIntegration({ userId } = {}) {
      await assertPermission(userId, 'SETTINGS_UPDATE');
      const webhookUrl = process.env.SMTP_WEBHOOK_URL;
      const checkedAt = new Date().toISOString();
      if (!webhookUrl) {
        return {
          ok: false,
          configured: false,
          checkedAt,
          message: 'SMTP_WEBHOOK_URL belum dikonfigurasi pada environment server.',
        };
      }
      let parsedWebhook;
      try {
        parsedWebhook = new URL(webhookUrl);
      } catch {
        parsedWebhook = null;
      }
      if (!parsedWebhook || !['http:', 'https:'].includes(parsedWebhook.protocol)) {
        return {
          ok: false,
          configured: true,
          checkedAt,
          message: 'SMTP_WEBHOOK_URL tidak valid (harus URL http atau https).',
        };
      }
      try {
        const res = await fetch(parsedWebhook.toString(), { method: 'HEAD', signal: AbortSignal.timeout(5000) });
        return {
          ok: res.ok,
          configured: true,
          checkedAt,
          statusCode: res.status,
          message: res.ok ? `Endpoint webhook merespons HTTP ${res.status}.` : `Endpoint merespons status HTTP ${res.status}.`,
        };
      } catch (err) {
        return {
          ok: false,
          configured: true,
          checkedAt,
          message: err?.name === 'TimeoutError' ? 'Timeout menghubungi SMTP_WEBHOOK_URL (5s).' : 'Gagal menghubungi endpoint SMTP_WEBHOOK_URL.',
        };
      }
    },

    async createConfigBackupSnapshot({ userId } = {}) {
      await assertPermission(userId, 'SETTINGS_UPDATE');
      const { settings } = await this.getAllSettings({ userId });
      const createdAt = new Date().toISOString();
      const snapshot = {
        format: 'anantalia-config-snapshot-v1',
        createdAt,
        settings,
      };
      const meta = {
        createdAt,
        status: 'success',
        type: 'config_snapshot_json',
        createdBy: userId,
      };
      if (repository?.set) {
        await repository.set('system_last_backup', JSON.stringify(meta));
      }
      if (activityLog?.log) {
        await activityLog.log({
          actor: userId,
          action: 'SYSTEM_BACKUP_EXPORTED',
          resourceType: 'SystemBackup',
          resourceId: null,
          details: { type: 'config_snapshot_json', createdAt },
        }).catch(() => {});
      }
      return { snapshot, meta };
    },
  };
}
