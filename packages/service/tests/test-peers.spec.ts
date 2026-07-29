import { AggregationServiceRunner, HttpServerTransport, type AggregationResult } from '@did-btcr2/aggregation/service';
import { resolveBtcr2SenderPk } from '@did-btcr2/method';
import { buildCohortConfig, createIdentity, resolveNetwork, type Identity } from '@btcr2-aggregation/shared';
import type { Participant } from '@btcr2-aggregation/participant';
import type { Transaction } from '@scure/btc-signer';
import { describe, expect, it } from 'vitest';
import { createService } from '../src/index.js';
import { createCohortMonitor } from '../src/monitor.js';
import {
  createTestPeers,
  spawnTestPeers,
  NO_SEATS_REASON,
  type TestPeerFactory,
} from '../src/test-peers.js';

/**
 * Hermetic coverage of the operator's test-peer spawner (SVC-04, D-17): the seat cap, the
 * zero-seat refusal, the per-service badge set, and the bounded teardown on both the cohort
 * settle path and `service.stop()`.
 *
 * The load-bearing property is that a spawned peer NEVER outlives the cohort it was created
 * for. Each peer holds two SSE subscriptions, so a leaked handle is a leaked connection; the
 * teardown assertions therefore COUNT the live handles rather than inferring their absence
 * from the fact that nothing visibly broke.
 *
 * Most tests inject a fake participant factory so the spawner's own arithmetic and lifecycle
 * are deterministic with no port and no protocol. The two service-level tests use the REAL
 * `createParticipant` against a REAL started service, because the thing under test there is
 * exactly the wiring between `createService`'s stop signal and the registry.
 *
 * Spec file lives under `packages/service/tests/` (tests-outside-src convention).
 */

const ACTIVE_NETWORK = 'signet';

/** A minimal AggregationResult for driving `signing-complete` (only `cohortId` is read here). */
function anchoredResult(cohortId: string): AggregationResult {
  return {
    cohortId,
    signature: new Uint8Array(64),
    signedTx: {} as unknown as Transaction,
    path: 'key-path',
  } as AggregationResult;
}

/**
 * A fake participant factory that records the DIDs it started and stopped. It stands in for
 * `createParticipant` so the spawner's counting, badging and teardown are asserted without a
 * port: the real factory is exercised by the two service-level tests below and by
 * `pnpm e2e:testpeers`.
 */
function fakePeers(): { started: string[]; stopped: string[]; createPeer: TestPeerFactory } {
  const started: string[] = [];
  const stopped: string[] = [];
  const createPeer: TestPeerFactory = ({ identity }) =>
    ({
      start: async (): Promise<void> => {
        started.push(identity.did);
      },
      stop: (): void => {
        stopped.push(identity.did);
      },
    }) as unknown as Participant;
  return { started, stopped, createPeer };
}

/**
 * Deterministic throwaway identities, so a DID assertion never depends on real key generation.
 * `prefix` keeps two independent registries in one test from minting the SAME DID, which would
 * make an independence assertion pass or fail for the wrong reason.
 */
function fakeIdentities(prefix = 'test-peer'): () => Identity {
  let n = 0;
  return () => {
    n += 1;
    return { did: `did:example:${prefix}-${n}`, keys: {} as Identity['keys'] };
  };
}

/** A registry wired with the fakes, against a base URL that is always available. */
function fakeRegistry(signal?: AbortSignal, prefix?: string) {
  const peers = fakePeers();
  const registry = createTestPeers({
    baseUrl: () => 'http://127.0.0.1:9999',
    network: resolveNetwork(ACTIVE_NETWORK),
    signal,
    createPeer: peers.createPeer,
    createPeerIdentity: fakeIdentities(prefix),
  });
  return { registry, ...peers };
}

describe('spawnTestPeers caps the spawn at the cohort remaining seats', () => {
  it('spawns exactly the remaining seats when no count is requested', async () => {
    const peers = fakePeers();
    const result = await spawnTestPeers({
      cohortId: 'c1',
      baseUrl: 'http://127.0.0.1:9999',
      remainingSeats: 3,
      createPeer: peers.createPeer,
      createPeerIdentity: fakeIdentities(),
    });

    expect(result.spawned).toBe(3);
    expect(result.dids).toHaveLength(3);
    expect(peers.started).toHaveLength(3);
  });

  it('spawns FEWER than the remaining seats when the operator asks for fewer', async () => {
    const peers = fakePeers();
    const result = await spawnTestPeers({
      cohortId: 'c1',
      baseUrl: 'http://127.0.0.1:9999',
      requested: 1,
      remainingSeats: 4,
      createPeer: peers.createPeer,
      createPeerIdentity: fakeIdentities(),
    });

    expect(result.spawned).toBe(1);
    expect(peers.started).toHaveLength(1);
  });

  it('CAPS a request larger than the remaining seats, so the spawn is bounded by n', async () => {
    const peers = fakePeers();
    const result = await spawnTestPeers({
      cohortId: 'c1',
      baseUrl: 'http://127.0.0.1:9999',
      requested: 5000,
      remainingSeats: 2,
      createPeer: peers.createPeer,
      createPeerIdentity: fakeIdentities(),
    });

    expect(result.spawned).toBe(2);
    expect(peers.started).toHaveLength(2);
  });

  it('spawns NOTHING when no seats remain', async () => {
    const peers = fakePeers();
    const result = await spawnTestPeers({
      cohortId: 'c1',
      baseUrl: 'http://127.0.0.1:9999',
      requested: 3,
      remainingSeats: 0,
      createPeer: peers.createPeer,
      createPeerIdentity: fakeIdentities(),
    });

    expect(result.spawned).toBe(0);
    expect(result.dids).toEqual([]);
    expect(peers.started).toEqual([]);
  });

  it('spawns NOTHING for a non-positive or non-finite requested count', async () => {
    for (const requested of [0, -3, Number.NaN]) {
      const peers = fakePeers();
      const result = await spawnTestPeers({
        cohortId: 'c1',
        baseUrl: 'http://127.0.0.1:9999',
        requested,
        remainingSeats: 4,
        createPeer: peers.createPeer,
        createPeerIdentity: fakeIdentities(),
      });
      expect(result.spawned).toBe(0);
      expect(peers.started).toEqual([]);
    }
  });

  it('excludes a peer whose start() rejects, and stops it rather than leaking it', async () => {
    const stopped: string[] = [];
    let attempt = 0;
    const createPeer: TestPeerFactory = ({ identity }) =>
      ({
        start: async (): Promise<void> => {
          attempt += 1;
          if (attempt === 2) {
            throw new Error('subscription refused');
          }
        },
        stop: (): void => {
          stopped.push(identity.did);
        },
      }) as unknown as Participant;

    const result = await spawnTestPeers({
      cohortId: 'c1',
      baseUrl: 'http://127.0.0.1:9999',
      remainingSeats: 3,
      createPeer,
      createPeerIdentity: fakeIdentities(),
    });

    // Two of three started; the failed one was stopped immediately and never counted.
    expect(result.spawned).toBe(2);
    expect(stopped).toEqual(['did:example:test-peer-2']);
  });
});

describe('the test-peer registry records every spawned DID for the badge', () => {
  it('records each spawned DID in the per-service set', async () => {
    const { registry } = fakeRegistry();

    const result = await registry.spawn({ cohortId: 'c1', remainingSeats: 2 });

    expect(result?.spawned).toBe(2);
    for (const did of result?.dids ?? []) {
      expect(registry.dids.has(did)).toBe(true);
    }
  });

  it('badges exactly those DIDs in the monitor member projection, and no others', async () => {
    const { registry } = fakeRegistry();
    const result = await registry.spawn({ cohortId: 'c1', remainingSeats: 1 });
    const peerDid = result!.dids[0];

    const identity = createIdentity(resolveNetwork(ACTIVE_NETWORK));
    const transport = new HttpServerTransport({
      resolveSenderPk: resolveBtcr2SenderPk,
      heartbeatIntervalMs: 0,
    });
    transport.registerActor(identity.did, identity.keys);
    const runner = new AggregationServiceRunner({
      transport,
      did: identity.did,
      keys: identity.keys,
      onProvideTxData: async () => {
        throw new Error('signing not exercised in this spec');
      },
    });
    // The SAME live set instance `index.ts` threads, so a peer spawned after construction is
    // badged without the monitor being rebuilt.
    const monitor = createCohortMonitor(runner, undefined, undefined, undefined, undefined, registry.dids);

    runner.emit('participant-accepted', { cohortId: 'c1', participantDid: peerDid });
    runner.emit('participant-accepted', { cohortId: 'c1', participantDid: 'did:example:a-real-stranger' });

    const members = monitor.detail('c1').members;
    expect(members.find((m) => m.did === peerDid)?.testPeer).toBe(true);
    // A genuine external participant is NEVER mislabelled as the operator's own (T-05-09-05).
    expect(members.find((m) => m.did === 'did:example:a-real-stranger')?.testPeer).toBeUndefined();

    runner.stop();
  });

  it('badges a DID spawned AFTER the monitor was constructed', async () => {
    const { registry } = fakeRegistry();
    const identity = createIdentity(resolveNetwork(ACTIVE_NETWORK));
    const transport = new HttpServerTransport({
      resolveSenderPk: resolveBtcr2SenderPk,
      heartbeatIntervalMs: 0,
    });
    transport.registerActor(identity.did, identity.keys);
    const runner = new AggregationServiceRunner({
      transport,
      did: identity.did,
      keys: identity.keys,
      onProvideTxData: async () => {
        throw new Error('signing not exercised in this spec');
      },
    });
    const monitor = createCohortMonitor(runner, undefined, undefined, undefined, undefined, registry.dids);

    const result = await registry.spawn({ cohortId: 'c2', remainingSeats: 1 });
    runner.emit('participant-accepted', { cohortId: 'c2', participantDid: result!.dids[0] });

    expect(monitor.detail('c2').members[0].testPeer).toBe(true);
    runner.stop();
  });

  it('keeps two registries in one process completely independent', async () => {
    const a = fakeRegistry(undefined, 'service-a-peer');
    const b = fakeRegistry(undefined, 'service-b-peer');

    const spawnedA = await a.registry.spawn({ cohortId: 'c1', remainingSeats: 1 });
    const spawnedB = await b.registry.spawn({ cohortId: 'c1', remainingSeats: 1 });

    expect(a.registry.dids.has(spawnedA!.dids[0])).toBe(true);
    expect(b.registry.dids.has(spawnedA!.dids[0])).toBe(false);
    expect(a.registry.dids.has(spawnedB!.dids[0])).toBe(false);
  });
});

describe('the test-peer registry tears every peer down within the run it was created for', () => {
  it('stops and DROPS a cohort peers on release, asserted by a live count', async () => {
    const { registry, stopped } = fakeRegistry();
    await registry.spawn({ cohortId: 'c1', remainingSeats: 2 });
    await registry.spawn({ cohortId: 'c2', remainingSeats: 1 });
    expect(registry.activeCount).toBe(3);

    registry.release('c1');

    expect(stopped).toHaveLength(2);
    // Counted, not inferred: a leaked handle is a leaked SSE subscription.
    expect(registry.activeCount).toBe(1);
  });

  it('leaves the badge set intact after a release, so an ended cohort still reads badged', async () => {
    const { registry } = fakeRegistry();
    const result = await registry.spawn({ cohortId: 'c1', remainingSeats: 1 });

    registry.release('c1');

    expect(registry.dids.has(result!.dids[0])).toBe(true);
  });

  it('stops every remaining peer on stopAll and empties the handle map', async () => {
    const { registry, stopped } = fakeRegistry();
    await registry.spawn({ cohortId: 'c1', remainingSeats: 2 });
    await registry.spawn({ cohortId: 'c2', remainingSeats: 2 });
    expect(registry.activeCount).toBe(4);

    registry.stopAll();

    expect(stopped).toHaveLength(4);
    expect(registry.activeCount).toBe(0);
  });

  it('is idempotent: a second release or stopAll stops nothing twice', async () => {
    const { registry, stopped } = fakeRegistry();
    await registry.spawn({ cohortId: 'c1', remainingSeats: 2 });

    registry.release('c1');
    registry.release('c1');
    registry.stopAll();

    expect(stopped).toHaveLength(2);
  });

  it('tears peers down when the injected abort signal fires', async () => {
    const controller = new AbortController();
    const { registry, stopped } = fakeRegistry(controller.signal);
    await registry.spawn({ cohortId: 'c1', remainingSeats: 2 });

    controller.abort();

    expect(stopped).toHaveLength(2);
  });

  it('spawns nothing at all once the injected signal has already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const { registry, started } = fakeRegistry(controller.signal);

    const result = await registry.spawn({ cohortId: 'c1', remainingSeats: 2 });

    expect(result?.spawned).toBe(0);
    expect(started).toEqual([]);
  });

  it('reports the service as unavailable while it has no base URL yet', async () => {
    const registry = createTestPeers({
      baseUrl: () => undefined,
      createPeer: fakePeers().createPeer,
      createPeerIdentity: fakeIdentities(),
    });

    await expect(registry.spawn({ cohortId: 'c1', remainingSeats: 2 })).resolves.toBeUndefined();
  });
});

describe('createService tears its test peers down on both terminal paths', () => {
  it('releases a cohort peers when that cohort settles', async () => {
    const service = createService({
      identity: createIdentity(),
      config: buildCohortConfig(2, 'CASBeacon'),
      operatorPassword: 'correct-horse-battery-staple',
      operatorCookieSecure: false,
    });
    await service.start(0);
    try {
      await service.testPeers.spawn({ cohortId: 'c1', remainingSeats: 2 });
      expect(service.testPeers.activeCount).toBe(2);

      // The cohort settles: `releaseCohortTables` runs on the same path the funding watch uses.
      service.runner.emit('signing-complete', anchoredResult('c1'));

      expect(service.testPeers.activeCount).toBe(0);
    } finally {
      await service.stop();
    }
  });

  it('stops every remaining peer when the service stops', async () => {
    const service = createService({
      identity: createIdentity(),
      config: buildCohortConfig(2, 'CASBeacon'),
      operatorPassword: 'correct-horse-battery-staple',
      operatorCookieSecure: false,
    });
    await service.start(0);

    // REAL peers over the real client transport against this real started service: the thing
    // under test is the wiring between `service.stop()` and the registry, so nothing is faked.
    await service.testPeers.spawn({ cohortId: 'never-advertised', remainingSeats: 2 });
    expect(service.testPeers.activeCount).toBe(2);

    await service.stop();

    expect(service.testPeers.activeCount).toBe(0);
  });
});

describe('the zero-seat refusal reason is exact contract copy', () => {
  it('matches the UI-SPEC disabled reason byte for byte', () => {
    expect(NO_SEATS_REASON).toBe('This cohort has no seats left.');
  });

  it('carries no long dash', () => {
    expect(NO_SEATS_REASON).not.toMatch(/—/);
  });
});
