import assert from 'node:assert/strict';
import test from 'node:test';
import { createMyProfileService } from '../../src/auth/my-profile-service.js';

function setup() {
  const user = { id: 'user-id', email: 'admin@example.test', username: 'admin', displayName: null, passwordHash: 'old-hash', status: 'ACTIVE', roles: [] };
  const logs = [];
  const tx = {
    user: {
      async update({ data }) { Object.assign(user, data); return { ...user }; },
      async updateMany({ where, data }) {
        if (where.passwordHash !== user.passwordHash) return { count: 0 };
        Object.assign(user, data);
        return { count: 1 };
      },
    },
    activityLog: { async create({ data }) { logs.push(data); return data; } },
  };
  const totpFactors = [];
  const totpFactorService = {
    async startEnrollment({ userId, accountName }) {
      if (!userId || !accountName) return { status: 'TOTP_FACTOR_REJECTED' };
      const factor = { id: 'factor-1', userId, status: 'PENDING' };
      totpFactors.push(factor);
      return { status: 'TOTP_ENROLLMENT_PENDING', factorId: 'factor-1', secret: 'JBSWY3DPEHPK3PXP', provisioningUri: 'otpauth://totp/...' };
    },
    async confirmEnrollment({ userId, factorId, code }) {
      if (code === '123456') {
        const factor = totpFactors.find((f) => f.id === factorId && f.userId === userId);
        if (factor) factor.status = 'ACTIVE';
        return { status: 'TOTP_ENROLLMENT_CONFIRMED' };
      }
      return { status: 'TOTP_FACTOR_REJECTED' };
    },
    async revokeFactor({ userId, factorId }) {
      const factor = totpFactors.find((f) => f.id === factorId && f.userId === userId);
      if (factor) {
        factor.status = 'REVOKED';
        return { status: 'TOTP_FACTOR_REVOKED' };
      }
      return { status: 'TOTP_FACTOR_REJECTED' };
    },
  };
  const prisma = {
    user: {
      async findUnique() { return { ...user }; },
    },
    totpFactor: {
      async findFirst({ where }) {
        return totpFactors.find((f) => f.userId === where.userId && (Array.isArray(where.status?.in) ? where.status.in.includes(f.status) : f.status === where.status)) ?? null;
      },
    },
    async $transaction(callback) { return callback(tx); },
  };
  const activityLog = { async log({ client, ...data }) { return client.activityLog.create({ data }); } };
  const service = createMyProfileService({ prisma, passwordService: { hash: async () => 'new-hash' }, activityLog, totpFactorService });
  return { service, user, logs, totpFactors };
}

test('my profile never changes email without the approved verification flow', async () => {
  const h = setup();
  await assert.rejects(h.service.updateEmail('user-id', 'new@example.test'), { status: 'EMAIL_VERIFICATION_REQUIRED' });
  assert.equal(h.user.email, 'admin@example.test');
  assert.equal(h.logs.length, 0);
});

test('profile edits normalize identifiers and commit their audit rows in the same transaction', async () => {
  const h = setup();
  const profile = await h.service.updateUsername('user-id', '  NewAdmin  ');
  assert.equal(profile.username, 'newadmin');
  assert.equal('passwordHash' in profile, false);
  await h.service.updateDisplayName('user-id', 'New Display Name');
  assert.deepEqual(h.logs.map(({ action }) => action), ['PROFILE_USERNAME_UPDATED', 'PROFILE_DISPLAY_NAME_UPDATED']);
});

test('password changes verify the old password and audit without exposing a hash', async () => {
  const h = setup();
  const verification = [];
  const result = await h.service.changePassword('user-id', 'old-password', 'new-password', async (password, hash) => {
    verification.push([password, hash]);
    return password === 'old-password' && hash === 'old-hash';
  });
  assert.deepEqual(result, { status: 'PASSWORD_CHANGED' });
  assert.equal(h.user.passwordHash, 'new-hash');
  assert.deepEqual(verification, [['old-password', 'old-hash']]);
  assert.equal(h.logs.at(-1).action, 'PASSWORD_CHANGED');
  await assert.rejects(h.service.changePassword('user-id', 'wrong', 'another', async () => false), { status: 'CURRENT_PASSWORD_INVALID' });
});

test('MFA enrollment, confirmation, status and revocation flow works with audit logs', async () => {
  const h = setup();
  // Status initial
  const statusBefore = await h.service.getMfaStatus('user-id');
  assert.equal(statusBefore.hasActiveTotp, false);
  assert.equal(statusBefore.status, 'NONE');

  // Start enrollment
  const enrollment = await h.service.startMfaEnrollment('user-id');
  assert.equal(enrollment.factorId, 'factor-1');
  assert.equal(enrollment.secret, 'JBSWY3DPEHPK3PXP');

  // Confirm with wrong code
  await assert.rejects(
    h.service.confirmMfaEnrollment('user-id', { factorId: 'factor-1', code: '000000' }),
    { status: 'MFA_VERIFICATION_FAILED' }
  );

  // Confirm with right code
  const confirmed = await h.service.confirmMfaEnrollment('user-id', { factorId: 'factor-1', code: '123456' });
  assert.equal(confirmed.status, 'MFA_FACTOR_CONFIRMED');

  // Status after confirmation
  const statusAfter = await h.service.getMfaStatus('user-id');
  assert.equal(statusAfter.hasActiveTotp, true);
  assert.equal(statusAfter.status, 'ACTIVE');

  // Revoke factor
  const revoked = await h.service.revokeMfaFactor('user-id', { factorId: 'factor-1' });
  assert.equal(revoked.status, 'MFA_FACTOR_REVOKED');
});
