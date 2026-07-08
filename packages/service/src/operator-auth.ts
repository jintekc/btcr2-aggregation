/**
 * Operator authentication for the self-hosted service (HOST-01, ADR 0015).
 *
 * This is the first server-enforced control-plane boundary in the app. The operator
 * signs in at `/operator` with the service's {@link CreateServiceOptions.operatorPassword}
 * (never baked into the image, never logged); a successful login issues an opaque,
 * server-tracked, httpOnly session cookie. Every operator/mutating route and the
 * live telemetry feed (`/dashboard/events`) sits behind {@link requireOperator}, so
 * an unauthenticated visitor cannot control the service or read its operator-only
 * telemetry (closing the CONCERNS.md top blocker "no auth anywhere in the control
 * plane").
 *
 * Composed from Hono first-party helpers + Node stdlib ONLY (no new dependency):
 * `hono/factory` `createMiddleware`, `hono/cookie` set/get/delete, and
 * `node:crypto` `createHash`/`timingSafeEqual`/`randomBytes`.
 *
 * Design notes:
 * - httpOnly cookie (not a bearer token) is the ONLY scheme that gates the SSE feed:
 *   `EventSource` cannot set an `Authorization` header, it only sends same-origin
 *   cookies automatically (see ADR 0015 / RESEARCH Pitfall 1).
 * - The session store is a per-`createService` closure (mirrors `genesisStaging` /
 *   `seatedRosterKeys` in {@link file://./index.ts}), NOT a module singleton, so two
 *   services in one process (tests) never share sessions.
 * - Opaque server-tracked ids (not a stateless JWT) so {@link SessionStore.destroy}
 *   on logout truly kills the session (D-06).
 */

import type { HttpBindings } from '@hono/node-server';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createMiddleware } from 'hono/factory';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Context, MiddlewareHandler } from 'hono';

type Env = { Bindings: HttpBindings };

/** Name of the httpOnly session cookie issued on login. */
export const SESSION_COOKIE = 'operator_session';

/**
 * Constant-time credential check (D-05). SHA-256 digests BOTH sides first so
 * {@link timingSafeEqual} always compares equal-length (32-byte) buffers - it throws
 * on a length mismatch, and that throw itself leaks the length. Never logs either
 * value. Not a password hash for storage (the expected password lives only in env);
 * this exists solely to avoid a timing/length oracle on the compare.
 */
export function passwordMatches(supplied: string, expected: string): boolean {
  const a = createHash('sha256').update(supplied, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b);
}

/**
 * A fresh, server-issued session id: 32 CSPRNG bytes hex-encoded. Because the id is
 * only ever minted here (never accepted from the client), session fixation is
 * impossible - a caller cannot pre-seed an id and have it become valid on login.
 */
export function newSessionId(): string {
  return randomBytes(32).toString('hex');
}

/** In-memory session registry scoped to one {@link createService} call. */
export interface SessionStore {
  /** Mint a new session, recording `expiresAt = now + ttlMs`. Returns the id. */
  create(): string;
  /** True only when the id is known and not past its expiry (evicts on expiry). */
  isValid(id: string): boolean;
  /** Invalidate a session server-side (logout). No-op for an unknown id. */
  destroy(id: string): void;
}

/**
 * Build a {@link SessionStore} backed by an in-file `Map` (mirrors the closure-state
 * pattern of `seatedRosterKeys` in index.ts:265 - constructed by the caller per
 * createService, never a module singleton). A non-positive `ttlMs` yields sessions
 * that are already expired at creation (used by tests / a disabled console).
 */
export function createSessionStore(ttlMs: number): SessionStore {
  const sessions = new Map<string, { expiresAt: number }>();
  return {
    create(): string {
      const id = newSessionId();
      sessions.set(id, { expiresAt: Date.now() + ttlMs });
      return id;
    },
    isValid(id: string): boolean {
      const rec = sessions.get(id);
      if (!rec) {
        return false;
      }
      if (Date.now() > rec.expiresAt) {
        sessions.delete(id); // evict lazily on read so the Map cannot grow unbounded
        return false;
      }
      return true;
    },
    destroy(id: string): void {
      sessions.delete(id);
    },
  };
}

/**
 * Per-client fixed-window login attempt throttle (A5, ASVS V2 belt-and-suspenders).
 * A should-have, not a hard blocker: it bounds brute-force against a weak
 * `OPERATOR_PASSWORD` without persistence or a lockout that could self-DoS the operator.
 */
export interface LoginThrottle {
  /** True while the client is under the attempt limit for the current window. */
  check(key: string): boolean;
  /** Record one failed attempt for the client. */
  fail(key: string): void;
  /** Clear a client's counter (called on a successful login). */
  reset(key: string): void;
}

/**
 * In-memory per-key fixed-window throttle. `key` is the client remote address (see
 * {@link clientKey}). Defaults chosen at the call site: 10 attempts / 5 min.
 */
export function createLoginThrottle(opts: { maxAttempts: number; windowMs: number }): LoginThrottle {
  const { maxAttempts, windowMs } = opts;
  const attempts = new Map<string, { count: number; resetAt: number }>();
  return {
    check(key: string): boolean {
      const rec = attempts.get(key);
      if (!rec) {
        return true;
      }
      if (Date.now() > rec.resetAt) {
        attempts.delete(key);
        return true;
      }
      return rec.count < maxAttempts;
    },
    fail(key: string): void {
      const now = Date.now();
      const rec = attempts.get(key);
      if (!rec || now > rec.resetAt) {
        attempts.set(key, { count: 1, resetAt: now + windowMs });
      } else {
        rec.count += 1;
      }
    },
    reset(key: string): void {
      attempts.delete(key);
    },
  };
}

/** The throttle/log key for a request: the client's remote address, or 'unknown'. */
function clientKey(c: Context<Env>): string {
  return c.env?.incoming?.socket?.remoteAddress ?? 'unknown';
}

/**
 * Guard middleware for the `/v1/operator/*` and `/dashboard/*` prefixes. Rejects any
 * request without a valid, unexpired session BEFORE the handler runs (mount it on the
 * prefix ahead of the routes - Hono matches in registration order, so a guard mounted
 * after a route would leave it exposed). The 401 body is generic; a denial is logged
 * with the `[operator]` prefix and NEVER includes the cookie value.
 */
export function requireOperator(sessions: SessionStore): MiddlewareHandler<Env> {
  return createMiddleware<Env>(async (c, next) => {
    const id = getCookie(c, SESSION_COOKIE);
    if (!id || !sessions.isValid(id)) {
      console.warn(`[operator] denied ${c.req.method} ${new URL(c.req.url).pathname}: no valid session`);
      return c.json({ error: 'operator authentication required' }, 401);
    }
    await next();
  });
}

/** HTTP methods that mutate state and therefore warrant the same-origin CSRF check. */
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Same-origin CSRF check (T-01-05, belt-and-suspenders on top of SameSite=Strict).
 * On a mutating request, if an `Origin`/`Referer` header is present it MUST match the
 * request `Host`, else 403. Absent Origin (a non-browser API client, or a same-origin
 * navigation that sends none) is allowed through - browsers always attach Origin to a
 * cross-site POST, so a forged cross-origin request cannot omit it. Mount on
 * `/v1/operator/*` (covers login + logout); GET routes are CSRF-inert and pass.
 */
export function requireSameOrigin(): MiddlewareHandler<Env> {
  return createMiddleware<Env>(async (c, next) => {
    if (MUTATING_METHODS.has(c.req.method)) {
      const origin = c.req.header('origin') ?? c.req.header('referer');
      if (origin) {
        const host = c.req.header('host');
        let originHost: string | undefined;
        try {
          originHost = new URL(origin).host;
        } catch {
          return c.json({ error: 'cross-origin request rejected' }, 403);
        }
        if (!host || originHost !== host) {
          console.warn(`[operator] rejected cross-origin ${c.req.method} from ${originHost}`);
          return c.json({ error: 'cross-origin request rejected' }, 403);
        }
      }
    }
    await next();
  });
}

/** Everything the login handler needs, constructed once per createService. */
export interface OperatorAuthConfig {
  /** The per-service session registry. */
  sessions: SessionStore;
  /** The per-service login throttle. */
  throttle: LoginThrottle;
  /** The operator password to compare against (from env; never logged). */
  expectedPassword: string;
  /** Whether to set the `Secure` cookie flag (true in prod behind TLS; see D-07 / Pitfall 2). */
  cookieSecure: boolean;
  /** Session lifetime in ms; drives both the store TTL and the cookie `Max-Age`. */
  sessionTtlMs: number;
}

/**
 * Build the `POST /v1/operator/login` handler (public route - mount it OUTSIDE the
 * guard, body-limited). Flow: throttle -> parse -> constant-time compare -> issue an
 * httpOnly cookie. The generic 401 never reveals whether a session/account exists, and
 * neither the password nor the request body is ever logged.
 */
export function loginHandler(config: OperatorAuthConfig) {
  const { sessions, throttle, expectedPassword, cookieSecure, sessionTtlMs } = config;
  return async (c: Context<Env>): Promise<Response> => {
    const key = clientKey(c);
    if (!throttle.check(key)) {
      console.warn(`[operator] login throttled for ${key}`);
      return c.json({ error: 'too many attempts, try again later' }, 429);
    }
    let body: { password?: unknown };
    try {
      body = await c.req.json<{ password?: unknown }>();
    } catch {
      return c.json({ error: 'expected a JSON body { password }' }, 400);
    }
    const password = typeof body.password === 'string' ? body.password : '';
    if (!passwordMatches(password, expectedPassword)) {
      throttle.fail(key);
      console.warn(`[operator] failed login attempt from ${key}`);
      return c.json({ error: 'invalid credentials' }, 401);
    }
    const id = sessions.create();
    setCookie(c, SESSION_COOKIE, id, {
      httpOnly: true,
      sameSite: 'Strict',
      secure: cookieSecure,
      path: '/',
      maxAge: Math.floor(sessionTtlMs / 1000),
    });
    throttle.reset(key);
    console.log(`[operator] login succeeded from ${key}`);
    return c.json({ ok: true });
  };
}

/**
 * Build the `POST /v1/operator/logout` handler (gated). Destroys the session
 * server-side FIRST, then clears the cookie, so a replay of the same cookie 401s.
 */
export function logoutHandler(sessions: SessionStore) {
  return async (c: Context<Env>): Promise<Response> => {
    const id = getCookie(c, SESSION_COOKIE);
    if (id) {
      sessions.destroy(id);
    }
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  };
}

/**
 * Build the `GET /v1/operator/session` probe handler (gated). Only reached when the
 * guard passed, so a 200 body confirms a live session; the browser console uses this
 * (never the httpOnly cookie, which JS cannot read) to determine login state.
 */
export function sessionProbeHandler() {
  return (c: Context<Env>): Response => c.json({ operator: true });
}
