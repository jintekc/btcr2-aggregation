import { AggregationServiceRunner, HttpServerTransport } from '@did-btcr2/aggregation/service';
import { resolveBtcr2SenderPk } from '@did-btcr2/method';
import { buildCohortConfig, createIdentity, resolveNetwork } from '@btcr2-aggregation/shared';
import type { BitcoinConnection } from '@did-btcr2/bitcoin';
import type { AggregationResult } from '@did-btcr2/aggregation/service';
import type { Transaction } from '@scure/btc-signer';
import { describe, expect, it } from 'vitest';
import { cohortKeepsLiveWiring, createService } from '../src/index.js';
import { createCohortMonitor } from '../src/monitor.js';
import { createHonoApp } from '../src/hono-adapter.js';
import { createLoginThrottle, createSessionStore, type OperatorAuthConfig } from '../src/operator-auth.js';
import { createRuntimeSettings } from '../src/runtime-settings.js';

/**
 * Hermetic coverage of the ONE-WAY broadcast kill switch (SVC-04, Phase 5 D-14).
 *
 * Three properties are load-bearing here, and each is asserted rather than commented:
 *
 *  1. **The decision is per COHORT, taken at the beacon-tx handoff, never at boot.** A cohort
 *     advertised BEFORE the switch engaged still broadcasts; one advertised afterwards does not.
 *     That is what makes "in-flight cohorts finish under the mode they started with" a fact
 *     rather than a hope, and it is proven end to end with a stubbed esplora connection whose
 *     `send` is counted.
 *  2. **The flag can only ever move from false to true.** ADR 0010's layered environment opt-in
 *     stays the only path to money movement, so the holder exposes exactly one broadcast mutator,
 *     no route sets the flag back, and the escape hatch is a restart. The absence is SEARCHED for
 *     over the holder's own surface and over the app's registered routes, not documented.
 *  3. **The service MODE is never mutated.** `createCohortMonitor` caches the mode at
 *     construction (it says so in its own docstring), and the health strip must keep reporting how
 *     this service actually booted; the disabled state is a separate bit beside it, because the
 *     service really did boot live and its chain reads really are still live (RESEARCH Pattern 6).
 *
 * The spec is chain-free: the injected {@link BitcoinConnection} is a counting stub, and the
 * confirmation poll is given a zero timeout so `broadcastAndConfirm` returns without polling.
 *
 * Lives under `packages/service/tests/` (tests-outside-src convention).
 */

const PASSWORD = 'correct-horse-battery-staple';
const ACTIVE_NETWORK = 'signet';

/** The exact service-level operator-actions entry for the kill switch (05-UI-SPEC E13). */
const BROADCAST_DISABLED_TEXT = 'Disabled broadcast for new cohorts.';

/** A counting esplora stub: no network, and every call is observable. */
function stubBitcoin(): { bitcoin: BitcoinConnection; sent: string[] } {
  const sent: string[] = [];
  const bitcoin = {
    rest: {
      address: {
        getUtxos: async () => [],
      },
      transaction: {
        send: async (rawHex: string) => {
          sent.push(rawHex);
          return 'a'.repeat(64);
        },
        isConfirmed: async () => false,
      },
    },
  } as unknown as BitcoinConnection;
  return { bitcoin, sent };
}

/**
 * A stand-in signed beacon tx. `extract()` is all {@link rawBeaconTxHex} needs, and `id` resolves
 * the duplicate-acceptance branch; neither reaches the network through the stub above.
 */
function signedTxStub(): Transaction {
  return {
    extract: () => new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
    id: 'b'.repeat(64),
  } as unknown as Transaction;
}

/** A minimal `signing-complete` payload; only `cohortId` and `signedTx` are read on this path. */
function anchoredResult(cohortId: string): AggregationResult {
  return {
    cohortId,
    signature: new Uint8Array(64),
    signedTx: signedTxStub(),
    path: 'key-path',
  } as AggregationResult;
}

/**
 * A live + broadcasting service over the counting stub. Nothing binds a port and nothing reaches
 * a chain: the cohorts below are driven by emitting the runner's own events, which is exactly the
 * push input the broadcast handoff and the advertise-stamp listener consume.
 */
function liveService(): ReturnType<typeof createService> & { sent: string[] } {
  const identity = createIdentity(resolveNetwork(ACTIVE_NETWORK));
  const { bitcoin, sent } = stubBitcoin();
  const service = createService({
    identity,
    config: buildCohortConfig(2, 'CASBeacon', ACTIVE_NETWORK),
    live: true,
    broadcast: true,
    bitcoin,
    // Return from broadcastAndConfirm without polling: the send is what this spec counts.
    confirmTimeoutMs: 0,
    cohortTtlMs: 60_000,
    operatorPassword: PASSWORD,
    operatorCookieSecure: false,
  });
  return Object.assign(service, { sent });
}

/** Let the fire-and-forget broadcast handler run to its (stubbed) completion. */
async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 30));
}

/** An operator-enabled app wired with just the holder + monitor, for the route semantics. */
function killSwitchApp() {
  const identity = createIdentity(resolveNetwork(ACTIVE_NETWORK));
  const transport = new HttpServerTransport({ resolveSenderPk: resolveBtcr2SenderPk, heartbeatIntervalMs: 0 });
  transport.registerActor(identity.did, identity.keys);
  const runner = new AggregationServiceRunner({
    transport,
    did: identity.did,
    keys: identity.keys,
    onProvideTxData: async () => {
      throw new Error('signing not exercised in this spec');
    },
  });
  transport.start();
  const sessions = createSessionStore(60_000);
  const operatorAuth: OperatorAuthConfig = {
    sessions,
    throttle: createLoginThrottle({ maxAttempts: 1000, windowMs: 5 * 60_000 }),
    expectedPassword: PASSWORD,
    cookieSecure: false,
    sessionTtlMs: 60_000,
  };
  const settings = createRuntimeSettings({});
  // `live` mode is passed explicitly so the health projection under test is the one a
  // broadcasting service serves.
  const monitor = createCohortMonitor(runner, undefined, undefined, 'live', settings);
  const app = createHonoApp(transport, {
    operatorAuth,
    monitor,
    runtimeSettings: settings,
    networkName: ACTIVE_NETWORK,
  });
  return { app, runner, transport, monitor, settings };
}

/** POST a login and return the bare `operator_session=<id>` cookie for gated requests. */
async function login(app: ReturnType<typeof killSwitchApp>['app']): Promise<string> {
  const res = await app.request('/v1/operator/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  });
  return res.headers.get('set-cookie')?.split(';')[0] ?? '';
}

describe('cohortKeepsLiveWiring: the per-cohort broadcast decision (D-14, RESEARCH Pattern 6)', () => {
  it('keeps the live wiring for every cohort while the switch is off', () => {
    expect(cohortKeepsLiveWiring({ broadcastDisabled: false, advertisedAtMs: 10 })).toBe(true);
    expect(cohortKeepsLiveWiring({ broadcastDisabled: false })).toBe(true);
  });

  it('keeps the live wiring for a cohort advertised BEFORE the switch engaged', () => {
    expect(
      cohortKeepsLiveWiring({ broadcastDisabled: true, engagedAtMs: 100, advertisedAtMs: 99 }),
    ).toBe(true);
  });

  it('drops a cohort advertised AT or AFTER the engage moment onto the fixture path', () => {
    expect(
      cohortKeepsLiveWiring({ broadcastDisabled: true, engagedAtMs: 100, advertisedAtMs: 100 }),
    ).toBe(false);
    expect(
      cohortKeepsLiveWiring({ broadcastDisabled: true, engagedAtMs: 100, advertisedAtMs: 101 }),
    ).toBe(false);
  });

  it('fails CLOSED for a cohort with no advertise stamp once the switch is engaged', () => {
    // An id this service never stamped cannot be shown to predate the switch, and the safe
    // answer for a money-moving decision is the one that moves no money.
    expect(cohortKeepsLiveWiring({ broadcastDisabled: true, engagedAtMs: 100 })).toBe(false);
  });
});

describe('the one-way flag on the runtime holder (ADR 0010 preserved)', () => {
  it('starts false on every boot and stamps its engage moment on the first call', () => {
    const settings = createRuntimeSettings({});
    expect(settings.broadcastDisabled).toBe(false);
    expect(settings.broadcastDisabledAtMs).toBeUndefined();

    const before = Date.now();
    settings.disableBroadcast();
    expect(settings.broadcastDisabled).toBe(true);
    expect(settings.broadcastDisabledAtMs).toBeGreaterThanOrEqual(before);
  });

  it('is idempotent: a second call keeps the FIRST engage stamp', () => {
    const settings = createRuntimeSettings({});
    settings.disableBroadcast();
    const first = settings.broadcastDisabledAtMs;
    settings.disableBroadcast();
    expect(settings.broadcastDisabledAtMs).toBe(first);
  });

  it('exposes exactly ONE broadcast mutator, and it only ever sets the flag true', () => {
    const settings = createRuntimeSettings({});
    // A SEARCH over the holder's own surface, not a comment: any future `enableBroadcast`,
    // `resetBroadcast`, or `setBroadcast` would fail this immediately.
    const broadcastMembers = Object.keys(settings).filter((k) => /broadcast/i.test(k));
    expect(broadcastMembers.sort()).toEqual(['broadcastDisabled', 'broadcastDisabledAtMs', 'disableBroadcast']);

    settings.disableBroadcast();
    // Exercise every other callable on the holder; none of them may return the flag to false.
    settings.pause();
    settings.resume();
    settings.applySettings({
      serviceName: 'Renamed',
      defaultBeaconType: 'SMTBeacon',
      defaultSize: 3,
      defaultThreshold: 3,
      defaultDiscoveryWindowMs: 60_000,
      defaultFundingWindowMs: 60_000,
      termsText: 'Be excellent to each other.',
    });
    settings.snapshot();
    expect(settings.broadcastDisabled).toBe(true);
  });

  it('keeps the flag out of the settings SET, so a save can never clear it', () => {
    const settings = createRuntimeSettings({});
    settings.disableBroadcast();
    // A patch carrying the key is not part of the contract; even smuggled in it changes nothing.
    settings.applySettings({ broadcastDisabled: false } as never);
    expect(settings.broadcastDisabled).toBe(true);
    expect(Object.keys(settings.snapshot())).not.toContain('broadcastDisabled');
  });
});

describe('the switch never mutates the mode the monitor reports (RESEARCH Pattern 6)', () => {
  it('reports broadcastDisabled as a bit BESIDE the unchanged boot mode', () => {
    const { runner, transport, monitor, settings } = killSwitchApp();
    const before = monitor.serviceHealth();
    expect(before.mode).toBe('live');
    expect(before.broadcastDisabled).toBe(false);

    settings.disableBroadcast();
    const after = monitor.serviceHealth();
    // The SAME mode value: the service really did boot live, and its chain reads are still live.
    expect(after.mode).toBe(before.mode);
    expect(after.esploraReachable).toBe(before.esploraReachable);
    expect(after.broadcastDisabled).toBe(true);

    runner.stop();
    transport.stop();
  });
});

describe('POST /v1/operator/broadcast/disable route semantics', () => {
  it('401s for an anonymous caller', async () => {
    const { app, runner, transport, settings } = killSwitchApp();
    const res = await app.request('/v1/operator/broadcast/disable', { method: 'POST' });
    expect(res.status).toBe(401);
    expect(settings.broadcastDisabled).toBe(false);

    runner.stop();
    transport.stop();
  });

  it('200s for an operator session and answers with the resulting state', async () => {
    const { app, runner, transport, settings } = killSwitchApp();
    const cookie = await login(app);
    const res = await app.request('/v1/operator/broadcast/disable', { method: 'POST', headers: { cookie } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ broadcastDisabled: true });
    expect(settings.broadcastDisabled).toBe(true);

    runner.stop();
    transport.stop();
  });

  it('is idempotent and appends ONE operator-action entry, not two', async () => {
    const { app, runner, transport, monitor } = killSwitchApp();
    const cookie = await login(app);
    await app.request('/v1/operator/broadcast/disable', { method: 'POST', headers: { cookie } });
    const second = await app.request('/v1/operator/broadcast/disable', { method: 'POST', headers: { cookie } });
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ broadcastDisabled: true });

    const entries = monitor.operatorActions().filter((e) => e.text === BROADCAST_DISABLED_TEXT);
    expect(entries).toHaveLength(1);
    expect(typeof entries[0].t).toBe('number');

    runner.stop();
    transport.stop();
  });

  it('registers NO counterpart route that turns broadcast back on', async () => {
    const { app, runner, transport } = killSwitchApp();
    const broadcastRoutes = app.routes
      .map((r) => `${r.method} ${r.path}`)
      .filter((r) => /broadcast/i.test(r));
    // The gated disable is the only broadcast route on this app; the `/v1/operator/*` prefix
    // guards match every path under it, so they are excluded by the `broadcast` filter itself.
    expect(broadcastRoutes).toEqual(['POST /v1/operator/broadcast/disable']);
    // And nothing anywhere is named enable / resume / reset for broadcasting.
    expect(app.routes.some((r) => /broadcast\/(enable|resume|reset|on)/i.test(r.path))).toBe(false);

    runner.stop();
    transport.stop();
  });
});

describe('the beacon-tx handoff decides per cohort (stubbed broadcaster, no chain)', () => {
  it('still broadcasts a cohort advertised BEFORE the switch engaged', async () => {
    const service = liveService();
    service.runner.emit('cohort-advertised', { cohortId: 'before-1' } as never);
    // Engage AFTER the advertise stamp, so this cohort predates the switch.
    await new Promise((r) => setTimeout(r, 2));
    service.settings.disableBroadcast();

    service.runner.emit('signing-complete', anchoredResult('before-1') as never);
    await settle();
    expect(service.sent).toHaveLength(1);

    await service.stop();
  });

  it('does NOT broadcast a cohort advertised AFTER the switch engaged', async () => {
    const service = liveService();
    service.settings.disableBroadcast();
    await new Promise((r) => setTimeout(r, 2));
    service.runner.emit('cohort-advertised', { cohortId: 'after-1' } as never);

    service.runner.emit('signing-complete', anchoredResult('after-1') as never);
    await settle();
    expect(service.sent).toEqual([]);

    await service.stop();
  });

  it('broadcasts every cohort while the switch is off (the unchanged default path)', async () => {
    const service = liveService();
    service.runner.emit('cohort-advertised', { cohortId: 'c1' } as never);
    service.runner.emit('signing-complete', anchoredResult('c1') as never);
    await settle();
    expect(service.sent).toHaveLength(1);

    await service.stop();
  });
});
