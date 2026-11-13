import { createHash } from 'node:crypto';

export function createAuthRoutes({ orchestration, sessionService, sessionAdapter, csrfMiddleware, rateLimitMiddleware, logger }) {
  if (typeof orchestration?.login !== 'function'
    || typeof orchestration?.completeMfa !== 'function'
    || typeof sessionService?.validateSession !== 'function'
    || typeof sessionService?.revokeAllUserSessions !== 'function'
    || !sessionAdapter || !csrfMiddleware || !rateLimitMiddleware || !logger) {
    throw new TypeError('All auth route dependencies are required');
  }

  async function handleLogin(req, res, next) {
    try {
      const { email, username, password } = req.body;
      if (typeof email !== 'string' && typeof username !== 'string') {
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Email or username required' } });
      }
      if (typeof password !== 'string') {
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Password required' } });
      }

      const limit = rateLimitMiddleware.checkLogin(req);
      if (!limit.allowed) {
        return res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many login attempts' } });
      }

      const identity = email || username;
      const result = await orchestration.login({ email: email || username, password });

      if (result.status === 'AUTHENTICATION_FAILED' || result.status === 'INVALID_INPUT') {
        return res.status(401).json({ error: { code: 'AUTHENTICATION_FAILED', message: 'Invalid credentials' } });
      }

      if (result.status !== 'MFA_REQUIRED') {
        return res.status(401).json({ error: { code: 'AUTHENTICATION_FAILED', message: 'Invalid credentials' } });
      }

      const csrfToken = req.csrfToken || csrfMiddleware.middleware.csrfToken;
      return res.status(200).json({
        status: 'MFA_REQUIRED',
        challenge: result.challenge,
        expiresAt: result.expiresAt,
        csrfToken,
      });
    } catch (error) {
      logger?.error?.('auth_login_failed', { requestId: req.id, error: error?.message });
      return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
    }
  }

  async function handleMfaVerify(req, res, next) {
    try {
      const { challenge, code, csrfToken } = req.body;

      if (typeof challenge !== 'string' || typeof code !== 'string') {
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Challenge and code required' } });
      }

      if (typeof csrfToken !== 'string' || !csrfMiddleware.validateToken(csrfToken)) {
        return res.status(403).json({ error: { code: 'CSRF_INVALID', message: 'CSRF validation failed' } });
      }

      const challengeHash = createHash('sha256').update(Buffer.from(challenge, 'base64url')).digest('base64url');
      const limit = rateLimitMiddleware.checkMfa(req, challengeHash);
      if (!limit.allowed) {
        return res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many MFA attempts' } });
      }

      const result = await orchestration.completeMfa({ challenge, code });

      if (result.status !== 'AUTHENTICATED') {
        return res.status(401).json({ error: { code: 'AUTHENTICATION_FAILED', message: 'Invalid credentials' } });
      }

      sessionAdapter.setCookie(res, result.token);
      return res.status(200).json({ status: 'AUTHENTICATED', expiresAt: result.expiresAt });
    } catch (error) {
      logger?.error?.('auth_mfa_verify_failed', { requestId: req.id, error: error?.message });
      return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
    }
  }

  async function handleLogout(req, res, next) {
    try {
      const token = req.cookies?.[sessionAdapter.cookieName];
      if (!token) {
        sessionAdapter.clearCookie(res);
        return res.status(200).json({ status: 'LOGGED_OUT' });
      }

      const validation = await sessionService.validateSession(token);
      if (validation.status === 'SESSION_VALID') {
        await sessionService.revokeAllUserSessions(validation.userId);
      }

      sessionAdapter.clearCookie(res);
      return res.status(200).json({ status: 'LOGGED_OUT' });
    } catch (error) {
      logger?.error?.('auth_logout_failed', { requestId: req.id, error: error?.message });
      sessionAdapter.clearCookie(res);
      return res.status(200).json({ status: 'LOGGED_OUT' });
    }
  }

  async function handleGetSession(req, res, next) {
    try {
      const session = await sessionAdapter.validateFromCookie(req);
      if (!session) {
        return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Session invalid or expired' } });
      }

      return res.status(200).json({
        status: 'AUTHENTICATED',
        sessionId: session.sessionId,
        userId: session.userId,
        expiresAt: session.expiresAt,
      });
    } catch (error) {
      logger?.error?.('auth_get_session_failed', { requestId: req.id, error: error?.message });
      return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
    }
  }

  return {
    handleLogin,
    handleMfaVerify,
    handleLogout,
    handleGetSession,
  };
}
