import { randomBytes } from 'node:crypto';
import { AUTHENTICATION_PURPOSE, hashProof } from './mfa-completion-service.js';

const ttlMs = 5 * 60 * 1000;
const rejected = Object.freeze({ status: 'MFA_CHALLENGE_REJECTED' });

function currentTime(clock) {
  const value = clock();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error('MFA challenge service unavailable');
  return new Date(value.getTime());
}

export function createMfaChallengeService({ repository, clock = () => new Date() } = {}) {
  if (typeof repository?.createChallenge !== 'function' || typeof repository?.consumeChallenge !== 'function') {
    throw new TypeError('A complete MFA challenge repository is required');
  }
  if (typeof clock !== 'function') throw new TypeError('An MFA challenge clock is required');

  async function createChallenge({ userId } = {}) {
    if (typeof userId !== 'string' || userId.length === 0) return rejected;
    const now = currentTime(clock);
    const challenge = randomBytes(32).toString('base64url');
    try {
      const created = await repository.createChallenge({
        userId,
        challengeHash: hashProof(challenge),
        purpose: AUTHENTICATION_PURPOSE,
        createdAt: now,
        expiresAt: new Date(now.getTime() + ttlMs),
      });
      if (!created) return rejected;
      return { status: 'MFA_CHALLENGE_CREATED', challenge, expiresAt: created.expiresAt };
    } catch {
      throw new Error('MFA challenge service unavailable');
    }
  }

  async function consumeChallenge({ userId, challenge } = {}) {
    const challengeHash = hashProof(challenge);
    if (typeof userId !== 'string' || userId.length === 0 || !challengeHash) return rejected;
    try {
      const consumed = await repository.consumeChallenge({
        userId,
        challengeHash,
        purpose: AUTHENTICATION_PURPOSE,
        now: currentTime(clock),
      });
      return consumed ? { status: 'MFA_CHALLENGE_CONSUMED' } : rejected;
    } catch {
      throw new Error('MFA challenge service unavailable');
    }
  }

  return Object.freeze({ createChallenge, consumeChallenge });
}
