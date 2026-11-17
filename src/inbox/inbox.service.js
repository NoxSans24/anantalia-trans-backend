import { randomUUID } from 'node:crypto';

const VALID_STATUSES = [
  'unread',
  'read',
  'in_progress',
  'waiting_customer',
  'replied',
  'resolved',
  'archived',
  'spam',
];
const VALID_PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const VALID_CATEGORIES = [
  'general',
  'booking',
  'pricing',
  'fleet',
  'complaint',
  'partnership',
  'payment',
  'other',
];

const CATEGORY_ALIASES = Object.freeze({
  pertanyaan: 'general',
  pemesanan: 'booking',
  harga: 'pricing',
  keluhan: 'complaint',
  kerjasama: 'partnership',
});

function normalizeCategory(raw) {
  const key = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  const mapped = CATEGORY_ALIASES[key] || key;
  return VALID_CATEGORIES.includes(mapped) ? mapped : 'general';
}

export function createInboxService({ repository, authorizationService, activityLog, settingsRepository } = {}) {
  const localMetaStore = new Map();
  let localTemplates = [];

  async function readSetting(key, fallbackVal) {
    if (settingsRepository?.getSetting) {
      try {
        const res = await settingsRepository.getSetting(key);
        if (res && typeof res.value === 'string') return JSON.parse(res.value);
      } catch {
        // Fallback to local
      }
    }
    return fallbackVal;
  }

  async function writeSetting(key, value) {
    if (settingsRepository?.upsertSetting) {
      try {
        await settingsRepository.upsertSetting(key, JSON.stringify(value));
      } catch {
        // Ignore if not wired in unit tests
      }
    }
  }

  async function getMeta(id) {
    const fallback = localMetaStore.get(id) || {};
    const stored = await readSetting(`inbox_meta:${id}`, null);
    return stored || fallback;
  }

  async function saveMeta(id, meta) {
    localMetaStore.set(id, meta);
    await writeSetting(`inbox_meta:${id}`, meta);
  }

  async function attachMeta(item) {
    if (!item) return null;
    const meta = await getMeta(item.id);
    return {
      ...item,
      meta: {
        priority: meta.priority || 'normal',
        category: meta.category || 'general',
        labels: Array.isArray(meta.labels) ? meta.labels : [],
        assigneeId: meta.assigneeId || null,
        assigneeName: meta.assigneeName || null,
        starred: Boolean(meta.starred),
        phone: meta.phone || null,
        firstResponseAt: meta.firstResponseAt || null,
        resolvedAt: meta.resolvedAt || null,
        replies: Array.isArray(meta.replies) ? meta.replies : [],
      },
    };
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
    async submitPublicContactMessage({ input } = {}) {
      const { senderName, senderEmail, phone, subject, content, category, website } = input ?? {};
      if (website && String(website).trim().length > 0) {
        const err = new Error('Spam submission rejected');
        err.code = 'SPAM_DETECTED';
        err.status = 400;
        throw err;
      }
      if (!senderName || typeof senderName !== 'string' || !senderName.trim()) {
        const err = new Error('Sender name is required');
        err.code = 'INVALID_INPUT';
        err.status = 400;
        throw err;
      }
      const emailStr = typeof senderEmail === 'string' ? senderEmail.trim().toLowerCase() : '';
      if (!emailStr || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailStr)) {
        const err = new Error('Valid sender email is required');
        err.code = 'INVALID_INPUT';
        err.status = 400;
        throw err;
      }
      if (!content || typeof content !== 'string' || content.trim().length < 5) {
        const err = new Error('Message content (at least 5 characters) is required');
        err.code = 'INVALID_INPUT';
        err.status = 400;
        throw err;
      }

      const id = randomUUID();
      const nowIso = new Date().toISOString();
      const cleanCategory = normalizeCategory(category);
      const initialPriority = cleanCategory === 'complaint' ? 'high' : 'normal';
      const record = {
        id,
        senderName: senderName.trim().slice(0, 150),
        senderEmail: emailStr.slice(0, 254),
        subject: typeof subject === 'string' && subject.trim() ? subject.trim().slice(0, 250) : 'Pertanyaan Website',
        content: content.trim().slice(0, 4000),
        status: 'unread',
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      let saved = record;
      if (repository?.createMessage) {
        saved = await repository.createMessage(record);
      }
      await saveMeta(saved.id, {
        priority: initialPriority,
        category: cleanCategory,
        phone: typeof phone === 'string' && phone.trim() ? phone.trim().slice(0, 30) : null,
        labels: [],
        starred: false,
        replies: [],
      });

      return { item: await attachMeta(saved) };
    },

    async listMessages({ userId, query = {} } = {}) {
      await assertPermission(userId, 'MESSAGE_VIEW');
      const limit = Math.min(Math.max(Number(query.limit) || 25, 1), 100);
      const offset = Math.max(Number(query.offset) || 0, 0);

      if (repository?.listMessages) {
        const result = await repository.listMessages({ ...query, limit, offset });
        let enriched = await Promise.all((result.items || []).map(attachMeta));
        if (query.priority && query.priority !== 'all') {
          enriched = enriched.filter((m) => m.meta.priority === query.priority);
        }
        if (query.category && query.category !== 'all') {
          enriched = enriched.filter((m) => m.meta.category === query.category);
        }
        return { ...result, items: enriched };
      }
      return { items: [], page: { limit, offset, total: 0 } };
    },

    async getInboxSummary({ userId } = {}) {
      await assertPermission(userId, 'MESSAGE_VIEW');
      if (!repository?.listMessages) {
        return {
          total: 0,
          unread: 0,
          needsReply: 0,
          inProgress: 0,
          highPriority: 0,
          resolved: 0,
          archived: 0,
          overdue: 0,
          byCategory: {},
        };
      }
      const { items = [] } = await repository.listMessages({ limit: 500, offset: 0 });
      const enriched = await Promise.all(items.map(attachMeta));
      const slaCutoff = Date.now() - 24 * 60 * 60 * 1000;
      const summary = {
        total: enriched.length,
        unread: 0,
        needsReply: 0,
        inProgress: 0,
        highPriority: 0,
        resolved: 0,
        archived: 0,
        overdue: 0,
        byCategory: {},
      };

      for (const m of enriched) {
        if (m.status === 'unread') summary.unread += 1;
        if (['unread', 'read'].includes(m.status)) summary.needsReply += 1;
        if (['in_progress', 'waiting_customer'].includes(m.status)) summary.inProgress += 1;
        if (['resolved', 'replied'].includes(m.status)) summary.resolved += 1;
        if (m.status === 'archived') summary.archived += 1;
        if (['high', 'urgent'].includes(m.meta.priority) && !['archived', 'resolved', 'spam'].includes(m.status)) {
          summary.highPriority += 1;
        }
        if (['unread', 'read'].includes(m.status) && new Date(m.createdAt).getTime() < slaCutoff) {
          summary.overdue += 1;
        }
        const cat = m.meta.category || 'general';
        summary.byCategory[cat] = (summary.byCategory[cat] || 0) + 1;
      }
      return summary;
    },

    async getMessageById({ userId, id } = {}) {
      await assertPermission(userId, 'MESSAGE_VIEW');
      if (repository?.getMessageById) {
        const item = await repository.getMessageById(id);
        if (item) return { item: await attachMeta(item) };
      }
      const err = new Error('Message not found');
      err.code = 'NOT_FOUND';
      err.status = 404;
      throw err;
    },

    async updateMessageStatus({ userId, id, status } = {}) {
      await assertPermission(userId, 'MESSAGE_UPDATE');
      if (!VALID_STATUSES.includes(status)) {
        const err = new Error('Invalid message status');
        err.code = 'INVALID_INPUT';
        err.status = 400;
        throw err;
      }

      let existing = null;
      if (repository?.getMessageById) {
        existing = await repository.getMessageById(id);
      }
      if (!existing) {
        const err = new Error('Message not found');
        err.code = 'NOT_FOUND';
        err.status = 404;
        throw err;
      }

      const nowIso = new Date().toISOString();
      const updated = { ...existing, status, updatedAt: nowIso };
      if (repository?.updateMessage) {
        await repository.updateMessage(updated);
      }

      if (status === 'resolved') {
        const meta = await getMeta(id);
        await saveMeta(id, { ...meta, resolvedAt: meta.resolvedAt || nowIso });
      }

      if (activityLog?.log) {
        await activityLog.log({
          actor: userId,
          action: 'MESSAGE_STATUS_UPDATED',
          resourceType: 'Message',
          resourceId: id,
          details: { status },
        }).catch(() => {});
      }

      return { item: await attachMeta(updated) };
    },

    async updateMessageMeta({ userId, id, input = {} } = {}) {
      await assertPermission(userId, 'MESSAGE_UPDATE');
      if (repository?.getMessageById) {
        const existing = await repository.getMessageById(id);
        if (!existing) {
          const err = new Error('Message not found');
          err.code = 'NOT_FOUND';
          err.status = 404;
          throw err;
        }
      }
      const current = await getMeta(id);
      const next = { ...current };
      if (input.priority !== undefined) {
        if (!VALID_PRIORITIES.includes(input.priority)) {
          const err = new Error('Invalid priority');
          err.code = 'INVALID_INPUT';
          err.status = 400;
          throw err;
        }
        next.priority = input.priority;
      }
      if (input.category !== undefined) {
        if (!VALID_CATEGORIES.includes(input.category)) {
          const err = new Error('Invalid category');
          err.code = 'INVALID_INPUT';
          err.status = 400;
          throw err;
        }
        next.category = input.category;
      }
      if (Array.isArray(input.labels)) {
        next.labels = input.labels.map((l) => String(l).trim()).filter(Boolean).slice(0, 10);
      }
      if (input.assigneeId !== undefined) next.assigneeId = input.assigneeId || null;
      if (input.assigneeName !== undefined) next.assigneeName = input.assigneeName || null;
      if (input.starred !== undefined) next.starred = Boolean(input.starred);
      if (input.phone !== undefined) next.phone = typeof input.phone === 'string' ? input.phone.trim().slice(0, 30) || null : null;

      await saveMeta(id, next);
      if (activityLog?.log) {
        await activityLog.log({
          actor: userId,
          action: 'MESSAGE_META_UPDATED',
          resourceType: 'Message',
          resourceId: id,
        }).catch(() => {});
      }
      const item = repository?.getMessageById ? await repository.getMessageById(id) : { id };
      return { item: await attachMeta(item) };
    },

    async bulkUpdateStatus({ userId, ids = [], status } = {}) {
      await assertPermission(userId, 'MESSAGE_UPDATE');
      if (!Array.isArray(ids) || ids.length === 0 || !VALID_STATUSES.includes(status)) {
        const err = new Error('Valid ids array and status required');
        err.code = 'INVALID_INPUT';
        err.status = 400;
        throw err;
      }
      const updated = [];
      for (const id of ids.slice(0, 50)) {
        const res = await this.updateMessageStatus({ userId, id, status });
        updated.push(res.item);
      }
      return { updatedCount: updated.length, items: updated };
    },

    async replyToMessage({ userId, id, input = {} } = {}) {
      await assertPermission(userId, 'MESSAGE_UPDATE');
      const existing = repository?.getMessageById ? await repository.getMessageById(id) : null;
      if (!existing) {
        const err = new Error('Message not found');
        err.code = 'NOT_FOUND';
        err.status = 404;
        throw err;
      }
      const subject = typeof input.subject === 'string' && input.subject.trim()
        ? input.subject.trim().slice(0, 250)
        : `Re: ${existing.subject || 'Pertanyaan Anatalia Trans'}`;
      const body = typeof input.body === 'string' ? input.body.trim() : '';
      if (!body) {
        const err = new Error('Reply body is required');
        err.code = 'INVALID_INPUT';
        err.status = 400;
        throw err;
      }

      const webhookUrl = process.env.SMTP_WEBHOOK_URL;
      let deliveryStatus = 'smtp_not_configured';
      let deliveryNote = 'Balasan dicatat di riwayat internal. Layanan email/SMTP belum dikonfigurasi pada server.';

      if (webhookUrl && existing.senderEmail) {
        let parsedWebhook;
        try {
          parsedWebhook = new URL(webhookUrl);
        } catch {
          parsedWebhook = null;
        }
        if (!parsedWebhook || !['http:', 'https:'].includes(parsedWebhook.protocol)) {
          const cfgErr = new Error('Konfigurasi SMTP_WEBHOOK_URL tidak valid (harus http/https)');
          cfgErr.code = 'EMAIL_DELIVERY_FAILED';
          cfgErr.status = 502;
          throw cfgErr;
        }
        try {
          const resp = await fetch(parsedWebhook.toString(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to: existing.senderEmail, subject, text: body, messageId: id }),
            signal: AbortSignal.timeout(5000),
          });
          if (!resp.ok) {
            const err = new Error(`Email gateway returned status ${resp.status}`);
            err.code = 'EMAIL_DELIVERY_FAILED';
            err.status = 502;
            throw err;
          }
          deliveryStatus = 'sent';
          deliveryNote = `Terkirim ke ${existing.senderEmail}`;
        } catch (err) {
          if (err.code === 'EMAIL_DELIVERY_FAILED') throw err;
          const netErr = new Error(err?.name === 'TimeoutError' ? 'Timeout menghubungi layanan pengiriman email (5s)' : 'Gagal menghubungi layanan pengiriman email');
          netErr.code = 'EMAIL_DELIVERY_FAILED';
          netErr.status = 502;
          throw netErr;
        }
      }

      const nowIso = new Date().toISOString();
      const meta = await getMeta(id);
      const replyRecord = {
        id: randomUUID(),
        subject,
        body,
        sentBy: userId || 'admin',
        sentAt: nowIso,
        deliveryStatus,
        deliveryNote,
      };
      await saveMeta(id, {
        ...meta,
        firstResponseAt: meta.firstResponseAt || nowIso,
        replies: [replyRecord, ...(Array.isArray(meta.replies) ? meta.replies : [])].slice(0, 30),
      });

      if (deliveryStatus === 'sent' && repository?.updateMessage) {
        await repository.updateMessage({ ...existing, status: 'replied', updatedAt: nowIso });
      }

      if (activityLog?.log) {
        await activityLog.log({
          actor: userId,
          action: 'MESSAGE_REPLIED',
          resourceType: 'Message',
          resourceId: id,
          details: { deliveryStatus },
        }).catch(() => {});
      }

      const refreshed = repository?.getMessageById ? await repository.getMessageById(id) : existing;
      return {
        item: await attachMeta(refreshed),
        reply: replyRecord,
        emailConfigured: Boolean(webhookUrl),
      };
    },

    async listTemplates({ userId } = {}) {
      await assertPermission(userId, 'MESSAGE_VIEW');
      const stored = await readSetting('inbox_templates', null);
      return { items: Array.isArray(stored) ? stored : localTemplates };
    },

    async saveTemplate({ userId, input = {} } = {}) {
      await assertPermission(userId, 'MESSAGE_UPDATE');
      if (!input.name?.trim() || !input.body?.trim()) {
        const err = new Error('Template name and body are required');
        err.code = 'INVALID_INPUT';
        err.status = 400;
        throw err;
      }
      const existing = (await readSetting('inbox_templates', null)) || localTemplates;
      const entry = {
        id: input.id || randomUUID(),
        name: input.name.trim().slice(0, 120),
        category: VALID_CATEGORIES.includes(input.category) ? input.category : 'general',
        subject: typeof input.subject === 'string' ? input.subject.trim().slice(0, 200) : '',
        body: input.body.trim().slice(0, 3000),
        updatedAt: new Date().toISOString(),
      };
      const next = [entry, ...existing.filter((t) => t.id !== entry.id)];
      localTemplates = next;
      await writeSetting('inbox_templates', next);
      return { item: entry };
    },

    async deleteTemplate({ userId, templateId } = {}) {
      await assertPermission(userId, 'MESSAGE_UPDATE');
      const existing = (await readSetting('inbox_templates', null)) || localTemplates;
      const next = existing.filter((t) => t.id !== templateId);
      localTemplates = next;
      await writeSetting('inbox_templates', next);
      return { success: true };
    },

    async addInternalNote({ userId, id, note } = {}) {
      await assertPermission(userId, 'MESSAGE_UPDATE');
      if (!note || typeof note !== 'string' || note.trim().length === 0) {
        const err = new Error('Note content is required');
        err.code = 'INVALID_INPUT';
        err.status = 400;
        throw err;
      }

      if (repository?.getMessageById) {
        const existing = await repository.getMessageById(id);
        if (!existing) {
          const err = new Error('Message not found');
          err.code = 'NOT_FOUND';
          err.status = 404;
          throw err;
        }
      }

      if (repository?.addNote) {
        const added = await repository.addNote({ messageId: id, note: note.trim(), authorId: userId });
        if (!added) {
          const err = new Error('Message not found');
          err.code = 'NOT_FOUND';
          err.status = 404;
          throw err;
        }
        return added;
      }

      return { success: true, note: note.trim() };
    },
  };
}
