const authenticationFailed = Object.freeze({
  status: 'AUTHENTICATION_FAILED',
  error: Object.freeze({ code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' }),
});
const mfaRequiredUnavailable = Object.freeze({ status: 'MFA_VERIFICATION_REJECTED' });

export function createAuthenticationOrchestrationService({ localLogin, challengeService, mfaVerificationService, sessionService } = {}) {
  if (typeof localLogin !== 'function'
    || typeof challengeService?.createChallenge !== 'function'
    || typeof sessionService?.createSession !== 'function') {
    throw new TypeError('Authentication orchestration dependencies are required');
  }

  async function login(credentials) {
    let result;
    try {
      result = await localLogin(credentials);
    } catch {
      return authenticationFailed;
    }
    if (result?.status !== 'PASSWORD_VERIFIED_MFA_REQUIRED'
      || typeof result.userId !== 'string' || result.userId.length === 0) return result;
    if (typeof mfaVerificationService?.verify !== 'function') return authenticationFailed;

    try {
      const challenge = await challengeService.createChallenge({ userId: result.userId });
      if (challenge?.status !== 'MFA_CHALLENGE_CREATED') return authenticationFailed;
      return { status: 'MFA_REQUIRED', challenge: challenge.challenge, expiresAt: challenge.expiresAt };
    } catch {
      return authenticationFailed;
    }
  }

  async function completeMfa({ challenge, code } = {}) {
    if (typeof mfaVerificationService?.verify !== 'function') return mfaRequiredUnavailable;
    let verification;
    try {
      verification = await mfaVerificationService.verify({ challenge, code });
    } catch {
      return mfaRequiredUnavailable;
    }
    if (verification?.status !== 'MFA_COMPLETION_CREATED'
      || typeof verification.userId !== 'string'
      || typeof verification.proof !== 'string') return mfaRequiredUnavailable;

    try {
      const session = await sessionService.createSession({
        userId: verification.userId,
        completionProof: verification.proof,
      });
      return session?.status === 'SESSION_CREATED'
        ? { status: 'AUTHENTICATED', token: session.token, expiresAt: session.expiresAt }
        : mfaRequiredUnavailable;
    } catch {
      return mfaRequiredUnavailable;
    }
  }

  return Object.freeze({ login, completeMfa });
}
