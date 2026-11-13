import { randomUUID } from 'node:crypto';

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function validatePricingMeta(input = {}, fallback = {}) {
  const validFrom = input.validFrom !== undefined ? (input.validFrom ? String(input.validFrom).trim() : null) : (fallback.validFrom ?? null);
  const validUntil = input.validUntil !== undefined ? (input.validUntil ? String(input.validUntil).trim() : null) : (fallback.validUntil ?? null);
  const discountRaw = input.discountPercent !== undefined ? Number(input.discountPercent || 0) : Number(fallback.discountPercent || 0);
  if ((validFrom && !isoDatePattern.test(validFrom)) || (validUntil && !isoDatePattern.test(validUntil)) || (validFrom && validUntil && validFrom > validUntil)) {
    const err = new Error('Periode berlaku tarif tidak valid (format YYYY-MM-DD dan validFrom <= validUntil)');
    err.code = 'INVALID_INPUT';
    err.status = 400;
    throw err;
  }
  if (!Number.isFinite(discountRaw) || discountRaw < 0 || discountRaw > 95) {
    const err = new Error('Diskon promo harus antara 0% sampai 95%');
    err.code = 'INVALID_INPUT';
    err.status = 400;
    throw err;
  }
  return { validFrom, validUntil, discountPercent: Math.round(discountRaw) };
}

export function createPricingService({ repository, authorizationService, activityLog, settingsRepository } = {}) {
  const localMeta = new Map();

  async function loadMeta(id) {
    if (settingsRepository?.get) {
      const raw = await settingsRepository.get(`pricing_meta:${id}`).catch(() => null);
      if (typeof raw === 'string') {
        try {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') return parsed;
        } catch {}
      } else if (raw && typeof raw === 'object') {
        return raw;
      }
    }
    return localMeta.get(id) ?? { validFrom: null, validUntil: null, discountPercent: 0 };
  }

  async function saveMeta(id, meta) {
    localMeta.set(id, meta);
    if (settingsRepository?.set) {
      await settingsRepository.set(`pricing_meta:${id}`, JSON.stringify(meta)).catch(() => {});
    }
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
    async listPricing({ userId, query = {} } = {}) {
      await assertPermission(userId, 'PRICING_VIEW');
      const limit = Math.min(Math.max(Number(query.limit) || 25, 1), 100);
      const offset = Math.max(Number(query.offset) || 0, 0);

      if (repository?.listPricing) {
        const res = await repository.listPricing({ ...query, limit, offset });
        const items = await Promise.all((res.items || []).map(async (item) => ({ ...item, ...(await loadMeta(item.id)) })));
        return { ...res, items };
      }
      return { items: [], page: { limit, offset, total: 0 } };
    },

    async getPricingById({ userId, id } = {}) {
      await assertPermission(userId, 'PRICING_VIEW');
      if (repository?.getPricingById) {
        const item = await repository.getPricingById(id);
        if (item) return { item: { ...item, ...(await loadMeta(item.id)) } };
      }
      const err = new Error('Pricing rule not found');
      err.code = 'NOT_FOUND';
      err.status = 404;
      throw err;
    },

    async createPricing({ userId, input } = {}) {
      await assertPermission(userId, 'PRICING_CREATE');
      const { modelId, rentalType, baseRate, currency = 'IDR', billingUnit = 'day', notes } = input ?? {};
      const trimmedModelId = typeof modelId === 'string' ? modelId.trim() : '';
      if (
        !trimmedModelId ||
        !['with_driver', 'self_drive'].includes(rentalType) ||
        !['day', 'trip', 'hour'].includes(billingUnit) ||
        !Number.isSafeInteger(baseRate) ||
        baseRate < 0
      ) {
        const err = new Error('Invalid pricing parameters (modelId, valid rentalType, billingUnit, and non-negative integer baseRate are required)');
        err.code = 'INVALID_INPUT';
        err.status = 400;
        throw err;
      }

      if (repository?.findActiveDuplicatePricing) {
        const conflict = await repository.findActiveDuplicatePricing({
          modelId: trimmedModelId,
          rentalType,
          billingUnit,
        });
        if (conflict) {
          const err = new Error(`Aturan tarif aktif untuk ${trimmedModelId} (${rentalType} / ${billingUnit}) sudah ada.`);
          err.code = 'PRICING_CONFLICT';
          err.status = 409;
          throw err;
        }
      }

      const meta = validatePricingMeta(input);
      const id = randomUUID();
      const pricing = {
        id,
        modelId: trimmedModelId,
        rentalType,
        baseRate,
        currency,
        billingUnit,
        notes: typeof notes === 'string' && notes.trim() ? notes.trim() : null,
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      if (repository?.createPricing) {
        await repository.createPricing(pricing);
      }
      await saveMeta(id, meta);

      if (activityLog?.log) {
        await activityLog.log({
          actor: userId,
          action: 'PRICING_CREATED',
          resourceType: 'Pricing',
          resourceId: id,
          details: { modelId: trimmedModelId, rentalType, billingUnit, baseRate, ...meta },
        }).catch(() => {});
      }

      return { item: { ...pricing, ...meta } };
    },

    async updatePricing({ userId, id, input } = {}) {
      await assertPermission(userId, 'PRICING_UPDATE');
      let existing = null;
      if (repository?.getPricingById) {
        existing = await repository.getPricingById(id);
      }
      if (!existing) {
        const err = new Error('Pricing rule not found');
        err.code = 'NOT_FOUND';
        err.status = 404;
        throw err;
      }

      if (input?.baseRate !== undefined && (!Number.isSafeInteger(input.baseRate) || input.baseRate < 0)) {
        const err = new Error('Invalid baseRate (non-negative integer required)');
        err.code = 'INVALID_INPUT';
        err.status = 400;
        throw err;
      }

      if (input?.billingUnit !== undefined && !['day', 'trip', 'hour'].includes(input.billingUnit)) {
        const err = new Error('Invalid billingUnit (day, trip, or hour required)');
        err.code = 'INVALID_INPUT';
        err.status = 400;
        throw err;
      }

      const nextBillingUnit = typeof input?.billingUnit === 'string' ? input.billingUnit : existing.billingUnit;
      const nextIsActive = typeof input?.isActive === 'boolean' ? input.isActive : existing.isActive;

      if (nextIsActive && repository?.findActiveDuplicatePricing) {
        const conflict = await repository.findActiveDuplicatePricing({
          modelId: existing.modelId,
          rentalType: existing.rentalType,
          billingUnit: nextBillingUnit,
          excludeId: id,
        });
        if (conflict) {
          const err = new Error(`Sudah ada aturan tarif aktif lain untuk ${existing.modelId} (${existing.rentalType} / ${nextBillingUnit}).`);
          err.code = 'PRICING_CONFLICT';
          err.status = 409;
          throw err;
        }
      }

      const prevMeta = await loadMeta(id);
      const nextMeta = validatePricingMeta(input, prevMeta);
      const updated = {
        ...existing,
        baseRate: input?.baseRate !== undefined ? input.baseRate : existing.baseRate,
        billingUnit: nextBillingUnit,
        notes: input?.notes !== undefined ? (typeof input.notes === 'string' && input.notes.trim() ? input.notes.trim() : null) : existing.notes,
        isActive: nextIsActive,
        updatedAt: new Date().toISOString(),
      };

      if (repository?.updatePricing) {
        await repository.updatePricing(updated);
      }
      await saveMeta(id, nextMeta);

      if (activityLog?.log) {
        await activityLog.log({
          actor: userId,
          action: 'PRICING_UPDATED',
          resourceType: 'Pricing',
          resourceId: id,
          details: {
            fromBaseRate: existing.baseRate,
            toBaseRate: updated.baseRate,
            fromActive: existing.isActive,
            toActive: updated.isActive,
            ...nextMeta,
          },
        }).catch(() => {});
      }

      return { item: { ...updated, ...nextMeta } };
    },

    async deletePricing({ userId, id } = {}) {
      await assertPermission(userId, 'PRICING_DELETE');
      let existing = null;
      if (repository?.getPricingById) {
        existing = await repository.getPricingById(id);
      }
      if (!existing) {
        const err = new Error('Pricing rule not found');
        err.code = 'NOT_FOUND';
        err.status = 404;
        throw err;
      }

      if (repository?.deletePricing) {
        await repository.deletePricing(id);
      }

      if (activityLog?.log) {
        await activityLog.log({
          actor: userId,
          action: 'PRICING_DELETED',
          resourceType: 'Pricing',
          resourceId: id,
        }).catch(() => {});
      }

      return { success: true };
    },
  };
}
