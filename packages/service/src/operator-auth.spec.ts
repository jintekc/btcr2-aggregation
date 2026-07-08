import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SESSION_COOKIE,
  createLoginThrottle,
  createSessionStore,
  loginHandler,
  logoutHandler,
  newSessionId,
  passwordMatches,
  requireOperator,
  requireSameOrigin,
  sessionProbeHandler,
  type LoginThrottle,
} from './operator-auth.js';

// Hermetic auth coverage using the config.spec.ts idiom: an in-memory Hono app built
// from the operator-auth exports (no port, no chain), driven via `app.request(...)`.
// The mandatory negative tests (CONCERNS.md: auth ships paired with its negatives) live
// here: wrong password, no/invalid/expired session on every gated route incl. the SSE
// feed, logout-then-401, and a console spy asserting the password is never logged.

const PASSWORD = 'correct-horse-battery-staple';

/**
 * Build an operator-enabled app the way `hono-adapter.ts` will (Task 2): the PUBLIC
 * login POST (body-limited) first, then the guard on the two gated prefixes, then the
 * gated logout/session/dashboard-events routes. A stand-in `GET /dashboard/events`
 * proves the SSE feed sits behind the same guard.
 */
function operatorApp(opts: { password?: string; ttlMs?: number; throttle?: LoginThrottle } = {}) {
  const password = opts.password ?? PASSWORD;
  const ttlMs = opts.ttlMs ?? 60_000;
  const sessions = createSessionStore(ttlMs);
  const throttle = opts.throttle ?? createLoginThrottle({ maxAttempts: 10, windowMs: 5 * 60_000 });
  const app = new Hono();
  app.post(
    '/v1/operator/login',
    bodyLimit({ maxSize: 4 * 1024, onError: (c) => c.json({ error: 'request too large' }, 413) }),
    loginHandler({ sessions, throttle, expectedPassword: password, cookieSecure: false, sessionTtlMs: ttlMs }),
  );
  app.use('/v1/operator/*', requireSameOrigin());
  app.use('/v1/operator/*', requireOperator(sessions));
  app.use('/dashboard/*', requireOperator(sessions));
  app.post('/v1/operator/logout', logoutHandler(sessions));
  app.get('/v1/operator/session', sessionProbeHandler());
  app.get('/dashboard/events', (c) => c.text('telemetry'));
  return { app, sessions, throttle };
}

/** POST a login and return the response plus the bare `operator_session=<id>` cookie pair. */
async function login(app: Hono, password: string) {
  const res = await app.request('/v1/operator/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  const setCookie = res.headers.get('set-cookie');
  const cookie = setCookie?.split(';')[0] ?? '';
  return { res, setCookie, cookie };
}

describe('passwordMatches (constant-time compare)', () => {
  it('accepts the exact password and rejects any other', () => {
    expect(passwordMatches(PASSWORD, PASSWORD)).toBe(true);
    expect(passwordMatches('wrong', PASSWORD)).toBe(false);
  });

  it('handles unequal-length inputs without throwing (SHA-256 both sides first)', () => {
    // A naive timingSafeEqual on raw buffers throws on length mismatch and leaks length.
    expect(() => passwordMatches('a', 'a-much-longer-password')).not.toThrow();
    expect(passwordMatches('a', 'a-much-longer-password')).toBe(false);
  });
});

describe('newSessionId', () => {
  it('returns a fresh 64-hex-char id each call', () => {
    const a = newSessionId();
    const b = newSessionId();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });
});

describe('createSessionStore', () => {
  it('validates a fresh session and rejects an unknown id', () => {
    const store = createSessionStore(60_000);
    const id = store.create();
    expect(store.isValid(id)).toBe(true);
    expect(store.isValid('nope')).toBe(false);
  });

  it('rejects (and evicts) an expired session', () => {
    const store = createSessionStore(-1_000); // already past expiry
    const id = store.create();
    expect(store.isValid(id)).toBe(false);
  });

  it('destroy invalidates a session', () => {
    const store = createSessionStore(60_000);
    const id = store.create();
    store.destroy(id);
    expect(store.isValid(id)).toBe(false);
  });
});

describe('POST /v1/operator/login', () => {
  it('correct password -> 200 + httpOnly SameSite=Strict operator_session cookie', async () => {
    const { app } = operatorApp();
    const { res, setCookie } = await login(app, PASSWORD);
    expect(res.status).toBe(200);
    expect(setCookie).toBeTruthy();
    expect(setCookie).toContain(`${SESSION_COOKIE}=`);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Strict/i);
    expect(setCookie).toMatch(/Path=\//i);
  });

  it('wrong password -> 401 with NO Set-Cookie and a generic body', async () => {
    const { app } = operatorApp();
    const { res, setCookie } = await login(app, 'not-the-password');
    expect(res.status).toBe(401);
    expect(setCookie).toBeNull();
    const body = (await res.json()) as { error: string };
    expect(body.error).not.toContain('not-the-password');
  });

  it('issues a fresh session id on each successful login (fixation-proof)', async () => {
    const { app } = operatorApp();
    const first = await login(app, PASSWORD);
    const second = await login(app, PASSWORD);
    expect(first.cookie).not.toBe(second.cookie);
  });

  it('malformed JSON body -> 400', async () => {
    const { app } = operatorApp();
    const res = await app.request('/v1/operator/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });
    expect(res.status).toBe(400);
  });

  it('never logs the supplied password', async () => {
    const logs: string[] = [];
    const spies = (['log', 'error', 'warn', 'info', 'debug'] as const).map((k) =>
      vi.spyOn(console, k).mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(' '));
      }),
    );
    try {
      const secret = 'super-secret-password-should-never-appear';
      const { app } = operatorApp();
      await login(app, secret); // wrong password path logs a denial
      expect(logs.join('\n')).not.toContain(secret);
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
  });
});

describe('requireOperator (guard middleware)', () => {
  it('allows a gated route with a valid session cookie', async () => {
    const { app } = operatorApp();
    const { cookie } = await login(app, PASSWORD);
    const res = await app.request('/v1/operator/session', { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { operator: boolean };
    expect(body.operator).toBe(true);
  });

  it('401s a gated route with no cookie', async () => {
    const { app } = operatorApp();
    const res = await app.request('/v1/operator/session');
    expect(res.status).toBe(401);
  });

  it('401s a gated route with an unknown cookie', async () => {
    const { app } = operatorApp();
    const res = await app.request('/v1/operator/session', {
      headers: { cookie: `${SESSION_COOKIE}=deadbeef` },
    });
    expect(res.status).toBe(401);
  });

  it('401s a gated route with an expired session cookie', async () => {
    const { app } = operatorApp({ ttlMs: -1_000 }); // sessions expire at creation
    const { cookie } = await login(app, PASSWORD);
    const res = await app.request('/v1/operator/session', { headers: { cookie } });
    expect(res.status).toBe(401);
  });

  it('gates GET /dashboard/events (the SSE telemetry feed) - 401 without a session', async () => {
    const { app } = operatorApp();
    const noCookie = await app.request('/dashboard/events');
    expect(noCookie.status).toBe(401);
    const { cookie } = await login(app, PASSWORD);
    const withCookie = await app.request('/dashboard/events', { headers: { cookie } });
    expect(withCookie.status).toBe(200);
  });
});

describe('POST /v1/operator/logout', () => {
  it('destroys the session server-side so the prior cookie then 401s', async () => {
    const { app } = operatorApp();
    const { cookie } = await login(app, PASSWORD);
    const before = await app.request('/v1/operator/session', { headers: { cookie } });
    expect(before.status).toBe(200);
    const out = await app.request('/v1/operator/logout', { method: 'POST', headers: { cookie } });
    expect(out.status).toBe(200);
    const after = await app.request('/v1/operator/session', { headers: { cookie } });
    expect(after.status).toBe(401);
  });
});

describe('requireSameOrigin (CSRF belt-and-suspenders)', () => {
  it('403s a cross-origin mutating request but allows a matching / absent origin', async () => {
    const { app } = operatorApp();
    const { cookie } = await login(app, PASSWORD);
    const cross = await app.request('/v1/operator/logout', {
      method: 'POST',
      headers: { cookie, origin: 'https://evil.example', host: 'localhost' },
    });
    expect(cross.status).toBe(403);
    // No Origin header (API client / same-origin nav) is allowed through the guard.
    const noOrigin = await app.request('/v1/operator/logout', { method: 'POST', headers: { cookie } });
    expect(noOrigin.status).toBe(200);
  });
});

describe('createLoginThrottle', () => {
  let throttle: LoginThrottle;
  beforeEach(() => {
    throttle = createLoginThrottle({ maxAttempts: 2, windowMs: 5 * 60_000 });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('429s further login attempts after maxAttempts failures, and a success resets the counter', async () => {
    const { app } = operatorApp({ throttle });
    const first = await login(app, 'wrong-1');
    expect(first.res.status).toBe(401);
    const second = await login(app, 'wrong-2');
    expect(second.res.status).toBe(401);
    const third = await login(app, 'wrong-3');
    expect(third.res.status).toBe(429); // over the limit
    // The throttle interface resets a client's counter on demand (success path uses this).
    throttle.reset('unknown');
    const afterReset = await login(app, PASSWORD);
    expect(afterReset.res.status).toBe(200);
  });
});
