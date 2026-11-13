import { setAuthenticatedPrincipal } from '../auth/principal-context.js';

export function createAuthenticationMiddleware(authenticate) {
  if (typeof authenticate !== 'function') throw new TypeError('An authentication adapter is required');

  return async function authenticateRequest(req, res, next) {
    try {
      const principal = await authenticate(req);
      if (!principal || typeof principal !== 'object' || Array.isArray(principal)) {
        return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } });
      }
      setAuthenticatedPrincipal(req, principal);
      return next();
    } catch (error) {
      return next(error);
    }
  };
}
