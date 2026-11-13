import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { AUTHENTICATION_PURPOSE, hashProof } from './mfa-completion-service.js';

const idleTimeoutMs = 30 * 60 * 1000;
const absoluteLifetimeMs = 8 * 60 * 60 * 1000;
const denied = Object.freeze({ status: 'SESSION_CREATION_DENIED', error: Object.freeze({ code: 'SESSION_NOT_CREATED', message: 'Session could not be created' }) });
const invalidSession = Object.freeze({ status: 'SESSION_INVALID', error: Object.freeze({ code: 'INVALID_SESSION', message: 'Session is invalid' }) });

function tokenHash(token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const decoded = Buffer.from(token, 'base64url');
  if (decoded.length !== 32 || decoded.toString('base64url') !== token) return null;
  return createHash('sha256').update(token, 'utf8').digest();
}

function hashMatches(storedHash, expectedHash) {
  if (!(storedHash instanceof Uint8Array) || storedHash.byteLength !== expectedHash.byteLength) return false;
  return timingSafeEqual(Buffer.from(storedHash), expectedHash);
}

function currentTime(clock) {
  const value = clock();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error('Session service unavailable');
  return new Date(value.getTime());
}

function activeAccount(user) {
  return user?.status === 'ACTIVE' && user.deletedAt === null;
}

function unexpiredSession(session, now) {
  return session.revokedAt === null
    && session.idleExpiresAt instanceof Date
    && session.absoluteExpiresAt instanceof Date
    && session.idleExpiresAt.getTime() > now.getTime()
    && session.absoluteExpiresAt.getTime() > now.getTime();
}

function nextIdleExpiry(now, absoluteExpiresAt) {
  return new Date(Math.min(now.getTime() + idleTimeoutMs, absoluteExpiresAt.getTime()));
}

function publicSession(token, absoluteExpiresAt, status) {
  return { status, token, expiresAt: absoluteExpiresAt };
}

export function createSessionService({ repository, clock = () => new Date() } = {}) {
  if (typeof repository?.findUserForSession !== 'function'
    || typeof repository?.createSessionWithProof !== 'function'
    || typeof repository?.findByTokenHash !== 'function'
    || typeof repository?.touchSession !== 'function'
    || typeof repository?.rotateSession !== 'function'
    || typeof repository?.revokeSession !== 'function'
    || typeof repository?.revokeAllUserSessions !== 'function') {
    throw new TypeError('A complete session repository is required');
  }
  if (typeof clock !== 'function') throw new TypeError('A session clock is required');

  async function findValidSession(token) {
    const digest = tokenHash(token);
    if (!digest) return null;
    const now = currentTime(clock);
    let session;
    try {
      session = await repository.findByTokenHash(digest);
    } catch {
      throw new Error('Session service unavailable');
    }
    if (!session || !hashMatches(session.tokenHash, digest) || !unexpiredSession(session, now)) return null;
    if (!activeAccount(session.user)) {
      try {
        await repository.revokeAllUserSessions({ userId: session.userId, now });
      } catch {
        throw new Error('Session service unavailable');
      }
      return null;
    }
    return { digest, now, session };
  }

  async function createSession({ userId, completionProof } = {}) {
    const proofHash = hashProof(completionProof);
    if (typeof userId !== 'string' || userId.length === 0 || !proofHash) return denied;

    let user;
    try {
      user = await repository.findUserForSession(userId);
    } catch {
      throw new Error('Session service unavailable');
    }
    if (!activeAccount(user)) return denied;

    const now = currentTime(clock);
    const absoluteExpiresAt = new Date(now.getTime() + absoluteLifetimeMs);
    const rawToken = randomBytes(32).toString('base64url');
    const digest = tokenHash(rawToken);
    try {
      const created = await repository.createSessionWithProof({
        proofHash,
        purpose: AUTHENTICATION_PURPOSE,
        now,
        data: {
        userId,
        tokenHash: digest,
        createdAt: now,
        lastActivityAt: now,
        idleExpiresAt: nextIdleExpiry(now, absoluteExpiresAt),
        absoluteExpiresAt,
        },
      });
      if (!created) return denied;
      return publicSession(rawToken, created.absoluteExpiresAt, 'SESSION_CREATED');
    } catch {
      throw new Error('Session service unavailable');
    }
  }

  async function validateSession(token) {
    const valid = await findValidSession(token);
    if (!valid) return invalidSession;
    const { session, digest, now } = valid;
    try {
      const touched = await repository.touchSession({
        sessionId: session.id,
        userId: session.userId,
        tokenHash: digest,
        now,
        idleExpiresAt: nextIdleExpiry(now, session.absoluteExpiresAt),
      });
      if (!touched) return invalidSession;
      return { status: 'SESSION_VALID', sessionId: session.id, userId: session.userId, expiresAt: session.absoluteExpiresAt };
    } catch {
      throw new Error('Session service unavailable');
    }
  }

  async function rotateSession(token) {
    const valid = await findValidSession(token);
    if (!valid) return invalidSession;
    const { session, digest, now } = valid;
    const rawToken = randomBytes(32).toString('base64url');
    const newHash = tokenHash(rawToken);
    try {
      const rotated = await repository.rotateSession({
        sessionId: session.id,
        userId: session.userId,
        oldTokenHash: digest,
        newTokenHash: newHash,
        now,
        idleExpiresAt: nextIdleExpiry(now, session.absoluteExpiresAt),
      });
      if (!rotated) return invalidSession;
      return publicSession(rawToken, session.absoluteExpiresAt, 'SESSION_ROTATED');
    } catch {
      throw new Error('Session service unavailable');
    }
  }

  async function revokeSession({ token, userId } = {}) {
    const digest = tokenHash(token);
    if (typeof userId !== 'string' || userId.length === 0 || !digest) {
      return { status: 'SESSION_REVOCATION_ACCEPTED' };
    }
    try {
      await repository.revokeSession({ tokenHash: digest, userId, now: currentTime(clock) });
      return { status: 'SESSION_REVOCATION_ACCEPTED' };
    } catch {
      throw new Error('Session service unavailable');
    }
  }

  async function revokeAllUserSessions(userId) {
    if (typeof userId !== 'string' || userId.length === 0) return { status: 'SESSION_REVOCATION_ACCEPTED' };
    try {
      await repository.revokeAllUserSessions({ userId, now: currentTime(clock) });
      return { status: 'SESSION_REVOCATION_ACCEPTED' };
    } catch {
      throw new Error('Session service unavailable');
    }
  }

  return Object.freeze({ createSession, validateSession, rotateSession, revokeSession, revokeAllUserSessions });
}
