import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { createAuthenticationOrchestrationService } from '../../src/auth/authentication-orchestration-service.js';
import { createLocalLoginService } from '../../src/auth/local-login-service.js';
import { createMfaChallengeService } from '../../src/auth/mfa-challenge-service.js';
import { createMfaVerificationService } from '../../src/auth/mfa-verification-service.js';
import { createPrismaMfaChallengeRepository } from '../../src/auth/prisma-mfa-challenge.repository.js';
import { createPrismaMfaCompletionRepository } from '../../src/auth/prisma-mfa-completion.repository.js';
import { createPrismaSessionRepository } from '../../src/auth/prisma-session.repository.js';
import { createPrismaTotpFactorRepository } from '../../src/auth/prisma-totp-factor.repository.js';
import { createPrismaUserRepository } from '../../src/auth/prisma-user.repository.js';
import { createSessionService } from '../../src/auth/session-service.js';
import { createTotpFactorService } from '../../src/auth/totp-factor-service.js';
import { hashPassword, verifyPassword } from '../../src/auth/password-service.js';
import { createTestPrismaClient, getTestDatabaseConfig } from './setup/database-setup.js';
import { createMfaCompletionFixture } from '../helpers/mfa-completion-fixture.js';
import { cleanupUserFixtures } from '../helpers/cleanup-user-fixtures.js';

const { databaseName: expectedDatabase } = getTestDatabaseConfig();

process.env.ARGON2_MEMORY_COST ??= '32';
process.env.ARGON2_TIME_COST ??= '2';
process.env.ARGON2_PARALLELISM ??= '1';
process.env.ARGON2_HASH_LENGTH ??= '16';

const base32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function decodeBase32(value) {
  let bits = 0;
  let current = 0;
  const bytes = [];
  for (const character of value) {
    current = (current << 5) | base32.indexOf(character);
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

test('PostgreSQL authentication orchestration requires password, TOTP, and one-time proof before session creation', async () => {
  const prisma = await createTestPrismaClient();
  const testUserIds = [];
  try {
    const [identity] = await prisma.$queryRaw`SELECT current_database() AS database_name, current_user AS role_name`;
    if (identity?.database_name !== expectedDatabase || identity?.role_name !== 'validation_user') {
      throw new Error('Authentication integration database identity preflight failed');
    }

    const now = (await prisma.$queryRaw`SELECT CURRENT_TIMESTAMP AS "now"`)[0].now;
    const currentStep = BigInt(Math.floor(now.getTime() / 30_000));
    const userRepository = createPrismaUserRepository(prisma);
    const login = createLocalLoginService({ userRepository, passwordVerifier: verifyPassword });
    const challengeService = createMfaChallengeService({ repository: createPrismaMfaChallengeRepository(prisma) });
    const sessionRepository = createPrismaSessionRepository(prisma);
    const sessionService = createSessionService({ repository: sessionRepository });
    const keyringKey = randomBytes(32);
    const totpService = createTotpFactorService({
      repository: createPrismaTotpFactorRepository(prisma),
      encryption: { activeKeyId: 'integration-only-kid', keys: { 'integration-only-kid': keyringKey } },
      clock: () => new Date(now),
    });
    const completionRepository = createPrismaMfaCompletionRepository(prisma, { verifyFactor: totpService.verifyCode });
    const mfaVerification = createMfaVerificationService({ completionRepository });
    const orchestration = createAuthenticationOrchestrationService({
      localLogin: login,
      challengeService,
      mfaVerificationService: mfaVerification,
      sessionService,
    });

    const userId = (await prisma.user.create({
      data: {
        email: `${randomUUID()}@example.test`,
        username: `orchestration-${randomUUID()}`,
        passwordHash: await hashPassword('integration-password-92!'),
        status: 'ACTIVE',
      },
      select: { id: true },
    })).id;
    testUserIds.push(userId);
    const enrollment = await totpService.startEnrollment({ userId, accountName: 'integration@example.test' });
    assert.equal(enrollment.status, 'TOTP_ENROLLMENT_PENDING');
    assert.equal((await totpService.confirmEnrollment({ userId, factorId: enrollment.factorId, code: codeAt(enrollment.secret, currentStep - 1n) })).status, 'TOTP_ENROLLMENT_CONFIRMED');
    const factorRow = await prisma.totpFactor.findUnique({ where: { id: enrollment.factorId } });
    assert.equal(factorRow.status, 'ACTIVE');
    assert.notDeepEqual(Buffer.from(factorRow.encryptedSecret), decodeBase32(enrollment.secret));
    assert.equal(Object.hasOwn(factorRow, 'secret'), false);

    const challengeCountBeforeBadPassword = await prisma.mfaChallenge.count({ where: { userId } });
    const completionCountBeforeBadPassword = await prisma.mfaCompletion.count({ where: { userId } });
    const sessionCountBeforeBadPassword = await prisma.adminSession.count({ where: { userId } });
    assert.equal((await orchestration.login({ email: (await prisma.user.findUnique({ where: { id: userId }, select: { email: true } })).email, password: 'wrong-password' })).status, 'AUTHENTICATION_FAILED');
    assert.equal(await prisma.mfaChallenge.count({ where: { userId } }), challengeCountBeforeBadPassword);
    assert.equal(await prisma.mfaCompletion.count({ where: { userId } }), completionCountBeforeBadPassword);
    assert.equal(await prisma.adminSession.count({ where: { userId } }), sessionCountBeforeBadPassword);

    const loginResult = await orchestration.login({ email: (await prisma.user.findUnique({ where: { id: userId }, select: { email: true } })).email, password: 'integration-password-92!' });
    assert.equal(loginResult.status, 'MFA_REQUIRED');
    assert.equal(Object.hasOwn(loginResult, 'userId'), false);
    assert.equal(await prisma.adminSession.count({ where: { userId } }), 0);
    const challengeHash = createHash('sha256').update(Buffer.from(loginResult.challenge, 'base64url')).digest();
    const badCode = codeAt(enrollment.secret, currentStep) === '000000' ? '000001' : '000000';
    assert.equal((await orchestration.completeMfa({ challenge: loginResult.challenge, code: badCode })).status, 'MFA_VERIFICATION_REJECTED');
    assert.equal((await prisma.mfaChallenge.findUnique({ where: { challengeHash }, select: { consumedAt: true } })).consumedAt, null);
    assert.equal(await prisma.mfaCompletion.count({ where: { userId } }), 0);
    assert.equal(await prisma.adminSession.count({ where: { userId } }), 0);

    const correctCode = codeAt(enrollment.secret, currentStep);
    const concurrent = await Promise.all([
      orchestration.completeMfa({ challenge: loginResult.challenge, code: correctCode }),
      orchestration.completeMfa({ challenge: loginResult.challenge, code: correctCode }),
    ]);
    assert.equal(concurrent.filter(({ status }) => status === 'AUTHENTICATED').length, 1);
    assert.equal(concurrent.filter(({ status }) => status === 'MFA_VERIFICATION_REJECTED').length, 1);
    assert.equal(await prisma.mfaCompletion.count({ where: { userId } }), 1);
    assert.equal(await prisma.adminSession.count({ where: { userId } }), 1);
    const completionRow = await prisma.mfaCompletion.findFirst({ where: { userId }, select: { proofHash: true, purpose: true, createdAt: true, expiresAt: true, consumedAt: true } });
    assert.equal(completionRow.purpose, 'AUTHENTICATION');
    assert.equal(completionRow.expiresAt.getTime() - completionRow.createdAt.getTime(), 300_000);
    assert.ok(completionRow.consumedAt instanceof Date);
    assert.equal(Object.hasOwn(completionRow, 'proof'), false);
    const completionColumns = await prisma.$queryRaw`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='MfaCompletion'`;
    assert.equal(completionColumns.some(({ column_name }) => column_name === 'proof'), false);
    const factorColumns = await prisma.$queryRaw`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='TotpFactor'`;
    assert.equal(factorColumns.some(({ column_name }) => column_name === 'secret'), false);

    const rollbackUser = (await prisma.user.create({
      data: { email: `${randomUUID()}@example.test`, username: `rollback-${randomUUID()}`, status: 'ACTIVE' },
      select: { id: true },
    })).id;
    testUserIds.push(rollbackUser);
    const fixture = createMfaCompletionFixture({ prisma });
    const proof = await fixture.issueForUser(rollbackUser);
    const proofHash = createHash('sha256').update(Buffer.from(proof, 'base64url')).digest();
    const failingClient = prisma.$extends({ query: { adminSession: { async create() { throw new Error('intentional session insert failure'); } } } });
    const failingSessionService = createSessionService({ repository: createPrismaSessionRepository(failingClient) });
    await assert.rejects(failingSessionService.createSession({ userId: rollbackUser, completionProof: proof }), /Session service unavailable/);
    assert.equal((await prisma.mfaCompletion.findUnique({ where: { proofHash }, select: { consumedAt: true } })).consumedAt, null);
    assert.equal(await prisma.adminSession.count({ where: { userId: rollbackUser } }), 0);
    assert.equal((await sessionService.createSession({ userId: rollbackUser, completionProof: proof })).status, 'SESSION_CREATED');
    assert.ok((await prisma.mfaCompletion.findUnique({ where: { proofHash }, select: { consumedAt: true } })).consumedAt instanceof Date);
  } finally {
    try {
      await cleanupUserFixtures(prisma, testUserIds);
    } finally {
      await prisma.$disconnect();
    }
  }
});
