import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { createHttpSessionAdapter } from '../../src/auth/http-session-adapter.js';
import { createApp } from '../../src/app.js';
import { createAuthRouter } from '../../src/routes/auth.routes.js';
import { createLogger } from '../../src/lib/logger.js';
import { createCsrfMiddleware } from '../../src/middlewares/csrf.middleware.js';
import { createRateLimitMiddleware } from '../../src/middlewares/rate-limit.middleware.js';

test('HTTP session adapter', async (t) => {
  await t.test('sets and clears session cookie with HttpOnly, SameSite flags', async () => {
    const mockSessionService = {
      validateSession: async (token) => ({
        status: 'SESSION_VALID',
        sessionId: 'test-session-id',
        userId: 'test-user-id',
        expiresAt: new Date(),
      }),
      revokeSession: async () => ({ status: 'SESSION_REVOCATION_ACCEPTED' }),
      rotateSession: async () => ({ status: 'SESSION_ROTATED' }),
      revokeAllUserSessions: async () => ({ status: 'SESSION_REVOCATION_ACCEPTED' }),
    };
    const adapter = createHttpSessionAdapter({ sessionService: mockSessionService });
    
    const mockRes = {
      cookie: (name, value, options) => {
        assert.equal(name, '__session');
        assert.equal(options.httpOnly, true);
        assert.equal(options.sameSite, 'lax');
        assert.equal(options.path, '/');
      },
      clearCookie: (name, options) => {
        assert.equal(name, '__session');
        assert.equal(options.path, '/');
      },
    };

    adapter.setCookie(mockRes, 'test-token');
    adapter.clearCookie(mockRes);
  });

  await t.test('validates session from cookie', async () => {
    const mockSessionService = {
      validateSession: async (token) => {
        assert.equal(token, 'valid-token');
        return {
          status: 'SESSION_VALID',
          sessionId: 'session-123',
          userId: 'user-456',
          expiresAt: new Date(),
        };
      },
      revokeSession: async () => ({ status: 'SESSION_REVOCATION_ACCEPTED' }),
      rotateSession: async () => ({ status: 'SESSION_ROTATED' }),
      revokeAllUserSessions: async () => ({ status: 'SESSION_REVOCATION_ACCEPTED' }),
    };
    const adapter = createHttpSessionAdapter({ sessionService: mockSessionService });
    
    const mockReq = {
      cookies: { __session: 'valid-token' },
    };

    const session = await adapter.validateFromCookie(mockReq);
    assert.equal(session.sessionId, 'session-123');
    assert.equal(session.userId, 'user-456');
  });

  await t.test('returns null for invalid or missing cookie', async () => {
    const mockSessionService = {
      validateSession: async () => ({ status: 'SESSION_INVALID' }),
      revokeSession: async () => ({ status: 'SESSION_REVOCATION_ACCEPTED' }),
      rotateSession: async () => ({ status: 'SESSION_ROTATED' }),
      revokeAllUserSessions: async () => ({ status: 'SESSION_REVOCATION_ACCEPTED' }),
    };
    const adapter = createHttpSessionAdapter({ sessionService: mockSessionService });
    
    const mockReq = { cookies: {} };
    const session = await adapter.validateFromCookie(mockReq);
    assert.equal(session, null);
  });
});

test('CSRF middleware', async (t) => {
  await t.test('requires a persistent secret', () => {
    assert.throws(() => createCsrfMiddleware(), /persistent CSRF secret/);
  });
  await t.test('generates and validates CSRF tokens', async () => {
    const csrf = createCsrfMiddleware({ secret: randomBytes(32) });
    
    let generatedToken;
    const mockReq = { cookies: {} };
    const mockRes = {
      cookie: (name, value) => {
        generatedToken = value;
      },
      setHeader() {},
    };
    
    csrf.middleware(mockReq, mockRes, () => {});
    assert.ok(typeof generatedToken === 'string' && generatedToken.length > 0);
    assert.equal(csrf.validateToken(generatedToken), true);
  });

  await t.test('binds tokens to their session and rejects cross-session reuse', async () => {
    const csrf = createCsrfMiddleware({ secret: randomBytes(32) });
    let generatedToken;
    csrf.setSessionToken({ cookie: (_name, value) => { generatedToken = value; }, setHeader() {} }, 'session-one');
    assert.equal(csrf.validateToken(generatedToken, 'session-one'), true);
    assert.equal(csrf.validateToken(generatedToken, 'session-two'), false);
  });

  await t.test('rejects tampered tokens', async () => {
    const csrf = createCsrfMiddleware({ secret: randomBytes(32) });
    const tamperedToken = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.1699000000000.bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    
    const isValid = csrf.validateToken(tamperedToken);
    assert.equal(isValid, false);
  });

  await t.test('rejects expired tokens', async () => {
    const csrf = createCsrfMiddleware({ secret: randomBytes(32) });
    const oldTimestamp = Date.now() - (2 * 60 * 60 * 1000);
    const expiredToken = `token.${oldTimestamp}.signature`;
    
    const isValid = csrf.validateToken(expiredToken);
    assert.equal(isValid, false);
  });

  await t.test('rejects malformed tokens', async () => {
    const csrf = createCsrfMiddleware({ secret: randomBytes(32) });
    
    assert.equal(csrf.validateToken('invalid'), false);
    assert.equal(csrf.validateToken(''), false);
    assert.equal(csrf.validateToken('a.b'), false);
  });
});

test('Rate limit middleware', async (t) => {
  await t.test('allows up to 5 login attempts per 15 minutes', async () => {
    const rateLimiter = createRateLimitMiddleware();
    const mockReq = { ip: '127.0.0.1' };
    const identifier = 'test@example.com';

    for (let i = 0; i < 5; i++) {
      const limit = rateLimiter.checkLogin(mockReq, identifier);
      assert.equal(limit.allowed, true);
    }

    const sixthAttempt = rateLimiter.checkLogin(mockReq, identifier);
    assert.equal(sixthAttempt.allowed, false);
  });

  await t.test('normalizes email/username for rate limiting', async () => {
    const rateLimiter = createRateLimitMiddleware();
    const mockReq = { ip: '127.0.0.1' };

    rateLimiter.checkLogin(mockReq, 'TEST@EXAMPLE.COM');
    rateLimiter.checkLogin(mockReq, 'test@example.com');
    rateLimiter.checkLogin(mockReq, '  Test@Example.Com  ');
    
    const limit = rateLimiter.checkLogin(mockReq, 'test@example.com');
    assert.equal(limit.remaining, 1);
  });

  await t.test('allows up to 3 MFA attempts per challenge', async () => {
    const rateLimiter = createRateLimitMiddleware();
    const mockReq = { ip: '127.0.0.1' };
    const challengeHash = 'challenge-hash-123';

    for (let i = 0; i < 3; i++) {
      const limit = rateLimiter.checkMfa(mockReq, challengeHash);
      assert.equal(limit.allowed, true);
    }

    const fourthAttempt = rateLimiter.checkMfa(mockReq, challengeHash);
    assert.equal(fourthAttempt.allowed, false);
  });

  await t.test('returns remaining attempts count', async () => {
    const rateLimiter = createRateLimitMiddleware();
    const mockReq = { ip: '127.0.0.1' };
    const identifier = 'user@test.com';

    const first = rateLimiter.checkLogin(mockReq, identifier);
    assert.equal(first.remaining, 4);

    const second = rateLimiter.checkLogin(mockReq, identifier);
    assert.equal(second.remaining, 3);
  });
});

test('HTTP session rotation requires session-bound CSRF and never returns the replacement token', async () => {
  const csrf = createCsrfMiddleware({ secret: randomBytes(32) });
  const cookies = new Map([['__session', 'old-session-token']]);
  const sessionService = {
    validateSession: async () => ({ status: 'SESSION_VALID', userId: 'user-id' }),
    revokeSession: async () => ({ status: 'SESSION_REVOCATION_ACCEPTED' }),
    revokeAllUserSessions: async () => ({ status: 'SESSION_REVOCATION_ACCEPTED' }),
    rotateSession: async (token) => {
      assert.equal(token, 'old-session-token');
      return { status: 'SESSION_ROTATED', token: 'replacement-session-token', expiresAt: new Date() };
    },
  };
  const sessionAdapter = {
    cookieName: '__session',
    setCookie: (res, value) => res.cookie('__session', value, { httpOnly: true, sameSite: 'lax', path: '/' }),
    clearCookie: (res) => res.clearCookie('__session', { path: '/' }),
    validateFromCookie: async () => null,
  };
  const authRouter = createAuthRouter({
    orchestration: { login: async () => ({}), completeMfa: async () => ({}) },
    sessionService,
    sessionAdapter,
    csrfMiddleware: csrf,
    rateLimitMiddleware: { checkLogin: () => ({ allowed: true }), checkMfa: () => ({ allowed: true }) },
    logger: createLogger(() => {}),
  });
  const server = createApp({ authRouter, logger: createLogger(() => {}) }).listen(0, '127.0.0.1');
  const baseUrl = await new Promise((resolve) => server.once('listening', () => resolve(`http://127.0.0.1:${server.address().port}`)));
  const header = () => [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  const absorbCookies = (response) => {
    for (const line of response.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const separator = pair.indexOf('=');
      const name = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      if (value) cookies.set(name, value);
      else cookies.delete(name);
    }
  };
  try {
    let response = await fetch(`${baseUrl}/auth/csrf`, { headers: { cookie: header() } });
    absorbCookies(response);
    const csrfToken = (await response.json()).csrfToken;
    response = await fetch(`${baseUrl}/auth/session/rotate`, {
      method: 'POST',
      headers: { cookie: header(), 'content-type': 'application/json' },
      body: JSON.stringify({ csrfToken }),
    });
    assert.equal(response.status, 200);
    absorbCookies(response);
    assert.equal(cookies.get('__session'), 'replacement-session-token');
    assert.equal((await response.text()).includes('replacement-session-token'), false);

    response = await fetch(`${baseUrl}/auth/session/rotate`, {
      method: 'POST',
      headers: { cookie: header(), 'content-type': 'application/json' },
      body: JSON.stringify({ csrfToken }),
    });
    assert.equal(response.status, 403);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('GET /auth/me returns only the authenticated profile and granted permissions', async () => {
  const csrf = createCsrfMiddleware({ secret: randomBytes(32) });
  const authRouter = createAuthRouter({
    orchestration: { login: async () => ({}), completeMfa: async () => ({}) },
    sessionService: { validateSession: async () => ({ status: 'SESSION_VALID' }) },
    sessionAdapter: { validateFromCookie: async (req) => req.cookies?.__session === 'valid'
      ? { userId: 'user-id', expiresAt: new Date('2026-11-05T00:00:00Z') } : null },
    principalService: { getPrincipal: async () => ({ user: { id: 'user-id', roles: ['STAFF'], permissions: ['DASHBOARD_VIEW'] } }) },
    csrfMiddleware: csrf,
    rateLimitMiddleware: { checkLogin: () => ({ allowed: true }), checkMfa: () => ({ allowed: true }) },
    logger: createLogger(() => {}),
  });
  const server = createApp({ authRouter, logger: createLogger(() => {}) }).listen(0, '127.0.0.1');
  const baseUrl = await new Promise((resolve) => server.once('listening', () => resolve(`http://127.0.0.1:${server.address().port}`)));
  try {
    const anonymous = await fetch(`${baseUrl}/auth/me`);
    assert.equal(anonymous.status, 401);
    const response = await fetch(`${baseUrl}/auth/me`, { headers: { cookie: '__session=valid' } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      user: { id: 'user-id', roles: ['STAFF'], permissions: ['DASHBOARD_VIEW'] },
      expiresAt: '2026-11-05T00:00:00.000Z',
    });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
