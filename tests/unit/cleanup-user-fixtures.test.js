import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanupUserFixtures } from '../helpers/cleanup-user-fixtures.js';

test('cleanupUserFixtures deletes only the supplied user scope in foreign-key order', async () => {
  const calls = [];
  const models = ['activityLog', 'mfaCompletion', 'mfaChallenge', 'totpFactor', 'userRole', 'oidcIdentity', 'adminSession', 'user'];
  const tx = Object.fromEntries(models.map((model) => [model, {
    async deleteMany(args) { calls.push([model, args]); },
  }]));
  let transactionCalled = false;
  const prisma = {
    async $transaction(callback) {
      transactionCalled = true;
      return callback(tx);
    },
  };

  await cleanupUserFixtures(prisma, ['fixture-user', 'fixture-user']);

  assert.equal(transactionCalled, true);
  assert.deepEqual(calls.map(([model]) => model), models);
  assert.deepEqual(calls[0][1], { where: { OR: [{ actor: { in: ['fixture-user'] } }, { targetUserId: { in: ['fixture-user'] } }] } });
  for (const [, args] of calls.slice(1, -1)) assert.deepEqual(args, { where: { userId: { in: ['fixture-user'] } } });
  assert.deepEqual(calls.at(-1)[1], { where: { id: { in: ['fixture-user'] } } });
});

test('cleanupUserFixtures does not open a transaction for an empty fixture set', async () => {
  let transactionCalled = false;
  await cleanupUserFixtures({ $transaction: async () => { transactionCalled = true; } }, []);
  assert.equal(transactionCalled, false);
});
