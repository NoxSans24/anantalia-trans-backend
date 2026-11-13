import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { createSessionService } from '../../src/auth/session-service.js';
import { createMfaCompletionFixture } from '../helpers/mfa-completion-fixture.js';
import { createPrismaSessionRepository } from '../../src/auth/prisma-session.repository.js';
import { createTestPrismaClient, getTestDatabaseConfig } from './setup/database-setup.js';
import { cleanupUserFixtures } from '../helpers/cleanup-user-fixtures.js';

const { databaseName: configuredDatabaseName } = getTestDatabaseConfig();

function tokenHash(token) {
  return createHash('sha256').update(token, 'utf8').digest();
}


test('session repository stores only hashes, rotates atomically, scopes revocation, and revokes inactive accounts', async (t) => {
  const prisma = await createTestPrismaClient();
  const userIds = [];
  const repository = createPrismaSessionRepository(prisma);
  const completion = createMfaCompletionFixture({ prisma });
  const service = createSessionService({ repository });
  try {
    let identity;
    try {
      [identity] = await prisma.$queryRaw`SELECT current_database() AS database_name, current_user AS role_name`;
    } catch {
      throw new Error('Disposable database identity preflight failed');
    }
    if (identity?.database_name !== configuredDatabaseName
      || typeof identity.role_name !== 'string' || identity.role_name.length === 0) {
      throw new Error('Disposable database identity preflight failed');
    }

    const user = await prisma.user.create({
      data: { email: `${randomUUID()}@example.test`, username: `session-${randomUUID()}`, status: 'ACTIVE' },
      select: { id: true },
    });
    userIds.push(user.id);
    const otherUser = await prisma.user.create({
      data: { email: `${randomUUID()}@example.test`, username: `session-${randomUUID()}`, status: 'ACTIVE' },
      select: { id: true },
    });
    userIds.push(otherUser.id);
    await t.test('session insert failure rolls back completion consumption and allows retry', async () => {
      const rollbackUser = await prisma.user.create({
        data: { email: `${randomUUID()}@example.test`, username: `rollback-${randomUUID()}`, status: 'ACTIVE' },
        select: { id: true },
      });
      userIds.push(rollbackUser.id);
      const proof = await completion.issueForUser(rollbackUser.id);
      const proofHash = createHash('sha256').update(Buffer.from(proof, 'base64url')).digest();
      const beforeFailure = await prisma.mfaCompletion.findUnique({ where: { proofHash }, select: { consumedAt: true } });
      assert.equal(beforeFailure.consumedAt, null);
      let sessionInsertIntercepted = false;
      const failingClient = prisma.$extends({
        query: {
          adminSession: {
            async create() {
              sessionInsertIntercepted = true;
              throw new Error('intentional session insert failure');
            },
          },
        },
      });
      const failingService = createSessionService({ repository: createPrismaSessionRepository(failingClient) });

      await assert.rejects(
        failingService.createSession({ userId: rollbackUser.id, completionProof: proof }),
        /Session service unavailable/,
      );
      assert.equal(sessionInsertIntercepted, true);
      const afterRollback = await prisma.mfaCompletion.findUnique({ where: { proofHash }, select: { consumedAt: true } });
      assert.equal(afterRollback.consumedAt, null);
      assert.equal(await prisma.adminSession.count({ where: { userId: rollbackUser.id } }), 0);

      const retry = await service.createSession({ userId: rollbackUser.id, completionProof: proof });
      assert.equal(retry.status, 'SESSION_CREATED');
      const afterRetry = await prisma.mfaCompletion.findUnique({ where: { proofHash }, select: { consumedAt: true } });
      assert.ok(afterRetry.consumedAt instanceof Date);
    });

    const replayProof = await completion.issueForUser(otherUser.id);
    const concurrentCreates = await Promise.all([
      service.createSession({ userId: otherUser.id, completionProof: replayProof }),
      service.createSession({ userId: otherUser.id, completionProof: replayProof }),
    ]);
    assert.equal(concurrentCreates.filter(({ status }) => status === 'SESSION_CREATED').length, 1);
    assert.equal(concurrentCreates.filter(({ status }) => status === 'SESSION_CREATION_DENIED').length, 1);
    assert.equal(await prisma.adminSession.count({ where: { userId: otherUser.id } }), 1);
    const replayProofHash = createHash('sha256').update(Buffer.from(replayProof, 'base64url')).digest();
    assert.ok((await prisma.mfaCompletion.findUnique({ where: { proofHash: replayProofHash }, select: { consumedAt: true } })).consumedAt);

    const wrongUserProof = await completion.issueForUser(otherUser.id);
    assert.equal((await service.createSession({ userId: user.id, completionProof: wrongUserProof })).status, 'SESSION_CREATION_DENIED');
    const expiredProof = await completion.issueForUser(user.id);
    const expiredHash = createHash('sha256').update(Buffer.from(expiredProof, 'base64url')).digest();
    await prisma.mfaCompletion.update({ where: { proofHash: expiredHash }, data: { expiresAt: new Date(0) } });
    assert.equal((await service.createSession({ userId: user.id, completionProof: expiredProof })).status, 'SESSION_CREATION_DENIED');

    const create = async () => service.createSession({ userId: user.id, completionProof: await completion.issueForUser(user.id) });

    const initial = await create();
    assert.equal(initial.status, 'SESSION_CREATED');
    assert.equal(initial.token.length, 43);
    const initialHash = tokenHash(initial.token);
    const storedInitial = await prisma.adminSession.findUnique({
      where: { tokenHash: initialHash },
      select: { tokenHash: true, createdAt: true, lastActivityAt: true, idleExpiresAt: true, absoluteExpiresAt: true },
    });
    assert.ok(storedInitial);
    assert.deepEqual(Buffer.from(storedInitial.tokenHash), initialHash);
    assert.equal(storedInitial.absoluteExpiresAt.getTime() - storedInitial.createdAt.getTime(), 8 * 60 * 60 * 1000);
    assert.equal(storedInitial.idleExpiresAt.getTime() - storedInitial.lastActivityAt.getTime(), 30 * 60 * 1000);
    const sessionColumns = await prisma.$queryRaw`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='AdminSession'`;
    assert.equal(sessionColumns.some(({ column_name }) => column_name === 'token'), false);

    const rotations = await Promise.all([service.rotateSession(initial.token), service.rotateSession(initial.token)]);
    assert.equal(rotations.filter(({ status }) => status === 'SESSION_ROTATED').length, 1);
    assert.equal(rotations.filter(({ status }) => status === 'SESSION_INVALID').length, 1);
    const rotated = rotations.find(({ status }) => status === 'SESSION_ROTATED');
    const rotatedHash = tokenHash(rotated.token);
    const rowsAfterRotation = await prisma.adminSession.findMany({ where: { userId: user.id }, select: { tokenHash: true, absoluteExpiresAt: true, revokedAt: true } });
    assert.equal(rowsAfterRotation.length, 1);
    assert.deepEqual(Buffer.from(rowsAfterRotation[0].tokenHash), rotatedHash);
    assert.equal(rowsAfterRotation[0].absoluteExpiresAt.getTime(), storedInitial.absoluteExpiresAt.getTime());
    assert.equal(await prisma.adminSession.findUnique({ where: { tokenHash: initialHash } }), null);
    assert.equal((await service.validateSession(initial.token)).status, 'SESSION_INVALID');
    assert.equal((await service.validateSession(rotated.token)).status, 'SESSION_VALID');

    await service.revokeSession({ token: rotated.token, userId: otherUser.id });
    assert.equal((await prisma.adminSession.findUnique({ where: { tokenHash: rotatedHash }, select: { revokedAt: true } })).revokedAt, null);
    await service.revokeSession({ token: rotated.token, userId: user.id });
    assert.equal((await service.validateSession(rotated.token)).status, 'SESSION_INVALID');

    const revokeAllSessions = [await create(), await create()];
    await service.revokeAllUserSessions(user.id);
    for (const session of revokeAllSessions) assert.equal((await service.validateSession(session.token)).status, 'SESSION_INVALID');
    assert.equal(await prisma.adminSession.count({ where: { userId: user.id, revokedAt: null } }), 0);

    const afterStatusSessions = [await create(), await create()];
    await prisma.user.update({ where: { id: user.id }, data: { status: 'SUSPENDED' } });
    assert.equal((await service.validateSession(afterStatusSessions[0].token)).status, 'SESSION_INVALID');
    assert.equal(await prisma.adminSession.count({ where: { userId: user.id, revokedAt: null } }), 0);

    const softDeletedUser = await prisma.user.create({
      data: { email: `${randomUUID()}@example.test`, username: `session-${randomUUID()}`, status: 'ACTIVE' },
      select: { id: true },
    });
    userIds.push(softDeletedUser.id);
    const softDeleteRepository = createPrismaSessionRepository(prisma);
    const softDeleteCompletion = createMfaCompletionFixture({ prisma });
    const softDeleteService = createSessionService({ repository: softDeleteRepository });
    const softDeleteSession = await softDeleteService.createSession({ userId: softDeletedUser.id, completionProof: await softDeleteCompletion.issueForUser(softDeletedUser.id) });
    await prisma.user.update({ where: { id: softDeletedUser.id }, data: { deletedAt: new Date() } });
    assert.equal((await softDeleteService.validateSession(softDeleteSession.token)).status, 'SESSION_INVALID');
    assert.equal(await prisma.adminSession.count({ where: { userId: softDeletedUser.id, revokedAt: null } }), 0);
  } finally {
    try {
      await cleanupUserFixtures(prisma, userIds);
    } finally {
      await prisma.$disconnect();
    }
  }
});
