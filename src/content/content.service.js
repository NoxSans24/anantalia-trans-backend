import { randomUUID } from 'node:crypto';

const VALID_STATUSES = ['draft', 'scheduled', 'published', 'archived'];

export function sanitizeHtmlBody(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/<(object|embed|style|link|meta|base|form)\b[^>]*>/gi, '')
    .replace(/<\/(object|embed|style|link|meta|base|form)>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*(["'])\s*(?:javascript|vbscript|data:text\/html)[^"']*\2/gi, '$1="#"');
}

export function validateSafeUrl(value, { allowDataImage = false, fieldName = 'URL' } = {}) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') {
    const err = new Error(`${fieldName} must be a string`);
    err.code = 'INVALID_INPUT';
    err.status = 400;
    throw err;
  }
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (allowDataImage && /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(trimmed)) {
    if (trimmed.length > 65000) {
      const err = new Error(`${fieldName} image payload exceeds 65KB limit`);
      err.code = 'INVALID_INPUT';
      err.status = 400;
      throw err;
    }
    return trimmed;
  }

  if (/^(https?:\/\/|\/|#)/i.test(trimmed)) {
    return trimmed;
  }

  const err = new Error(`${fieldName} must start with https://, http://, /, or #`);
  err.code = 'INVALID_INPUT';
  err.status = 400;
  throw err;
}

function normalizeSlug(slug, title) {
  const source = typeof slug === 'string' && slug.trim() ? slug.trim() : '';
  if (!source) return null;
  return source
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || null;
}

function normalizeMeta(inputMeta = {}, existingMeta = {}) {
  const merged = { ...existingMeta };
  const assignStr = (key, max = 500) => {
    if (key in inputMeta) {
      merged[key] = typeof inputMeta[key] === 'string' ? inputMeta[key].trim().slice(0, max) || null : null;
    }
  };

  assignStr('metaTitle', 160);
  assignStr('metaDescription', 320);
  assignStr('altText', 200);
  assignStr('ctaLabel', 80);
  assignStr('promoCode', 60);
  assignStr('authorName', 100);

  if ('canonicalUrl' in inputMeta) merged.canonicalUrl = validateSafeUrl(inputMeta.canonicalUrl, { fieldName: 'canonicalUrl' });
  if ('ctaUrl' in inputMeta) merged.ctaUrl = validateSafeUrl(inputMeta.ctaUrl, { fieldName: 'ctaUrl' });
  if ('imageUrl' in inputMeta) merged.imageUrl = validateSafeUrl(inputMeta.imageUrl, { allowDataImage: true, fieldName: 'imageUrl' });
  if ('mobileImageUrl' in inputMeta) merged.mobileImageUrl = validateSafeUrl(inputMeta.mobileImageUrl, { allowDataImage: true, fieldName: 'mobileImageUrl' });
  if ('ogImage' in inputMeta) merged.ogImage = validateSafeUrl(inputMeta.ogImage, { allowDataImage: true, fieldName: 'ogImage' });

  if ('publishAt' in inputMeta) {
    if (!inputMeta.publishAt) merged.publishAt = null;
    else {
      const d = new Date(inputMeta.publishAt);
      if (Number.isNaN(d.getTime())) {
        const err = new Error('Invalid publishAt timestamp');
        err.code = 'INVALID_INPUT';
        err.status = 400;
        throw err;
      }
      merged.publishAt = d.toISOString();
    }
  }
  if ('expireAt' in inputMeta) {
    if (!inputMeta.expireAt) merged.expireAt = null;
    else {
      const d = new Date(inputMeta.expireAt);
      if (Number.isNaN(d.getTime())) {
        const err = new Error('Invalid expireAt timestamp');
        err.code = 'INVALID_INPUT';
        err.status = 400;
        throw err;
      }
      merged.expireAt = d.toISOString();
    }
  }
  if (merged.publishAt && merged.expireAt && new Date(merged.expireAt) <= new Date(merged.publishAt)) {
    const err = new Error('expireAt must be after publishAt');
    err.code = 'INVALID_INPUT';
    err.status = 400;
    throw err;
  }

  if ('sortOrder' in inputMeta) {
    const num = Number(inputMeta.sortOrder);
    merged.sortOrder = Number.isFinite(num) ? Math.max(0, Math.round(num)) : 0;
  } else if (merged.sortOrder === undefined) {
    merged.sortOrder = 0;
  }

  if ('rating' in inputMeta) {
    const r = Number(inputMeta.rating);
    merged.rating = Number.isFinite(r) && r >= 1 && r <= 5 ? Math.round(r) : null;
  }
  if ('noIndex' in inputMeta) {
    merged.noIndex = Boolean(inputMeta.noIndex);
  }
  return merged;
}

export function isContentCurrentlyLive(item, meta = {}, now = new Date()) {
  if (!item) return false;
  if (meta?.expireAt && new Date(meta.expireAt) <= now) return false;
  if (item.status === 'published') {
    if (meta?.publishAt && new Date(meta.publishAt) > now) return false;
    return true;
  }
  if (item.status === 'scheduled') {
    return Boolean(meta?.publishAt && new Date(meta.publishAt) <= now);
  }
  return false;
}

export function createContentService({ repository, authorizationService, activityLog, settingsRepository } = {}) {
  const localMetaStore = new Map();
  const localRevisionStore = new Map();

  async function readJsonSetting(key, fallback) {
    if (settingsRepository?.getSetting) {
      try {
        const raw = await settingsRepository.getSetting(key);
        if (raw && typeof raw.value === 'string') return JSON.parse(raw.value);
      } catch {
        // Fallback to local store
      }
    }
    return fallback.get(key) ?? null;
  }

  async function writeJsonSetting(key, value, fallback) {
    fallback.set(key, value);
    if (settingsRepository?.upsertSetting) {
      try {
        await settingsRepository.upsertSetting(key, JSON.stringify(value));
      } catch {
        // Fallback retained
      }
    }
  }

  async function getMeta(id) {
    return (await readJsonSetting(`cms_meta:${id}`, localMetaStore)) || {};
  }

  async function saveMeta(id, meta) {
    await writeJsonSetting(`cms_meta:${id}`, meta, localMetaStore);
  }

  async function getRevisionList(id) {
    return (await readJsonSetting(`cms_rev:${id}`, localRevisionStore)) || [];
  }

  async function pushRevision(id, snapshot) {
    const existing = await getRevisionList(id);
    const nextVersion = (existing[0]?.version || 0) + 1;
    const entry = { version: nextVersion, ...snapshot };
    const updated = [entry, ...existing].slice(0, 20);
    await writeJsonSetting(`cms_rev:${id}`, updated, localRevisionStore);
    return entry;
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

  async function assertUniqueSlug(slug, excludeId = null) {
    if (!slug || !repository?.findBySlug) return;
    const conflict = await repository.findBySlug(slug);
    if (conflict && conflict.id !== excludeId) {
      const err = new Error(`Slug "${slug}" sudah digunakan oleh konten lain`);
      err.code = 'CONTENT_SLUG_CONFLICT';
      err.status = 409;
      throw err;
    }
  }

  async function attachMeta(item) {
    if (!item) return null;
    const meta = await getMeta(item.id);
    return { ...item, meta };
  }

  return {
    async listContent({ userId, query = {} } = {}) {
      await assertPermission(userId, 'CONTENT_VIEW');
      const limit = Math.min(Math.max(Number(query.limit) || 25, 1), 100);
      const offset = Math.max(Number(query.offset) || 0, 0);

      if (repository?.listContent) {
        const result = await repository.listContent({ ...query, limit, offset });
        const enriched = await Promise.all((result.items || []).map(attachMeta));
        return { ...result, items: enriched };
      }
      return { items: [], page: { limit, offset, total: 0 } };
    },

    async getContentSummary({ userId } = {}) {
      await assertPermission(userId, 'CONTENT_VIEW');
      if (!repository?.listContent) {
        return {
          total: 0,
          published: 0,
          draft: 0,
          scheduled: 0,
          archived: 0,
          expiringSoon: 0,
          expired: 0,
          lastUpdatedAt: null,
          bySection: {},
        };
      }
      const { items = [] } = await repository.listContent({ limit: 500, offset: 0 });
      const enriched = await Promise.all(items.map(attachMeta));
      const now = new Date();
      const soonCutoff = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      const summary = {
        total: enriched.length,
        published: 0,
        draft: 0,
        scheduled: 0,
        archived: 0,
        expiringSoon: 0,
        expired: 0,
        lastUpdatedAt: null,
        bySection: {},
      };

      for (const item of enriched) {
        if (item.status === 'published') summary.published += 1;
        else if (item.status === 'draft') summary.draft += 1;
        else if (item.status === 'scheduled') summary.scheduled += 1;
        else if (item.status === 'archived') summary.archived += 1;

        const sec = item.section || 'general';
        summary.bySection[sec] = (summary.bySection[sec] || 0) + 1;

        if (!summary.lastUpdatedAt || (item.updatedAt && item.updatedAt > summary.lastUpdatedAt)) {
          summary.lastUpdatedAt = item.updatedAt;
        }
        const exp = item.meta?.expireAt ? new Date(item.meta.expireAt) : null;
        if (exp) {
          if (exp <= now) summary.expired += 1;
          else if (exp <= soonCutoff) summary.expiringSoon += 1;
        }
      }
      return summary;
    },

    async getContentById({ userId, id } = {}) {
      await assertPermission(userId, 'CONTENT_VIEW');
      if (repository?.getContentById) {
        const item = await repository.getContentById(id);
        if (item) return { item: await attachMeta(item) };
      }
      const err = new Error('Content item not found');
      err.code = 'NOT_FOUND';
      err.status = 404;
      throw err;
    },

    async createContent({ userId, input } = {}) {
      await assertPermission(userId, 'CONTENT_CREATE');
      const { title, slug, contentKey, body, section, status = 'draft', meta: rawMeta } = input ?? {};
      if (!title || typeof title !== 'string' || title.trim().length === 0) {
        const err = new Error('Content title is required');
        err.code = 'INVALID_INPUT';
        err.status = 400;
        throw err;
      }

      const normalizedStatus = VALID_STATUSES.includes(status) ? status : 'draft';
      if (normalizedStatus === 'published' || normalizedStatus === 'scheduled') {
        await assertPermission(userId, 'CONTENT_APPROVE');
      }

      const cleanSlug = normalizeSlug(slug, title);
      await assertUniqueSlug(cleanSlug);
      const cleanMeta = normalizeMeta(rawMeta || {});
      const id = randomUUID();
      const nowIso = new Date().toISOString();

      const content = {
        id,
        title: title.trim(),
        slug: cleanSlug,
        contentKey: typeof contentKey === 'string' && contentKey.trim() ? contentKey.trim() : null,
        body: sanitizeHtmlBody(typeof body === 'string' ? body : ''),
        section: typeof section === 'string' && section.trim() ? section.trim() : 'general',
        status: normalizedStatus,
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      if (repository?.createContent) {
        await repository.createContent(content);
      }
      await saveMeta(id, cleanMeta);

      if (activityLog?.log) {
        await activityLog.log({
          actor: userId,
          action: 'CONTENT_CREATED',
          resourceType: 'Content',
          resourceId: id,
        }).catch(() => {});
      }

      return { item: { ...content, meta: cleanMeta } };
    },

    async updateContent({ userId, id, input } = {}) {
      await assertPermission(userId, 'CONTENT_UPDATE');
      let existing = null;
      if (repository?.getContentById) {
        existing = await repository.getContentById(id);
      }
      if (!existing) {
        const err = new Error('Content item not found');
        err.code = 'NOT_FOUND';
        err.status = 404;
        throw err;
      }

      const nextStatus = VALID_STATUSES.includes(input?.status) ? input.status : existing.status;
      if ((nextStatus === 'published' || nextStatus === 'scheduled') && existing.status !== nextStatus) {
        await assertPermission(userId, 'CONTENT_APPROVE');
      }

      const nextSlug = 'slug' in (input || {}) ? normalizeSlug(input.slug, input.title || existing.title) : existing.slug;
      await assertUniqueSlug(nextSlug, id);

      const existingMeta = await getMeta(id);
      const nextMeta = input?.meta ? normalizeMeta(input.meta, existingMeta) : existingMeta;

      await pushRevision(id, {
        title: existing.title,
        slug: existing.slug,
        section: existing.section,
        status: existing.status,
        body: existing.body,
        meta: existingMeta,
        updatedBy: userId || 'system',
        updatedAt: existing.updatedAt || new Date().toISOString(),
        summary: typeof input?.revisionNote === 'string' ? input.revisionNote.trim() : 'Pembaruan konten',
      });

      const updated = {
        ...existing,
        title: typeof input?.title === 'string' && input.title.trim() ? input.title.trim() : existing.title,
        slug: nextSlug,
        body: typeof input?.body === 'string' ? sanitizeHtmlBody(input.body) : existing.body,
        section: typeof input?.section === 'string' && input.section.trim() ? input.section.trim() : existing.section,
        status: nextStatus,
        updatedAt: new Date().toISOString(),
      };

      if (repository?.updateContent) {
        await repository.updateContent(updated);
      }
      if (input?.meta) {
        await saveMeta(id, nextMeta);
      }

      if (activityLog?.log) {
        await activityLog.log({
          actor: userId,
          action: nextStatus !== existing.status && nextStatus === 'published' ? 'CONTENT_PUBLISHED' : 'CONTENT_UPDATED',
          resourceType: 'Content',
          resourceId: id,
        }).catch(() => {});
      }

      return { item: { ...updated, meta: nextMeta } };
    },

    async getRevisions({ userId, id } = {}) {
      await assertPermission(userId, 'CONTENT_VIEW');
      if (repository?.getContentById) {
        const existing = await repository.getContentById(id);
        if (!existing) {
          const err = new Error('Content item not found');
          err.code = 'NOT_FOUND';
          err.status = 404;
          throw err;
        }
      }
      const items = await getRevisionList(id);
      return { items };
    },

    async restoreRevision({ userId, id, version } = {}) {
      await assertPermission(userId, 'CONTENT_UPDATE');
      const revisions = await getRevisionList(id);
      const target = revisions.find((r) => Number(r.version) === Number(version));
      if (!target) {
        const err = new Error('Revision version not found');
        err.code = 'NOT_FOUND';
        err.status = 404;
        throw err;
      }
      if (target.status === 'published' || target.status === 'scheduled') {
        await assertPermission(userId, 'CONTENT_APPROVE');
      }
      const result = await this.updateContent({
        userId,
        id,
        input: {
          title: target.title,
          slug: target.slug,
          section: target.section,
          status: target.status,
          body: target.body,
          meta: target.meta || {},
          revisionNote: `Pemulihan ke versi v${target.version}`,
        },
      });
      if (activityLog?.log) {
        await activityLog.log({
          actor: userId,
          action: 'CONTENT_RESTORED',
          resourceType: 'Content',
          resourceId: id,
          details: { restoredVersion: target.version },
        }).catch(() => {});
      }
      return result;
    },

    async bulkUpdateStatus({ userId, ids = [], status } = {}) {
      await assertPermission(userId, 'CONTENT_UPDATE');
      if (!Array.isArray(ids) || ids.length === 0 || !VALID_STATUSES.includes(status)) {
        const err = new Error('Valid ids array and status are required');
        err.code = 'INVALID_INPUT';
        err.status = 400;
        throw err;
      }
      if (status === 'published' || status === 'scheduled') {
        await assertPermission(userId, 'CONTENT_APPROVE');
      }
      const updated = [];
      for (const id of ids.slice(0, 50)) {
        const res = await this.updateContent({ userId, id, input: { status, revisionNote: `Bulk update status ke ${status}` } });
        updated.push(res.item);
      }
      return { updatedCount: updated.length, items: updated };
    },

    async deleteContent({ userId, id } = {}) {
      await assertPermission(userId, 'CONTENT_DELETE');
      let existing = null;
      if (repository?.getContentById) {
        existing = await repository.getContentById(id);
      }
      if (!existing) {
        const err = new Error('Content item not found');
        err.code = 'NOT_FOUND';
        err.status = 404;
        throw err;
      }

      if (repository?.deleteContent) {
        await repository.deleteContent(id);
      }

      if (activityLog?.log) {
        await activityLog.log({
          actor: userId,
          action: 'CONTENT_DELETED',
          resourceType: 'Content',
          resourceId: id,
        }).catch(() => {});
      }

      return { success: true };
    },

    async listPublicContent({ section, limit = 50 } = {}) {
      if (!repository?.listContent) return { items: [] };
      const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
      const { items = [] } = await repository.listContent({
        ...(section && section !== 'all' ? { section } : {}),
        limit: 200,
        offset: 0,
      });
      const now = new Date();
      const enriched = await Promise.all(items.map(attachMeta));
      const liveItems = enriched
        .filter((item) => isContentCurrentlyLive(item, item.meta, now))
        .map((item) => ({
          id: item.id,
          title: item.title,
          slug: item.slug,
          section: item.section,
          body: sanitizeHtmlBody(item.body),
          meta: item.meta || {},
          updatedAt: item.updatedAt,
        }))
        .sort((a, b) => {
          const orderDiff = (Number(a.meta?.sortOrder) || 0) - (Number(b.meta?.sortOrder) || 0);
          if (orderDiff !== 0) return orderDiff;
          return new Date(b.updatedAt) - new Date(a.updatedAt);
        })
        .slice(0, safeLimit);

      return { items: liveItems };
    },

    async getPublicContentBySlug({ slug } = {}) {
      if (!slug || !repository?.findBySlug) {
        const err = new Error('Content not found');
        err.code = 'NOT_FOUND';
        err.status = 404;
        throw err;
      }
      const raw = await repository.findBySlug(String(slug).trim().toLowerCase());
      const item = await attachMeta(raw);
      if (!item || !isContentCurrentlyLive(item, item.meta, new Date())) {
        const err = new Error('Content not found');
        err.code = 'NOT_FOUND';
        err.status = 404;
        throw err;
      }
      return {
        item: {
          id: item.id,
          title: item.title,
          slug: item.slug,
          section: item.section,
          body: sanitizeHtmlBody(item.body),
          meta: item.meta || {},
          updatedAt: item.updatedAt,
        },
      };
    },
  };
}
