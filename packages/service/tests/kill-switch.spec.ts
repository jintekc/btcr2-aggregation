import { AggregationServiceRunner, HttpServerTransport } from '@did-btcr2/aggregation/service';
import { resolveBtcr2SenderPk } from '@did-btcr2/method';
import { buildCohortConfig, createIdentity, resolveNetwork } from '@btcr2-aggregation/shared';
import type { BitcoinConnection } from '@did-btcr2/bitcoin';
import type { AggregationResult } from '@did-btcr2/aggregation/service';
import type { Transaction } from '@scure/btc-signer';
import { describe, expect, it, vi } from 'vitest';
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

/**
 * Two plausible signet taproot beacon addresses. Nothing here decodes them; they exist so a
 * counted esplora read names WHICH cohort's beacon was polled, which is what turns "some read
 * happened" into "the pre-switch cohort's beacon was read and the post-switch one's was not".
 */
const BEACON_BEFORE = 'tb1pbeforebeforebeforebeforebeforebeforebeforebeforebeforebefo';
const BEACON_AFTER = 'tb1pafterafterafterafterafterafterafterafterafterafterafterafte';

/**
 * A counting esplora stub: no network, and every call is observable.
 *
 * `getUtxos` is COUNTED for the same reason `send` is (05-AUDIT entry 2): the funding leg of the
 * kill switch is only assertable through the chain reads it does or does not make. A watch that
 * was never created reads nothing, and that absence is the whole property. Each read records the
 * address it was asked about, so a case can also say WHICH cohort's beacon was polled.
 */
function stubBitcoin(): { bitcoin: BitcoinConnection; sent: string[]; utxoReads: string[] } {
  const sent: string[] = [];
  const utxoReads: string[] = [];
  const bitcoin = {
    rest: {
      address: {
        getUtxos: async (address: string) => {
          utxoReads.push(address);
          return [];
        },
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
  return { bitcoin, sent, utxoReads };
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
function liveService(): ReturnType<typeof createService> & { sent: string[]; utxoReads: string[] } {
  const identity = createIdentity(resolveNetwork(ACTIVE_NETWORK));
  const { bitcoin, sent, utxoReads } = stubBitcoin();
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
    // Poll far slower than any case here runs, so a watch that IS created contributes exactly one
    // read (its immediate first poll) and the counted numbers stay deterministic.
    fundingPollIntervalMs: 60_000,
  });
  return Object.assign(service, { sent, utxoReads });
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

/**
 * The FUNDING leg of the same switch (05-AUDIT entry 2, D-14).
 *
 * The shipped spec had no funding assertion at all, which is precisely why a defect on the flag
 * this file exists for survived it: the display funding watch in
 * {@link file://../src/funding-watch.ts} was wired at `keygen-complete` with no kill-switch test,
 * so a cohort that correctly stood down (fixture tx, nothing published) still polled esplora and
 * still recorded a `waiting` funding view. That view draws the copyable `bitcoin:` URI and the
 * "send at least N sats in one single payment" instruction on the operator drill-down, beside the
 * disclosure that funds sent to a throwaway-recovery beacon are unrecoverable.
 *
 * The PARTICIPANT-side consequence this pins is the reason the anonymous read is asserted rather
 * than only the gated projection: `publicFunding` is the single input to the `liveCohort` latch in
 * `packages/web/src/stores/participant.ts`, and that latch is what makes `CohortPage.tsx` tell a
 * seated participant "This cohort anchors on-chain" plus "Waiting for the operator to fund this
 * cohort's beacon address". Both are false for a stood-down cohort. Closing it at the source (no
 * funding view recorded) closes it for the console AND the participant with no web-side change,
 * so the served value is what these rows assert.
 *
 * The counted `getUtxos` on {@link stubBitcoin} is the axis that was missing.
 */
describe('the funding watch stands down with the switch (05-AUDIT entry 2)', () => {
  it('reads NO utxo and records NO funding view for a cohort advertised AFTER the switch', async () => {
    const service = liveService();
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });
    try {
      service.settings.disableBroadcast();
      await new Promise((r) => setTimeout(r, 2));
      service.runner.emit('cohort-advertised', { cohortId: 'after-fund' } as never);

      service.runner.emit('keygen-complete', {
        cohortId: 'after-fund',
        beaconAddress: BEACON_AFTER,
      } as never);

      // Red WITHOUT any flush: `createFundingWatch` evaluates `getUtxos(...)` SYNCHRONOUSLY (the
      // call happens before the `await` suspends the loop), so a watch that was created has
      // already read the chain by the time this line runs. Pre-fix this observed 1 read.
      expect(service.utxoReads).toEqual([]);

      // The next two rows need the flush, and the reason must not be glossed: `noteFunding` runs
      // only once that first `getUtxos` promise RESOLVES, so asserted in the emit's own tick they
      // are true against the unfixed code too and would prove nothing. With the flush they are
      // genuine: pre-fix the detail carried a full `waiting` funding view and `publicFunding`
      // answered `{ awaitingFunding: true }`.
      await settle();
      expect(service.utxoReads).toEqual([]);
      expect(service.monitor.detail('after-fund').funding).toBeUndefined();
      expect(service.monitor.publicFunding('after-fund')).toEqual({ awaitingFunding: false });

      // ...and still nothing once the cohort has ENDED. The retained funding view is the durable
      // half of the defect: the summary chip reverts on settle, but the drill-down card and this
      // anonymous read kept asserting "awaiting funding" for a finished, never-published cohort.
      service.runner.emit('signing-complete', anchoredResult('after-fund') as never);
      await settle();
      expect(service.utxoReads).toEqual([]);
      expect(service.monitor.detail('after-fund').funding).toBeUndefined();
      expect(service.monitor.publicFunding('after-fund')).toEqual({ awaitingFunding: false });
    } finally {
      logSpy.mockRestore();
      await service.stop();
    }

    // An operator reading the process output learns WHY a funding stage they expected is absent,
    // rather than meeting a silently missing card.
    expect(
      logs.some((line) => line.includes('after-fund') && /funding/i.test(line)),
    ).toBe(true);
  });

  it('KEEPS the funding watch for a cohort advertised BEFORE the switch engaged', async () => {
    // The non-regression direction, and the row a guard written too broadly fails. That cohort's
    // beacon really will be spent, so suppressing its funding prompt would be the inverse defect:
    // an operator who is never asked to fund a cohort that genuinely needs funding watches it
    // lapse for want of an instruction the console decided not to give.
    const service = liveService();
    try {
      service.runner.emit('cohort-advertised', { cohortId: 'before-fund' } as never);
      await new Promise((r) => setTimeout(r, 2));
      service.settings.disableBroadcast();

      service.runner.emit('keygen-complete', {
        cohortId: 'before-fund',
        beaconAddress: BEACON_BEFORE,
      } as never);
      await settle();

      expect(service.utxoReads).toContain(BEACON_BEFORE);
      // The PRESENCE of the key, not its contents, so this row stays stable if the funding view
      // gains fields later.
      expect(service.monitor.detail('before-fund').funding).toBeDefined();
      expect(service.monitor.publicFunding('before-fund')).toEqual({ awaitingFunding: true });
    } finally {
      await service.stop();
    }
  });

  it('watches EVERY cohort while the switch is off (the unchanged default path)', async () => {
    const service = liveService();
    try {
      service.runner.emit('cohort-advertised', { cohortId: 'off-1' } as never);
      service.runner.emit('cohort-advertised', { cohortId: 'off-2' } as never);
      service.runner.emit('keygen-complete', {
        cohortId: 'off-1',
        beaconAddress: BEACON_BEFORE,
      } as never);
      service.runner.emit('keygen-complete', {
        cohortId: 'off-2',
        beaconAddress: BEACON_AFTER,
      } as never);
      await settle();

      expect(service.utxoReads).toContain(BEACON_BEFORE);
      expect(service.utxoReads).toContain(BEACON_AFTER);
      expect(service.monitor.detail('off-1').funding).toBeDefined();
      expect(service.monitor.detail('off-2').funding).toBeDefined();
    } finally {
      await service.stop();
    }
  });

  it('serves awaitingFunding TRUE for the pre-switch cohort and FALSE for the post-switch one, in one request pair', async () => {
    // DIFFERENTIAL, and deliberately so. The pre-switch control is what makes this row measure the
    // guard rather than the fixture: an app with no funding watch behind it answers
    // `{ awaitingFunding: false }` for every well-formed id, switch engaged or not, before the fix
    // and after it. That is why this case is built over the SAME `liveService()` instance (a real
    // funding watch really is at stake for one of the two ids) and NOT over `killSwitchApp()`,
    // whose monitor sits beside a bare runner with no `createService` behind it. Standing a watch
    // in with `monitor.noteFunding` is refused for the mirror-image reason: it would make the
    // post-switch id answer TRUE, leaving "record nothing" as the only way to green the row, which
    // is the vacuous case again.
    //
    // `operatorAuth` is omitted on purpose: `GET /v1/funding/:cohortId` is mounted in the PUBLIC
    // block BEFORE the operator gate, so no session and no login is needed, and omitting it keeps
    // the case about the funding read rather than about auth.
    //
    // Pre-fix the post-switch half answered `{ awaitingFunding: true }`, which is the participant
    // -facing half of 05-AUDIT entry 2: this one boolean is the sole input to the `liveCohort`
    // latch in `packages/web/src/stores/participant.ts`, and that latch is what makes
    // `CohortPage.tsx` tell a seated participant that their cohort anchors on-chain and awaits the
    // operator's funding. Closing it here closes it for the participant with no web-side change.
    const service = liveService();
    const app = createHonoApp(service.transport, {
      monitor: service.monitor,
      runtimeSettings: service.settings,
      networkName: ACTIVE_NETWORK,
    });
    try {
      service.runner.emit('cohort-advertised', { cohortId: 'pair-before' } as never);
      await new Promise((r) => setTimeout(r, 2));
      service.settings.disableBroadcast();
      await new Promise((r) => setTimeout(r, 2));
      service.runner.emit('cohort-advertised', { cohortId: 'pair-after' } as never);

      service.runner.emit('keygen-complete', {
        cohortId: 'pair-before',
        beaconAddress: BEACON_BEFORE,
      } as never);
      service.runner.emit('keygen-complete', {
        cohortId: 'pair-after',
        beaconAddress: BEACON_AFTER,
      } as never);
      await settle();

      // The pre-switch cohort is kept IN FLIGHT and still waiting for the duration of the pair:
      // `publicFunding` answers false for a canceled record and for a view carrying a terminal
      // verdict, so ending it first would flip the control half to false and quietly turn this
      // differential row back into the vacuous one.
      const beforeRes = await app.request('/v1/funding/pair-before');
      const afterRes = await app.request('/v1/funding/pair-after');
      expect(beforeRes.status).toBe(200);
      expect(afterRes.status).toBe(200);
      expect(await beforeRes.json()).toEqual({ awaitingFunding: true });
      expect(await afterRes.json()).toEqual({ awaitingFunding: false });
    } finally {
      await service.stop();
    }
  });
});

/**
 * The ONE cost this fix introduces, registered rather than assumed away (T-05-16-05).
 *
 * `monitor.noteEsploraObservation` has exactly one caller in the whole service: the funding
 * watch's `onState` in `index.ts`. Standing the watch down therefore means that on a service whose
 * remaining cohorts are all post-switch, `serviceHealth().esploraReachable` is never written
 * again and keeps reporting its last value (optimistically `true`, its initial value, if nothing
 * ever wrote it) while `HealthStrip.tsx` keeps painting the good-tone badge. The switch is one-way
 * per session, so a restart is the only escape.
 *
 * This row is NOT red before green and is NOT defect coverage. It is a documentation pin with
 * teeth on ONE side, in the shape `T-05-17-06` uses for the cost its own fix introduces.
 * What it catches: any future change that makes the post-switch health read something OTHER than
 * the booted mode plus a `true` bit, which a third `unknown` state, a probe reporting `false`, or
 * a re-derived mode would all do, forcing the reader back to this comment and to the amended
 * kill-switch consequences in `docs/adr/0017-runtime-lifecycle-control.md`.
 * What it does NOT catch: someone adding a feeder that happens to observe successfully, since that
 * also reports `true`.
 *
 * Fabricating a reading on the stand-down path is forbidden: there is no esplora read there, so
 * any note would be an observation nobody made, which is a worse honesty defect than the stale bit
 * it would paper over. D-14's "health strip unaffected" survives for the MODE chip and not for
 * this one, which is why the owner is told so beside the item in `05-UAT-CHECKLIST.md`.
 */
describe('a stood-down service keeps reporting its last esplora reading (T-05-16-05)', () => {
  it('reports the booted mode and an unrefreshed esplora bit when only post-switch cohorts remain', async () => {
    const service = liveService();
    try {
      service.settings.disableBroadcast();
      await new Promise((r) => setTimeout(r, 2));
      service.runner.emit('cohort-advertised', { cohortId: 'health-after' } as never);
      service.runner.emit('keygen-complete', {
        cohortId: 'health-after',
        beaconAddress: BEACON_AFTER,
      } as never);
      await settle();

      const health = service.monitor.serviceHealth();
      // The mode is untouched: this service really did boot live, and its resolve / anchor esplora
      // reads really are still live. That half of D-14 holds.
      expect(health.mode).toBe('live');
      expect(health.broadcastDisabled).toBe(true);
      // ...and the bit nothing is maintaining any more. `true` here is the value it was
      // INITIALISED to, unchanged because nothing observed anything, not a reading. Note that this
      // assertion, like the two above it, holds in BOTH directions: it read `true` before the
      // guard landed too (the watch's first poll against the stub succeeded). That is exactly why
      // this row is a disclosure and not defect coverage.
      expect(health.esploraReachable).toBe(true);
      // The only line here that depends on the guard, and it is what makes the disclosure concrete
      // rather than abstract: nothing observed anything, so the `true` above stands behind no
      // observation at all.
      expect(service.utxoReads).toEqual([]);
    } finally {
      await service.stop();
    }
  });
});
