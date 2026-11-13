import { createHash, randomBytes, createHmac, timingSafeEqual } from 'node:crypto';

export function createCsrfMiddleware({ secret } = {}) {
  const key = typeof secret === 'string' ? Buffer.from(secret, 'base64url') : Buffer.from(secret ?? []);
  if (key.length < 32 || (typeof secret === 'string' && key.toString('base64url') !== secret)) throw new TypeError('A persistent CSRF secret of at least 256 bits is required');
  const tokenTtlMs = 60 * 60 * 1000;

  function sessionBinding(sessionToken) {
    return typeof sessionToken === 'string' && sessionToken.length > 0
      ? createHash('sha256').update(sessionToken).digest('base64url')
      : 'anonymous';
  }

  function generateToken(sessionToken) {
    const rawToken = randomBytes(32).toString('base64url');
    const timestamp = Date.now();
    const signature = createHmac('sha256', key)
      .update(`${rawToken}:${timestamp}:${sessionBinding(sessionToken)}`)
      .digest('base64url');
    return `${rawToken}.${timestamp}.${signature}`;
  }

  function isValidToken(token, sessionToken) {
    if (typeof token !== 'string' || token.length === 0) return false;
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    
    const [rawToken, timestamp, signature] = parts;
    const expectedSignature = createHmac('sha256', key)
      .update(`${rawToken}:${timestamp}:${sessionBinding(sessionToken)}`)
      .digest();
    const suppliedSignature = Buffer.from(signature, 'base64url');
    if (suppliedSignature.length !== expectedSignature.length || !timingSafeEqual(suppliedSignature, expectedSignature)) return false;
    
    const age = Date.now() - Number(timestamp);
    if (age < 0 || age > tokenTtlMs) return false;
    
    return true;
  }

  return Object.freeze({
    middleware: (req, res, next) => {
      const sessionToken = req.cookies?.__session;
      let token = req.cookies?.['__csrf'];
      if (!token || !isValidToken(token, sessionToken)) {
        token = generateToken(sessionToken);
      }
      res.cookie('__csrf', token, {
        httpOnly: false,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production',
        maxAge: tokenTtlMs,
      });
      res.setHeader('X-CSRF-Token', token);
      req.csrfToken = token;
      next();
    },
    guard: (req, res, next) => {
      if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
      const token = req.get?.('X-CSRF-Token') ?? req.body?.csrfToken;
      if (typeof token !== 'string' || token !== req.cookies?.__csrf || !isValidToken(token, req.cookies?.__session)) {
        return res.status(403).json({ error: { code: 'CSRF_INVALID', message: 'CSRF validation failed' } });
      }
      return next();
    },
    validateRequest(req, token) {
      return typeof token === 'string'
        && token === req.cookies?.__csrf
        && isValidToken(token, req.cookies?.__session);
    },
    validateToken(token, sessionToken) {
      return isValidToken(token, sessionToken);
    },
    setSessionToken(res, sessionToken) {
      const token = generateToken(sessionToken);
      res.cookie('__csrf', token, {
        httpOnly: false,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production',
        maxAge: tokenTtlMs,
      });
      res.setHeader('X-CSRF-Token', token);
      return token;
    },
    clearCookie(res) {
      res.clearCookie('__csrf', { path: '/', sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
    },
  });
}
