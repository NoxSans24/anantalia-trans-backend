const principals = new WeakMap();

export function setAuthenticatedPrincipal(request, principal) {
  if (!request || typeof request !== 'object' || !principal || typeof principal !== 'object' || Array.isArray(principal)) {
    throw new TypeError('A request and opaque principal object are required');
  }
  if (principals.has(request)) throw new Error('Authenticated principal is already set');
  principals.set(request, principal);
}

export function getAuthenticatedPrincipal(request) {
  return principals.get(request) ?? null;
}
