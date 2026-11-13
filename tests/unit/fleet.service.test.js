import assert from 'node:assert/strict';
import test from 'node:test';
import { createFleetService } from '../../src/fleet/fleet.service.js';

function fixture({ granted = ['FLEET_VIEW', 'FLEET_CREATE', 'FLEET_UPDATE', 'FLEET_DELETE', 'FLEET_APPROVE'], activeCategory = true } = {}) {
  const calls = [];
  const category = { id: 'category-id', isActive: activeCategory, slug: 'sedan', name: 'Sedan' };
  const repo = {
    transaction: (work) => work(repo),
    category: {
      list: async (...args) => { calls.push(['category.list', ...args]); return []; },
      count: async () => 0,
      get: async () => category,
      create: async (data) => ({ id: 'category-id', ...data }),
      update: async (id, data) => ({ id, ...data }),
    },
    model: {
      list: async (...args) => { calls.push(['model.list', ...args]); return []; },
      count: async () => 0,
      get: async () => ({ id: 'model-id', isActive: true, category, rentalOptions: [] }),
      create: async (data) => ({ id: 'model-id', ...data, category }),
      update: async (id, data) => ({ id, ...data }),
      createOptions: async (id) => calls.push(['createOptions', id]),
    },
    rentalOption: { upsert: async (...args) => ({ modelId: args[0], rentalType: args[1], ...args[2] }) },
    public: {
      rentalTypes: async () => [{ rentalType: 'with_driver' }],
      categories: async (rentalType) => { calls.push(['public.categories', rentalType]); return [{ id: 'category-id', name: 'Sedan' }]; },
      models: async (where) => { calls.push(['public.models', where]); return [{ id: 'model-id', slug: 'x', categoryId: 'category-id', name: 'Model', seatCount: 4, rentalOptions: [{ rentalType: 'with_driver' }] }]; },
      modelCount: async () => 1,
    },
  };
  const authorizationService = { requirePermission: async (_actor, permission) => {
    calls.push(['permission', permission]);
    if (!granted.includes(permission)) throw { status: 'PERMISSION_DENIED' };
  } };
  const activityLog = { log: async (entry) => calls.push(['audit', entry.action, entry.resourceId]) };
  return { service: createFleetService({ repository: repo, authorizationService, activityLog }), calls };
}

test('fleet model creation requires active category and creates both rental capabilities disabled', async () => {
  const { service, calls } = fixture();
  const item = await service.createModel({ actor: 'actor-id', input: { categoryId: '00000000-0000-4000-8000-000000000001', slug: 'toyota-avanza', name: 'Toyota Avanza', seatCount: 7 } });
  assert.equal(item.isVerified, undefined);
  assert.equal(item.rentalOptions.every((option) => option.isEnabled === false), true);
  assert.deepEqual(calls.find(([name]) => name === 'createOptions'), ['createOptions', 'model-id']);
  assert.equal(calls.some((entry) => entry[0] === 'audit' && entry[1] === 'FLEET_MODEL_CREATED'), true);
});

test('public model response contains only active verified catalog allowlist fields', async () => {
  const { service, calls } = fixture();
  const result = await service.getPublicModels({ categoryId: '00000000-0000-4000-8000-000000000001', rentalType: 'with_driver' });
  assert.deepEqual(result.items, [{ id: 'model-id', slug: 'x', categoryId: 'category-id', name: 'Model', seatCount: 4, rentalType: 'with_driver' }]);
  assert.deepEqual(calls.find(([name]) => name === 'public.models')[1], {
    categoryId: '00000000-0000-4000-8000-000000000001', isActive: true, isVerified: true,
    category: { isActive: true }, rentalOptions: { some: { rentalType: 'with_driver', isEnabled: true } },
  });
  assert.deepEqual(await service.getPublicRentalTypes(), { items: [{ code: 'with_driver', label: 'Dengan Sopir' }] });
});

test('verification and enabling a rental option require the approved approval permission', async () => {
  const { service } = fixture({ granted: ['FLEET_UPDATE'] });
  await assert.rejects(service.updateModel({ actor: 'actor-id', id: 'model-id', input: { isVerified: true } }), { status: 'PERMISSION_DENIED' });
  await assert.rejects(service.setRentalOption({ actor: 'actor-id', modelId: 'model-id', rentalType: 'self_drive', isEnabled: true }), { status: 'PERMISSION_DENIED' });
});

test('inactive categories cannot be used to create models', async () => {
  const { service } = fixture({ activeCategory: false });
  await assert.rejects(service.createModel({ actor: 'actor-id', input: { categoryId: '00000000-0000-4000-8000-000000000001', slug: 'new-model', name: 'New Model' } }), { status: 'CATEGORY_NOT_FOUND' });
});

test('category/model writes reject malformed slugs and out-of-range page input', async () => {
  const { service } = fixture();
  await assert.rejects(service.createCategory({ actor: 'actor-id', input: { slug: 'Bad Slug', name: 'Sedan' } }), { status: 'INVALID_INPUT' });
});
