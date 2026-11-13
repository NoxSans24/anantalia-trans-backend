import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { createMfaChallengeService } from '../../src/auth/mfa-challenge-service.js';
import { createMfaVerificationService } from '../../src/auth/mfa-verification-service.js';
import { createPrismaMfaCompletionRepository } from '../../src/auth/prisma-mfa-completion.repository.js';
import { createPrismaMfaChallengeRepository } from '../../src/auth/prisma-mfa-challenge.repository.js';
import { createPrismaTotpFactorRepository } from '../../src/auth/prisma-totp-factor.repository.js';
import { createPrismaSessionRepository } from '../../src/auth/prisma-session.repository.js';
import { createSessionService } from '../../src/auth/session-service.js';
import { createTotpFactorService } from '../../src/auth/totp-factor-service.js';
import { createTestPrismaClient, getTestDatabaseConfig } from './setup/database-setup.js';
import { cleanupUserFixtures } from '../helpers/cleanup-user-fixtures.js';

const { databaseName: expectedDatabase } = getTestDatabaseConfig();

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function decodeBase32(value) {
  let bits = 0;
  let current = 0;
  const bytes = [];
  for (const character of value) {
    current = (current << 5) | alphabet.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bytes.push((current >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function codeAt(secret, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', decodeBase32(secret)).update(counter).digest();
  const offset = digest.at(-1) & 15;
  const value = ((digest[offset] & 127) << 24)
    | ((digest[offset + 1] & 255) << 16)
    | ((digest[offset + 2] & 255) << 8)
    | (digest[offset + 3] & 255);
  return String(value % 1_000_000).padStart(6, '0');
}

test('PostgreSQL TOTP verification and completion proof issuance are atomic and single-use', async () => {
  const prisma = await createTestPrismaClient();
  const challengeRepository = createPrismaMfaChallengeRepository(prisma);
  const challengeService = createMfaChallengeService({ repository: challengeRepository });
  const repository = createPrismaTotpFactorRepository(prisma);
  const key = randomBytes(32);
  const encryption = { activeKeyId: 'integration-k1', keys: { 'integration-k1': key } };
  let now = new Date('2026-11-04T00:00:00.000Z');
  const service = createTotpFactorService({ repository, encryption, clock: () => new Date(now) });
  const completionRepository = createPrismaMfaCompletionRepository(prisma, { verifyFactor: service.verifyCode });
  const verificationService = createMfaVerificationService({ completionRepository });
  const issuedProofs = [];
  const userIds = [];

  async function makeUser() {
    const userId = (await prisma.user.create({
      data: { email: `${randomUUID()}@example.test`, username: `totp-${randomUUID()}`, status: 'ACTIVE' },
      select: { id: true },
    })).id;
    userIds.push(userId);
    return userId;
  }

  async function challengeFor(userId) {
    const result = await challengeService.createChallenge({ userId });
    assert.equal(result.status, 'MFA_CHALLENGE_CREATED');
    return result.challenge;
  }

  async function challengeState(challenge) {
    const challengeHash = createHash('sha256').update(Buffer.from(challenge, 'base64url')).digest();
    return prisma.mfaChallenge.findUnique({ where: { challengeHash }, select: { consumedAt: true } });
  }

  try {
    const [identity] = await prisma.$queryRaw`SELECT current_database() AS database_name, current_user AS role_name`;
    if (identity?.database_name !== expectedDatabase || identity?.role_name !== 'validation_user') {
      throw new Error('TOTP database identity preflight failed');
    }
    const [databaseTime] = await prisma.$queryRaw`SELECT CURRENT_TIMESTAMP AS "now"`;
    now = databaseTime.now;

    const userA = await makeUser();
    const userB = await makeUser();
    const startA = await service.startEnrollment({ userId: userA, accountName: 'user-a@example.test' });
    const startB = await service.startEnrollment({ userId: userB, accountName: 'user-b@example.test' });
    assert.equal(startA.status, 'TOTP_ENROLLMENT_PENDING');
    assert.equal(startB.status, 'TOTP_ENROLLMENT_PENDING');
    const rowA = await prisma.totpFactor.findUnique({ where: { id: startA.factorId } });
    assert.equal(rowA.status, 'PENDING');
    assert.equal(rowA.encryptionKeyId, 'integration-k1');
    assert.equal(rowA.encryptedSecret.length, 20);
    assert.equal(rowA.secretNonce.length, 12);
    assert.equal(rowA.secretAuthTag.length, 16);
    assert.notDeepEqual(Buffer.from(rowA.encryptedSecret), decodeBase32(startA.secret));
    assert.equal(Object.hasOwn(rowA, 'secret'), false);

    const currentStep = BigInt(Math.floor(now.getTime() / 30_000));
    const enrollmentStep = currentStep - 1n;
    const pendingChallenge = await challengeFor(userA);
    assert.equal((await verificationService.verify({ challenge: pendingChallenge, code: codeAt(startA.secret, currentStep) })).status, 'MFA_VERIFICATION_REJECTED');
    assert.equal((await challengeState(pendingChallenge)).consumedAt, null);
    const enrollmentCode = codeAt(startA.secret, enrollmentStep);
    const invalidCode = enrollmentCode === '000000' ? '000001' : '000000';
    assert.equal((await service.confirmEnrollment({ userId: userA, factorId: startA.factorId, code: invalidCode })).status, 'TOTP_FACTOR_REJECTED');
    assert.equal((await prisma.totpFactor.findUnique({ where: { id: startA.factorId }, select: { status: true } })).status, 'PENDING');
    assert.equal((await service.confirmEnrollment({ userId: userA, factorId: startA.factorId, code: enrollmentCode })).status, 'TOTP_ENROLLMENT_CONFIRMED');
    assert.equal((await service.confirmEnrollment({ userId: userB, factorId: startB.factorId, code: codeAt(startB.secret, enrollmentStep) })).status, 'TOTP_ENROLLMENT_CONFIRMED');
    assert.ok((await prisma.totpFactor.findUnique({ where: { id: startA.factorId }, select: { confirmedAt: true } })).confirmedAt instanceof Date);

    await assert.rejects(prisma.totpFactor.create({
      data: {
        userId: userA,
        status: 'ACTIVE',
        encryptedSecret: rowA.encryptedSecret,
        secretNonce: rowA.secretNonce,
        secretAuthTag: rowA.secretAuthTag,
        encryptionKeyId: rowA.encryptionKeyId,
        confirmedAt: now,
      },
    }));

    const challengeA = await challengeFor(userA);
    const challengeB = await challengeFor(userB);
    const stepOneCodeA = codeAt(startA.secret, currentStep);
    const stepOneInvalidCode = stepOneCodeA === '000000' ? '000001' : '000000';
    assert.equal((await verificationService.verify({ challenge: challengeA, code: stepOneInvalidCode })).status, 'MFA_VERIFICATION_REJECTED');
    assert.equal((await challengeState(challengeA)).consumedAt, null);
    assert.equal((await prisma.totpFactor.findUnique({ where: { id: startA.factorId }, select: { lastAcceptedTimeStep: true } })).lastAcceptedTimeStep, enrollmentStep);
    const stepOneCodeB = codeAt(startB.secret, currentStep);
    assert.equal((await verificationService.verify({ challenge: challengeA, code: stepOneCodeB, userId: userB, purpose: 'PASSWORD_RESET', factorId: startB.factorId })).status, 'MFA_VERIFICATION_REJECTED');
    assert.equal((await challengeState(challengeA)).consumedAt, null);
    assert.equal((await verificationService.verify({ challenge: challengeB, code: stepOneCodeA, userId: userA })).status, 'MFA_VERIFICATION_REJECTED');
    assert.equal((await challengeState(challengeB)).consumedAt, null);

    const wrongPurpose = await challengeFor(userA);
    const wrongPurposeHash = createHash('sha256').update(Buffer.from(wrongPurpose, 'base64url')).digest();
    await prisma.mfaChallenge.update({ where: { challengeHash: wrongPurposeHash }, data: { purpose: 'PASSWORD_RESET' } });
    assert.equal((await verificationService.verify({ challenge: wrongPurpose, code: stepOneCodeA })).status, 'MFA_VERIFICATION_REJECTED');
    assert.equal((await challengeState(wrongPurpose)).consumedAt, null);
    assert.equal((await prisma.totpFactor.findUnique({ where: { id: startA.factorId }, select: { lastAcceptedTimeStep: true } })).lastAcceptedTimeStep, enrollmentStep);

    const expiredChallenge = await challengeFor(userA);
    const expiredHash = createHash('sha256').update(Buffer.from(expiredChallenge, 'base64url')).digest();
    await prisma.mfaChallenge.update({ where: { challengeHash: expiredHash }, data: { expiresAt: new Date(0) } });
    assert.equal((await verificationService.verify({ challenge: expiredChallenge, code: stepOneCodeA })).status, 'MFA_VERIFICATION_REJECTED');
    assert.equal((await challengeState(expiredChallenge)).consumedAt, null);

    const rollbackChallenge = challengeA;
    const failingPrisma = prisma.$extends({
      query: { mfaCompletion: { async create() { throw new Error('intentional transaction failure'); } } },
    });
    const failingCompletionRepository = createPrismaMfaCompletionRepository(failingPrisma, { verifyFactor: service.verifyCode });
    const failingVerificationService = createMfaVerificationService({ completionRepository: failingCompletionRepository });
    assert.equal((await failingVerificationService.verify({ challenge: rollbackChallenge, code: stepOneCodeA })).status, 'MFA_VERIFICATION_REJECTED');
    assert.equal((await challengeState(rollbackChallenge)).consumedAt, null);
    assert.equal((await prisma.totpFactor.findUnique({ where: { id: startA.factorId }, select: { lastAcceptedTimeStep: true } })).lastAcceptedTimeStep, enrollmentStep);
    const retried = await verificationService.verify({ challenge: rollbackChallenge, code: stepOneCodeA, userId: userB, purpose: 'PASSWORD_RESET', factorId: startB.factorId, verified: true });
    assert.equal(retried.status, 'MFA_COMPLETION_CREATED');
    issuedProofs.push(retried.proof);
    assert.equal(retried.expiresAt.getTime() - (await prisma.mfaCompletion.findUnique({ where: { proofHash: createHash('sha256').update(Buffer.from(retried.proof, 'base64url')).digest() }, select: { createdAt: true } })).createdAt.getTime(), 300_000);
    const issuedRow = await prisma.mfaCompletion.findUnique({ where: { proofHash: createHash('sha256').update(Buffer.from(retried.proof, 'base64url')).digest() } });
    assert.equal(issuedRow.userId, userA);
    assert.equal(issuedRow.purpose, 'AUTHENTICATION');
    assert.equal(Object.hasOwn(issuedRow, 'proof'), false);

    assert.ok((await challengeState(challengeA)).consumedAt instanceof Date);
    assert.equal((await verificationService.verify({ challenge: await challengeFor(userA), code: stepOneCodeA })).status, 'MFA_VERIFICATION_REJECTED');

    const [concurrencyTime] = await prisma.$queryRaw`SELECT CURRENT_TIMESTAMP AS "now"`;
    const concurrentStep = BigInt(Math.floor(concurrencyTime.now.getTime() / 30_000)) + 1n;
    const stepTwoCode = codeAt(startA.secret, concurrentStep);
    const concurrentChallenge = await challengeFor(userA);
    const concurrentResults = await Promise.all([
      verificationService.verify({ challenge: concurrentChallenge, code: stepTwoCode }),
      verificationService.verify({ challenge: concurrentChallenge, code: stepTwoCode }),
    ]);
    const concurrentSuccesses = concurrentResults.filter(({ status }) => status === 'MFA_COMPLETION_CREATED');
    assert.equal(concurrentSuccesses.length, 1);
    assert.equal(concurrentResults.filter(({ status }) => status === 'MFA_VERIFICATION_REJECTED').length, 1);
    issuedProofs.push(concurrentSuccesses[0].proof);
    assert.equal((await verificationService.verify({ challenge: await challengeFor(userA), code: stepTwoCode })).status, 'MFA_VERIFICATION_REJECTED');

    assert.equal(await prisma.mfaCompletion.count({ where: { userId: userA } }), 2);
    for (const proof of issuedProofs) {
      const proofHash = createHash('sha256').update(Buffer.from(proof, 'base64url')).digest();
      const row = await prisma.mfaCompletion.findUnique({ where: { proofHash } });
      assert.ok(row);
      assert.equal(row.purpose, 'AUTHENTICATION');
      assert.equal(row.expiresAt.getTime() - row.createdAt.getTime(), 300_000);
      assert.equal(Object.hasOwn(row, 'proof'), false);
    }
    const completionColumns = await prisma.$queryRaw`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='MfaCompletion'`;
    assert.equal(completionColumns.some(({ column_name }) => column_name === 'proof'), false);

    let sessionInsertAttempts = 0;
    const noWriteSessionClient = prisma.$extends({
      query: {
        adminSession: {
          async create({ args }) {
            sessionInsertAttempts += 1;
            return { id: randomUUID(), absoluteExpiresAt: args.data.absoluteExpiresAt };
          },
        },
      },
    });
    const sessionService = createSessionService({ repository: createPrismaSessionRepository(noWriteSessionClient) });
    assert.equal((await sessionService.createSession({ userId: userA, completionProof: issuedProofs[0] })).status, 'SESSION_CREATED');
    assert.equal((await sessionService.createSession({ userId: userA, completionProof: issuedProofs[0] })).status, 'SESSION_CREATION_DENIED');
    assert.equal(sessionInsertAttempts, 1);
    assert.equal(await prisma.adminSession.count({ where: { userId: userA } }), 0);
    const consumedProofHash = createHash('sha256').update(Buffer.from(issuedProofs[0], 'base64url')).digest();
    assert.ok((await prisma.mfaCompletion.findUnique({ where: { proofHash: consumedProofHash }, select: { consumedAt: true } })).consumedAt instanceof Date);

    assert.equal((await service.revokeFactor({ userId: userA, factorId: startA.factorId })).status, 'TOTP_FACTOR_REVOKED');
    const revokedChallenge = await challengeFor(userA);
    assert.equal((await verificationService.verify({ challenge: revokedChallenge, code: codeAt(startA.secret, currentStep + 3n) })).status, 'MFA_VERIFICATION_REJECTED');
    assert.equal((await challengeState(revokedChallenge)).consumedAt, null);
    assert.equal(await prisma.mfaCompletion.count({ where: { userId: userA } }), 2);
    assert.equal(await prisma.adminSession.count({ where: { userId: userA } }), 0);
  } finally {
    try {
      await cleanupUserFixtures(prisma, userIds);
    } finally {
      await prisma.$disconnect();
    }
  }
});
