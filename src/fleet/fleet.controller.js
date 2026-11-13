const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function page(query) {
  const number = (value, fallback, min, max = Number.MAX_SAFE_INTEGER) => {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
  };
  const limit = number(query.limit, 25, 1, 100);
  const offset = number(query.offset, 0, 0);
  return limit === null || offset === null ? null : { limit, offset };
}

function booleanQuery(value) {
  if (value === undefined) return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

function statusFor(error) {
  const status = error?.status ?? error?.code;
  if (status === 'PERMISSION_DENIED') return [403, 'FORBIDDEN'];
  if (status === 'INVALID_INPUT') return [400, 'INVALID_INPUT'];
  if (status === 'CATEGORY_NOT_FOUND' || status === 'MODEL_NOT_FOUND' || status === 'UNIT_NOT_FOUND' || status === 'MAINTENANCE_NOT_FOUND') return [404, 'NOT_FOUND'];
  if (status === 'P2002' || status === 'DUPLICATE_PLATE' || status === 'CONCURRENCY_CONFLICT') return [409, 'CONFLICT'];
  if (status === 'P2025') return [404, 'NOT_FOUND'];
  return [500, 'INTERNAL_ERROR'];
}

export function createFleetController({ fleetService, logger } = {}) {
  if (!fleetService || !logger) throw new TypeError('Fleet controller dependencies required');
  const handle = (work) => async (req, res) => {
    try { return await work(req, res); }
    catch (error) {
      const [status, code] = statusFor(error);
      logger.error('fleet_request_failed', { requestId: req.id, status, errorType: error?.constructor?.name ?? 'Error' });
      return res.status(status).json({ error: { code, message: status === 500 ? 'An unexpected error occurred' : 'The request could not be completed' }, requestId: req.id });
    }
  };
  const authenticated = (req, res) => req.userId ? true : (res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' }, requestId: req.id }), false);
  const validId = (id) => typeof id === 'string' && uuid.test(id);
  const safeQuery = (query) => typeof query.q !== 'string' || query.q.length <= 100 ? query.q?.trim() ?? '' : null;

  return Object.freeze({
    listCategories: handle(async (req, res) => {
      if (!authenticated(req, res)) return;
      const paging = page(req.query); const q = safeQuery(req.query);
      if (!paging || q === null || !['true', 'false', undefined].includes(req.query.includeInactive)) return res.status(400).json({ error: { code: 'INVALID_QUERY' }, requestId: req.id });
      return res.json(await fleetService.listCategories({ actor: req.userId, ...paging, q, includeInactive: req.query.includeInactive === 'true' }));
    }),
    getCategory: handle(async (req, res) => {
      if (!authenticated(req, res)) return;
      if (!validId(req.params.id)) return res.status(400).json({ error: { code: 'INVALID_ID' }, requestId: req.id });
      const item = await fleetService.getCategory({ actor: req.userId, id: req.params.id });
      return item ? res.json({ item }) : res.status(404).json({ error: { code: 'NOT_FOUND' }, requestId: req.id });
    }),
    createCategory: handle(async (req, res) => {
      if (!authenticated(req, res)) return;
      return res.status(201).json({ item: await fleetService.createCategory({ actor: req.userId, input: req.body }) });
    }),
    updateCategory: handle(async (req, res) => {
      if (!authenticated(req, res)) return;
      if (!validId(req.params.id)) return res.status(400).json({ error: { code: 'INVALID_ID' }, requestId: req.id });
      return res.json({ item: await fleetService.updateCategory({ actor: req.userId, id: req.params.id, input: req.body }) });
    }),
    deactivateCategory: handle(async (req, res) => {
      if (!authenticated(req, res)) return;
      if (!validId(req.params.id)) return res.status(400).json({ error: { code: 'INVALID_ID' }, requestId: req.id });
      await fleetService.deactivateCategory({ actor: req.userId, id: req.params.id });
      return res.status(204).end();
    }),
    listModels: handle(async (req, res) => {
      if (!authenticated(req, res)) return;
      const paging = page(req.query); const q = safeQuery(req.query);
      const isActive = booleanQuery(req.query.isActive); const isVerified = booleanQuery(req.query.isVerified);
      if (!paging || q === null || isActive === null || isVerified === null
        || (req.query.categoryId !== undefined && !validId(req.query.categoryId))
        || !['true', 'false', undefined].includes(req.query.includeInactive)) return res.status(400).json({ error: { code: 'INVALID_QUERY' }, requestId: req.id });
      return res.json(await fleetService.listModels({ actor: req.userId, ...paging, q, isActive, isVerified, categoryId: req.query.categoryId, includeInactive: req.query.includeInactive === 'true' }));
    }),
    getModel: handle(async (req, res) => {
      if (!authenticated(req, res)) return;
      if (!validId(req.params.id)) return res.status(400).json({ error: { code: 'INVALID_ID' }, requestId: req.id });
      const item = await fleetService.getModel({ actor: req.userId, id: req.params.id });
      return item ? res.json({ item }) : res.status(404).json({ error: { code: 'NOT_FOUND' }, requestId: req.id });
    }),
    createModel: handle(async (req, res) => {
      if (!authenticated(req, res)) return;
      return res.status(201).json({ item: await fleetService.createModel({ actor: req.userId, input: req.body }) });
    }),
    updateModel: handle(async (req, res) => {
      if (!authenticated(req, res)) return;
      if (!validId(req.params.id)) return res.status(400).json({ error: { code: 'INVALID_ID' }, requestId: req.id });
      return res.json({ item: await fleetService.updateModel({ actor: req.userId, id: req.params.id, input: req.body }) });
    }),
    deactivateModel: handle(async (req, res) => {
      if (!authenticated(req, res)) return;
      if (!validId(req.params.id)) return res.status(400).json({ error: { code: 'INVALID_ID' }, requestId: req.id });
      await fleetService.deactivateModel({ actor: req.userId, id: req.params.id });
      return res.status(204).end();
    }),
    listRentalOptions: handle(async (req, res) => {
      if (!authenticated(req, res)) return;
      if (!validId(req.params.id)) return res.status(400).json({ error: { code: 'INVALID_ID' }, requestId: req.id });
      const items = await fleetService.listRentalOptions({ actor: req.userId, modelId: req.params.id });
      return items ? res.json({ items }) : res.status(404).json({ error: { code: 'NOT_FOUND' }, requestId: req.id });
    }),
    setRentalOption: handle(async (req, res) => {
      if (!authenticated(req, res)) return;
      if (!validId(req.params.id)) return res.status(400).json({ error: { code: 'INVALID_ID' }, requestId: req.id });
      return res.json({ item: await fleetService.setRentalOption({ actor: req.userId, modelId: req.params.id, rentalType: req.params.rentalType, isEnabled: req.body.isEnabled }) });
    }),
    listVehicleUnits: handle(async (req, res) => {
      if (!authenticated(req, res)) return;
      const paging = page(req.query);
      const q = safeQuery(req.query);
      if (!paging || q === null || (req.query.modelId !== undefined && req.query.modelId !== '' && !validId(req.query.modelId))) {
        return res.status(400).json({ error: { code: 'INVALID_QUERY' }, requestId: req.id });
      }
      return res.json(await fleetService.listVehicleUnits({
        actor: req.userId,
        modelId: req.query.modelId || undefined,
        status: req.query.status,
        serviceDue: req.query.serviceDue,
        q,
        ...paging,
      }));
    }),
    getVehicleUnit: handle(async (req, res) => {
      if (!authenticated(req, res)) return;
      if (!validId(req.params.id)) return res.status(400).json({ error: { code: 'INVALID_ID' }, requestId: req.id });
      const item = await fleetService.getVehicleUnit({ actor: req.userId, id: req.params.id });
      return item ? res.json({ item }) : res.status(404).json({ error: { code: 'NOT_FOUND' }, requestId: req.id });
    }),
    createVehicleUnit: handle(async (req, res) => {
      if (!authenticated(req, res)) return;
      return res.status(201).json({ item: await fleetService.createVehicleUnit({ actor: req.userId, input: req.body }) });
    }),
    updateVehicleUnit: handle(async (req, res) => {
      if (!authenticated(req, res)) return;
      if (!validId(req.params.id)) return res.status(400).json({ error: { code: 'INVALID_ID' }, requestId: req.id });
      return res.json({ item: await fleetService.updateVehicleUnit({ actor: req.userId, id: req.params.id, input: req.body }) });
    }),
    deleteVehicleUnit: handle(async (req, res) => {
      if (!authenticated(req, res)) return;
      if (!validId(req.params.id)) return res.status(400).json({ error: { code: 'INVALID_ID' }, requestId: req.id });
      const result = await fleetService.deleteVehicleUnit({ actor: req.userId, id: req.params.id });
      return result?.deactivated ? res.status(200).json(result) : res.status(204).end();
    }),
    listUnitMaintenances: handle(async (req, res) => {
      if (!authenticated(req, res)) return;
      if (!validId(req.params.id)) return res.status(400).json({ error: { code: 'INVALID_ID' }, requestId: req.id });
      return res.json(await fleetService.listUnitMaintenances({ actor: req.userId, unitId: req.params.id }));
    }),
    createUnitMaintenance: handle(async (req, res) => {
      if (!authenticated(req, res)) return;
      if (!validId(req.params.id)) return res.status(400).json({ error: { code: 'INVALID_ID' }, requestId: req.id });
      return res.status(201).json({ item: await fleetService.createUnitMaintenance({ actor: req.userId, unitId: req.params.id, input: req.body }) });
    }),
    updateUnitMaintenance: handle(async (req, res) => {
      if (!authenticated(req, res)) return;
      if (!validId(req.params.id) || !validId(req.params.maintenanceId)) return res.status(400).json({ error: { code: 'INVALID_ID' }, requestId: req.id });
      return res.json({ item: await fleetService.updateUnitMaintenance({ actor: req.userId, unitId: req.params.id, maintenanceId: req.params.maintenanceId, input: req.body }) });
    }),
    publicRentalTypes: handle(async (_req, res) => res.json(await fleetService.getPublicRentalTypes())),
    publicCategories: handle(async (req, res) => res.json(await fleetService.getPublicCategories(req.query.rentalType))),
    publicModels: handle(async (req, res) => {
      const paging = page(req.query);
      if (!paging) return res.status(400).json({ error: { code: 'INVALID_QUERY' }, requestId: req.id });
      return res.json(await fleetService.getPublicModels({ categoryId: req.query.categoryId, rentalType: req.query.rentalType, ...paging }));
    }),
  });
}
