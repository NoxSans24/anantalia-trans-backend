export function createHttpSessionAdapter({ sessionService, clock = () => new Date() } = {}) {
  if (typeof sessionService?.validateSession !== 'function'
    || typeof sessionService?.revokeSession !== 'function') {
    throw new TypeError('A session service is required');
  }

  const cookieName = '__session';
  const csrfCookieName = '__csrf';
  const cookieOptions = {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 8 * 60 * 60 * 1000, // 8 hours
  };

  async function validateFromCookie(req) {
    const token = req.cookies?.[cookieName];
    if (typeof token !== 'string' || token.length === 0) return null;
    const result = await sessionService.validateSession(token);
    if (result.status !== 'SESSION_VALID') return null;
    return {
      sessionId: result.sessionId,
      userId: result.userId,
      expiresAt: result.expiresAt,
    };
  }

  function setCookie(res, token) {
    res.cookie(cookieName, token, cookieOptions);
  }

  function clearCookie(res) {
    res.clearCookie(cookieName, {
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });
  }

  function setCsrfCookie(res, token) {
    res.cookie(csrfCookieName, token, {
      httpOnly: false,
      sameSite: 'lax',
      path: '/',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 1000, // 1 hour
    });
  }

  function getCsrfToken(req) {
    return req.cookies?.[csrfCookieName] ?? null;
  }

  return Object.freeze({
    validateFromCookie,
    setCookie,
    clearCookie,
    setCsrfCookie,
    getCsrfToken,
    cookieName,
    csrfCookieName,
  });
}
