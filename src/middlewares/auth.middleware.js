export function createAuthenticationMiddleware({ sessionAdapter } = {}) {
  if (!sessionAdapter) throw new TypeError('Session adapter required');

  return async (req, res, next) => {
    try {
      const session = await sessionAdapter.validateFromCookie(req);
      if (session) {
        req.userId = session.userId;
        req.sessionId = session.sessionId;
      }
      next();
    } catch {
      next();
    }
  };
}

export function createAuthorizationMiddleware({ authService } = {}) {
  if (!authService) throw new TypeError('Authorization service required');

  return (requiredPermission) => async (req, res, next) => {
    try {
      if (!req.userId) return res.status(401).json({ error: { code: 'UNAUTHENTICATED' } });
      await authService.requirePermission(req.userId, requiredPermission);
      next();
    } catch (error) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied' } });
    }
  };
}
