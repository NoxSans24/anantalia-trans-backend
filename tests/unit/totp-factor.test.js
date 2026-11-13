import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import test from 'node:test';
import { createTotpFactorService } from '../../src/auth/totp-factor-service.js';

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const key = randomBytes(32);
const start = new Date('2026-11-04T00:00:00.000Z');

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

function fixture({ clock = () => new Date(start), cryptoKey = key } = {}) {
  const factors = new Map();
  const repository = {
    async createPendingFactor(data) {
      const factor = { ...data, confirmedAt: null, lastAcceptedTimeStep: null };
      factors.set(factor.id, factor);
      return { id: factor.id, createdAt: factor.createdAt };
    },
    async findFactor({ userId, factorId, status }) {
      const factor = factorId
        ? factors.get(factorId)
        : [...factors.values()].find((candidate) => candidate.userId === userId && candidate.status === status);
      if (!factor || factor.userId !== userId || factor.status !== status) return null;
      return factor;
    },
    async confirmPendingFactor({ userId, factorId, timeStep, now }) {
      const factor = factors.get(factorId);
      if (!factor || factor.userId !== userId || factor.status !== 'PENDING') return false;
      factor.status = 'ACTIVE';
      factor.confirmedAt = now;
      factor.lastAcceptedTimeStep = timeStep;
      return true;
    },
    async revokeFactor({ userId, factorId, now }) {
      const factor = factors.get(factorId);
      if (!factor || factor.userId !== userId || !['PENDING', 'ACTIVE'].includes(factor.status)) return false;
      factor.status = 'REVOKED';
      factor.revokedAt = now;
      return true;
    },
  };
  const service = createTotpFactorService({
    repository,
    encryption: { activeKeyId: 'test-k1', keys: { 'test-k1': cryptoKey } },
    clock,
  });
  return {
    service, factors, repository,
  };
}

async function enrolled(context = fixture(), userId = 'user-a') {
  const enrollment = await context.service.startEnrollment({ userId, accountName: 'admin@example.test' });
  return { ...enrollment, userId };
}

test('enrollment returns an RFC-compatible provisioning URI and persists only encrypted secret material', async () => {
  const context = fixture();
  const enrollment = await enrolled(context);
  const factor = context.factors.get(enrollment.factorId);
  const uri = new URL(enrollment.provisioningUri);
  const secondEnrollment = await context.service.startEnrollment({ userId: 'user-b', accountName: 'other@example.test' });
  assert.equal(enrollment.status, 'TOTP_ENROLLMENT_PENDING');
  assert.equal(enrollment.secret.length, 32);
  assert.equal(uri.protocol, 'otpauth:');
  assert.equal(uri.searchParams.get('secret'), enrollment.secret);
  assert.equal(uri.searchParams.get('algorithm'), 'SHA1');
  assert.equal(uri.searchParams.get('digits'), '6');
  assert.equal(uri.searchParams.get('period'), '30');
  assert.equal(factor.status, 'PENDING');
  assert.equal(Object.hasOwn(factor, 'secret'), false);
  assert.equal(Object.hasOwn(factor, 'plaintextSecret'), false);
  assert.equal(factor.encryptedSecret.length, 20);
  assert.equal(factor.secretNonce.length, 12);
  assert.equal(factor.secretAuthTag.length, 16);
  assert.equal(factor.encryptionKeyId, 'test-k1');
  assert.notDeepEqual(factor.secretNonce, context.factors.get(secondEnrollment.factorId).secretNonce);
  assert.notDeepEqual(factor.encryptedSecret, decodeBase32(enrollment.secret));
  assert.equal(Object.hasOwn(context.service, 'getSecret'), false);
});

test('pending enrollment activates only after a valid constant-time TOTP code', async () => {
  const context = fixture();
  const enrollment = await enrolled(context);
  const step = BigInt(Math.floor(start.getTime() / 30_000));
  const validCode = codeAt(enrollment.secret, step);
  const invalidCode = validCode === '000000' ? '000001' : '000000';
  assert.deepEqual(await context.service.confirmEnrollment({ userId: enrollment.userId, factorId: enrollment.factorId, code: invalidCode }), { status: 'TOTP_FACTOR_REJECTED' });
  assert.equal(context.factors.get(enrollment.factorId).status, 'PENDING');
  assert.deepEqual(await context.service.confirmEnrollment({
    userId: enrollment.userId,
    factorId: enrollment.factorId,
    code: validCode,
  }), { status: 'TOTP_ENROLLMENT_CONFIRMED' });
  assert.equal(context.factors.get(enrollment.factorId).status, 'ACTIVE');
  assert.equal(context.factors.get(enrollment.factorId).lastAcceptedTimeStep, step);
});

test('the previous and next time step are accepted, while malformed and out-of-window codes fail closed', async (t) => {
  const currentStep = BigInt(Math.floor(start.getTime() / 30_000));
  for (const step of [currentStep - 1n, currentStep + 1n]) {
    await t.test(`accepts drift step ${step - currentStep}`, async () => {
      const context = fixture();
      const enrollment = await enrolled(context);
      const factor = context.factors.get(enrollment.factorId);
      factor.status = 'ACTIVE';
      assert.equal(context.service.verifyCode({
        factor: context.factors.get(enrollment.factorId),
        code: codeAt(enrollment.secret, step),
        now: start,
      }), step);
    });
  }

  for (const code of ['12345', 'abcdef', '123456\n']) {
    const context = fixture();
    const enrollment = await enrolled(context);
    context.factors.get(enrollment.factorId).status = 'ACTIVE';
    assert.equal(context.service.verifyCode({ factor: context.factors.get(enrollment.factorId), code, now: start }), null);
  }

  for (const step of [currentStep - 2n, currentStep + 2n]) {
    const context = fixture();
    const enrollment = await enrolled(context);
    context.factors.get(enrollment.factorId).status = 'ACTIVE';
    assert.equal(context.service.verifyCode({ factor: context.factors.get(enrollment.factorId), code: codeAt(enrollment.secret, step), now: start }), null);
  }
});

test('only active factors can verify a TOTP code', async () => {
  const context = fixture();
  const enrollment = await enrolled(context);
  const factor = context.factors.get(enrollment.factorId);
  factor.status = 'ACTIVE';
  const step = BigInt(Math.floor(start.getTime() / 30_000));
  const input = { factor, code: codeAt(enrollment.secret, step), now: start };
  assert.equal(context.service.verifyCode(input), step);
  assert.deepEqual(await context.service.revokeFactor({ userId: enrollment.userId, factorId: enrollment.factorId }), { status: 'TOTP_FACTOR_REVOKED' });
  assert.equal(context.service.verifyCode({ ...input, factor: { ...factor, status: 'REVOKED' }, code: codeAt(enrollment.secret, step + 1n) }), null);
});

test('wrong encryption keys and damaged authentication tags fail closed', async (t) => {
  for (const damage of ['key', 'tag']) {
    await t.test(`rejects damaged ${damage}`, async () => {
      const context = fixture();
      const enrollment = await enrolled(context);
      const factor = context.factors.get(enrollment.factorId);
      factor.status = 'ACTIVE';
      if (damage === 'tag') factor.secretAuthTag[0] ^= 1;
      const otherKey = damage === 'key' ? randomBytes(32) : key;
      const service = createTotpFactorService({
        repository: {
          ...context.repository,
          async findFactor() { return factor; },
        },
        encryption: { activeKeyId: 'test-k1', keys: { 'test-k1': otherKey } },
      });
      const step = BigInt(Math.floor(start.getTime() / 30_000));
      assert.equal(service.verifyCode({ factor, code: codeAt(enrollment.secret, step), now: start }), null);
    });
  }
  const repository = fixture().repository;
  assert.throws(() => createTotpFactorService({ repository }), /active TOTP encryption key id/);
  assert.throws(() => createTotpFactorService({ repository, encryption: { activeKeyId: 'missing', keys: {} } }), /active TOTP encryption key id/);
});

