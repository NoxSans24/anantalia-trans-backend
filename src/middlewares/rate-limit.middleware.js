export function createRateLimitMiddleware() {
  const loginAttempts = new Map();
  const mfaAttempts = new Map();
  const publicBookingAttempts = new Map();
  const cleanupIntervalMs = 60_000;
  const loginWindowMs = 15 * 60 * 1000;
  const mfaWindowMs = 5 * 60 * 1000;
  const publicBookingWindowMs = 60 * 1000;

  function getClientIp(req) {
    return req.ip || req.socket?.remoteAddress || '127.0.0.1';
  }

  function normalizeIdentifier(identifier) {
    if (typeof identifier !== 'string') return '';
    return identifier.toLowerCase().trim();
  }

  function cleanupExpired(store, windowMs) {
    const now = Date.now();
    for (const [key, entries] of store.entries()) {
      const filtered = entries.filter(ts => now - ts < windowMs);
      if (filtered.length === 0) {
        store.delete(key);
      } else {
        store.set(key, filtered);
      }
    }
  }

  const cleanup = setInterval(() => {
    cleanupExpired(loginAttempts, loginWindowMs);
    cleanupExpired(mfaAttempts, mfaWindowMs);
    cleanupExpired(publicBookingAttempts, publicBookingWindowMs);
  }, cleanupIntervalMs);
  cleanup.unref();

  return Object.freeze({
    checkLogin(req, identifier) {
      const ip = getClientIp(req);
      const normalized = normalizeIdentifier(identifier);
      const key = `login:${ip}:${normalized}`;
      const entries = loginAttempts.get(key) || [];
      const now = Date.now();
      const recent = entries.filter(ts => now - ts < loginWindowMs);

      if (recent.length >= 5) {
        return { allowed: false, remaining: 0, retryAfterMs: Math.min(...recent) + loginWindowMs - now };
      }

      recent.push(now);
      loginAttempts.set(key, recent);
      return { allowed: true, remaining: 5 - recent.length };
    },

    checkMfa(req, challengeHash) {
      const ip = getClientIp(req);
      const key = `mfa:${challengeHash}:${ip}`;
      const entries = mfaAttempts.get(key) || [];
      const now = Date.now();
      const recent = entries.filter(ts => now - ts < mfaWindowMs);

      if (recent.length >= 3) {
        return { allowed: false, remaining: 0, retryAfterMs: Math.min(...recent) + mfaWindowMs - now };
      }

      recent.push(now);
      mfaAttempts.set(key, recent);
      return { allowed: true, remaining: 3 - recent.length };
    },

    checkPublicBooking(req) {
      const ip = getClientIp(req);
      const key = `booking:${ip}`;
      const entries = publicBookingAttempts.get(key) || [];
      const now = Date.now();
      const recent = entries.filter(ts => now - ts < publicBookingWindowMs);

      if (recent.length >= 30) {
        return { allowed: false, remaining: 0, retryAfterMs: Math.min(...recent) + publicBookingWindowMs - now };
      }

      recent.push(now);
      publicBookingAttempts.set(key, recent);
      return { allowed: true, remaining: 30 - recent.length };
    },
  });
}
