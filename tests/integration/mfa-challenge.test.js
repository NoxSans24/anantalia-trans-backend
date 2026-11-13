import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { createMfaChallengeService } from '../../src/auth/mfa-challenge-service.js';
import { createPrismaMfaChallengeRepository } from '../../src/auth/prisma-mfa-challenge.repository.js';
import { createTestPrismaClient, getTestDatabaseConfig } from './setup/database-setup.js';
import { cleanupUserFixtures } from '../helpers/cleanup-user-fixtures.js';

const { databaseName: expectedDatabase } = getTestDatabaseConfig();

test('MFA challenges are hash-only, scoped, expiring, and atomically single-use', async () => {
  const prisma = await createTestPrismaClient();
  const userIds = [];
  const repository = createPrismaMfaChallengeRepository(prisma);
  const service = createMfaChallengeService({ repository });
  try {
    const [identity] = await prisma.$queryRaw`SELECT current_database() AS database_name, current_user AS role_name`;
    if (identity?.database_name !== expectedDatabase || identity?.role_name !== 'validation_user') {
      throw new Error('MFA challenge database identity preflight failed');
    }
    const user = await prisma.user.create({
      data: { email: `${randomUUID()}@example.test`, username: `mfa-${randomUUID()}`, status: 'ACTIVE' },
      select: { id: true },
    });
    userIds.push(user.id);
    const otherUser = await prisma.user.create({
      data: { email: `${randomUUID()}@example.test`, username: `mfa-${randomUUID()}`, status: 'ACTIVE' },
      select: { id: true },
    });
    userIds.push(otherUser.id);

    const challenge = await service.createChallenge({ userId: user.id });
    assert.equal(challenge.status, 'MFA_CHALLENGE_CREATED');
    const challengeHash = createHash('sha256').update(Buffer.from(challenge.challenge, 'base64url')).digest();
    const row = await prisma.mfaChallenge.findUnique({ where: { challengeHash } });
    assert.ok(row);
    assert.deepEqual(Buffer.from(row.challengeHash), challengeHash);
    assert.equal(Object.hasOwn(row, 'challenge'), false);
    assert.equal(row.userId, user.id);
    assert.equal(row.purpose, 'AUTHENTICATION');
    assert.equal(await service.consumeChallenge({ userId: otherUser.id, challenge: challenge.challenge }).then(({ status }) => status), 'MFA_CHALLENGE_REJECTED');
    const altered = `${challenge.challenge[0] === 'A' ? 'B' : 'A'}${challenge.challenge.slice(1)}`;
    assert.equal((await service.consumeChallenge({ userId: user.id, challenge: altered })).status, 'MFA_CHALLENGE_REJECTED');

    const wrongPurpose = await service.createChallenge({ userId: user.id });
    const wrongPurposeHash = createHash('sha256').update(Buffer.from(wrongPurpose.challenge, 'base64url')).digest();
    await prisma.mfaChallenge.update({ where: { challengeHash: wrongPurposeHash }, data: { purpose: 'PASSWORD_RESET' } });
    assert.equal((await service.consumeChallenge({ userId: user.id, challenge: wrongPurpose.challenge })).status, 'MFA_CHALLENGE_REJECTED');
    assert.equal((await prisma.mfaChallenge.findUnique({ where: { challengeHash: wrongPurposeHash }, select: { consumedAt: true } })).consumedAt, null);

    const expired = await service.createChallenge({ userId: user.id });
    const expiredHash = createHash('sha256').update(Buffer.from(expired.challenge, 'base64url')).digest();
    await prisma.mfaChallenge.update({ where: { challengeHash: expiredHash }, data: { expiresAt: new Date(0) } });
    assert.equal((await service.consumeChallenge({ userId: user.id, challenge: expired.challenge })).status, 'MFA_CHALLENGE_REJECTED');

    const concurrent = await service.createChallenge({ userId: user.id });
    const outcomes = await Promise.all([
      service.consumeChallenge({ userId: user.id, challenge: concurrent.challenge }),
      service.consumeChallenge({ userId: user.id, challenge: concurrent.challenge }),
    ]);
    assert.equal(outcomes.filter(({ status }) => status === 'MFA_CHALLENGE_CONSUMED').length, 1);
    assert.equal(outcomes.filter(({ status }) => status === 'MFA_CHALLENGE_REJECTED').length, 1);
    assert.ok((await prisma.mfaChallenge.findUnique({ where: { challengeHash: createHash('sha256').update(Buffer.from(concurrent.challenge, 'base64url')).digest() }, select: { consumedAt: true } })).consumedAt instanceof Date);
    assert.equal((await service.consumeChallenge({ userId: user.id, challenge: concurrent.challenge })).status, 'MFA_CHALLENGE_REJECTED');
    assert.equal(await prisma.mfaCompletion.count({ where: { userId: user.id } }), 0);
    assert.equal(await prisma.adminSession.count({ where: { userId: user.id } }), 0);
  } finally {
    try {
      await cleanupUserFixtures(prisma, userIds);
    } finally {
      await prisma.$disconnect();
    }
  }
});
