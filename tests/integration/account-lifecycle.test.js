import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createAccountLifecycleService } from '../../src/auth/account-lifecycle-service.js';
import { createPrismaSessionRepository } from '../../src/auth/prisma-session.repository.js';
import { createPrismaUserRepository } from '../../src/auth/prisma-user.repository.js';
import { createSessionService } from '../../src/auth/session-service.js';
import { createMfaCompletionFixture } from '../helpers/mfa-completion-fixture.js';
import { cleanupUserFixtures } from '../helpers/cleanup-user-fixtures.js';
import { createTestPrismaClient } from './setup/database-setup.js';

test('account lifecycle changes and session revocation are atomic in PostgreSQL', async (t) => {
  const prisma = await createTestPrismaClient();
  const userRepository = createPrismaUserRepository(prisma);
  const sessionRepository = createPrismaSessionRepository(prisma);
  const completionService = createMfaCompletionFixture({ prisma });
  const sessionService = createSessionService({ repository: sessionRepository });
  const lifecycleService = createAccountLifecycleService({ prisma, userRepository, sessionRepository });

  const testUserIds = [];
  async function makeUser() {
    const id = randomUUID();
    await prisma.user.create({
      data: { id, email: `${randomUUID()}@example.test`, username: `lifecycle-${randomUUID()}`, status: 'ACTIVE' },
    });
    testUserIds.push(id);
    return id;
  }
  async function makeSession(userId) {
    const completionProof = await completionService.issueForUser(userId);
    const session = await sessionService.createSession({ userId, completionProof });
    assert.equal(session.status, 'SESSION_CREATED');
    return session;
  }

  try {
    for (const status of ['SUSPENDED', 'DISABLED']) {
      await t.test(`${status} revokes only the target user's sessions and reactivation leaves old sessions revoked`, async () => {
        const userId = await makeUser();
        const otherUserId = await makeUser();
        const oldSession = await makeSession(userId);
        const otherSession = await makeSession(otherUserId);

        assert.deepEqual(await lifecycleService.setStatus(userId, status), { status: 'ACCOUNT_UPDATED' });
        assert.equal((await sessionService.validateSession(oldSession.token)).status, 'SESSION_INVALID');
        assert.equal(await prisma.adminSession.count({ where: { userId, revokedAt: null } }), 0);
        assert.equal((await sessionService.validateSession(otherSession.token)).status, 'SESSION_VALID');
        assert.equal(await prisma.adminSession.count({ where: { userId: otherUserId, revokedAt: null } }), 1);

        assert.deepEqual(await lifecycleService.setStatus(userId, 'ACTIVE'), { status: 'ACCOUNT_UPDATED' });
        assert.equal((await sessionService.validateSession(oldSession.token)).status, 'SESSION_INVALID');
      });
    }

    await t.test('soft delete revokes every target session, preserves another user session, and cannot reactivate old sessions', async () => {
      const userId = await makeUser();
      const otherUserId = await makeUser();
      const oldSession = await makeSession(userId);
      const otherSession = await makeSession(otherUserId);

      assert.deepEqual(await lifecycleService.softDelete(userId), { status: 'ACCOUNT_UPDATED' });
      assert.ok((await prisma.user.findUnique({ where: { id: userId }, select: { deletedAt: true } })).deletedAt instanceof Date);
      assert.equal((await sessionService.validateSession(oldSession.token)).status, 'SESSION_INVALID');
      assert.equal(await prisma.adminSession.count({ where: { userId, revokedAt: null } }), 0);
      assert.equal((await sessionService.validateSession(otherSession.token)).status, 'SESSION_VALID');
      assert.equal(await prisma.adminSession.count({ where: { userId: otherUserId, revokedAt: null } }), 1);
      assert.deepEqual(await lifecycleService.setStatus(userId, 'ACTIVE'), { status: 'ACCOUNT_NOT_FOUND' });
      assert.equal((await sessionService.validateSession(oldSession.token)).status, 'SESSION_INVALID');
    });

    await t.test('a PostgreSQL update failure rolls back the user change before any revoke persists', async () => {
      const userId = await makeUser();
      const oldSession = await makeSession(userId);
      const failingUserRepository = {
        ...userRepository,
        async updateLifecycle(args) {
          await userRepository.updateLifecycle(args);
          throw new Error('injected update failure');
        },
      };
      const service = createAccountLifecycleService({ prisma, userRepository: failingUserRepository, sessionRepository });

      await assert.rejects(service.setStatus(userId, 'SUSPENDED'));
      assert.equal((await prisma.user.findUnique({ where: { id: userId }, select: { status: true } })).status, 'ACTIVE');
      assert.equal(await prisma.adminSession.count({ where: { userId, revokedAt: null } }), 1);
      assert.equal((await sessionService.validateSession(oldSession.token)).status, 'SESSION_VALID');
    });

    await t.test('a PostgreSQL revoke failure rolls back the user update and session revocations', async () => {
      const userId = await makeUser();
      const oldSession = await makeSession(userId);
      const failingSessionRepository = {
        ...sessionRepository,
        async revokeAllUserSessions(args) {
          await sessionRepository.revokeAllUserSessions(args);
          throw new Error('injected revoke failure');
        },
      };
      const service = createAccountLifecycleService({ prisma, userRepository, sessionRepository: failingSessionRepository });

      await assert.rejects(service.setStatus(userId, 'DISABLED'));
      assert.equal((await prisma.user.findUnique({ where: { id: userId }, select: { status: true } })).status, 'ACTIVE');
      assert.equal(await prisma.adminSession.count({ where: { userId, revokedAt: null } }), 1);
      assert.equal((await sessionService.validateSession(oldSession.token)).status, 'SESSION_VALID');
    });

    await cleanupUserFixtures(prisma, testUserIds);

    let activeSuperAdminCount = 0;
    let superAdminRoleExists = false;
    let superAdminRoleId;
    try {
      const [role] = await prisma.$queryRaw`SELECT "id" FROM "Role" WHERE "code" = 'SUPER_ADMIN'`;
      superAdminRoleExists = Boolean(role);
      if (role) {
        superAdminRoleId = role.id;
        const [count] = await prisma.$queryRaw`
          SELECT count(*)::int AS active_count
          FROM "User" u
          JOIN "UserRole" ur ON ur."userId" = u."id"
          WHERE ur."roleId" = ${role.id}::uuid
            AND u."status" = 'ACTIVE'::"UserStatus"
            AND u."deletedAt" IS NULL
        `;
        activeSuperAdminCount = count.active_count;
      }
    } catch {
      throw new Error('SUPER_ADMIN fixture preflight failed');
    }

    if (!superAdminRoleExists) {
      const role = await prisma.role.create({ data: { code: 'SUPER_ADMIN' }, select: { id: true } });
      superAdminRoleExists = true;
      superAdminRoleId = role.id;
    }

    assert.equal(superAdminRoleExists, true, 'Last-admin test precondition failed: SUPER_ADMIN baseline role is unavailable');
    assert.equal(activeSuperAdminCount, 0, 'Last-admin test precondition failed: active SUPER_ADMIN accounts exist outside this test fixture');

    await t.test('the last active SUPER_ADMIN is protected, including concurrent deactivation', async () => {
      const userIds = [await makeUser(), await makeUser()];
      for (const userId of userIds) {
        await prisma.userRole.create({ data: { userId, roleId: superAdminRoleId } });
      }
      const sessions = await Promise.all(userIds.map(makeSession));

      const concurrent = await Promise.all(userIds.map((userId) => lifecycleService.setStatus(userId, 'SUSPENDED')));
      assert.equal(concurrent.filter(({ status }) => status === 'ACCOUNT_UPDATED').length, 1);
      assert.equal(concurrent.filter(({ status }) => status === 'ACCOUNT_LIFECYCLE_DENIED').length, 1);
      assert.equal(await prisma.user.count({
        where: { status: 'ACTIVE', deletedAt: null, roles: { some: { roleId: superAdminRoleId } } },
      }), 1);
      const survivorIndex = concurrent.findIndex(({ status }) => status === 'ACCOUNT_LIFECYCLE_DENIED');
      const deactivatedIndex = 1 - survivorIndex;
      const survivorId = userIds[survivorIndex];

      assert.equal((await sessionService.validateSession(sessions[deactivatedIndex].token)).status, 'SESSION_INVALID');
      assert.equal((await sessionService.validateSession(sessions[survivorIndex].token)).status, 'SESSION_VALID');
      assert.deepEqual(await lifecycleService.setStatus(survivorId, 'SUSPENDED'), { status: 'ACCOUNT_LIFECYCLE_DENIED' });
      assert.deepEqual(await lifecycleService.setStatus(survivorId, 'DISABLED'), { status: 'ACCOUNT_LIFECYCLE_DENIED' });
      assert.deepEqual(await lifecycleService.softDelete(survivorId), { status: 'ACCOUNT_LIFECYCLE_DENIED' });
      assert.deepEqual(
        await prisma.user.findUnique({ where: { id: survivorId }, select: { status: true, deletedAt: true } }),
        { status: 'ACTIVE', deletedAt: null },
      );
    });
  } finally {
    try {
      await cleanupUserFixtures(prisma, testUserIds);
    } finally {
      await prisma.$disconnect();
    }
  }
});
