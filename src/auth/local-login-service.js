import { parseLoginInput } from './login-input.js';

const invalidInput = Object.freeze({
  status: 'INVALID_INPUT',
  error: Object.freeze({ code: 'INVALID_LOGIN_REQUEST', message: 'Invalid login request' }),
});
const authenticationFailed = Object.freeze({
  status: 'AUTHENTICATION_FAILED',
  error: Object.freeze({ code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' }),
});

export function createLocalLoginService({ userRepository, passwordVerifier } = {}) {
  if (typeof userRepository?.findForLocalLogin !== 'function') {
    throw new TypeError('A local login user repository is required');
  }
  if (typeof passwordVerifier !== 'function') {
    throw new TypeError('A password verifier is required');
  }

  return async function authenticateLocalCredentials(input) {
    const parsed = parseLoginInput(input);
    if (!parsed.ok) return invalidInput;

    let user;
    try {
      user = await userRepository.findForLocalLogin(parsed.credentials.identity);
    } catch {
      throw new Error('Local authentication service unavailable');
    }

    if (!user || typeof user.id !== 'string' || user.id.length === 0 || user.status !== 'ACTIVE' || user.deletedAt !== null || typeof user.passwordHash !== 'string' || user.passwordHash.length === 0) {
      return authenticationFailed;
    }

    let passwordMatches;
    try {
      passwordMatches = await passwordVerifier(parsed.credentials.password, user.passwordHash);
    } catch {
      throw new Error('Local authentication service unavailable');
    }
    return passwordMatches === true ? { status: 'PASSWORD_VERIFIED_MFA_REQUIRED', userId: user.id } : authenticationFailed;
  };
}
