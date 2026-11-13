import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { createApp } from '../../src/app.js';
import { createAuthRouter } from '../../src/routes/auth.routes.js';
import { createLogger } from '../../src/lib/logger.js';
import { createAuthenticationOrchestrationService } from '../../src/auth/authentication-orchestration-service.js';
import { createLocalLoginService } from '../../src/auth/local-login-service.js';
import { createMfaChallengeService } from '../../src/auth/mfa-challenge-service.js';
import { createMfaVerificationService } from '../../src/auth/mfa-verification-service.js';
import { createHttpSessionAdapter } from '../../src/auth/http-session-adapter.js';
import { createPrismaMfaChallengeRepository } from '../../src/auth/prisma-mfa-challenge.repository.js';
import { createPrismaMfaCompletionRepository } from '../../src/auth/prisma-mfa-completion.repository.js';
import { createPrismaSessionRepository } from '../../src/auth/prisma-session.repository.js';
import { createPrismaTotpFactorRepository } from '../../src/auth/prisma-totp-factor.repository.js';
import { createPrismaUserRepository } from '../../src/auth/prisma-user.repository.js';
import { createSessionService } from '../../src/auth/session-service.js';
import { createTotpFactorService } from '../../src/auth/totp-factor-service.js';
import { createCsrfMiddleware } from '../../src/middlewares/csrf.middleware.js';
import { createRateLimitMiddleware } from '../../src/middlewares/rate-limit.middleware.js';
import { hashPassword, verifyPassword } from '../../src/auth/password-service.js';
import { createTestPrismaClient } from './setup/database-setup.js';
import { createMfaCompletionFixture } from '../helpers/mfa-completion-fixture.js';
import { cleanupUserFixtures } from '../helpers/cleanup-user-fixtures.js';

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

function updateCookies(cookies, response) {
  for (const line of response.headers.getSetCookie()) {
    const [pair] = line.split(';');
    const separator = pair.indexOf('=');
    const name = pair.slice(0, separator);
    const value = pair.slice(separator + 1);
    if (value) cookies.set(name, value);
    else cookies.delete(name);
  }
}

function cookieHeader(cookies) {
  return [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
}

function signedCsrfToken(secret, sessionToken, timestamp) {
  const raw = randomBytes(32).toString('base64url');
  const binding = sessionToken ? createHash('sha256').update(sessionToken).digest('base64url') : 'anonymous';
  const signature = createHmac('sha256', secret).update(`${raw}:${timestamp}:${binding}`).digest('base64url');
  return `${raw}.${timestamp}.${signature}`;
}

test('HTTP authentication endpoints: login → MFA → session → logout', async () => {
  const prisma = await createTestPrismaClient();
  const testUserIds = [];

  async function makeUser() {
    const id = randomUUID();
    await prisma.user.create({
      data: { id, email: `${randomUUID()}@example.test`, username: `http-auth-${randomUUID()}`, status: 'ACTIVE', passwordHash: await hashPassword('integration-password-92!') },
    });
    testUserIds.push(id);
    return id;
  }

  try {
    const [identity] = await prisma.$queryRaw`SELECT current_database() AS database_name, current_user AS role_name`;
    assert.match(identity.database_name, /_test$/i);

    const now = (await prisma.$queryRaw`SELECT CURRENT_TIMESTAMP AS "now"`)[0].now;
    const currentStep = BigInt(Math.floor(now.getTime() / 30_000));

    const userRepository = createPrismaUserRepository(prisma);
    const localLogin = createLocalLoginService({ userRepository, passwordVerifier: verifyPassword });
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
      localLogin,
      challengeService,
      mfaVerificationService: mfaVerification,
      sessionService,
    });
    const sessionAdapter = createHttpSessionAdapter({ sessionService });
    const csrfSecret = randomBytes(32);
    const csrfMiddleware = createCsrfMiddleware({ secret: csrfSecret });
    const rateLimitMiddleware = createRateLimitMiddleware();

    const userId = await makeUser();
    const enrollment = await totpService.startEnrollment({ userId, accountName: 'integration@example.test' });
    assert.equal(enrollment.status, 'TOTP_ENROLLMENT_PENDING');
    assert.equal((await totpService.confirmEnrollment({ userId, factorId: enrollment.factorId, code: codeAt(enrollment.secret, currentStep - 1n) })).status, 'TOTP_ENROLLMENT_CONFIRMED');

    await test('HTTP login, MFA, session, rotation, CSRF, and logout use PostgreSQL', async () => {
      const authRouter = createAuthRouter({ orchestration, sessionService, sessionAdapter, csrfMiddleware, rateLimitMiddleware, logger: createLogger(() => {}) });
      const httpServer = createApp({ prisma, logger: createLogger(() => {}), authRouter }).listen(0, '127.0.0.1');
      const cookies = new Map();
      const baseUrl = await new Promise((resolve, reject) => httpServer.once('listening', () => resolve(`http://127.0.0.1:${httpServer.address().port}`)).once('error', reject));
      const request = (path, method = 'GET', body) => fetch(`${baseUrl}${path}`, {
        method,
        headers: { cookie: cookieHeader(cookies), ...(body ? { 'content-type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      try {
        let response = await request('/auth/csrf');
        updateCookies(cookies, response);
        let csrfToken = (await response.json()).csrfToken;
        const email = (await prisma.user.findUnique({ where: { id: userId }, select: { email: true } })).email;

        response = await request('/auth/login', 'POST', { email, password: 'integration-password-92!', csrfToken: `${csrfToken}x` });
        assert.equal(response.status, 403);

        cookies.set('__csrf', signedCsrfToken(csrfSecret, null, Date.now() - 60 * 60 * 1000 - 1));
        response = await request('/auth/login', 'POST', { email, password: 'integration-password-92!', csrfToken: cookies.get('__csrf') });
        assert.equal(response.status, 403);
        updateCookies(cookies, response);
        response = await request('/auth/csrf');
        updateCookies(cookies, response);
        csrfToken = (await response.json()).csrfToken;

        const rateLimitEmail = `limit-${randomUUID()}@example.test`;
        for (let attempt = 0; attempt < 5; attempt++) {
          response = await request('/auth/login', 'POST', { email: rateLimitEmail, password: 'wrong-password', csrfToken });
          assert.equal(response.status, 401);
        }
        response = await request('/auth/login', 'POST', { email: rateLimitEmail, password: 'wrong-password', csrfToken });
        assert.equal(response.status, 429);

        response = await request('/auth/login', 'POST', { email, password: 'integration-password-92!', csrfToken });
        assert.equal(response.status, 200);
        const failedMfaChallenge = (await response.json()).challenge;
        const validCode = codeAt(enrollment.secret, currentStep);
        const invalidCode = validCode === '000000' ? '000001' : '000000';
        for (let attempt = 0; attempt < 3; attempt++) {
          response = await request('/auth/mfa/verify', 'POST', { challenge: failedMfaChallenge, code: invalidCode, csrfToken });
          assert.equal(response.status, 401);
        }
        response = await request('/auth/mfa/verify', 'POST', { challenge: failedMfaChallenge, code: invalidCode, csrfToken });
        assert.equal(response.status, 429);

        response = await request('/auth/login', 'POST', { email, password: 'wrong-password', csrfToken });
        assert.equal(response.status, 401);
        assert.equal(await prisma.adminSession.count({ where: { userId } }), 0);

        response = await request('/auth/login', 'POST', { email, password: 'integration-password-92!', csrfToken });
        assert.equal(response.status, 200);
        const login = await response.json();
        assert.equal(login.status, 'MFA_REQUIRED');
        assert.equal(cookies.has('__session'), false);
        assert.equal(await prisma.adminSession.count({ where: { userId } }), 0);

        response = await request('/auth/mfa/verify', 'POST', { challenge: login.challenge, code: codeAt(enrollment.secret, currentStep), csrfToken });
        assert.equal(response.status, 200);
        assert.match(response.headers.getSetCookie().find((value) => value.startsWith('__session=')), /HttpOnly/i);
        updateCookies(cookies, response);
        const sessionCsrf = cookies.get('__csrf');
        const originalToken = cookies.get('__session');
        const authenticatedBody = await response.text();
        assert.equal(authenticatedBody.includes(originalToken), false);

        response = await request('/auth/session/rotate', 'POST', { csrfToken });
        assert.equal(response.status, 403);
        response = await request('/auth/session/rotate', 'POST', { csrfToken: `${sessionCsrf}x` });
        assert.equal(response.status, 403);

        response = await request('/auth/session');
        assert.equal(response.status, 200);
        assert.equal((await response.json()).userId, userId);

        response = await request('/auth/session/rotate', 'POST', { csrfToken: sessionCsrf });
        assert.equal(response.status, 200);
        updateCookies(cookies, response);
        assert.notEqual(cookies.get('__session'), originalToken);
        const rotatedToken = cookies.get('__session');
        const rotatedCsrf = cookies.get('__csrf');

        cookies.set('__session', originalToken);
        response = await request('/auth/session');
        assert.equal(response.status, 401);
        cookies.set('__session', rotatedToken);
        cookies.set('__csrf', rotatedCsrf);

        response = await request('/auth/logout', 'POST', { csrfToken: rotatedCsrf });
        assert.equal(response.status, 200);
        updateCookies(cookies, response);
        assert.equal(await prisma.adminSession.count({ where: { userId, revokedAt: null } }), 0);
      } finally {
        httpServer.closeAllConnections();
        await new Promise((resolve) => httpServer.close(resolve));
      }
    });

  } finally {
    try {
      await cleanupUserFixtures(prisma, testUserIds);
    } finally {
      await prisma.$disconnect();
    }
  }
});
