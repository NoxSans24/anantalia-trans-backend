import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { AUTHENTICATION_PURPOSE } from '../../src/auth/mfa-completion-service.js';
import { createMfaChallengeService } from '../../src/auth/mfa-challenge-service.js';

test('MFA challenge is random, stored as a hash, and expires after five minutes', async () => {
  const now = new Date('2026-11-04T00:00:00.000Z');
  let stored;
  const service = createMfaChallengeService({
    clock: () => now,
    repository: {
      async createChallenge(data) { stored = data; return { expiresAt: data.expiresAt }; },
      async consumeChallenge() { return true; },
    },
  });
  const result = await service.createChallenge({ userId: 'user-1' });
  assert.equal(result.status, 'MFA_CHALLENGE_CREATED');
  assert.match(result.challenge, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(stored.userId, 'user-1');
  assert.equal(stored.purpose, AUTHENTICATION_PURPOSE);
  assert.equal(stored.expiresAt.getTime() - now.getTime(), 300_000);
  assert.deepEqual(stored.challengeHash, createHash('sha256').update(Buffer.from(result.challenge, 'base64url')).digest());
  assert.equal(Object.hasOwn(stored, 'challenge'), false);
});

test('challenge consumption is purpose-fixed and rejects malformed or mismatched input without details', async () => {
  const calls = [];
  const service = createMfaChallengeService({
    repository: {
      async createChallenge(data) { return { expiresAt: data.expiresAt }; },
      async consumeChallenge(data) { calls.push(data); return false; },
    },
  });
  const created = await service.createChallenge({ userId: 'user-1', purpose: 'OTHER' });
  assert.equal(created.status, 'MFA_CHALLENGE_CREATED');
  assert.deepEqual(await service.consumeChallenge({ userId: 'user-2', challenge: created.challenge, purpose: 'OTHER' }), { status: 'MFA_CHALLENGE_REJECTED' });
  assert.equal(calls[0].purpose, AUTHENTICATION_PURPOSE);
  assert.equal(calls[0].userId, 'user-2');
  assert.deepEqual(await service.consumeChallenge({ userId: 'user-1', challenge: 'invalid' }), { status: 'MFA_CHALLENGE_REJECTED' });
  assert.equal(calls.length, 1);
  assert.deepEqual(await service.createChallenge({}), { status: 'MFA_CHALLENGE_REJECTED' });
});

test('single-use consumption exposes one winner and rejects replay', async () => {
  let remaining = 1;
  const service = createMfaChallengeService({
    repository: {
      async createChallenge(data) { return { expiresAt: data.expiresAt }; },
      async consumeChallenge() { if (remaining-- > 0) return true; return false; },
    },
  });
  const { challenge } = await service.createChallenge({ userId: 'user-1' });
  const outcomes = await Promise.all([
    service.consumeChallenge({ userId: 'user-1', challenge }),
    service.consumeChallenge({ userId: 'user-1', challenge }),
  ]);
  assert.equal(outcomes.filter(({ status }) => status === 'MFA_CHALLENGE_CONSUMED').length, 1);
  assert.equal(outcomes.filter(({ status }) => status === 'MFA_CHALLENGE_REJECTED').length, 1);
  assert.deepEqual(await service.consumeChallenge({ userId: 'user-1', challenge }), { status: 'MFA_CHALLENGE_REJECTED' });
});
