import { HttpServerTransport } from '@did-btcr2/aggregation/service';
import { resolveBtcr2SenderPk } from '@did-btcr2/method';
import { createIdentity } from '@btcr2-aggregation/shared';
import { describe, expect, it } from 'vitest';
import { createHonoApp, type HonoAppOptions } from './hono-adapter.js';
import { createLoginThrottle, createSessionStore, type OperatorAuthConfig } from './operator-auth.js';

// Fail-closed boot coverage (D-07): the operator surface + gated monitoring mount ONLY
// when operator auth is configured. Without a password the public participant surface
// (GET /v1/config) still serves while every operator route (incl. the gated monitoring
// read) is unmounted (404). With a password set, the gated routes exist but reject an
// unauthenticated caller (401). The booth-era `/dashboard/events` SSE feed is retired
// (D-02/D-19), so the negative-auth evidence lives on the gated monitoring read now.
// In-memory (createHonoApp(...).request), no port, no chain.

const PASSWORD = 'boot-test-operator-password';

/** A transport-backed app; operator auth present only when `withPassword`. No runner is
 * needed: these tests exercise mount/gate presence, not a cohort lifecycle. */
function bootApp(withPassword: boolean) {
  const { did, keys } = createIdentity();
  const transport = new HttpServerTransport({ resolveSenderPk: resolveBtcr2SenderPk, heartbeatIntervalMs: 0 });
  transport.registerActor(did, keys);
  const operatorAuth: OperatorAuthConfig | undefined = withPassword
    ? {
        sessions: createSessionStore(60_000),
        throttle: createLoginThrottle({ maxAttempts: 10, windowMs: 5 * 60_000 }),
        expectedPassword: PASSWORD,
        cookieSecure: false,
        sessionTtlMs: 60_000,
      }
    : undefined;
  const opts: HonoAppOptions = { networkName: 'mutinynet', operatorAuth };
  return createHonoApp(transport, opts);
}

describe('fail-closed boot: no operator password', () => {
  it('still serves the public participant surface (GET /v1/config -> 200)', async () => {
    const res = await bootApp(false).request('/v1/config');
    expect(res.status).toBe(200);
  });

  it('does NOT mount the operator login route (404)', async () => {
    const res = await bootApp(false).request('/v1/operator/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD }),
    });
    expect(res.status).toBe(404);
  });

  it('does NOT mount the operator session probe (404)', async () => {
    const res = await bootApp(false).request('/v1/operator/session');
    expect(res.status).toBe(404);
  });

  it('does NOT mount the gated monitoring read GET /v1/operator/cohorts/:id (404)', async () => {
    const res = await bootApp(false).request('/v1/operator/cohorts/some-cohort');
    expect(res.status).toBe(404);
  });
});

describe('operator surface: password configured', () => {
  it('mounts login (correct password -> 200 + Set-Cookie)', async () => {
    const res = await bootApp(true).request('/v1/operator/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toContain('operator_session=');
  });

  it('gates GET /v1/operator/session -> 401 without a session', async () => {
    const res = await bootApp(true).request('/v1/operator/session');
    expect(res.status).toBe(401);
  });

  it('gates the monitoring read GET /v1/operator/cohorts/:id -> 401 without a session', async () => {
    const res = await bootApp(true).request('/v1/operator/cohorts/some-cohort');
    expect(res.status).toBe(401);
  });

  it('the public surface is unaffected (GET /v1/config -> 200)', async () => {
    const res = await bootApp(true).request('/v1/config');
    expect(res.status).toBe(200);
  });
});
