import { AggregationServiceRunner, HttpServerTransport } from '@did-btcr2/aggregation/service';
import { resolveBtcr2SenderPk } from '@did-btcr2/method';
import { createIdentity, resolveNetwork } from '@btcr2-aggregation/shared';
import { describe, expect, it } from 'vitest';
import { createCohortMonitor } from '../src/monitor.js';
import { createHonoApp } from '../src/hono-adapter.js';
import { createLoginThrottle, createSessionStore, type OperatorAuthConfig } from '../src/operator-auth.js';
import { createOperatorCohorts } from '../src/operator-cohorts.js';

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
    return { app, runner };
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
});
