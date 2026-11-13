import assert from 'node:assert/strict';
import test from 'node:test';
import { AUTHENTICATION_PURPOSE } from '../../src/auth/mfa-completion-service.js';
import { createPrismaMfaCompletionRepository } from '../../src/auth/prisma-mfa-completion.repository.js';

const now = new Date('2026-11-04T00:00:00.000Z');
const challengeRow = {
  userId: 'db-user',
  purpose: AUTHENTICATION_PURPOSE,
  expiresAt: new Date(now.getTime() + 300_000),
  consumedAt: null,
  user: { status: 'ACTIVE', deletedAt: null },
};
const factor = { id: 'db-factor', userId: 'db-user', status: 'ACTIVE' };

function fixture({ challenge = challengeRow, factorRow = factor, timeStep = 42n, acceptedCount = 1, consumedCount = 1, failInsert = false, verifierAvailable = true } = {}) {
  const events = [];
  let rawQuery = 0;
  let inserted;
  const tx = {
    async $queryRaw() {
      rawQuery += 1;
      events.push(rawQuery === 1 ? 'transaction-time' : 'lock-user');
      return rawQuery === 1 ? [{ now }] : [{ id: challenge.userId }];
    },
    mfaChallenge: {
      async findUnique() { events.push('read-challenge'); return challenge; },
      async updateMany(args) { events.push('consume-challenge'); events.push(args); return { count: consumedCount }; },
    },
    totpFactor: {
      async findFirst() { events.push('read-factor'); return factorRow; },
      async updateMany(args) { events.push('accept-timestep'); events.push(args); return { count: acceptedCount }; },
    },
    mfaCompletion: {
      async create(args) {
        events.push('insert-completion');
        inserted = args;
        if (failInsert) throw new Error('database insert failed');
        return { id: 'completion-row' };
      },
    },
  };
  const prisma = {
    $transaction: async (callback) => {
      events.push('begin');
      try {
        const result = await callback(tx);
        events.push('commit');
        return result;
      } catch (error) {
        events.push('rollback');
        throw error;
      }
    },
    $queryRaw() {},
    mfaChallenge: { findUnique() {}, updateMany() {} },
    totpFactor: { findFirst() {}, updateMany() {} },
    mfaCompletion: { create() {} },
  };
  const verifyFactor = ({ factor: suppliedFactor, code, now: suppliedNow }) => {
    events.push('verify-totp');
    assert.equal(suppliedFactor, factorRow);
    assert.equal(suppliedNow, now);
    return code === '123456' ? timeStep : null;
  };
  return { repository: createPrismaMfaCompletionRepository(prisma, verifierAvailable ? { verifyFactor } : {}), events, get inserted() { return inserted; } };
}

test('missing keyring-backed verifier fails closed before starting a transaction', async () => {
  const context = fixture({ verifierAvailable: false });
  assert.equal(await context.repository.verifyAndIssueCompletion({ challengeHash: Buffer.alloc(32), proofHash: Buffer.alloc(32), code: '123456' }), null);
  assert.deepEqual(context.events, []);
});

test('completion repository validates and consumes challenge, accepts TOTP, and inserts a hash-bound 300-second proof in order', async () => {
  const context = fixture();
  const proofHash = Buffer.alloc(32, 9);
  const challengeHash = Buffer.alloc(32, 4);
  const result = await context.repository.verifyAndIssueCompletion({
    challengeHash,
    proofHash,
    code: '123456',
  });
  assert.equal(result.userId, 'db-user');
  assert.equal(result.expiresAt.getTime() - now.getTime(), 300_000);
  assert.equal(context.inserted.data.userId, 'db-user');
  assert.equal(context.inserted.data.purpose, AUTHENTICATION_PURPOSE);
  assert.deepEqual(context.inserted.data.proofHash, proofHash);
  assert.equal(context.inserted.data.createdAt, now);
  assert.equal(Object.hasOwn(context.inserted.data, 'proof'), false);
  assert.deepEqual(context.events.filter((event) => typeof event === 'string'), [
    'begin', 'transaction-time', 'read-challenge', 'lock-user', 'read-factor',
    'verify-totp', 'accept-timestep', 'consume-challenge', 'insert-completion', 'commit',
  ]);
});

test('challenge, factor, or code rejection inserts no proof and updates no replay state', async (t) => {
  const invalidChallenges = [
    null,
    { ...challengeRow, purpose: 'PASSWORD_RESET' },
    { ...challengeRow, consumedAt: now },
    { ...challengeRow, expiresAt: now },
    { ...challengeRow, user: { status: 'SUSPENDED', deletedAt: null } },
  ];
  for (const challenge of invalidChallenges) {
    await t.test(`rejects challenge ${challenge?.purpose ?? 'missing'}`, async () => {
      const context = fixture({ challenge });
      assert.equal(await context.repository.verifyAndIssueCompletion({ challengeHash: Buffer.alloc(32), proofHash: Buffer.alloc(32), code: '123456' }), null);
      assert.equal(context.inserted, undefined);
      assert.equal(context.events.includes('accept-timestep'), false);
    });
  }

  for (const factorRow of [null, { ...factor, status: 'PENDING' }, { ...factor, status: 'REVOKED' }]) {
    const context = fixture({ factorRow });
    assert.equal(await context.repository.verifyAndIssueCompletion({ challengeHash: Buffer.alloc(32), proofHash: Buffer.alloc(32), code: '123456' }), null);
    assert.equal(context.inserted, undefined);
    assert.equal(context.events.includes('accept-timestep'), false);
  }

  const badCode = fixture();
  assert.equal(await badCode.repository.verifyAndIssueCompletion({
    challengeHash: Buffer.alloc(32), proofHash: Buffer.alloc(32), code: '000000',
  }), null);
  assert.equal(badCode.inserted, undefined);
  assert.equal(badCode.events.includes('accept-timestep'), false);
});

test('failure consuming the challenge rolls back the timestep before completion insert', async () => {
  const context = fixture({ consumedCount: 0 });
  assert.equal(await context.repository.verifyAndIssueCompletion({
    challengeHash: Buffer.alloc(32), proofHash: Buffer.alloc(32), code: '123456',
  }), null);
  assert.equal(context.inserted, undefined);
  assert.ok(context.events.includes('rollback'));
  assert.equal(context.events.includes('insert-completion'), false);
});
