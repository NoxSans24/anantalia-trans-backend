import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import test from 'node:test';
import { createMfaVerificationService } from '../../src/auth/mfa-verification-service.js';
import { createTotpKeyringProvider } from '../../src/auth/totp-keyring-provider.js';

const now = new Date('2026-11-04T00:00:00.000Z');

function fixture({ accepted = true, factorStatus = 'ACTIVE' } = {}) {
  const calls = [];
  const completionRepository = {
    async verifyAndIssueCompletion(input) {
      calls.push(input);
      return accepted && factorStatus === 'ACTIVE' && input.code === '123456'
        ? { userId: 'database-user', expiresAt: new Date(now.getTime() + 300_000) }
        : null;
    },
  };
  return { service: createMfaVerificationService({ completionRepository }), calls };
}

test('valid trusted TOTP returns a random 256-bit proof after repository completion', async () => {
  const context = fixture();
  const challenge = randomBytes(32).toString('base64url');
  const result = await context.service.verify({ challenge, code: '123456' });
  assert.equal(result.status, 'MFA_COMPLETION_CREATED');
  assert.equal(result.userId, 'database-user');
  assert.match(result.proof, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(Buffer.from(result.proof, 'base64url').length, 32);
  const [storedInput] = context.calls;
  assert.deepEqual(storedInput.challengeHash, createHash('sha256').update(Buffer.from(challenge, 'base64url')).digest());
  assert.deepEqual(storedInput.proofHash, createHash('sha256').update(Buffer.from(result.proof, 'base64url')).digest());
  assert.equal(Object.hasOwn(storedInput, 'proof'), false);
  assert.equal(Object.hasOwn(storedInput, 'userId'), false);
  assert.equal(Object.hasOwn(storedInput, 'purpose'), false);
  assert.equal(Object.hasOwn(storedInput, 'verified'), false);
  assert.equal(Object.keys(context.service).join(','), 'verify');
});

test('wrong code, invalid challenge states, and non-active factors produce no proof', async (t) => {
  for (const input of [
    { code: '000000' },
    { code: '123456', accepted: false },
    { code: '123456', factorStatus: 'PENDING' },
    { code: '123456', factorStatus: 'REVOKED' },
  ]) {
    await t.test(`rejects ${input.factorStatus ?? (input.accepted === false ? 'invalid challenge' : 'wrong code')}`, async () => {
      const context = fixture(input);
      const result = await context.service.verify({ challenge: randomBytes(32).toString('base64url'), code: input.code });
      assert.deepEqual(result, { status: 'MFA_VERIFICATION_REJECTED' });
      assert.equal(Object.hasOwn(result, 'proof'), false);
    });
  }
});

test('caller claims cannot set identity, purpose, factor, or verification outcome', async () => {
  const context = fixture();
  const challenge = randomBytes(32).toString('base64url');
  const result = await context.service.verify({
    challenge,
    code: '123456',
    userId: 'attacker-user',
    purpose: 'PASSWORD_RESET',
    factorId: 'attacker-factor',
    verified: true,
  });
  assert.equal(result.status, 'MFA_COMPLETION_CREATED');
  assert.equal(context.calls[0].code, '123456');
  assert.equal(Object.hasOwn(context.calls[0], 'userId'), false);
  assert.equal(Object.hasOwn(context.calls[0], 'purpose'), false);
});

test('repository rejection fails closed and creates no proof', async () => {
  let called = false;
  const service = createMfaVerificationService({
    completionRepository: { async verifyAndIssueCompletion() { called = true; return null; } },
  });
  assert.deepEqual(await service.verify({ challenge: randomBytes(32).toString('base64url'), code: '123456' }), { status: 'MFA_VERIFICATION_REJECTED' });
  assert.equal(called, true);
});

test('keyring provider returns configured keys and fails closed when its source is unavailable', async () => {
  const keyring = { activeKeyId: 'kid-1', keys: { 'kid-1': Buffer.alloc(32, 7) } };
  assert.equal(await createTotpKeyringProvider({ loadKeyring: async () => keyring }).load(), keyring);
  assert.equal(await createTotpKeyringProvider({ loadKeyring: async () => { throw new Error('sensitive provider detail'); } }).load(), null);
});
