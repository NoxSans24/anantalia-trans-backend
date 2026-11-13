import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthenticationOrchestrationService } from '../../src/auth/authentication-orchestration-service.js';

function setup({ loginResult = { status: 'PASSWORD_VERIFIED_MFA_REQUIRED', userId: 'verified-user' }, verificationResult = { status: 'MFA_COMPLETION_CREATED', userId: 'challenge-user', proof: 'completion-proof' }, sessionResult = { status: 'SESSION_CREATED', token: 'opaque-session-token', expiresAt: new Date('2026-11-04T08:00:00Z') }, verifierAvailable = true } = {}) {
  const calls = [];
  const service = createAuthenticationOrchestrationService({
    async localLogin(input) { calls.push(['login', input]); return loginResult; },
    challengeService: { async createChallenge(input) { calls.push(['challenge', input]); return { status: 'MFA_CHALLENGE_CREATED', challenge: 'opaque-challenge', expiresAt: new Date('2026-11-04T00:05:00Z') }; } },
    mfaVerificationService: verifierAvailable ? { async verify(input) { calls.push(['verify', input]); return verificationResult; } } : null,
    sessionService: { async createSession(input) { calls.push(['session', input]); return sessionResult; } },
  });
  return { service, calls };
}

test('password failure creates no challenge, completion proof, or session', async () => {
  const context = setup({ loginResult: { status: 'AUTHENTICATION_FAILED', error: { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' } } });
  assert.equal((await context.service.login({ email: 'operator@example.test', password: 'wrong' })).status, 'AUTHENTICATION_FAILED');
  assert.deepEqual(context.calls.map(([name]) => name), ['login']);
});

test('password success returns only MFA_REQUIRED and creates no session', async () => {
  const context = setup();
  const result = await context.service.login({ email: 'operator@example.test', password: 'valid' });
  assert.equal(result.status, 'MFA_REQUIRED');
  assert.equal(result.challenge, 'opaque-challenge');
  assert.equal(Object.hasOwn(result, 'userId'), false);
  assert.deepEqual(context.calls.map(([name]) => name), ['login', 'challenge']);
  assert.deepEqual(context.calls[1][1], { userId: 'verified-user' });
});

test('TOTP failure creates neither a session nor a successful login result', async () => {
  const context = setup({ verificationResult: { status: 'MFA_VERIFICATION_REJECTED' } });
  const result = await context.service.completeMfa({ challenge: 'opaque-challenge', code: '000000' });
  assert.deepEqual(result, { status: 'MFA_VERIFICATION_REJECTED' });
  assert.deepEqual(context.calls.map(([name]) => name), ['verify']);
});

test('valid completion proof uses its verified identity and caller cannot override its scope', async () => {
  const context = setup();
  const result = await context.service.completeMfa({
    challenge: 'opaque-challenge', code: '123456', userId: 'caller-user', purpose: 'PASSWORD_RESET', verified: true,
  });
  assert.equal(result.status, 'AUTHENTICATED');
  assert.equal(result.token, 'opaque-session-token');
  assert.deepEqual(context.calls[0], ['verify', { challenge: 'opaque-challenge', code: '123456' }]);
  assert.deepEqual(context.calls[1], ['session', { userId: 'challenge-user', completionProof: 'completion-proof' }]);
  assert.equal(Object.hasOwn(result, 'userId'), false);
});

test('proof replay rejection and session failure never report successful authentication', async () => {
  const replay = setup({ verificationResult: { status: 'MFA_VERIFICATION_REJECTED' } });
  assert.equal((await replay.service.completeMfa({ challenge: 'same', code: '123456' })).status, 'MFA_VERIFICATION_REJECTED');
  assert.equal(replay.calls.some(([name]) => name === 'session'), false);

  const failedSession = setup({ sessionResult: { status: 'SESSION_CREATION_DENIED' } });
  assert.equal((await failedSession.service.completeMfa({ challenge: 'opaque-challenge', code: '123456' })).status, 'MFA_VERIFICATION_REJECTED');
});

test('missing keyring-backed verification fails closed before issuing a challenge', async () => {
  const context = setup({ verifierAvailable: false });
  assert.equal((await context.service.login({ email: 'operator@example.test', password: 'valid' })).status, 'AUTHENTICATION_FAILED');
  assert.deepEqual(await context.service.completeMfa({ challenge: 'opaque-challenge', code: '123456' }), { status: 'MFA_VERIFICATION_REJECTED' });
  assert.deepEqual(context.calls.map(([name]) => name), ['login']);
});
