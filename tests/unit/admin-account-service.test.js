import assert from 'node:assert/strict';
import test from 'node:test';
import { createAdminAccountService } from '../../src/auth/admin-account-service.js';

function setup() {
  const roles = new Map(['ADMIN', 'STAFF', 'SUPER_ADMIN'].map((code) => [code, { id: code, code }]));
  const users = new Map();
  const links = [];
  const logs = [];
  const lifecycleCalls = [];
  function hydrate(id) {
    const user = users.get(id);
    return user ? { ...user, roles: links.filter((link) => link.userId === id).map((link) => ({ role: roles.get(link.roleId) })) } : null;
  }
  const prisma = {
    async $transaction(callback) { return callback(tx); },
    user: {
      async findMany() { return [...users.values()]; },
      async findUnique({ where }) { return hydrate(where.id); },
    },
  };
  const tx = {
    user: {
      async findFirst({ where }) { return [...users.values()].find((user) => user.email === where.OR[0].email || user.username === where.OR[1].username) ?? null; },
      async create({ data, select }) {
        const user = { id: `user-${users.size + 1}`, ...data, deletedAt: null };
        users.set(user.id, user);
        return Object.fromEntries(Object.keys(select).map((key) => [key, user[key]]));
      },
      async findUnique({ where }) {
        return hydrate(where.id);
      },
    },
    role: {
      async findMany({ where }) { return where.code.in.map((code) => roles.get(code)).filter(Boolean).map(({ id }) => ({ id })); },
    },
    userRole: {
      async createMany({ data }) { links.push(...data); },
      async deleteMany({ where }) { for (let i = links.length - 1; i >= 0; i--) if (links[i].userId === where.userId) links.splice(i, 1); },
    },
    activityLog: { async create({ data }) { logs.push(data); return data; } },
  };
  const authService = {
    async requirePermission(_actor, permission) { assert.ok(permission); },
    async canManageUser(actor, target) { return actor === 'super-admin' && target !== actor; },
  };
  const activityLog = {
    async log({ client, ...entry }) { return client.activityLog.create({ data: entry }); },
  };
  const accountLifecycleService = {
    async setStatus(userId, status, audit) { lifecycleCalls.push(audit); users.get(userId).status = status; return { status: 'ACCOUNT_UPDATED', userId }; },
    async softDelete(userId, audit) { lifecycleCalls.push(audit); users.get(userId).deletedAt = new Date(); return { status: 'ACCOUNT_UPDATED', userId }; },
  };
  return {
    service: createAdminAccountService({ prisma, authService, activityLog, accountLifecycleService }),
    users, links, logs, lifecycleCalls,
  };
}

test('admin creation normalizes identifiers, assigns only manageable roles, and audits in its transaction', async () => {
  const h = setup();
  const result = await h.service.createAdmin({
    actor: 'super-admin', email: ' Admin@Example.Test ', username: ' NewAdmin ', displayName: ' New Admin ', roles: ['ADMIN'],
  });
  assert.equal(result.email, 'admin@example.test');
  assert.equal(result.username, 'newadmin');
  assert.deepEqual(result.roles.map(({ role }) => role.code), ['ADMIN']);
  assert.equal(h.users.size, 1);
  assert.equal(h.logs[0].action, 'USER_CREATED');
  assert.deepEqual(h.logs[0].details, { roles: ['ADMIN'] });
  assert.equal(JSON.stringify(h.logs).includes('passwordHash'), false);
});

test('admin management cannot create or modify SUPER_ADMIN grants', async () => {
  const h = setup();
  await assert.rejects(h.service.createAdmin({ actor: 'super-admin', email: 'a@example.test', username: 'admin-a', roles: ['SUPER_ADMIN'] }), { status: 'INVALID_ROLE' });
  assert.equal(h.users.size, 0);
});

test('role replacement is transactional and rejects SUPER_ADMIN targets', async () => {
  const h = setup();
  const target = await h.service.createAdmin({ actor: 'super-admin', email: 'a@example.test', username: 'admin-a', roles: ['ADMIN'] });
  const updated = await h.service.updateAdminRole({ actor: 'super-admin', targetUserId: target.id, newRoles: ['STAFF'] });
  assert.deepEqual(updated.roles.map(({ role }) => role.code), ['STAFF']);
  await assert.rejects(h.service.updateAdminRole({ actor: 'super-admin', targetUserId: target.id, newRoles: ['SUPER_ADMIN'] }), { status: 'INVALID_ROLE' });
  assert.equal(h.logs.at(-1).action, 'USER_ROLE_CHANGED');
});

test('account status changes use the lifecycle transaction and audit action', async () => {
  const h = setup();
  const target = await h.service.createAdmin({ actor: 'super-admin', email: 'a@example.test', username: 'admin-a', roles: ['ADMIN'] });
  const result = await h.service.suspendAdmin({ actor: 'super-admin', targetUserId: target.id });
  assert.equal(result.status, 'SUSPENDED');
  assert.equal(h.lifecycleCalls[0].action, 'USER_SUSPENDED');
});
