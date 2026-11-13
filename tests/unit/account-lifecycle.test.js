import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createAccountLifecycleService } from '../../src/auth/account-lifecycle-service.js';

function setup({ revokeError, updateError, secondAdmin = true } = {}) {
  const userId = randomUUID();
  const otherId = randomUUID();
  const users = new Map([
    [userId, { id: userId, status: 'ACTIVE', deletedAt: null, roles: ['SUPER_ADMIN'] }],
    [otherId, { id: otherId, status: 'ACTIVE', deletedAt: null, roles: secondAdmin ? ['SUPER_ADMIN'] : [] }],
  ]);
  const sessions = [
    { userId, revokedAt: null }, { userId, revokedAt: null }, { userId: otherId, revokedAt: null },
  ];
  const prisma = { async $transaction(fn) {
    const userSnapshot = structuredClone(users);
    const sessionSnapshot = structuredClone(sessions);
    try { return await fn({ users, sessions, async $queryRaw(parts, userId) {
      if (parts.join('').includes('FOR UPDATE')) return [];
      const active = [...users.values()].filter((user) => user.status === 'ACTIVE' && user.deletedAt === null && user.roles?.includes('SUPER_ADMIN'));
      return [{ targetIsSuperAdmin: users.get(userId)?.roles?.includes('SUPER_ADMIN') ?? false, activeSuperAdminCount: active.length }];
    } }); }
    catch (error) {
      users.clear();
      for (const [id, user] of userSnapshot) users.set(id, user);
      sessions.splice(0, sessions.length, ...sessionSnapshot);
      throw error;
    }
  } };
  const userRepository = {
    async findLifecycleState(id, tx) { return tx.users.get(id) ?? null; },
    async updateLifecycle({ userId: id, expectedStatus, expectedDeletedAt, data, client }) {
      if (updateError) throw updateError;
      const user = client.users.get(id);
      if (!user || user.status !== expectedStatus || user.deletedAt !== expectedDeletedAt) return { count: 0 };
      Object.assign(user, data);
      return { count: 1 };
    },
    async lockAndCountActiveSuperAdmins(id, client) {
      await client.$queryRaw`SELECT "id" FROM "Role" WHERE "code" = 'SUPER_ADMIN' FOR UPDATE`;
      const [row] = await client.$queryRaw`SELECT ${id} AS target`;
      return row;
    },
  };
  const sessionRepository = { async revokeAllUserSessions({ userId: id, now, transactionClient }) {
    if (revokeError) throw revokeError;
    let count = 0;
    for (const row of transactionClient.sessions) if (row.userId === id && row.revokedAt === null) {
      row.revokedAt = now;
      count++;
    }
    return { count };
  } };
  return {
    service: createAccountLifecycleService({ prisma, userRepository, sessionRepository, clock: () => new Date('2026-01-01T00:00:00Z') }),
    userId, otherId, users, sessions,
  };
}

for (const status of ['SUSPENDED', 'DISABLED']) {
  test(`${status} atomically revokes all and only this user's active sessions`, async () => {
    const h = setup();
    assert.deepEqual(await h.service.setStatus(h.userId, status), { status: 'ACCOUNT_UPDATED' });
    assert.equal(h.users.get(h.userId).status, status);
    assert.ok(h.sessions.slice(0, 2).every(({ revokedAt }) => revokedAt instanceof Date));
    assert.equal(h.sessions[2].revokedAt, null);
  });
}

test('soft delete atomically revokes sessions; repeat is idempotent', async () => {
  const h = setup();
  assert.deepEqual(await h.service.softDelete(h.userId), { status: 'ACCOUNT_UPDATED' });
  const deletedAt = h.users.get(h.userId).deletedAt;
  assert.ok(deletedAt instanceof Date);
  assert.deepEqual(await h.service.softDelete(h.userId), { status: 'ACCOUNT_UPDATED' });
  assert.equal(h.users.get(h.userId).deletedAt, deletedAt);
  assert.ok(h.sessions.slice(0, 2).every(({ revokedAt }) => revokedAt instanceof Date));
});

test('activation and reactivation never un-revoke existing sessions', async () => {
  for (const startingStatus of ['ACTIVE', 'SUSPENDED', 'DISABLED']) {
    const h = setup();
    h.users.get(h.userId).status = startingStatus;
    h.sessions[0].revokedAt = new Date('2025-12-31T00:00:00Z');
    assert.deepEqual(await h.service.setStatus(h.userId, 'ACTIVE'), { status: 'ACCOUNT_UPDATED' });
    assert.equal(h.users.get(h.userId).status, 'ACTIVE');
    assert.ok(h.sessions[0].revokedAt instanceof Date);
    assert.equal(h.sessions[1].revokedAt, null);
  }
});

test('update failure prevents session revocation', async () => {
  const h = setup({ updateError: new Error('database detail') });
  await assert.rejects(h.service.setStatus(h.userId, 'DISABLED'));
  assert.equal(h.users.get(h.userId).status, 'ACTIVE');
  assert.ok(h.sessions.every(({ revokedAt }) => revokedAt === null));
});

test('revoke failure rolls back the user update', async () => {
  const h = setup({ revokeError: new Error('database detail') });
  await assert.rejects(h.service.setStatus(h.userId, 'SUSPENDED'));
  assert.equal(h.users.get(h.userId).status, 'ACTIVE');
  assert.ok(h.sessions.every(({ revokedAt }) => revokedAt === null));
});

test('repeated status changes are safe and idempotent', async () => {
  const h = setup();
  await h.service.setStatus(h.userId, 'DISABLED');
  const revokedAt = h.sessions[0].revokedAt;
  assert.deepEqual(await h.service.setStatus(h.userId, 'DISABLED'), { status: 'ACCOUNT_UPDATED' });
  assert.equal(h.sessions[0].revokedAt, revokedAt);
});

test('missing users and invalid requests do not expose account details', async () => {
  const h = setup();
  assert.deepEqual(await h.service.setStatus(randomUUID(), 'SUSPENDED'), { status: 'ACCOUNT_NOT_FOUND' });
  assert.deepEqual(await h.service.setStatus(h.userId, 'UNKNOWN'), { status: 'INVALID_ACCOUNT_LIFECYCLE_REQUEST' });
  assert.deepEqual(await h.service.softDelete('not-an-id'), { status: 'INVALID_ACCOUNT_LIFECYCLE_REQUEST' });
  assert.equal(JSON.stringify(h.users).includes('passwordHash'), false);
});

test('soft-deleted accounts cannot be reactivated by changing status', async () => {
  const h = setup();
  await h.service.softDelete(h.userId);
  assert.deepEqual(await h.service.setStatus(h.userId, 'ACTIVE'), { status: 'ACCOUNT_NOT_FOUND' });
  assert.equal(h.users.get(h.userId).status, 'ACTIVE');
});

test('the last active SUPER_ADMIN cannot be suspended, disabled, or soft-deleted', async () => {
  for (const action of [
    (service, id) => service.setStatus(id, 'SUSPENDED'),
    (service, id) => service.setStatus(id, 'DISABLED'),
    (service, id) => service.softDelete(id),
  ]) {
    const h = setup({ secondAdmin: false });
    assert.deepEqual(await action(h.service, h.userId), { status: 'ACCOUNT_LIFECYCLE_DENIED' });
    assert.equal(h.users.get(h.userId).status, 'ACTIVE');
    assert.equal(h.users.get(h.userId).deletedAt, null);
    assert.ok(h.sessions.every(({ revokedAt }) => revokedAt === null));
  }
});
