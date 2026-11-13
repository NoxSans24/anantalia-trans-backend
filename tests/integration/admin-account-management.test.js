import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createAccountLifecycleService } from '../../src/auth/account-lifecycle-service.js';
import { createActivityLogService } from '../../src/auth/activity-log-service.js';
import { createAdminAccountService } from '../../src/auth/admin-account-service.js';
import { createAuthorizationService } from '../../src/auth/authorization-service.js';
import { createPrismaSessionRepository } from '../../src/auth/prisma-session.repository.js';
import { createPrismaUserRepository } from '../../src/auth/prisma-user.repository.js';
import { createTestPrismaClient } from './setup/database-setup.js';
import { cleanupUserFixtures } from '../helpers/cleanup-user-fixtures.js';
import { seedRolesAndPermissions } from '../../src/lib/seed.js';

test('admin account creation, grants, lifecycle, and audit use PostgreSQL transactions', async () => {
  const prisma = await createTestPrismaClient();
  const userIds = [];
  try {
    const [identity] = await prisma.$queryRaw`SELECT current_database() AS database_name`;
    assert.match(identity.database_name, /_test$/i);
    const catalog = await seedRolesAndPermissions(prisma);
    const actorId = randomUUID();
    await prisma.user.create({ data: { id: actorId, email: `${randomUUID()}@example.test`, username: `root-${randomUUID()}`, status: 'ACTIVE' } });
    userIds.push(actorId);
    await prisma.userRole.create({ data: { userId: actorId, roleId: catalog.roles.SUPER_ADMIN } });

    const userRepository = createPrismaUserRepository(prisma);
    const sessionRepository = createPrismaSessionRepository(prisma);
    const activityLog = createActivityLogService({ prisma });
    const accountLifecycleService = createAccountLifecycleService({ prisma, userRepository, sessionRepository, activityLog });
    const service = createAdminAccountService({
      prisma,
      authService: createAuthorizationService({ prisma }),
      activityLog,
      accountLifecycleService,
    });
    const account = await service.createAdmin({
      actor: actorId,
      email: '  operator@example.test ',
      username: ' Operator ',
      displayName: 'Operator',
      roles: ['ADMIN'],
    });
    userIds.push(account.id);
    assert.equal(account.email, 'operator@example.test');
    assert.equal(account.username, 'operator');
    assert.equal(await prisma.adminSession.count({ where: { userId: account.id } }), 0);

    await assert.rejects(service.createAdmin({ actor: actorId, email: 'root2@example.test', username: 'root-two', roles: ['SUPER_ADMIN'] }), { status: 'INVALID_ROLE' });
    await assert.rejects(service.updateAdminRole({ actor: account.id, targetUserId: actorId, newRoles: ['STAFF'] }), { status: 'PERMISSION_DENIED' });
    await service.updateAdminRole({ actor: actorId, targetUserId: account.id, newRoles: ['STAFF'] });
    assert.deepEqual((await prisma.userRole.findMany({ where: { userId: account.id }, include: { role: true } })).map(({ role }) => role.code), ['STAFF']);

    await service.suspendAdmin({ actor: actorId, targetUserId: account.id });
    assert.equal((await prisma.user.findUnique({ where: { id: account.id } })).status, 'SUSPENDED');
    await service.reactivateAdmin({ actor: actorId, targetUserId: account.id });
    await service.disableAdmin({ actor: actorId, targetUserId: account.id });
    assert.equal((await prisma.user.findUnique({ where: { id: account.id } })).status, 'DISABLED');
    await service.softDeleteAdmin({ actor: actorId, targetUserId: account.id });
    assert.ok((await prisma.user.findUnique({ where: { id: account.id } })).deletedAt instanceof Date);

    await assert.rejects(service.suspendAdmin({ actor: actorId, targetUserId: actorId }), { status: 'PERMISSION_DENIED' });
    const actions = await prisma.activityLog.findMany({ where: { actor: actorId, targetUserId: account.id }, select: { action: true } });
    assert.deepEqual(actions.map(({ action }) => action).sort(), ['USER_CREATED', 'USER_ROLE_CHANGED', 'USER_SUSPENDED', 'USER_REACTIVATED', 'USER_DISABLED', 'USER_SOFT_DELETED'].sort());
  } finally {
    try {
      await cleanupUserFixtures(prisma, userIds);
    } finally {
      await prisma.$disconnect();
    }
  }
});
