import {
  AggregationServiceRunner,
  HttpServerTransport,
  type AggregationResult,
} from '@did-btcr2/aggregation/service';
import { resolveBtcr2SenderPk } from '@did-btcr2/method';
import { createIdentity, resolveNetwork } from '@btcr2-aggregation/shared';
import type { Transaction } from '@scure/btc-signer';
import { describe, expect, it } from 'vitest';
import { createCohortMonitor, summarizeTx } from '../src/monitor.js';
import { BeaconBroadcaster } from '../src/broadcast.js';
import { createHonoApp } from '../src/hono-adapter.js';
import { createLoginThrottle, createSessionStore, type OperatorAuthConfig } from '../src/operator-auth.js';
import {
  createOperatorCohorts,
  type DirectoryCohortDTO,
  type ServiceStatusDTO,
} from '../src/operator-cohorts.js';

/** A minimal AggregationResult for driving `signing-complete` (the fold reads only
 *  cohortId + path; signedTx is never touched by the summary fold). */
function anchoredResult(cohortId: string, path: 'key-path' | 'script-path' = 'key-path'): AggregationResult {
  return { cohortId, signature: new Uint8Array(64), signedTx: {} as unknown as Transaction, path } as AggregationResult;
}

/**
 * Hermetic coverage of the cohort monitoring fold (SVC-03, D-19/D-27), following the
 * anchor-state.spec.ts idiom: drive the runner's membership events directly (the runner
 * is a TypedEventEmitter, so `emit` is the fold's push input) and assert the projected
 * detail DTO. No port, no chain, no esplora: the fold is pure in-memory state and the
 * detail read never touches the network. The route half reuses the operator-cohorts.spec
 * harness (login once, then drive the gated read + the mandatory anonymous 401).
 *
 * NEW spec file lives under `packages/service/tests/` (tests-outside-src convention), so
 * it imports the module under test via `../src/monitor.js`.
 */

const PASSWORD = 'correct-horse-battery-staple';
const ACTIVE_NETWORK = 'signet';

/** A bare runner with no cohort advertised: enough to drive the fold via `emit`. */
function bareRunner(): AggregationServiceRunner {
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
  return runner;
}

describe('createCohortMonitor', () => {
  it('folds opt-in -> pending and accept -> seated for the same DID', () => {
    const runner = bareRunner();
    const monitor = createCohortMonitor(runner);

    runner.emit('opt-in-received', {
      cohortId: 'c1',
      participantDid: 'did:example:alice',
      participantPk: new Uint8Array([1]),
      communicationPk: new Uint8Array([2]),
    });
    let detail = monitor.detail('c1');
    expect(detail.exists).toBe(true);
    expect(detail.members).toHaveLength(1);
    expect(detail.members[0]).toMatchObject({ did: 'did:example:alice', status: 'pending' });
    expect(typeof detail.members[0].since).toBe('number');

    runner.emit('participant-accepted', { cohortId: 'c1', participantDid: 'did:example:alice' });
    detail = monitor.detail('c1');
    expect(detail.members).toHaveLength(1);
    expect(detail.members[0]).toMatchObject({ did: 'did:example:alice', status: 'seated' });
  });

  it('lists a DID with only an opt-in as pending, distinct from a seated member (D-29)', () => {
    const runner = bareRunner();
    const monitor = createCohortMonitor(runner);

    runner.emit('opt-in-received', {
      cohortId: 'c1',
      participantDid: 'did:example:pending',
      participantPk: new Uint8Array([1]),
      communicationPk: new Uint8Array([2]),
    });
    runner.emit('opt-in-received', {
      cohortId: 'c1',
      participantDid: 'did:example:seated',
      participantPk: new Uint8Array([3]),
      communicationPk: new Uint8Array([4]),
    });
    runner.emit('participant-accepted', { cohortId: 'c1', participantDid: 'did:example:seated' });

    const detail = monitor.detail('c1');
    const statuses = Object.fromEntries(detail.members.map((m) => [m.did, m.status]));
    expect(statuses['did:example:pending']).toBe('pending');
    expect(statuses['did:example:seated']).toBe('seated');
    // No live cohort in the session for this bare runner, so seatsJoined derives from the
    // seated fold (one seated member).
    expect(detail.seatsJoined).toBe(1);
  });

  it('promoting a pending member keeps its original `since` stamp', () => {
    const runner = bareRunner();
    const monitor = createCohortMonitor(runner);
    runner.emit('opt-in-received', {
      cohortId: 'c1',
      participantDid: 'did:example:alice',
      participantPk: new Uint8Array([1]),
      communicationPk: new Uint8Array([2]),
    });
    const since = monitor.detail('c1').members[0].since;
    runner.emit('participant-accepted', { cohortId: 'c1', participantDid: 'did:example:alice' });
    expect(monitor.detail('c1').members[0].since).toBe(since);
  });

  it('answers an unknown cohortId with the non-oracle absent DTO (never throwing)', () => {
    const runner = bareRunner();
    const monitor = createCohortMonitor(runner);
    expect(monitor.detail('does-not-exist')).toEqual({
      exists: false,
      members: [],
      seatsJoined: 0,
      capacity: 0,
      phase: 'unknown',
    });
  });

  it('reads an evicted cohort byte-identically to a never-existed one (no existence oracle)', () => {
    const runner = bareRunner();
    const monitor = createCohortMonitor(runner);
    // Fold 25 distinct cohorts; c0 is the oldest and evicted past the 24 cap.
    for (let i = 0; i < 25; i++) {
      runner.emit('opt-in-received', {
        cohortId: `c${i}`,
        participantDid: `did:example:p${i}`,
        participantPk: new Uint8Array([i & 0xff]),
        communicationPk: new Uint8Array([i & 0xff]),
      });
    }
    const evicted = monitor.detail('c0');
    const neverExisted = monitor.detail('never-existed');
    expect(evicted).toEqual(neverExisted);
    expect(evicted.exists).toBe(false);
    // The newest 24 (c1..c24) are all retained.
    expect(monitor.detail('c1').exists).toBe(true);
    expect(monitor.detail('c24').exists).toBe(true);
  });

  it('is an idempotent projection: two reads with no intervening event are deep-equal', () => {
    const runner = bareRunner();
    const monitor = createCohortMonitor(runner);
    runner.emit('opt-in-received', {
      cohortId: 'c1',
      participantDid: 'did:example:alice',
      participantPk: new Uint8Array([1]),
      communicationPk: new Uint8Array([2]),
    });
    runner.emit('participant-accepted', { cohortId: 'c1', participantDid: 'did:example:alice' });
    expect(monitor.detail('c1')).toEqual(monitor.detail('c1'));
  });

  it('is a per-service closure: two monitors on two runners never share state', () => {
    const runnerA = bareRunner();
    const runnerB = bareRunner();
    const monitorA = createCohortMonitor(runnerA);
    const monitorB = createCohortMonitor(runnerB);

    runnerA.emit('opt-in-received', {
      cohortId: 'c1',
      participantDid: 'did:example:alice',
      participantPk: new Uint8Array([1]),
      communicationPk: new Uint8Array([2]),
    });
    expect(monitorA.detail('c1').members).toHaveLength(1);
    // monitorB's runner saw nothing: its state is independent.
    expect(monitorB.detail('c1')).toEqual({
      exists: false,
      members: [],
      seatsJoined: 0,
      capacity: 0,
      phase: 'unknown',
    });
  });

  it('catches a thrown detail-projection safely at the listener boundary (fire-and-forget)', () => {
    // A malformed opt-in payload (missing participantDid) must not reject back to the
    // runner: the listener catches its own error. emit returns normally either way.
    const runner = bareRunner();
    createCohortMonitor(runner);
    expect(() =>
      runner.emit('opt-in-received', {
        cohortId: 'c1',
        // deliberately omit participantDid to exercise the defensive catch path
      } as unknown as {
        cohortId: string;
        participantDid: string;
        participantPk: Uint8Array;
        communicationPk: Uint8Array;
      }),
    ).not.toThrow();
  });
});

describe('GET /v1/operator/cohorts/:id monitoring route', () => {
  /** Build an operator-enabled app wired with a monitor over a real runner, as index.ts does. */
  function monitorApp() {
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
    const operatorAuth: OperatorAuthConfig = {
      sessions: createSessionStore(60_000),
      throttle: createLoginThrottle({ maxAttempts: 1000, windowMs: 5 * 60_000 }),
      expectedPassword: PASSWORD,
      cookieSecure: false,
      sessionTtlMs: 60_000,
    };
    const operatorCohorts = createOperatorCohorts({ activeNetwork: ACTIVE_NETWORK, runner, autoFallbackOnStall: true });
    const monitor = createCohortMonitor(runner);
    const app = createHonoApp(transport, {
      operatorAuth,
      operatorCohorts,
      monitor,
      networkName: ACTIVE_NETWORK,
    });
    return { app, runner, operatorCohorts };
  }

  async function login(app: ReturnType<typeof monitorApp>['app']): Promise<string> {
    const res = await app.request('/v1/operator/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD }),
    });
    return res.headers.get('set-cookie')?.split(';')[0] ?? '';
  }

  it('rejects an anonymous request with 401 BEFORE any cohort-id lookup (no existence oracle)', async () => {
    const { app, runner } = monitorApp();
    try {
      const res = await app.request('/v1/operator/cohorts/some-cohort');
      expect(res.status).toBe(401);
    } finally {
      runner.stop();
    }
  });

  it('returns 400 for an id failing the shape guard, even with a valid session', async () => {
    const { app, runner } = monitorApp();
    try {
      const cookie = await login(app);
      const res = await app.request('/v1/operator/cohorts/has_underscore', { headers: { cookie } });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'invalid cohort id' });
    } finally {
      runner.stop();
    }
  });

  it('serves the detail DTO to an authenticated operator', async () => {
    const { app, runner } = monitorApp();
    try {
      const cookie = await login(app);
      runner.emit('opt-in-received', {
        cohortId: 'cohort-1',
        participantDid: 'did:example:alice',
        participantPk: new Uint8Array([1]),
        communicationPk: new Uint8Array([2]),
      });
      const res = await app.request('/v1/operator/cohorts/cohort-1', { headers: { cookie } });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { exists: boolean; members: { did: string; status: string }[] };
      expect(body.exists).toBe(true);
      expect(body.members[0]).toMatchObject({ did: 'did:example:alice', status: 'pending' });
    } finally {
      runner.stop();
    }
  });

  it('answers an unknown cohortId with the non-oracle absent DTO (200, never 404)', async () => {
    const { app, runner } = monitorApp();
    try {
      const cookie = await login(app);
      const res = await app.request('/v1/operator/cohorts/never-existed', { headers: { cookie } });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        exists: false,
        members: [],
        seatsJoined: 0,
        capacity: 0,
        phase: 'unknown',
      });
    } finally {
      runner.stop();
    }
  });

  it('merges live monitoring chips + metrics into GET /v1/operator/cohorts, cohorts array intact', async () => {
    const { app, runner } = monitorApp();
    try {
      const cookie = await login(app);
      // Create + advertise a cohort so the runner holds one live Advertised (filling) cohort.
      const createRes = await app.request('/v1/operator/cohorts', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ beaconType: 'CASBeacon', size: 2, threshold: 2 }),
      });
      const draft = (await createRes.json()) as { draftId: string };
      await app.request(`/v1/operator/cohorts/${draft.draftId}/advertise`, { method: 'POST', headers: { cookie } });

      const res = await app.request('/v1/operator/cohorts', { headers: { cookie } });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        cohorts: { state: string }[];
        monitoring?: { rows: { cohortId: string; chip: string }[]; metrics: Record<string, number> };
      };
      // The existing `cohorts` array is intact (an advertised row is present).
      expect(Array.isArray(body.cohorts)).toBe(true);
      expect(body.cohorts.some((c) => c.state === 'advertised')).toBe(true);
      // The NEW monitoring sibling carries a live `filling` chip + open metric === 1.
      expect(body.monitoring).toBeDefined();
      expect(body.monitoring?.rows.some((r) => r.chip === 'filling')).toBe(true);
      expect(body.monitoring?.metrics).toEqual({ open: 1, inFlight: 0, anchored: 0, failed: 0 });
    } finally {
      runner.stop();
    }
  });

  it('freezes the public DirectoryCohortDTO + ServiceStatusDTO shapes (no monitoring leak, D-26)', () => {
    const { runner, operatorCohorts } = monitorApp();
    try {
      // Advertise via the object API so the live-derived public reads have an entry.
      const draft = operatorCohorts.createDraft({ beaconType: 'CASBeacon', size: 2, threshold: 2 });
      operatorCohorts.advertiseDraft(draft.draftId);

      const dir: DirectoryCohortDTO[] = operatorCohorts.directory();
      expect(dir).toHaveLength(1);
      // The public directory DTO carries EXACTLY these keys - monitoring fields (chip,
      // reason, metrics) must never leak onto the frozen public surface (Pitfall 7).
      expect(Object.keys(dir[0]).sort()).toEqual(
        ['beaconType', 'capacity', 'cohortId', 'joined', 'network', 'phase', 'threshold'].sort(),
      );

      const status: ServiceStatusDTO = operatorCohorts.status();
      expect(Object.keys(status).sort()).toEqual(['network', 'openCohorts', 'up'].sort());
    } finally {
      runner.stop();
    }
  });
});

describe('createCohortMonitor summary + serviceMetrics + ended taxonomy', () => {
  it('records an ANCHORED ended record that survives with no live cohort (D-23)', () => {
    const runner = bareRunner();
    const monitor = createCohortMonitor(runner);
    // Seat a member so the ended record captures a real seat count from the fold, then end.
    runner.emit('opt-in-received', {
      cohortId: 'c1',
      participantDid: 'did:example:alice',
      participantPk: new Uint8Array([1]),
      communicationPk: new Uint8Array([2]),
    });
    runner.emit('participant-accepted', { cohortId: 'c1', participantDid: 'did:example:alice' });
    runner.emit('signing-complete', anchoredResult('c1'));

    // No live cohort exists for this bare runner (runner.session.getCohort('c1') is undefined),
    // yet the ended record still projects the cohort's anchored fate + captured seat count.
    const row = monitor.summary().find((r) => r.cohortId === 'c1');
    expect(row).toMatchObject({ chip: 'anchored', phase: 'ended', seatsJoined: 1 });
    expect(monitor.serviceMetrics()).toMatchObject({ anchored: 1, failed: 0 });
  });

  it('records a FAILED ended record with the cohort-attributed reason (planning note 2)', () => {
    const runner = bareRunner();
    const monitor = createCohortMonitor(runner);
    runner.emit('cohort-failed', { cohortId: 'c2', reason: 'a participant rejected validation' });

    const row = monitor.summary().find((r) => r.cohortId === 'c2');
    expect(row).toMatchObject({ chip: 'failed', phase: 'ended', reason: 'a participant rejected validation' });
    expect(monitor.serviceMetrics()).toMatchObject({ failed: 1 });
  });

  it('tags a k-of-n script-path completion as `fallback`, counted as anchored (D-33)', () => {
    const runner = bareRunner();
    const monitor = createCohortMonitor(runner);
    runner.emit('fallback-started', { cohortId: 'c3', sessionId: 's1' });
    runner.emit('signing-complete', anchoredResult('c3', 'script-path'));

    expect(monitor.summary().find((r) => r.cohortId === 'c3')?.chip).toBe('fallback');
    // Fallback still anchored the beacon tx on-chain, so it counts toward `anchored`.
    expect(monitor.serviceMetrics()).toMatchObject({ anchored: 1, failed: 0 });
  });

  it('bounds ended records at 24 with oldest-first eviction', () => {
    const runner = bareRunner();
    const monitor = createCohortMonitor(runner);
    // Fail 25 distinct cohorts; c0 is the oldest and must be evicted past the 24 cap.
    for (let i = 0; i < 25; i++) {
      runner.emit('cohort-failed', { cohortId: `e${i}`, reason: 'stall' });
    }
    const rows = monitor.summary();
    expect(rows).toHaveLength(24);
    expect(rows.find((r) => r.cohortId === 'e0')).toBeUndefined();
    expect(rows.find((r) => r.cohortId === 'e24')).toBeDefined();
    // The metric is a bounded live count, never a since-boot cumulative: 24, not 25.
    expect(monitor.serviceMetrics().failed).toBe(24);
  });

  it('serviceMetrics counts anchored + failed independently from the ended set', () => {
    const runner = bareRunner();
    const monitor = createCohortMonitor(runner);
    runner.emit('signing-complete', anchoredResult('a1'));
    runner.emit('signing-complete', anchoredResult('a2'));
    runner.emit('cohort-failed', { cohortId: 'f1', reason: 'stall' });
    // No live cohorts on the bare runner, so open + inFlight are 0.
    expect(monitor.serviceMetrics()).toEqual({ open: 0, inFlight: 0, anchored: 2, failed: 1 });
  });

  it('a broadcast that FAILS after a successful co-sign flips the fate to `failed` (D-18)', () => {
    const runner = bareRunner();
    const broadcaster = new BeaconBroadcaster();
    const monitor = createCohortMonitor(runner, broadcaster);
    runner.emit('signing-complete', anchoredResult('c9'));
    expect(monitor.summary().find((r) => r.cohortId === 'c9')?.chip).toBe('anchored');

    // The beacon-tx broadcast then fails: the honest fate is `failed`, not `anchored`, so
    // the operator never sees an "anchored" chip for a cohort whose tx never made it on-chain.
    broadcaster.emit('beacon-broadcast-failed', { cohortId: 'c9', reason: 'bad-txns-inputs-missingorspent' });
    const row = monitor.summary().find((r) => r.cohortId === 'c9');
    expect(row?.chip).toBe('failed');
    expect(row?.reason).toBe('bad-txns-inputs-missingorspent');
    expect(monitor.serviceMetrics()).toMatchObject({ anchored: 0, failed: 1 });
  });
});

describe('summarizeTx (lifted from dashboard-sse)', () => {
  it('does not throw on a fixture tx whose fee accessor throws (fee -> undefined, other fields kept)', () => {
    const fixtureTx = {
      get id() {
        return 'fixture-txid';
      },
      version: 2,
      inputsLength: 1,
      outputsLength: 2,
      vsize: 110,
      weight: 440,
      get fee(): bigint {
        // The zero-chain fixture prevout carries no amount, so @scure/btc-signer throws here.
        throw new Error('Transaction fee is not available: input amounts are unknown');
      },
    } as unknown as Transaction;

    expect(() => summarizeTx(fixtureTx)).not.toThrow();
    const summary = summarizeTx(fixtureTx);
    expect(summary.fee).toBeUndefined();
    expect(summary).toMatchObject({ txid: 'fixture-txid', version: 2, inputs: 1, outputs: 2 });
  });
});
