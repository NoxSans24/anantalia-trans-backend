import { randomUUID } from 'node:crypto';

const rentalTypes = new Set(['self_drive', 'with_driver']);
const unitStatuses = new Set(['available', 'in_use', 'maintenance', 'inactive']);
const maintenanceStatuses = new Set(['scheduled', 'in_progress', 'completed', 'cancelled']);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function computeServiceState(nextServiceDate) {
  if (!nextServiceDate || !isoDatePattern.test(nextServiceDate)) return 'none';
  const today = new Date().toISOString().slice(0, 10);
  if (nextServiceDate < today) return 'overdue';
  const soonDate = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  if (nextServiceDate <= soonDate) return 'due_soon';
  return 'scheduled';
}

function reject(status) { throw Object.freeze({ status }); }
function trim(value, max) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function validateSlug(value) {
  const slug = trim(value, 100);
  if (slug.length < 1 || !slugPattern.test(slug)) reject('INVALID_INPUT');
  return slug;
}
function validateName(value) {
  const name = trim(value, 150);
  if (!name) reject('INVALID_INPUT');
  return name;
}
function validateDescription(value) {
  if (value !== null && typeof value !== 'string') reject('INVALID_INPUT');
  if (typeof value === 'string' && value.length > 2000) reject('INVALID_INPUT');
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function validateSpecs(value) {
  if (value !== null && (typeof value !== 'object' || Array.isArray(value))) reject('INVALID_INPUT');
  if (value && Buffer.byteLength(JSON.stringify(value), 'utf8') > 5000) reject('INVALID_INPUT');
  return value;
}
function changed(keys) { return { changedFields: keys }; }

export function createFleetService({ repository, authorizationService, activityLog, settingsRepository } = {}) {
  if (!repository || !authorizationService || !activityLog) throw new TypeError('All fleet service dependencies are required');
  const requirePermission = (actor, permission) => authorizationService.requirePermission(actor, permission);
  let fallbackUnits = [];

  async function loadUnits() {
    if (settingsRepository?.get) {
      const raw = await settingsRepository.get('fleet_units_registry').catch(() => null);
      if (typeof raw === 'string') {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) return parsed;
        } catch {}
      } else if (Array.isArray(raw)) {
        return raw;
      }
    }
    return fallbackUnits;
  }

  async function saveUnits(units) {
    fallbackUnits = units;
    if (settingsRepository?.set) {
      await settingsRepository.set('fleet_units_registry', JSON.stringify(units));
    }
  }

  async function listCategories({ actor, q = '', includeInactive = false, limit = 25, offset = 0 }) {
    await requirePermission(actor, 'FLEET_VIEW');
    const where = { ...(includeInactive ? {} : { isActive: true }), ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { slug: { contains: q, mode: 'insensitive' } }] } : {}) };
    const [items, total] = await Promise.all([repository.category.list(where, limit, offset), repository.category.count(where)]);
    return { items, page: { limit, offset, total } };
  }

  async function getCategory({ actor, id }) {
    await requirePermission(actor, 'FLEET_VIEW');
    return repository.category.get(id);
  }

  async function createCategory({ actor, input }) {
    await requirePermission(actor, 'FLEET_CREATE');
    const data = {
      slug: validateSlug(input.slug), name: validateName(input.name),
      description: input.description === undefined ? null : validateDescription(input.description),
      sortOrder: input.sortOrder ?? 0,
    };
    if (!Number.isSafeInteger(data.sortOrder) || Math.abs(data.sortOrder) > 100000) reject('INVALID_INPUT');
    return repository.transaction(async (tx) => {
      const item = await tx.category.create(data);
      await activityLog.log({ actor, action: 'FLEET_CATEGORY_CREATED', resourceType: 'VehicleCategory', resourceId: item.id, details: { slug: item.slug }, client: tx });
      return item;
    });
  }

  async function updateCategory({ actor, id, input }) {
    await requirePermission(actor, 'FLEET_UPDATE');
    const data = {};
    for (const key of Object.keys(input)) {
      if (key === 'slug') data.slug = validateSlug(input.slug);
      else if (key === 'name') data.name = validateName(input.name);
      else if (key === 'description') data.description = validateDescription(input.description);
      else if (key === 'sortOrder' && Number.isSafeInteger(input.sortOrder) && Math.abs(input.sortOrder) <= 100000) data.sortOrder = input.sortOrder;
      else if (key === 'isActive' && typeof input.isActive === 'boolean') data.isActive = input.isActive;
      else reject('INVALID_INPUT');
    }
    if (!Object.keys(data).length) reject('INVALID_INPUT');
    return repository.transaction(async (tx) => {
      const item = await tx.category.update(id, data);
      await activityLog.log({ actor, action: 'FLEET_CATEGORY_UPDATED', resourceType: 'VehicleCategory', resourceId: id, details: changed(Object.keys(data)), client: tx });
      return item;
    });
  }

  async function deactivateCategory({ actor, id }) {
    await requirePermission(actor, 'FLEET_DELETE');
    return repository.transaction(async (tx) => {
      const item = await tx.category.update(id, { isActive: false });
      await activityLog.log({ actor, action: 'FLEET_CATEGORY_DEACTIVATED', resourceType: 'VehicleCategory', resourceId: id, client: tx });
      return item;
    });
  }

  async function listModels({ actor, q = '', categoryId, isActive, isVerified, includeInactive = false, limit = 25, offset = 0 }) {
    await requirePermission(actor, 'FLEET_VIEW');
    const where = {
      ...(includeInactive ? {} : { isActive: true }),
      ...(categoryId ? { categoryId } : {}),
      ...(isActive === undefined ? {} : { isActive }),
      ...(isVerified === undefined ? {} : { isVerified }),
      ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { slug: { contains: q, mode: 'insensitive' } }] } : {}),
    };
    const [items, total] = await Promise.all([repository.model.list(where, limit, offset), repository.model.count(where)]);
    return { items, page: { limit, offset, total } };
  }

  async function getModel({ actor, id }) {
    await requirePermission(actor, 'FLEET_VIEW');
    return repository.model.get(id);
  }

  async function createModel({ actor, input }) {
    await requirePermission(actor, 'FLEET_CREATE');
    if (!uuidPattern.test(input.categoryId ?? '')) reject('INVALID_INPUT');
    const data = {
      categoryId: input.categoryId, slug: validateSlug(input.slug), name: validateName(input.name),
      description: input.description === undefined ? null : validateDescription(input.description),
      seatCount: input.seatCount ?? null,
      ...(input.publicSpecs === undefined ? {} : { publicSpecs: validateSpecs(input.publicSpecs) }),
    };
    if (data.seatCount !== null && (!Number.isSafeInteger(data.seatCount) || data.seatCount < 1 || data.seatCount > 200)) reject('INVALID_INPUT');
    return repository.transaction(async (tx) => {
      const category = await tx.category.get(data.categoryId);
      if (!category || !category.isActive) reject('CATEGORY_NOT_FOUND');
      const item = await tx.model.create(data);
      await tx.model.createOptions(item.id);
      await activityLog.log({ actor, action: 'FLEET_MODEL_CREATED', resourceType: 'VehicleModel', resourceId: item.id, details: { categoryId: item.categoryId, slug: item.slug }, client: tx });
      return { ...item, rentalOptions: [{ rentalType: 'self_drive', isEnabled: false }, { rentalType: 'with_driver', isEnabled: false }] };
    });
  }

  async function updateModel({ actor, id, input }) {
    await requirePermission(actor, 'FLEET_UPDATE');
    const data = {};
    for (const key of Object.keys(input)) {
      if (key === 'categoryId' && uuidPattern.test(input.categoryId)) data.categoryId = input.categoryId;
      else if (key === 'slug') data.slug = validateSlug(input.slug);
      else if (key === 'name') data.name = validateName(input.name);
      else if (key === 'description') data.description = validateDescription(input.description);
      else if (key === 'seatCount' && (input.seatCount === null || (Number.isSafeInteger(input.seatCount) && input.seatCount >= 1 && input.seatCount <= 200))) data.seatCount = input.seatCount;
      else if (key === 'publicSpecs') data.publicSpecs = validateSpecs(input.publicSpecs);
      else if (key === 'isActive' && typeof input.isActive === 'boolean') data.isActive = input.isActive;
      else if (key === 'isVerified' && typeof input.isVerified === 'boolean') data.isVerified = input.isVerified;
      else reject('INVALID_INPUT');
    }
    if (!Object.keys(data).length) reject('INVALID_INPUT');
    if (Object.hasOwn(data, 'isVerified')) await requirePermission(actor, 'FLEET_APPROVE');
    return repository.transaction(async (tx) => {
      if (data.categoryId) {
        const category = await tx.category.get(data.categoryId);
        if (!category || !category.isActive) reject('CATEGORY_NOT_FOUND');
      }
      const item = await tx.model.update(id, data);
      await activityLog.log({ actor, action: data.isVerified === undefined ? 'FLEET_MODEL_UPDATED' : 'FLEET_MODEL_VERIFICATION_CHANGED', resourceType: 'VehicleModel', resourceId: id, details: changed(Object.keys(data)), client: tx });
      return item;
    });
  }

  async function deactivateModel({ actor, id }) {
    await requirePermission(actor, 'FLEET_DELETE');
    return repository.transaction(async (tx) => {
      const item = await tx.model.update(id, { isActive: false });
      await activityLog.log({ actor, action: 'FLEET_MODEL_DEACTIVATED', resourceType: 'VehicleModel', resourceId: id, client: tx });
      return item;
    });
  }

  async function listRentalOptions({ actor, modelId }) {
    await requirePermission(actor, 'FLEET_VIEW');
    const model = await repository.model.get(modelId);
    if (!model) return null;
    const byType = new Map(model.rentalOptions.map((item) => [item.rentalType, item]));
    return [...rentalTypes].map((rentalType) => byType.get(rentalType) ?? { modelId, rentalType, isEnabled: false, updatedAt: null });
  }

  async function setRentalOption({ actor, modelId, rentalType, isEnabled }) {
    if (!rentalTypes.has(rentalType) || typeof isEnabled !== 'boolean') reject('INVALID_INPUT');
    await requirePermission(actor, isEnabled ? 'FLEET_APPROVE' : 'FLEET_UPDATE');
    return repository.transaction(async (tx) => {
      const model = await tx.model.get(modelId);
      if (!model || model.isActive !== true) reject('MODEL_NOT_FOUND');
      if (isEnabled && !model.category.isActive) reject('CATEGORY_NOT_FOUND');
      const item = await tx.rentalOption.upsert(modelId, rentalType, { isEnabled, updatedById: actor });
      await activityLog.log({ actor, action: isEnabled ? 'FLEET_RENTAL_OPTION_ENABLED' : 'FLEET_RENTAL_OPTION_DISABLED', resourceType: 'VehicleModel', resourceId: modelId, details: { rentalType }, client: tx });
      return item;
    });
  }

  const publicWhere = (categoryId, rentalType) => ({ categoryId, isActive: true, isVerified: true, category: { isActive: true }, rentalOptions: { some: { rentalType, isEnabled: true } } });
  async function getPublicRentalTypes() {
    const items = await repository.public.rentalTypes();
    return { items: items.map(({ rentalType }) => ({ code: rentalType, label: rentalType === 'self_drive' ? 'Lepas Kunci' : 'Dengan Sopir' })) };
  }
  async function getPublicCategories(rentalType) {
    if (!rentalTypes.has(rentalType)) reject('INVALID_INPUT');
    return { items: await repository.public.categories(rentalType) };
  }
  async function getPublicModels({ categoryId, rentalType, limit = 25, offset = 0 }) {
    if (!uuidPattern.test(categoryId ?? '') || !rentalTypes.has(rentalType)) reject('INVALID_INPUT');
    const where = publicWhere(categoryId, rentalType);
    const [records, total] = await Promise.all([repository.public.models(where, limit, offset), repository.public.modelCount(where)]);
    return { items: records.map(({ rentalOptions, ...model }) => ({ ...model, rentalType: rentalOptions[0]?.rentalType })), page: { limit, offset, total } };
  }

  async function findModelForPublicBooking({ modelId, categoryId, rentalType } = {}) {
    if (!uuidPattern.test(categoryId ?? '') || !uuidPattern.test(modelId ?? '') || !rentalTypes.has(rentalType)) {
      return null;
    }
    const where = { ...publicWhere(categoryId, rentalType), id: modelId };
    const records = await repository.public.models(where, 1, 0);
    return records[0] ?? null;
  }

  async function listVehicleUnits({ actor, modelId, status, q = '', serviceDue, limit = 25, offset = 0 } = {}) {
    await requirePermission(actor, 'FLEET_VIEW');
    const safeLimit = Math.min(Math.max(Number(limit) || 25, 1), 100);
    const safeOffset = Math.max(Number(offset) || 0, 0);
    const needle = typeof q === 'string' ? q.trim() : '';

    if (repository.unit) {
      const today = new Date().toISOString().slice(0, 10);
      const soonDate = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
      const where = {
        ...(modelId ? { modelId } : {}),
        ...(status && status !== 'all' ? { status } : {}),
        ...(needle
          ? {
              OR: [
                { plateNumber: { contains: needle, mode: 'insensitive' } },
                { notes: { contains: needle, mode: 'insensitive' } },
                { model: { name: { contains: needle, mode: 'insensitive' } } },
              ],
            }
          : {}),
        ...(serviceDue === 'overdue'
          ? { nextServiceDate: { lt: today } }
          : serviceDue === 'due_soon'
            ? { nextServiceDate: { gte: today, lte: soonDate } }
            : {}),
      };

      const [rows, total, allForSummary] = await Promise.all([
        repository.unit.list(where, safeLimit, safeOffset),
        repository.unit.count(where),
        repository.unit.list({}, 500, 0),
      ]);
      const items = rows.map((u) => ({ ...u, serviceAlert: computeServiceState(u.nextServiceDate) }));
      const summary = {
        total: allForSummary.length,
        available: allForSummary.filter((u) => u.status === 'available').length,
        in_use: allForSummary.filter((u) => u.status === 'in_use').length,
        maintenance: allForSummary.filter((u) => u.status === 'maintenance').length,
        inactive: allForSummary.filter((u) => u.status === 'inactive').length,
        overdue: allForSummary.filter((u) => u.status !== 'inactive' && computeServiceState(u.nextServiceDate) === 'overdue').length,
        dueSoon: allForSummary.filter((u) => u.status !== 'inactive' && computeServiceState(u.nextServiceDate) === 'due_soon').length,
      };
      return { items, summary, page: { limit: safeLimit, offset: safeOffset, total } };
    }

    const units = await loadUnits();
    const filtered = units.filter((u) => {
      if (modelId && u.modelId !== modelId) return false;
      if (status && status !== 'all' && u.status !== status) return false;
      if (needle && !`${u.plateNumber || ''} ${u.notes || ''}`.toLowerCase().includes(needle.toLowerCase())) return false;
      if (serviceDue && computeServiceState(u.nextServiceDate) !== serviceDue) return false;
      return true;
    }).map((u) => ({ ...u, serviceAlert: computeServiceState(u.nextServiceDate) }));
    return {
      items: filtered.slice(safeOffset, safeOffset + safeLimit),
      summary: { total: units.length, available: units.filter((u) => u.status === 'available').length, in_use: units.filter((u) => u.status === 'in_use').length, maintenance: units.filter((u) => u.status === 'maintenance').length, inactive: units.filter((u) => u.status === 'inactive').length, overdue: 0, dueSoon: 0 },
      page: { limit: safeLimit, offset: safeOffset, total: filtered.length },
    };
  }

  async function getVehicleUnit({ actor, id } = {}) {
    await requirePermission(actor, 'FLEET_VIEW');
    if (!uuidPattern.test(id ?? '')) reject('INVALID_INPUT');
    if (repository.unit) {
      const unit = await repository.unit.get(id);
      return unit ? { ...unit, serviceAlert: computeServiceState(unit.nextServiceDate) } : null;
    }
    const units = await loadUnits();
    const found = units.find((u) => u.id === id);
    return found ? { ...found, maintenances: [], bookingAssignments: [], serviceAlert: computeServiceState(found.nextServiceDate) } : null;
  }

  async function createVehicleUnit({ actor, input = {} } = {}) {
    await requirePermission(actor, 'FLEET_CREATE');
    const modelId = trim(input.modelId, 64);
    const plateNumber = trim(input.plateNumber, 24).toUpperCase().replace(/\s+/g, ' ');
    const year = Number(input.year ?? new Date().getFullYear());
    const status = input.status ?? 'available';
    const odometerKm = input.odometerKm !== undefined && input.odometerKm !== null && input.odometerKm !== '' ? Number(input.odometerKm) : null;
    const nextServiceDate = input.nextServiceDate ? trim(input.nextServiceDate, 10) : null;
    const lastServiceDate = input.lastServiceDate ? trim(input.lastServiceDate, 10) : null;
    const notes = input.notes ? trim(input.notes, 500) : null;

    if (!uuidPattern.test(modelId) || plateNumber.length < 3 || !Number.isSafeInteger(year) || year < 1990 || year > 2035 || !unitStatuses.has(status)) {
      reject('INVALID_INPUT');
    }
    if (odometerKm !== null && (!Number.isSafeInteger(odometerKm) || odometerKm < 0)) reject('INVALID_INPUT');
    if ((nextServiceDate && !isoDatePattern.test(nextServiceDate)) || (lastServiceDate && !isoDatePattern.test(lastServiceDate))) {
      reject('INVALID_INPUT');
    }

    if (repository.unit) {
      return repository.transaction(async (tx) => {
        const model = await tx.model.get(modelId);
        if (!model) reject('MODEL_NOT_FOUND');
        const dup = await tx.unit.findByPlate(plateNumber);
        if (dup) reject('DUPLICATE_PLATE');
        const item = await tx.unit.create({
          id: randomUUID(),
          modelId,
          plateNumber,
          year,
          status,
          odometerKm,
          lastServiceDate,
          nextServiceDate,
          notes,
          isActive: status !== 'inactive',
        });
        await activityLog.log({ actor, action: 'FLEET_UNIT_CREATED', resourceType: 'VehicleUnit', resourceId: item.id, details: { modelId, plateNumber, status }, client: tx }).catch(() => {});
        return { ...item, serviceAlert: computeServiceState(item.nextServiceDate) };
      });
    }

    const model = await repository.model.get(modelId);
    if (!model) reject('MODEL_NOT_FOUND');
    const units = await loadUnits();
    if (units.some((u) => u.plateNumber.toUpperCase() === plateNumber)) reject('DUPLICATE_PLATE');
    const now = new Date().toISOString();
    const item = { id: randomUUID(), modelId, plateNumber, year, status, odometerKm, lastServiceDate, nextServiceDate, notes, version: 1, isActive: status !== 'inactive', createdAt: now, updatedAt: now };
    await saveUnits([item, ...units]);
    await activityLog.log({ actor, action: 'FLEET_UNIT_CREATED', resourceType: 'VehicleUnit', resourceId: item.id, details: { modelId, plateNumber, status } }).catch(() => {});
    return item;
  }

  async function updateVehicleUnit({ actor, id, input = {} } = {}) {
    await requirePermission(actor, 'FLEET_UPDATE');
    if (repository.unit) {
      return repository.transaction(async (tx) => {
        const current = await tx.unit.get(id);
        if (!current) reject('UNIT_NOT_FOUND');
        const plateNumber = input.plateNumber !== undefined ? trim(input.plateNumber, 24).toUpperCase().replace(/\s+/g, ' ') : current.plateNumber;
        const year = input.year !== undefined ? Number(input.year) : current.year;
        const status = input.status !== undefined ? input.status : current.status;
        const odometerKm = input.odometerKm !== undefined ? (input.odometerKm === null || input.odometerKm === '' ? null : Number(input.odometerKm)) : current.odometerKm;
        const nextServiceDate = input.nextServiceDate !== undefined ? (input.nextServiceDate ? trim(input.nextServiceDate, 10) : null) : current.nextServiceDate;
        const lastServiceDate = input.lastServiceDate !== undefined ? (input.lastServiceDate ? trim(input.lastServiceDate, 10) : null) : current.lastServiceDate;
        const notes = input.notes !== undefined ? (input.notes ? trim(input.notes, 500) : null) : current.notes;

        if (plateNumber.length < 3 || !Number.isSafeInteger(year) || year < 1990 || year > 2035 || !unitStatuses.has(status)) reject('INVALID_INPUT');
        if (odometerKm !== null && (!Number.isSafeInteger(odometerKm) || odometerKm < 0)) reject('INVALID_INPUT');
        if ((nextServiceDate && !isoDatePattern.test(nextServiceDate)) || (lastServiceDate && !isoDatePattern.test(lastServiceDate))) reject('INVALID_INPUT');

        if (plateNumber !== current.plateNumber) {
          const dup = await tx.unit.findByPlate(plateNumber);
          if (dup && dup.id !== id) reject('DUPLICATE_PLATE');
        }

        const expectedVersion = input.version !== undefined ? Number(input.version) : undefined;
        const updated = await tx.unit.update(
          id,
          { plateNumber, year, status, odometerKm, lastServiceDate, nextServiceDate, notes, isActive: status !== 'inactive' },
          expectedVersion,
        );
        if (!updated) reject('CONCURRENCY_CONFLICT');
        await activityLog.log({ actor, action: 'FLEET_UNIT_UPDATED', resourceType: 'VehicleUnit', resourceId: id, details: { plateNumber, status }, client: tx }).catch(() => {});
        return { ...updated, serviceAlert: computeServiceState(updated.nextServiceDate) };
      });
    }

    const units = await loadUnits();
    const index = units.findIndex((u) => u.id === id);
    if (index === -1) reject('UNIT_NOT_FOUND');
    const current = units[index];
    const plateNumber = input.plateNumber !== undefined ? trim(input.plateNumber, 24).toUpperCase().replace(/\s+/g, ' ') : current.plateNumber;
    const year = input.year !== undefined ? Number(input.year) : current.year;
    const status = input.status !== undefined ? input.status : current.status;
    const nextServiceDate = input.nextServiceDate !== undefined ? (input.nextServiceDate ? trim(input.nextServiceDate, 10) : null) : current.nextServiceDate;
    const lastServiceDate = input.lastServiceDate !== undefined ? (input.lastServiceDate ? trim(input.lastServiceDate, 10) : null) : current.lastServiceDate;
    const notes = input.notes !== undefined ? (input.notes ? trim(input.notes, 500) : null) : current.notes;
    if (plateNumber.length < 3 || !Number.isSafeInteger(year) || year < 1990 || year > 2035 || !unitStatuses.has(status)) reject('INVALID_INPUT');
    if ((nextServiceDate && !isoDatePattern.test(nextServiceDate)) || (lastServiceDate && !isoDatePattern.test(lastServiceDate))) reject('INVALID_INPUT');
    if (units.some((u) => u.id !== id && u.plateNumber.toUpperCase() === plateNumber)) reject('DUPLICATE_PLATE');
    const updated = { ...current, plateNumber, year, status, lastServiceDate, nextServiceDate, notes, updatedAt: new Date().toISOString() };
    const nextUnits = [...units];
    nextUnits[index] = updated;
    await saveUnits(nextUnits);
    return updated;
  }

  async function deleteVehicleUnit({ actor, id } = {}) {
    await requirePermission(actor, 'FLEET_DELETE');
    if (repository.unit) {
      return repository.transaction(async (tx) => {
        const existing = await tx.unit.get(id);
        if (!existing) reject('UNIT_NOT_FOUND');
        const hasHist = await tx.unit.hasHistory(id);
        if (hasHist) {
          const deactivated = await tx.unit.update(id, { status: 'inactive', isActive: false });
          await activityLog.log({ actor, action: 'FLEET_UNIT_DEACTIVATED', resourceType: 'VehicleUnit', resourceId: id, details: { plateNumber: existing.plateNumber, reason: 'HAS_HISTORY' }, client: tx }).catch(() => {});
          return { deleted: false, deactivated: true, item: deactivated };
        }
        await tx.unit.delete(id);
        await activityLog.log({ actor, action: 'FLEET_UNIT_DELETED', resourceType: 'VehicleUnit', resourceId: id, details: { plateNumber: existing.plateNumber }, client: tx }).catch(() => {});
        return { deleted: true, deactivated: false };
      });
    }
    const units = await loadUnits();
    const existing = units.find((u) => u.id === id);
    if (!existing) reject('UNIT_NOT_FOUND');
    await saveUnits(units.filter((u) => u.id !== id));
    return { deleted: true, deactivated: false };
  }

  async function listUnitMaintenances({ actor, unitId } = {}) {
    await requirePermission(actor, 'FLEET_VIEW');
    if (!uuidPattern.test(unitId ?? '')) reject('INVALID_INPUT');
    if (!repository.maintenance) return { items: [] };
    const unit = await repository.unit.get(unitId);
    if (!unit) reject('UNIT_NOT_FOUND');
    const items = await repository.maintenance.listByUnit(unitId);
    return { items };
  }

  async function createUnitMaintenance({ actor, unitId, input = {} } = {}) {
    await requirePermission(actor, 'FLEET_UPDATE');
    if (!uuidPattern.test(unitId ?? '') || !repository.maintenance) reject('INVALID_INPUT');
    const serviceType = trim(input.serviceType, 100);
    const serviceDate = trim(input.serviceDate, 10);
    const status = input.status ?? 'scheduled';
    const costAmount = input.costAmount !== undefined ? Number(input.costAmount) : 0;
    const odometerKm = input.odometerKm !== undefined && input.odometerKm !== null && input.odometerKm !== '' ? Number(input.odometerKm) : null;
    const notes = input.notes ? trim(input.notes, 1000) : null;
    const nextServiceDate = input.nextServiceDate ? trim(input.nextServiceDate, 10) : null;

    if (!serviceType || !isoDatePattern.test(serviceDate) || !maintenanceStatuses.has(status)) reject('INVALID_INPUT');
    if (!Number.isSafeInteger(costAmount) || costAmount < 0) reject('INVALID_INPUT');
    if (odometerKm !== null && (!Number.isSafeInteger(odometerKm) || odometerKm < 0)) reject('INVALID_INPUT');
    if (nextServiceDate && !isoDatePattern.test(nextServiceDate)) reject('INVALID_INPUT');

    return repository.transaction(async (tx) => {
      const unit = await tx.unit.get(unitId);
      if (!unit) reject('UNIT_NOT_FOUND');
      const item = await tx.maintenance.create({
        id: randomUUID(),
        unitId,
        serviceType,
        serviceDate,
        odometerKm,
        costAmount,
        status,
        notes,
      });
      const unitPatch = {};
      if (status === 'completed') {
        unitPatch.lastServiceDate = serviceDate;
        if (odometerKm !== null) unitPatch.odometerKm = odometerKm;
      }
      if (nextServiceDate) unitPatch.nextServiceDate = nextServiceDate;
      if (Object.keys(unitPatch).length > 0) {
        await tx.unit.update(unitId, unitPatch);
      }
      await activityLog.log({ actor, action: 'FLEET_MAINTENANCE_CREATED', resourceType: 'VehicleMaintenance', resourceId: item.id, details: { unitId, serviceType, serviceDate, status, costAmount }, client: tx }).catch(() => {});
      return item;
    });
  }

  async function updateUnitMaintenance({ actor, unitId, maintenanceId, input = {} } = {}) {
    await requirePermission(actor, 'FLEET_UPDATE');
    if (!uuidPattern.test(unitId ?? '') || !uuidPattern.test(maintenanceId ?? '') || !repository.maintenance) reject('INVALID_INPUT');
    return repository.transaction(async (tx) => {
      const existing = await tx.maintenance.get(maintenanceId);
      if (!existing || existing.unitId !== unitId) reject('MAINTENANCE_NOT_FOUND');
      const serviceType = input.serviceType !== undefined ? trim(input.serviceType, 100) : existing.serviceType;
      const serviceDate = input.serviceDate !== undefined ? trim(input.serviceDate, 10) : existing.serviceDate;
      const status = input.status !== undefined ? input.status : existing.status;
      const costAmount = input.costAmount !== undefined ? Number(input.costAmount) : existing.costAmount;
      const odometerKm = input.odometerKm !== undefined ? (input.odometerKm === null || input.odometerKm === '' ? null : Number(input.odometerKm)) : existing.odometerKm;
      const notes = input.notes !== undefined ? (input.notes ? trim(input.notes, 1000) : null) : existing.notes;
      const nextServiceDate = input.nextServiceDate ? trim(input.nextServiceDate, 10) : null;

      if (!serviceType || !isoDatePattern.test(serviceDate) || !maintenanceStatuses.has(status)) reject('INVALID_INPUT');
      if (!Number.isSafeInteger(costAmount) || costAmount < 0) reject('INVALID_INPUT');
      if (odometerKm !== null && (!Number.isSafeInteger(odometerKm) || odometerKm < 0)) reject('INVALID_INPUT');
      if (nextServiceDate && !isoDatePattern.test(nextServiceDate)) reject('INVALID_INPUT');

      const updated = await tx.maintenance.update(maintenanceId, { serviceType, serviceDate, status, costAmount, odometerKm, notes });
      const unitPatch = {};
      if (status === 'completed' && existing.status !== 'completed') {
        unitPatch.lastServiceDate = serviceDate;
        if (odometerKm !== null) unitPatch.odometerKm = odometerKm;
      }
      if (nextServiceDate) unitPatch.nextServiceDate = nextServiceDate;
      if (Object.keys(unitPatch).length > 0) {
        await tx.unit.update(unitId, unitPatch);
      }
      await activityLog.log({ actor, action: 'FLEET_MAINTENANCE_UPDATED', resourceType: 'VehicleMaintenance', resourceId: maintenanceId, details: { unitId, status }, client: tx }).catch(() => {});
      return updated;
    });
  }

  return Object.freeze({ listCategories, getCategory, createCategory, updateCategory, deactivateCategory, listModels, getModel, createModel, updateModel, deactivateModel, listRentalOptions, setRentalOption, listVehicleUnits, getVehicleUnit, createVehicleUnit, updateVehicleUnit, deleteVehicleUnit, listUnitMaintenances, createUnitMaintenance, updateUnitMaintenance, getPublicRentalTypes, getPublicCategories, getPublicModels, findModelForPublicBooking });
}
