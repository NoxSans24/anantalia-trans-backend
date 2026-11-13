import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { createSessionService } from '../../src/auth/session-service.js';
import { createMfaCompletionFixture } from '../helpers/mfa-completion-fixture.js';

const start = new Date('2026-01-01T00:00:00.000Z');
const account = (userId, values = {}) => ({ id: userId, status: 'ACTIVE', deletedAt: null, ...values });

function digest(token) {
  return createHash('sha256').update(token, 'utf8').digest();
}

function setup({ user = account('user-1'), repositoryOverrides = {} } = {}) {
  const users = new Map([[user.id, user]]);
  const sessions = new Map();
  const calls = { created: [], touched: [], rotated: [], revoked: [] };
  const proofs = new Map();
  let now = new Date(start);
  const mockPrisma = { mfaCompletion: { create: async ({ data }) => { proofs.set(data.proofHash.toString('hex'), data); } } };
  const repository = {
    async findUserForSession(userId) { return users.get(userId) ?? null; },
    async issueMfaCompletion(data) { proofs.set(data.proofHash.toString('hex'), data); },
    async createSessionWithProof({ data, proofHash, purpose, now }) {
      const proof = proofs.get(proofHash.toString('hex'));
      if (!proof || proof.userId !== data.userId || proof.purpose !== purpose || proof.consumedAt || proof.expiresAt <= now) return null;
      calls.created.push(data);
      if (!users.get(data.userId) || users.get(data.userId).status !== 'ACTIVE' || users.get(data.userId).deletedAt !== null) return null;
      const row = { id: randomUUID(), ...data, tokenHash: Buffer.from(data.tokenHash), revokedAt: null };
      sessions.set(row.tokenHash.toString('hex'), row);
      proof.consumedAt = now;
      return { id: row.id, absoluteExpiresAt: row.absoluteExpiresAt };
    },
    async findByTokenHash(tokenHash) {
      const row = sessions.get(Buffer.from(tokenHash).toString('hex'));
      return row ? { ...row, tokenHash: Buffer.from(row.tokenHash), user: users.get(row.userId) } : null;
    },
    async touchSession(data) {
      calls.touched.push(data);
      const row = sessions.get(Buffer.from(data.tokenHash).toString('hex'));
      const currentUser = row && users.get(row.userId);
      if (!row || row.id !== data.sessionId || row.userId !== data.userId || row.revokedAt !== null
        || row.idleExpiresAt <= data.now || row.absoluteExpiresAt <= data.now
        || currentUser?.status !== 'ACTIVE' || currentUser.deletedAt !== null) return null;
      row.lastActivityAt = data.now;
      row.idleExpiresAt = data.idleExpiresAt;
      return { id: row.id, userId: row.userId, absoluteExpiresAt: row.absoluteExpiresAt };
    },
    async rotateSession(data) {
      calls.rotated.push(data);
      const oldKey = Buffer.from(data.oldTokenHash).toString('hex');
      const row = sessions.get(oldKey);
      const currentUser = row && users.get(row.userId);
      if (!row || row.id !== data.sessionId || row.userId !== data.userId || row.revokedAt !== null
        || row.idleExpiresAt <= data.now || row.absoluteExpiresAt <= data.now
        || currentUser?.status !== 'ACTIVE' || currentUser.deletedAt !== null) return null;
      sessions.delete(oldKey);
      row.tokenHash = Buffer.from(data.newTokenHash);
      row.lastActivityAt = data.now;
      row.idleExpiresAt = data.idleExpiresAt;
      sessions.set(row.tokenHash.toString('hex'), row);
      return { id: row.id, userId: row.userId, absoluteExpiresAt: row.absoluteExpiresAt };
    },
    async revokeSession({ tokenHash, userId, now: revokedAt }) {
      const row = sessions.get(Buffer.from(tokenHash).toString('hex'));
      if (!row || row.userId !== userId || row.revokedAt !== null) return { count: 0 };
      row.revokedAt = revokedAt;
      calls.revoked.push(row.id);
      return { count: 1 };
    },
    async revokeAllUserSessions({ userId, now: revokedAt }) {
      let count = 0;
      for (const row of sessions.values()) {
        if (row.userId === userId && row.revokedAt === null) {
          row.revokedAt = revokedAt;
          count++;
        }
      }
      return { count };
    },
    ...repositoryOverrides,
  };
  const completion = createMfaCompletionFixture({ prisma: mockPrisma });
  const service = createSessionService({ repository, clock: () => now });
  return { service, completion, calls, users, sessions, setNow(value) { now = new Date(value); } };
}

async function create(harness, userId = 'user-1') {
  const completionProof = await harness.completion.issueForUser(userId);
  return harness.service.createSession({ userId, completionProof });
}

test('a session is created only after consuming a user-bound completion proof', async () => {
  const h = setup();
  const result = await create(h);
  assert.equal(result.status, 'SESSION_CREATED');
  assert.equal(h.calls.created.length, 1);
  assert.equal(result.token.length, 43);
  assert.equal(Buffer.from(result.token, 'base64url').length, 32);
  assert.deepEqual(Object.keys(result).sort(), ['expiresAt', 'status', 'token']);
});

test('missing and malformed proof fail closed without creating a session', async () => {
  const h = setup();
  for (const input of [{ userId: 'user-1' }, { userId: 'user-1', completionProof: 'bad' }]) {
    assert.equal((await h.service.createSession(input)).status, 'SESSION_CREATION_DENIED');
  }
  assert.equal(h.calls.created.length, 0);
});

test('unknown, suspended, disabled, and soft-deleted users cannot create sessions', async () => {
  for (const user of [
    null,
    account('user-1', { status: 'SUSPENDED' }),
    account('user-1', { status: 'DISABLED' }),
    account('user-1', { deletedAt: new Date(start) }),
  ]) {
    const h = setup({ user: user ?? account('other-user') });
    const userId = user?.id ?? 'user-1';
    assert.equal((await create(h, userId)).status, 'SESSION_CREATION_DENIED');
    assert.equal(h.calls.created.length, 0);
  }
});

test('the database repository receives only a SHA-256 token hash, never the raw token', async () => {
  const h = setup();
  const result = await create(h);
  const stored = [...h.sessions.values()][0];
  assert.equal(stored.tokenHash.length, 32);
  assert.deepEqual(stored.tokenHash, digest(result.token));
  assert.equal(Object.hasOwn(stored, 'token'), false);
  assert.equal(JSON.stringify(h.calls.created).includes(result.token), false);
});

test('valid session activity refreshes idle expiry but never absolute expiry', async () => {
  const h = setup();
  const created = await create(h);
  const valid = await h.service.validateSession(created.token);
  assert.equal(valid.status, 'SESSION_VALID');
  assert.equal(valid.expiresAt.getTime(), start.getTime() + 8 * 60 * 60 * 1000);
  assert.equal(h.calls.touched.length, 1);
  assert.equal(h.calls.touched[0].idleExpiresAt.getTime(), start.getTime() + 30 * 60 * 1000);

  const row = [...h.sessions.values()][0];
  row.lastActivityAt = new Date(start.getTime() + 7 * 60 * 60 * 1000 + 25 * 60 * 1000);
  row.idleExpiresAt = new Date(start.getTime() + 7 * 60 * 60 * 1000 + 55 * 60 * 1000);
  h.setNow(new Date(start.getTime() + 7 * 60 * 60 * 1000 + 40 * 60 * 1000));
  const lastWindow = await h.service.validateSession(created.token);
  assert.equal(lastWindow.status, 'SESSION_VALID');
  assert.equal(row.idleExpiresAt.getTime(), row.absoluteExpiresAt.getTime());
  assert.equal(row.absoluteExpiresAt.getTime(), start.getTime() + 8 * 60 * 60 * 1000);
});

test('idle-expired and absolute-expired sessions are rejected without activity updates', async () => {
  for (const offset of [30 * 60 * 1000, 8 * 60 * 60 * 1000]) {
    const h = setup();
    const created = await create(h);
    h.setNow(new Date(start.getTime() + offset));
    const result = await h.service.validateSession(created.token);
    assert.equal(result.status, 'SESSION_INVALID');
    assert.equal(h.calls.touched.length, 0);
  }
});

test('revoked sessions are rejected', async () => {
  const h = setup();
  const created = await create(h);
  await h.service.revokeSession({ token: created.token, userId: 'user-1' });
  assert.equal((await h.service.validateSession(created.token)).status, 'SESSION_INVALID');
});

test('rotation replaces the token hash and makes the old token invalid', async () => {
  const h = setup();
  const created = await create(h);
  const absoluteExpiresAt = [...h.sessions.values()][0].absoluteExpiresAt;
  const rotated = await h.service.rotateSession(created.token);
  assert.equal(rotated.status, 'SESSION_ROTATED');
  assert.notEqual(rotated.token, created.token);
  assert.equal((await h.service.validateSession(created.token)).status, 'SESSION_INVALID');
  assert.equal((await h.service.validateSession(rotated.token)).status, 'SESSION_VALID');
  assert.equal([...h.sessions.values()][0].absoluteExpiresAt, absoluteExpiresAt);
});

test('failed rotation does not return a new token', async () => {
  const h = setup({ repositoryOverrides: { async rotateSession() { return null; } } });
  const created = await create(h);
  const result = await h.service.rotateSession(created.token);
  assert.deepEqual(result, { status: 'SESSION_INVALID', error: { code: 'INVALID_SESSION', message: 'Session is invalid' } });
  assert.equal(Object.hasOwn(result, 'token'), false);
});

test('concurrent rotations expose at most one replacement token', async () => {
  const h = setup();
  const created = await create(h);
  const results = await Promise.all([
    h.service.rotateSession(created.token),
    h.service.rotateSession(created.token),
  ]);
  assert.equal(results.filter(({ status }) => status === 'SESSION_ROTATED').length, 1);
  assert.equal(results.filter(({ status }) => status === 'SESSION_INVALID').length, 1);
  assert.equal(h.sessions.size, 1);
  assert.deepEqual([...h.sessions.values()][0].tokenHash, digest(results.find(({ status }) => status === 'SESSION_ROTATED').token));
});

test('revoke one session is user-scoped and idempotent', async () => {
  const h = setup();
  const first = await create(h);
  const second = await create(h);
  const result = await h.service.revokeSession({ token: first.token, userId: 'user-1' });
  assert.equal(result.status, 'SESSION_REVOCATION_ACCEPTED');
  assert.equal((await h.service.validateSession(first.token)).status, 'SESSION_INVALID');
  assert.equal((await h.service.validateSession(second.token)).status, 'SESSION_VALID');
  assert.equal((await h.service.revokeSession({ token: first.token, userId: 'user-1' })).status, 'SESSION_REVOCATION_ACCEPTED');
});

test('revoke all sessions affects only the selected user', async () => {
  const h = setup();
  const first = await create(h);
  const second = await create(h);
  h.users.set('user-2', account('user-2'));
  const other = await create(h, 'user-2');
  await h.service.revokeAllUserSessions('user-1');
  assert.equal((await h.service.validateSession(first.token)).status, 'SESSION_INVALID');
  assert.equal((await h.service.validateSession(second.token)).status, 'SESSION_INVALID');
  assert.equal((await h.service.validateSession(other.token)).status, 'SESSION_VALID');
});

test('a caller identity mismatch cannot revoke another user session', async () => {
  const h = setup();
  const session = await create(h);
  await h.service.revokeSession({ token: session.token, userId: 'another-user' });
  assert.equal((await h.service.validateSession(session.token)).status, 'SESSION_VALID');
});

test('an inactive account causes all of its sessions to be revoked on validation', async () => {
  const h = setup();
  const first = await create(h);
  const second = await create(h);
  h.users.get('user-1').status = 'SUSPENDED';
  assert.equal((await h.service.validateSession(first.token)).status, 'SESSION_INVALID');
  assert.equal([...h.sessions.values()].every((session) => session.revokedAt instanceof Date), true);
  assert.equal((await h.service.validateSession(second.token)).status, 'SESSION_INVALID');
});

test('a status change before transactional proof consumption prevents session creation', async () => {
  const user = account('user-1');
  let createCalled = false;
  const service = createSessionService({
    repository: {
      async findUserForSession() { return user; },
      async issueMfaCompletion() {},
      async createSessionWithProof() { createCalled = true; user.status = 'DISABLED'; return null; },
      async findByTokenHash() { return null; },
      async touchSession() { return null; },
      async rotateSession() { return null; },
      async revokeSession() { return { count: 0 }; },
      async revokeAllUserSessions() { return { count: 0 }; },
    },
    clock: () => start,
  });
  const completion = createMfaCompletionFixture({ prisma: { mfaCompletion: { create: async () => {} } }, clock: () => start });
  const proof = await completion.issueForUser('user-1');
  assert.equal((await service.createSession({ userId: 'user-1', completionProof: proof })).status, 'SESSION_CREATION_DENIED');
  assert.equal(createCalled, true);
});

test('session tokens and hashes are never logged', async (t) => {
  const logged = [];
  for (const name of ['log', 'info', 'warn', 'error']) t.mock.method(console, name, (...args) => logged.push(args));
  const h = setup();
  const created = await create(h);
  await h.service.validateSession(created.token);
  await h.service.rotateSession(created.token);
  assert.deepEqual(logged, []);
});

test('session repository is mandatory and completion is provided only as a proof', () => {
  assert.throws(() => createSessionService(), /session repository is required/);
  const requiredRepository = {
    findUserForSession() {}, createSessionWithProof() {}, findByTokenHash() {}, touchSession() {}, rotateSession() {}, revokeSession() {}, revokeAllUserSessions() {},
  };
  assert.doesNotThrow(() => createSessionService({ repository: requiredRepository }));
});