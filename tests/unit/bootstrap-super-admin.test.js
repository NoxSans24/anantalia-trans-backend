import assert from 'node:assert/strict';
import test from 'node:test';
import { bootstrapSuperAdmin, normalizeEmail, normalizeUsername } from '../../scripts/bootstrap-super-admin.js';

test('normalizeEmail and normalizeUsername trim and lowercase inputs', () => {
  assert.equal(normalizeEmail('  SuperAdmin@Example.COM  '), 'superadmin@example.com');
  assert.equal(normalizeUsername('  Super_Admin-99  '), 'super_admin-99');
  assert.equal(normalizeEmail(null), '');
  assert.equal(normalizeUsername(undefined), '');
});

test('bootstrapSuperAdmin rejects invalid inputs before touching database', async () => {
  const dummyPrisma = {};
  const dummyHash = async () => 'hashed';

  await assert.rejects(
    bootstrapSuperAdmin({ prisma: null, hashPassword: dummyHash }),
    { message: 'Prisma client and hashPassword function are required' }
  );

  await assert.rejects(
    bootstrapSuperAdmin({ prisma: dummyPrisma, hashPassword: dummyHash, email: 'not-an-email', username: 'admin', password: 'password123' }),
    { message: 'Valid email address is required' }
  );

  await assert.rejects(
    bootstrapSuperAdmin({ prisma: dummyPrisma, hashPassword: dummyHash, email: 'admin@example.com', username: 'a!', password: 'password123' }),
    { message: 'Valid username is required (3-64 chars, alphanumeric, dash, underscore)' }
  );

  await assert.rejects(
    bootstrapSuperAdmin({ prisma: dummyPrisma, hashPassword: dummyHash, email: 'admin@example.com', username: 'admin', password: 'short' }),
    { message: 'Password must be at least 8 characters long' }
  );
});

test('bootstrapSuperAdmin creates user and assigns SUPER_ADMIN role idempotently', async () => {
  const users = [];
  const roles = [{ id: 'role-sa-id', code: 'SUPER_ADMIN' }];
  const userRoles = [];
  const auditLogs = [];

  const tx = {
    role: {
      async findUnique({ where }) {
        return roles.find((r) => r.code === where.code) ?? null;
      },
      async create({ data }) {
        const role = { id: `role-${data.code}`, code: data.code };
        roles.push(role);
        return role;
      },
    },
    user: {
      async create({ data }) {
        const user = { id: 'u-1', ...data, roles: [] };
        users.push(user);
        return user;
      },
    },
    userRole: {
      async create({ data }) {
        userRoles.push(data);
        return data;
      },
    },
  };

  const prisma = {
    user: {
      async findUnique({ where }) {
        return users.find((u) => (where.email && u.email === where.email) || (where.username && u.username === where.username)) ?? null;
      },
    },
    async $transaction(cb) {
      return cb(tx);
    },
  };

  const activityLog = {
    async log(entry) {
      auditLogs.push(entry);
    },
  };

  const result = await bootstrapSuperAdmin({
    prisma,
    hashPassword: async (p) => `hash:${p}`,
    email: 'Boss@Anantalia.com',
    username: 'Super_Boss',
    displayName: 'The Boss',
    password: 'supersecretpassword',
    activityLog,
  });

  assert.equal(result.status, 'BOOTSTRAP_SUCCESS');
  assert.equal(result.email, 'boss@anantalia.com');
  assert.equal(result.username, 'super_boss');
  assert.equal(users.length, 1);
  assert.equal(users[0].passwordHash, 'hash:supersecretpassword');
  assert.equal(userRoles.length, 1);
  assert.equal(userRoles[0].userId, 'u-1');
  assert.equal(auditLogs.length, 1);
  assert.equal(auditLogs[0].action, 'SUPER_ADMIN_BOOTSTRAPPED');

  // Second run: existing user already has SUPER_ADMIN role -> returns ALREADY_EXISTS
  users[0].roles = [{ role: { code: 'SUPER_ADMIN' } }];
  const idempotentResult = await bootstrapSuperAdmin({
    prisma,
    hashPassword: async (p) => `hash:${p}`,
    email: 'boss@anantalia.com',
    username: 'super_boss',
    password: 'supersecretpassword',
  });

  assert.equal(idempotentResult.status, 'ALREADY_EXISTS');
  assert.equal(idempotentResult.userId, 'u-1');
});
