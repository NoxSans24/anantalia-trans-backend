import { getAuthenticatedPrincipal } from '../auth/principal-context.js';

export function createAuthorizationMiddleware(authorize) {
  if (typeof authorize !== 'function') throw new TypeError('An authorization policy is required');

  return async function authorizeRequest(req, res, next) {
    const principal = getAuthenticatedPrincipal(req);
    if (!principal) {
      return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } });
    }

    try {
      if (await authorize(principal, req) !== true) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied' } });
      }
      return next();
    } catch (error) {
      return next(error);
    }
  };
}
