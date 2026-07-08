import { AggregationServiceRunner, HttpServerTransport } from '@did-btcr2/aggregation/service';
import { resolveBtcr2SenderPk } from '@did-btcr2/method';
import { buildCohortConfig, createIdentity } from '@btcr2-aggregation/shared';
import { describe, expect, it } from 'vitest';
import { createHonoApp, type HonoAppOptions } from './hono-adapter.js';
import { createLoginThrottle, createSessionStore, type OperatorAuthConfig } from './operator-auth.js';
import { makeProvideTxData } from './tx.js';

// Fail-closed boot coverage (D-07): the operator surface + gated telemetry mount ONLY
// when operator auth is configured. Without a password the public participant surface
// (GET /v1/config) still serves while every operator route + /dashboard/events is
// unmounted (404). With a password set, the gated routes exist but reject an
// unauthenticated caller (401). In-memory (createHonoApp(...).request), no port, no chain.

const PASSWORD = 'boot-test-operator-password';

/** A runner-backed app; operator auth present only when `withPassword`. */
function bootApp(withPassword: boolean) {
  const { did, keys } = createIdentity();
  const transport = new HttpServerTransport({ resolveSenderPk: resolveBtcr2SenderPk, heartbeatIntervalMs: 0 });
  transport.registerActor(did, keys);
  // The runner is never driven here (no cohort runs); onProvideTxData is required by
  // the constructor but never invoked, so the fixture provider (read lazily) is inert.
  const runner: AggregationServiceRunner = new AggregationServiceRunner({
    transport,
    did,
    keys,
    config: buildCohortConfig(2, 'CASBeacon'),
    onProvideTxData: makeProvideTxData(() => runner),
  });
  const operatorAuth: OperatorAuthConfig | undefined = withPassword
    ? {
        sessions: createSessionStore(60_000),
        throttle: createLoginThrottle({ maxAttempts: 10, windowMs: 5 * 60_000 }),
        expectedPassword: PASSWORD,
        cookieSecure: false,
        sessionTtlMs: 60_000,
      }
    : undefined;
  const opts: HonoAppOptions = { runner, networkName: 'mutinynet', operatorAuth };
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

  it('does NOT mount the gated telemetry feed /dashboard/events (404)', async () => {
    const res = await bootApp(false).request('/dashboard/events');
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

  it('gates GET /dashboard/events -> 401 without a session', async () => {
    const res = await bootApp(true).request('/dashboard/events');
    expect(res.status).toBe(401);
  });

  it('the public surface is unaffected (GET /v1/config -> 200)', async () => {
    const res = await bootApp(true).request('/v1/config');
    expect(res.status).toBe(200);
  });
});
