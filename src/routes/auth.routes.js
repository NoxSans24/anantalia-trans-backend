import express from 'express';
import { createHash } from 'node:crypto';

export function createAuthRouter({ orchestration, sessionService, sessionAdapter, principalService, csrfMiddleware, rateLimitMiddleware, logger }) {
  const router = express.Router();

  if (!orchestration || !sessionService || !sessionAdapter || !csrfMiddleware || !rateLimitMiddleware) {
    throw new TypeError('All auth route dependencies are required');
  }

  async function handleLogin(req, res) {
    try {
      const { email, username, password } = req.body;
      if (!csrfMiddleware.validateRequest(req, req.body.csrfToken)) {
        return res.status(403).json({ error: { code: 'CSRF_INVALID', message: 'CSRF validation failed' } });
      }
      if (typeof email === 'string' && typeof username === 'string') {
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Provide one identifier' } });
      }
      if (typeof email !== 'string' && typeof username !== 'string') {
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Email or username required' } });
      }
      if (typeof password !== 'string') {
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Password required' } });
      }

      const identifier = (email || username).trim();
      const limit = rateLimitMiddleware.checkLogin(req, identifier);
      if (!limit.allowed) {
        return res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many login attempts' } });
      }

      const credentials = typeof username === 'string' || !identifier.includes('@')
        ? { username: identifier, password }
        : { email: identifier, password };
      const result = await orchestration.login(credentials);

      if (result.status === 'AUTHENTICATION_FAILED' || result.status === 'INVALID_INPUT') {
        return res.status(401).json({ error: { code: 'AUTHENTICATION_FAILED', message: 'Invalid credentials' } });
      }

      if (result.status !== 'MFA_REQUIRED') {
        return res.status(401).json({ error: { code: 'AUTHENTICATION_FAILED', message: 'Invalid credentials' } });
      }

      return res.status(200).json({
        status: 'MFA_REQUIRED',
        challenge: result.challenge,
        expiresAt: result.expiresAt,
        csrfToken: req.csrfToken,
      });
    } catch (error) {
      logger?.error?.('auth_login_failed', { requestId: req.id });
      return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
    }
  }

  async function handleMfaVerify(req, res) {
    try {
      const { challenge, code, csrfToken } = req.body;

      if (typeof challenge !== 'string' || typeof code !== 'string') {
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Challenge and code required' } });
      }

      if (!csrfMiddleware.validateRequest(req, csrfToken)) {
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
      csrfMiddleware.setSessionToken(res, result.token);
      return res.status(200).json({ status: 'AUTHENTICATED', expiresAt: result.expiresAt });
    } catch (error) {
      logger?.error?.('auth_mfa_verify_failed', { requestId: req.id });
      return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
    }
  }

  async function handleLogout(req, res) {
    try {
      const { csrfToken } = req.body;
      
      if (!csrfMiddleware.validateRequest(req, csrfToken)) {
        return res.status(403).json({ error: { code: 'CSRF_INVALID', message: 'CSRF validation failed' } });
      }

      const token = req.cookies?.[sessionAdapter.cookieName];
      if (token) {
        const validation = await sessionService.validateSession(token);
        if (validation.status === 'SESSION_VALID') {
          await sessionService.revokeSession({ token, userId: validation.userId });
        }
      }

      sessionAdapter.clearCookie(res);
      csrfMiddleware.clearCookie(res);
      return res.status(200).json({ status: 'LOGGED_OUT' });
    } catch (error) {
      logger?.error?.('auth_logout_failed', { requestId: req.id });
      return res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Logout could not be completed' } });
    }
  }

  async function handleGetSession(req, res) {
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
      logger?.error?.('auth_get_session_failed', { requestId: req.id });
      return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
    }
  }

  async function handleRotateSession(req, res) {
    try {
      const { csrfToken } = req.body;
      if (!csrfMiddleware.validateRequest(req, csrfToken)) {
        return res.status(403).json({ error: { code: 'CSRF_INVALID', message: 'CSRF validation failed' } });
      }
      const token = req.cookies?.[sessionAdapter.cookieName];
      const result = await sessionService.rotateSession(token);
      if (result.status !== 'SESSION_ROTATED') return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Session invalid or expired' } });
      sessionAdapter.setCookie(res, result.token);
      csrfMiddleware.setSessionToken(res, result.token);
      return res.status(200).json({ status: result.status, expiresAt: result.expiresAt });
    } catch {
      logger?.error?.('auth_session_rotation_failed', { requestId: req.id });
      return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
    }
  }

  router.use(csrfMiddleware.middleware);
  router.get('/csrf', (req, res) => res.status(200).json({ csrfToken: req.csrfToken }));
  router.post('/login', handleLogin);
  router.post('/mfa/verify', handleMfaVerify);
  router.post('/logout', handleLogout);
  router.post('/sessions/revoke-all', async (req, res) => {
    try {
      if (!csrfMiddleware.validateRequest(req, req.body.csrfToken)) {
        return res.status(403).json({ error: { code: 'CSRF_INVALID', message: 'CSRF validation failed' } });
      }
      const session = await sessionAdapter.validateFromCookie(req);
      if (!session) return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Session invalid or expired' } });
      await sessionService.revokeAllUserSessions(session.userId);
      sessionAdapter.clearCookie(res);
      csrfMiddleware.clearCookie(res);
      return res.status(200).json({ status: 'SESSIONS_REVOKED' });
    } catch {
      logger?.error?.('auth_revoke_all_sessions_failed', { requestId: req.id });
      return res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Sessions could not be revoked' } });
    }
  });
  router.get('/session', handleGetSession);
  router.post('/session/rotate', handleRotateSession);
  if (principalService?.getPrincipal) {
    router.get('/me', async (req, res) => {
      try {
        const session = await sessionAdapter.validateFromCookie(req);
        if (!session) return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Session invalid or expired' } });
        const principal = await principalService.getPrincipal(session.userId);
        if (!principal) return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Session invalid or expired' } });
        return res.status(200).json({ ...principal, expiresAt: session.expiresAt });
      } catch {
        logger?.error?.('auth_get_principal_failed', { requestId: req.id });
        return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
      }
    });
  }

  return router;
}
