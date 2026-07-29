import {
  AggregationServiceRunner,
  HttpServerTransport,
  type AggregationResult,
} from '@did-btcr2/aggregation/service';
import { resolveBtcr2SenderPk } from '@did-btcr2/method';
import { createIdentity, resolveNetwork } from '@btcr2-aggregation/shared';
import type { Transaction } from '@scure/btc-signer';
import { describe, expect, it, vi } from 'vitest';
import { createCohortMonitor, summarizeTx, type FundingView } from '../src/monitor.js';
import { BeaconBroadcaster } from '../src/broadcast.js';
import { createAnchorState } from '../src/anchor-state.js';
import { createHonoApp } from '../src/hono-adapter.js';
import { createLoginThrottle, createSessionStore, type OperatorAuthConfig } from '../src/operator-auth.js';
import {
  createOperatorCohorts,
  type DirectoryCohortDTO,
  type ServiceStatusDTO,
} from '../src/operator-cohorts.js';
import { createCohortIntents } from '../src/cohort-intent.js';

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
      submissions: [],
      coSign: { noncesReceived: 0, total: 0, awaitingPartialSigs: false },
      anchor: { enabled: false, state: 'none' },
      fallback: { used: false },
      activity: [],
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
      submissions: [],
      coSign: { noncesReceived: 0, total: 0, awaitingPartialSigs: false },
      anchor: { enabled: false, state: 'none' },
      fallback: { used: false },
      activity: [],
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

describe('createCohortMonitor detail depth (submissions, round state, honest co-sign, anchor, activity)', () => {
  /** Seat a member on a bare runner so a round event has a member to advance. */
  function seat(runner: AggregationServiceRunner, cohortId: string, did: string): void {
    runner.emit('opt-in-received', {
      cohortId,
      participantDid: did,
      participantPk: new Uint8Array([1]),
      communicationPk: new Uint8Array([2]),
    });
    runner.emit('participant-accepted', { cohortId, participantDid: did });
  }

  it('advances a member through seated -> submitted -> validated -> nonce-sent (D-31)', () => {
    const runner = bareRunner();
    const monitor = createCohortMonitor(runner);
    seat(runner, 'c1', 'did:example:alice');
    expect(monitor.detail('c1').members[0].round).toBe('seated');

    runner.emit('update-received', { cohortId: 'c1', participantDid: 'did:example:alice' });
    expect(monitor.detail('c1').members[0].round).toBe('submitted');

    runner.emit('validation-received', { cohortId: 'c1', participantDid: 'did:example:alice', approved: true });
    expect(monitor.detail('c1').members[0].round).toBe('validated');

    runner.emit('nonce-received', { cohortId: 'c1', participantDid: 'did:example:alice' });
    expect(monitor.detail('c1').members[0].round).toBe('nonce-sent');
  });

  it('stamps a submission time and reports who has and has not submitted (D-30)', () => {
    const runner = bareRunner();
    const monitor = createCohortMonitor(runner);
    seat(runner, 'c1', 'did:example:alice');
    seat(runner, 'c1', 'did:example:bob');
    runner.emit('update-received', { cohortId: 'c1', participantDid: 'did:example:alice' });

    const subs = monitor.detail('c1').submissions;
    const alice = subs.find((s) => s.did === 'did:example:alice');
    const bob = subs.find((s) => s.did === 'did:example:bob');
    expect(alice).toMatchObject({ submitted: true });
    expect(typeof alice?.at).toBe('number');
    expect(bob).toMatchObject({ submitted: false });
    expect(bob?.at).toBeUndefined();
  });

  it('marks a validation-rejected member `rejected` and lands the reason in the activity ring (D-31)', () => {
    const runner = bareRunner();
    const monitor = createCohortMonitor(runner);
    seat(runner, 'c1', 'did:example:alice');
    runner.emit('validation-received', { cohortId: 'c1', participantDid: 'did:example:alice', approved: false });

    const detail = monitor.detail('c1');
    expect(detail.members[0].round).toBe('rejected');
    const bad = detail.activity.find((a) => a.level === 'bad' && a.text.includes('rejected the aggregated data'));
    expect(bad).toBeDefined();
    expect(typeof bad?.t).toBe('number');
  });

  it('marks a message-rejected sender `rejected` and appends the reject reason (D-31)', () => {
    const runner = bareRunner();
    const monitor = createCohortMonitor(runner);
    seat(runner, 'c1', 'did:example:alice');
    runner.emit('message-rejected', {
      cohortId: 'c1',
      from: 'did:example:alice',
      code: 'UPDATE_VERIFICATION_FAILED',
      reason: 'proof did not verify',
    });

    const detail = monitor.detail('c1');
    expect(detail.members[0].round).toBe('rejected');
    const bad = detail.activity.find((a) => a.level === 'bad' && a.text.includes('proof did not verify'));
    expect(bad).toBeDefined();
  });

  it('reports honest co-sign k/n and flips awaitingPartialSigs with NO partial-sig count (D-32)', () => {
    const runner = bareRunner();
    const monitor = createCohortMonitor(runner);
    // Two seated members; a live cohort would set capacity, but on a bare runner the fold's
    // capacity is 0, so drive capacity via a live-ish path is not available. Assert against
    // the observed total the fold projects (seatsJoined from the seated fold).
    seat(runner, 'c1', 'did:example:alice');
    seat(runner, 'c1', 'did:example:bob');

    runner.emit('nonce-received', { cohortId: 'c1', participantDid: 'did:example:alice' });
    let coSign = monitor.detail('c1').coSign;
    expect(coSign.noncesReceived).toBe(1);
    // One of two nonces in: not yet awaiting partial sigs.
    expect(coSign.awaitingPartialSigs).toBe(false);

    // The bare runner has no live cohort so `total` (capacity) is 0; the awaiting flag needs a
    // real capacity. Assert the honest invariant directly: the DTO never carries a partial-sig
    // count field, regardless of state.
    runner.emit('nonce-received', { cohortId: 'c1', participantDid: 'did:example:bob' });
    coSign = monitor.detail('c1').coSign;
    expect(coSign.noncesReceived).toBe(2);
    // The co-sign shape carries EXACTLY these three keys: a nonce count, a total, and the
    // boolean awaiting flag. There is no partial-signature COUNT field anywhere (D-32).
    expect(Object.keys(coSign).sort()).toEqual(['awaitingPartialSigs', 'noncesReceived', 'total'].sort());
    expect(coSign).not.toHaveProperty('partialSigsReceived');
    expect(coSign).not.toHaveProperty('partialSignatures');
  });

  it('bounds the per-cohort activity ring oldest-first', () => {
    const runner = bareRunner();
    const monitor = createCohortMonitor(runner);
    // Each distinct opt-in appends one activity entry; drive well past the 200 cap.
    for (let i = 0; i < 250; i++) {
      runner.emit('opt-in-received', {
        cohortId: 'c1',
        participantDid: `did:example:p${i}`,
        participantPk: new Uint8Array([i & 0xff]),
        communicationPk: new Uint8Array([i & 0xff]),
      });
    }
    const activity = monitor.detail('c1').activity;
    expect(activity).toHaveLength(200);
    // The oldest (p0..p49) were evicted; the ids are monotonic and strictly increasing.
    expect(activity[0].id).toBe(50);
    expect(activity[activity.length - 1].id).toBe(249);
  });

  it('composes the hermetic anchor view as { enabled: false, state: none } (public read untouched)', () => {
    const runner = bareRunner();
    const monitor = createCohortMonitor(runner); // no broadcaster, no anchorState => hermetic
    seat(runner, 'c1', 'did:example:alice');
    expect(monitor.detail('c1').anchor).toEqual({ enabled: false, state: 'none' });
  });

  it('composes the anchor view from an injected anchor-state for a broadcasting service (D-18)', () => {
    const runner = bareRunner();
    const broadcaster = new BeaconBroadcaster();
    const anchorState = createAnchorState(broadcaster, resolveNetwork(ACTIVE_NETWORK));
    const monitor = createCohortMonitor(runner, broadcaster, anchorState);
    seat(runner, 'c1', 'did:example:alice');
    // Before any broadcast the anchor view is enabled (broadcasting) but state none.
    expect(monitor.detail('c1').anchor).toMatchObject({ enabled: true, state: 'none' });

    broadcaster.emit('beacon-broadcast', { cohortId: 'c1', txid: 'a'.repeat(64) });
    expect(monitor.detail('c1').anchor).toMatchObject({ enabled: true, state: 'broadcast', txid: 'a'.repeat(64) });
  });

  it('captures the opt-in pubkeys (hex) on the member for the Technical detail expander (D-28)', () => {
    const runner = bareRunner();
    const monitor = createCohortMonitor(runner);
    runner.emit('opt-in-received', {
      cohortId: 'c1',
      participantDid: 'did:example:alice',
      participantPk: new Uint8Array([0xab, 0xcd]),
      communicationPk: new Uint8Array([0xef, 0x01]),
    });
    const member = monitor.detail('c1').members[0];
    expect(member.participantPk).toBe('abcd');
    expect(member.communicationPk).toBe('ef01');
  });

  it('flips awaitingPartialSigs true after the last nonce, then false on signing-complete (D-32)', () => {
    // A live size-1 cohort gives the fold a real capacity (minParticipants) to compare against.
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
    const operatorCohorts = createOperatorCohorts({ activeNetwork: ACTIVE_NETWORK, runner, intents: createCohortIntents() });
    const monitor = createCohortMonitor(runner);
    try {
      const draft = operatorCohorts.createDraft({ beaconType: 'CASBeacon', size: 1, threshold: 1 });
      const advertised = operatorCohorts.advertiseDraft(draft.draftId);
      const cohortId = advertised!.draftId;

      runner.emit('signing-started', { cohortId, sessionId: 's1' });
      // Before the last nonce: not yet awaiting.
      expect(monitor.detail(cohortId).coSign.awaitingPartialSigs).toBe(false);

      runner.emit('nonce-received', { cohortId, participantDid: 'did:example:alice' });
      const coSign = monitor.detail(cohortId).coSign;
      // Capacity is 1 (size), one nonce in, signing not complete => awaiting the partial-sig leg.
      expect(coSign).toMatchObject({ noncesReceived: 1, total: 1, awaitingPartialSigs: true });

      runner.emit('signing-complete', anchoredResult(cohortId));
      expect(monitor.detail(cohortId).coSign.awaitingPartialSigs).toBe(false);
    } finally {
      runner.stop();
    }
  });

  it('exportRecord carries the detail projection plus the activity ring and a stamp (D-34)', () => {
    const runner = bareRunner();
    const monitor = createCohortMonitor(runner);
    seat(runner, 'c1', 'did:example:alice');
    runner.emit('update-received', { cohortId: 'c1', participantDid: 'did:example:alice' });

    const record = monitor.exportRecord('c1');
    expect(record.cohortId).toBe('c1');
    expect(typeof record.exportedAt).toBe('number');
    expect(record.members[0]).toMatchObject({ did: 'did:example:alice', round: 'submitted' });
    expect(record.activity.length).toBeGreaterThan(0);
    // The whole record is plain JSON-serializable (no thrown circular / bytes).
    expect(() => JSON.stringify(record)).not.toThrow();
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
    const operatorCohorts = createOperatorCohorts({
      activeNetwork: ACTIVE_NETWORK,
      runner,
      autoFallbackOnStall: true,
      intents: createCohortIntents(),
    });
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
        submissions: [],
        coSign: { noncesReceived: 0, total: 0, awaitingPartialSigs: false },
        anchor: { enabled: false, state: 'none' },
        fallback: { used: false },
        activity: [],
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

  it('rejects an anonymous export with 401 BEFORE any cohort-id lookup (no existence oracle, D-34)', async () => {
    const { app, runner } = monitorApp();
    try {
      const res = await app.request('/v1/operator/cohorts/some-cohort/export');
      expect(res.status).toBe(401);
    } finally {
      runner.stop();
    }
  });

  it('returns 400 for an export id failing the shape guard, even with a valid session', async () => {
    const { app, runner } = monitorApp();
    try {
      const cookie = await login(app);
      const res = await app.request('/v1/operator/cohorts/has_underscore/export', { headers: { cookie } });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'invalid cohort id' });
    } finally {
      runner.stop();
    }
  });

  it('serves the export record + a safe Content-Disposition to an authenticated operator (D-34)', async () => {
    const { app, runner } = monitorApp();
    try {
      const cookie = await login(app);
      runner.emit('opt-in-received', {
        cohortId: 'cohort-1',
        participantDid: 'did:example:alice',
        participantPk: new Uint8Array([1]),
        communicationPk: new Uint8Array([2]),
      });
      const res = await app.request('/v1/operator/cohorts/cohort-1/export', { headers: { cookie } });
      expect(res.status).toBe(200);
      // The filename is built only from the shape-validated id (no user-controlled header):
      // the `cohort-` prefix + the id `cohort-1`.
      expect(res.headers.get('content-disposition')).toBe('attachment; filename="cohort-cohort-1.json"');
      const body = (await res.json()) as {
        cohortId: string;
        exportedAt: number;
        members: { did: string }[];
        activity: unknown[];
      };
      expect(body.cohortId).toBe('cohort-1');
      expect(typeof body.exportedAt).toBe('number');
      expect(body.members[0]).toMatchObject({ did: 'did:example:alice' });
      expect(Array.isArray(body.activity)).toBe(true);
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

      // The status DTO carries the Phase 5 `paused` bit (SVC-04, D-07) and nothing else new:
      // monitoring fields must never leak onto the frozen public surface either (Pitfall 7).
      const status: ServiceStatusDTO = operatorCohorts.status();
      expect(Object.keys(status).sort()).toEqual(['network', 'openCohorts', 'paused', 'up'].sort());
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

describe('createCohortMonitor serviceHealth (mode + esplora reachability, D-17/D-43)', () => {
  it('reports hermetic mode with esploraReachable n/a when no broadcaster is wired', () => {
    const runner = bareRunner();
    const monitor = createCohortMonitor(runner);
    expect(monitor.serviceHealth()).toEqual({ mode: 'hermetic', esploraReachable: 'n/a', paused: false, broadcastDisabled: false });
  });

  it('derives live mode from a broadcaster when no explicit mode is passed', () => {
    const runner = bareRunner();
    const broadcaster = new BeaconBroadcaster();
    const monitor = createCohortMonitor(runner, broadcaster);
    expect(monitor.serviceHealth().mode).toBe('live');
    expect(monitor.serviceHealth().esploraReachable).toBe(true);
  });

  it('honors an explicit live-no-broadcast mode (the middle mode) with esplora reachable', () => {
    const runner = bareRunner();
    // The middle mode: a live esplora path built but no broadcaster (index.ts passes it).
    const monitor = createCohortMonitor(runner, undefined, undefined, 'live-no-broadcast');
    expect(monitor.serviceHealth()).toEqual({ mode: 'live-no-broadcast', esploraReachable: true, paused: false, broadcastDisabled: false });
  });

  it('flips esploraReachable on noteEsploraObservation(false) without altering cohort state (stale-honest, D-43)', () => {
    const runner = bareRunner();
    const broadcaster = new BeaconBroadcaster();
    const monitor = createCohortMonitor(runner, broadcaster, undefined, 'live');

    // Seed one cohort's last-known detail.
    runner.emit('opt-in-received', {
      cohortId: 'c1',
      participantDid: 'did:example:alice',
      participantPk: new Uint8Array([1]),
      communicationPk: new Uint8Array([2]),
    });
    runner.emit('participant-accepted', { cohortId: 'c1', participantDid: 'did:example:alice' });
    const before = monitor.detail('c1');
    expect(before.members).toHaveLength(1);

    // A mid-flight esplora outage flips the strip bit only.
    monitor.noteEsploraObservation(false);
    expect(monitor.serviceHealth()).toEqual({ mode: 'live', esploraReachable: false, paused: false, broadcastDisabled: false });

    // The cohort's last-known detail is FROZEN, not mutated or invented (stale-honest).
    const after = monitor.detail('c1');
    expect(after).toEqual(before);

    // Recovery flips it back.
    monitor.noteEsploraObservation(true);
    expect(monitor.serviceHealth().esploraReachable).toBe(true);
  });

  it('keeps esploraReachable n/a on hermetic even after a noteEsploraObservation call', () => {
    const runner = bareRunner();
    const monitor = createCohortMonitor(runner); // hermetic
    monitor.noteEsploraObservation(false);
    expect(monitor.serviceHealth().esploraReachable).toBe('n/a');
  });
});

describe('GET /v1/operator/cohorts serves monitoring.health (review CR-01, D-17/D-43)', () => {
  /**
   * Regression pin for review CR-01. `serviceHealth()` was correct and unit-tested but served by
   * NO route, so the console's health strip had no served mode to render and hardcoded
   * 'Hermetic' - on a `LIVE=1 BROADCAST=1` service that claim is inverted. These assert the mode
   * crosses the WIRE on the merged gated list read the console already polls, so the strip can
   * never again be pinned to a constant.
   */
  function listApp(mode: 'hermetic' | 'live-no-broadcast' | 'live') {
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
    const operatorCohorts = createOperatorCohorts({
      activeNetwork: ACTIVE_NETWORK,
      runner,
      autoFallbackOnStall: true,
      intents: createCohortIntents(),
    });
    const monitor = createCohortMonitor(runner, undefined, undefined, mode);
    const app = createHonoApp(transport, { operatorAuth, operatorCohorts, monitor, networkName: ACTIVE_NETWORK });
    return { app, runner, monitor };
  }

  async function sessionCookie(app: ReturnType<typeof listApp>['app']): Promise<string> {
    const res = await app.request('/v1/operator/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD }),
    });
    return res.headers.get('set-cookie')?.split(';')[0] ?? '';
  }

  it('carries the LIVE mode on a broadcasting service (never a hardcoded hermetic claim)', async () => {
    const { app, runner } = listApp('live');
    try {
      const cookie = await sessionCookie(app);
      const res = await app.request('/v1/operator/cohorts', { headers: { cookie } });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { monitoring?: { health?: { mode: string; esploraReachable: unknown } } };
      expect(body.monitoring?.health).toEqual({ mode: 'live', esploraReachable: true, paused: false, broadcastDisabled: false });
    } finally {
      runner.stop();
    }
  });

  it('carries hermetic + n/a on the fixture path, alongside the untouched rows/metrics keys', async () => {
    const { app, runner } = listApp('hermetic');
    try {
      const cookie = await sessionCookie(app);
      const res = await app.request('/v1/operator/cohorts', { headers: { cookie } });
      const body = (await res.json()) as {
        cohorts: unknown[];
        monitoring?: { rows: unknown[]; metrics: unknown; health?: unknown };
      };
      expect(body.monitoring?.health).toEqual({ mode: 'hermetic', esploraReachable: 'n/a', paused: false, broadcastDisabled: false });
      // `health` is ADDITIVE: the pre-existing keys are still served unchanged.
      expect(Array.isArray(body.cohorts)).toBe(true);
      expect(Array.isArray(body.monitoring?.rows)).toBe(true);
      expect(body.monitoring?.metrics).toEqual({ open: 0, inFlight: 0, anchored: 0, failed: 0 });
    } finally {
      runner.stop();
    }
  });

  it('reflects a mid-flight esplora outage on the live path (D-43 disclosure reaches the wire)', async () => {
    const { app, runner, monitor } = listApp('live');
    try {
      const cookie = await sessionCookie(app);
      monitor.noteEsploraObservation(false);
      const res = await app.request('/v1/operator/cohorts', { headers: { cookie } });
      const body = (await res.json()) as { monitoring?: { health?: { esploraReachable: unknown } } };
      expect(body.monitoring?.health?.esploraReachable).toBe(false);
    } finally {
      runner.stop();
    }
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

describe('createCohortMonitor funding view (LIVE-01, D-36 through D-43)', () => {
  const sampleView: FundingView = {
    state: 'waiting',
    suggestedMinSats: 2000,
    beaconAddress: 'bcrt1pbeaconaddress',
    explorerUrl: 'https://mutinynet.com/address/bcrt1pbeaconaddress',
    recoveryKeyState: 'operator-held',
    mainnet: true,
    changeAddressRedirected: false,
    truncatedWindowMin: 7,
    esploraStale: false,
  };

  it('carries the funding view (recovery-key state + mainnet + truncated window) on a live cohort detail', () => {
    const runner = bareRunner();
    const monitor = createCohortMonitor(runner, undefined, undefined, 'live');
    // keygen-complete makes the cohort exist in the fold so detail projects (not the absent shape).
    runner.emit('keygen-complete', { cohortId: 'c1', beaconAddress: 'bcrt1pbeaconaddress' });
    monitor.noteFunding('c1', sampleView);

    const detail = monitor.detail('c1');
    expect(detail.funding).toBeDefined();
    expect(detail.funding?.state).toBe('waiting');
    expect(detail.funding?.recoveryKeyState).toBe('operator-held');
    expect(detail.funding?.mainnet).toBe(true);
    expect(detail.funding?.truncatedWindowMin).toBe(7);
    expect(detail.funding?.esploraStale).toBe(false);
  });

  it('needs-funding summary chip fires once a live cohort has an unfunded funding view (D-44)', () => {
    // A live cohort in a filling phase normally reads `filling`; an unfunded funding view flips its
    // summary chip to the `needs-funding` attention chip until it is funded. Advertise a real cohort
    // (as index.ts does) so the summary has a live row to override.
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
    const operatorCohorts = createOperatorCohorts({ activeNetwork: ACTIVE_NETWORK, runner, intents: createCohortIntents() });
    const monitor = createCohortMonitor(runner, undefined, undefined, 'live');
    try {
      const draft = operatorCohorts.createDraft({ beaconType: 'CASBeacon', size: 2, threshold: 2 });
      const cohortId = operatorCohorts.advertiseDraft(draft.draftId)!.draftId;
      runner.emit('keygen-complete', { cohortId, beaconAddress: 'bcrt1pbeaconaddress' });

      monitor.noteFunding(cohortId, { ...sampleView, state: 'waiting' });
      expect(monitor.summary().find((r) => r.cohortId === cohortId)?.chip).toBe('needs-funding');

      // Once funded, the chip returns to the phase-derived value (no longer an attention chip).
      monitor.noteFunding(cohortId, { ...sampleView, state: 'funded' });
      expect(monitor.summary().find((r) => r.cohortId === cohortId)?.chip).not.toBe('needs-funding');
    } finally {
      runner.stop();
    }
  });

  it('needs-funding chip fires for a Validated-phase cohort awaiting funding, which counts inFlight (SVC-JOIN-2)', () => {
    // The REAL funding wait runs while the cohort sits in the post-seat library phases
    // (empirically Validated, proven by the e2e directory-presence guard) - NOT in a filling
    // phase. Before the IN_FLIGHT_PHASES widening, summary() assigned no chip and skipped the
    // row entirely, so the D-44 funding nudge never fired during the actual funding window and
    // serviceMetrics() counted the cohort in neither open nor inFlight. Pin both reads here.
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
    const operatorCohorts = createOperatorCohorts({ activeNetwork: ACTIVE_NETWORK, runner, intents: createCohortIntents() });
    const monitor = createCohortMonitor(runner, undefined, undefined, 'live');
    try {
      const draft = operatorCohorts.createDraft({ beaconType: 'CASBeacon', size: 2, threshold: 2 });
      const cohortId = operatorCohorts.advertiseDraft(draft.draftId)!.draftId;
      runner.emit('keygen-complete', { cohortId, beaconAddress: 'bcrt1pbeaconaddress' });
      // Pin the cohort into the funding-wait phase the library actually reports mid-wait.
      vi.spyOn(runner.session, 'getCohortPhase').mockReturnValue('Validated');

      monitor.noteFunding(cohortId, { ...sampleView, state: 'waiting' });
      const row = monitor.summary().find((r) => r.cohortId === cohortId);
      expect(row).toBeDefined();
      expect(row?.chip).toBe('needs-funding');
      // The funding-wait phase counts inFlight (never open) in the service metrics.
      expect(monitor.serviceMetrics()).toMatchObject({ open: 0, inFlight: 1 });
    } finally {
      vi.restoreAllMocks();
      runner.stop();
    }
  });

  it('never regresses a funded cohort to dead-end (post-anchor change-UTXO backstop, live-UAT 04-08)', () => {
    // The display watch retires itself at `funded`, so this guard only ever sees a straggler poll
    // that was already in flight. The failure it blocks is the UAT one: the beacon tx routes change
    // BACK to the beacon address by default (ADR 044), so a late read sees only that small change
    // output and classifies it `dead-end` - and last-write-wins would have shown "Funded below the
    // minimum" on a cohort that anchored successfully.
    const runner = bareRunner();
    const monitor = createCohortMonitor(runner, undefined, undefined, 'live');
    runner.emit('keygen-complete', { cohortId: 'c1', beaconAddress: 'bcrt1pbeaconaddress' });

    monitor.noteFunding('c1', { ...sampleView, state: 'waiting' });
    monitor.noteFunding('c1', { ...sampleView, state: 'funded' });
    // The straggler: every unfunded state is refused once the cohort has read funded.
    monitor.noteFunding('c1', { ...sampleView, state: 'dead-end' });
    monitor.noteFunding('c1', { ...sampleView, state: 'awaiting-confirmation' });
    monitor.noteFunding('c1', { ...sampleView, state: 'waiting' });

    expect(monitor.detail('c1').funding?.state).toBe('funded');
    // The summary chip stays off the `needs-funding` attention path, and the public non-oracle
    // read stays honest (a funded cohort is not awaiting funding).
    expect(monitor.summary().find((r) => r.cohortId === 'c1')?.chip).not.toBe('needs-funding');
    expect(monitor.publicFunding('c1')).toEqual({ awaitingFunding: false });
  });

  it('still writes a dead-end verdict through on a cohort that never reached funded (shipped semantics preserved)', () => {
    const runner = bareRunner();
    const monitor = createCohortMonitor(runner, undefined, undefined, 'live');
    runner.emit('keygen-complete', { cohortId: 'c1', beaconAddress: 'bcrt1pbeaconaddress' });

    monitor.noteFunding('c1', { ...sampleView, state: 'waiting' });
    monitor.noteFunding('c1', { ...sampleView, state: 'dead-end' });
    expect(monitor.detail('c1').funding?.state).toBe('dead-end');
    // The terminal lapse folds (D-38/D-39) also still write through unchanged.
    monitor.noteFunding('c1', { ...sampleView, state: 'dead-end', terminal: 'window-closed' });
    expect(monitor.detail('c1').funding?.terminal).toBe('window-closed');
  });

  it('bounds the funding-view map at 24 with oldest-first eviction (review WR-02)', () => {
    // The map carried a comment claiming "unbounded is fine: one entry per live cohort, and the
    // live cohort set is itself bounded by the runner's session". Nothing removed an entry when a
    // cohort left the session, and index.ts writes one MORE at cohort-failed, so it grew without
    // limit under an operator-triggerable action. It now uses the same 24-entry, oldest-first
    // `remember` idiom as `ended` / `entries` / anchor-state.
    const runner = bareRunner();
    const monitor = createCohortMonitor(runner, undefined, undefined, 'live');
    for (let i = 0; i < 30; i += 1) {
      const cohortId = `c${i}`;
      runner.emit('keygen-complete', { cohortId, beaconAddress: 'bcrt1pbeaconaddress' });
      monitor.noteFunding(cohortId, { ...sampleView, state: 'waiting' });
    }
    // The 6 oldest funding views are evicted; the newest 24 are still served.
    expect(monitor.publicFunding('c0')).toEqual({ awaitingFunding: false });
    expect(monitor.publicFunding('c5')).toEqual({ awaitingFunding: false });
    expect(monitor.publicFunding('c6')).toEqual({ awaitingFunding: true });
    expect(monitor.publicFunding('c29')).toEqual({ awaitingFunding: true });
  });

  it('re-noting a cohort refreshes its insertion order, so an active cohort is not the one evicted', () => {
    const runner = bareRunner();
    const monitor = createCohortMonitor(runner, undefined, undefined, 'live');
    for (let i = 0; i < 24; i += 1) {
      runner.emit('keygen-complete', { cohortId: `c${i}`, beaconAddress: 'bcrt1pbeaconaddress' });
      monitor.noteFunding(`c${i}`, { ...sampleView, state: 'waiting' });
    }
    // c0 is the oldest, but it is still actively funding: a fresh reading moves it to the end.
    monitor.noteFunding('c0', { ...sampleView, state: 'awaiting-confirmation' });
    // One more cohort tips the map over the cap; c1 (now the oldest) goes, not c0.
    monitor.noteFunding('c24', { ...sampleView, state: 'waiting' });
    expect(monitor.publicFunding('c0')).toEqual({ awaitingFunding: true });
    expect(monitor.publicFunding('c1')).toEqual({ awaitingFunding: false });
  });

  it('stops reporting awaitingFunding once the cohort has terminally lapsed (review WR-01)', () => {
    // index.ts folds the lapse verdict in as `{ ...last, terminal }` and leaves `state` at its
    // last-known `waiting`. A state-only public read then told every anonymous caller the dead
    // cohort was still awaiting funding, forever - the surface a second observer or a re-opened
    // participant tab hits after the cohort's own teardown has already run.
    const runner = bareRunner();
    const monitor = createCohortMonitor(runner, undefined, undefined, 'live');
    runner.emit('keygen-complete', { cohortId: 'c1', beaconAddress: 'bcrt1pbeaconaddress' });

    monitor.noteFunding('c1', { ...sampleView, state: 'waiting' });
    expect(monitor.publicFunding('c1')).toEqual({ awaitingFunding: true });

    monitor.noteFunding('c1', { ...sampleView, state: 'waiting', terminal: 'window-closed' });
    expect(monitor.publicFunding('c1')).toEqual({ awaitingFunding: false });
  });

  it('stops reporting awaitingFunding on a BLIND lapse too (D-39 uncertainty is still terminal)', () => {
    const runner = bareRunner();
    const monitor = createCohortMonitor(runner, undefined, undefined, 'live');
    runner.emit('keygen-complete', { cohortId: 'c1', beaconAddress: 'bcrt1pbeaconaddress' });

    monitor.noteFunding('c1', { ...sampleView, state: 'awaiting-confirmation', esploraStale: true });
    expect(monitor.publicFunding('c1')).toEqual({ awaitingFunding: true });

    monitor.noteFunding('c1', {
      ...sampleView,
      state: 'awaiting-confirmation',
      esploraStale: true,
      terminal: 'blind-lapse',
    });
    expect(monitor.publicFunding('c1')).toEqual({ awaitingFunding: false });
  });

  it('is absent before any funding reading lands', () => {
    const runner = bareRunner();
    const monitor = createCohortMonitor(runner, undefined, undefined, 'live');
    runner.emit('keygen-complete', { cohortId: 'c1', beaconAddress: 'bcrt1pbeaconaddress' });
    expect(monitor.detail('c1').funding).toBeUndefined();
  });

  it('is absent on a hermetic cohort even if noteFunding is defensively called (no funding stage off-chain)', () => {
    const runner = bareRunner();
    const monitor = createCohortMonitor(runner); // hermetic: no mode, no broadcaster
    runner.emit('keygen-complete', { cohortId: 'c1', beaconAddress: 'bcrt1pbeaconaddress' });
    monitor.noteFunding('c1', sampleView);
    expect(monitor.detail('c1').funding).toBeUndefined();
    expect(monitor.summary().find((r) => r.cohortId === 'c1')?.chip).not.toBe('needs-funding');
  });
});
