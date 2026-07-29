/**
 * The operator's own test participants (SVC-04, D-17): a bounded, explicitly-triggered spawner
 * that fills a cohort's REMAINING seats with in-process participants so ONE operator can rehearse
 * the whole funding and co-signing path on their own service, without recruiting a second person.
 * The Phase 4 live UAT needed two humans for exactly this.
 *
 * **This is not the booth-era filler loop coming back.** Phase 1 deleted the boot-time
 * auto-advertise loop and the in-process fillers it drove; the `fillers?: number` field that
 * survives on the demo-server option type is compile-compatibility residue with NO machinery
 * behind it. Nothing here runs at boot, nothing here runs automatically, and nothing here fills a
 * seat the operator did not ask for: every spawn is one authenticated operator action against one
 * named cohort (HOST-03 posture).
 *
 * The peers are REAL participants. Nothing in the advert or the opt-in distinguishes them from a
 * stranger who joined from the public directory, and that is correct: on a live cohort they
 * co-sign a real transaction and their DIDs are genuinely anchored. The console's `Test peer`
 * badge therefore comes from a per-service set of DIDs written HERE, at spawn time, exactly the
 * way `seatedRosterKeys` is scoped per `createService` call - never from inferring anything off
 * the wire, which could only ever mislabel a genuine participant (T-05-09-05).
 *
 * Two bounds are load-bearing:
 *
 * - **Count.** A spawn is capped at the cohort's remaining seats, which is itself bounded by n,
 *   and a cohort with no seats left is refused outright. An operator-triggered action that could
 *   spawn without limit is a denial-of-service surface (T-05-09-02).
 * - **Lifetime.** Each peer holds two SSE subscriptions, so a peer that outlives its cohort is a
 *   leaked connection. Every peer is stopped when its cohort settles ({@link TestPeerRegistry.release},
 *   called from `releaseCohortTables`) and when the service stops ({@link TestPeerRegistry.stopAll},
 *   plus the injected abort signal), reusing the SAME stop-signal path the funding wait already
 *   rides ({@link file://./funding-watch.ts}).
 *
 * Peer key material never leaves this module: the throwaway identities are created in-process,
 * are returned by no route, are never logged, and are never written to disk. Only the peer's DID
 * crosses into the badge set (T-05-09-03).
 */

import { createParticipant, type Participant } from '@btcr2-aggregation/participant';
import { createIdentity, type Identity, type NetworkConfig } from '@btcr2-aggregation/shared';

/**
 * The exact refusal reason for a cohort with no seats left (05-UI-SPEC E11). The SAME string the
 * console renders beside the disabled control, so the reason an operator reads before clicking and
 * the reason the service returns if they click anyway are one string rather than two that can drift.
 */
export const NO_SEATS_REASON = 'This cohort has no seats left.';

/**
 * The refusal reason for a service that has not started listening yet, so it does not know the
 * base URL its own peers would connect back to. Unreachable through the console (the route only
 * exists on a listening server), but the verdict is explicit rather than a guessed URL.
 */
export const TEST_PEERS_UNAVAILABLE_REASON = 'This service is not ready to add test peers yet.';

/** The reason for a spawn where every peer failed to open its subscriptions. */
export const TEST_PEERS_FAILED_REASON = 'Could not add test peers to this cohort.';

/**
 * Upper bound on the per-service badge set. The set is deliberately NEVER pruned when a cohort
 * settles - an ended cohort's members must keep reading `Test peer` in the drill-down - so it
 * needs its own bound, oldest-first, mirroring every other retained map in this service.
 */
const MAX_TEST_PEER_DIDS = 200;

/** The participant factory this module spawns through; injected in specs, `createParticipant` in production. */
export type TestPeerFactory = (opts: {
  identity: Identity;
  baseUrl: string;
  cohortId: string;
}) => Participant;

/** A stop handle for ONE spawn batch. */
export interface TestPeerHandle {
  /** The DIDs this handle owns, snapshotted at spawn time. */
  readonly dids: readonly string[];
  /**
   * Stop every peer in this batch (idempotent). Safe to call after the batch has already been
   * torn down by the injected abort signal - it only stops peers nobody is listening to any more.
   * Documented like {@link file://./funding-watch.ts} `FundingWatchHandle.stop`, whose lifecycle
   * discipline this copies.
   */
  stop(): void;
}

/** Options for {@link spawnTestPeers}. */
export interface SpawnTestPeersOptions {
  /** The cohort these peers join, and the ONLY advert they accept (the browse-and-pick filter). */
  cohortId: string;
  /** This service's own base URL: the peers connect back over the same real HTTP transport a stranger uses. */
  baseUrl: string;
  /** How many peers the operator asked for. Absent means "every remaining seat". */
  requested?: number;
  /** Seats still open on the cohort. The hard cap, and zero spawns nothing. */
  remainingSeats: number;
  /** The service's resolved network, so each throwaway DID names the chain this service targets. */
  network?: NetworkConfig;
  /** Tears every peer in this batch down (wired to `service.stop()`). */
  signal?: AbortSignal;
  /** Test seam: the participant factory. Defaults to `createParticipant`. */
  createPeer?: TestPeerFactory;
  /** Test seam: the throwaway identity factory. Defaults to `createIdentity`. */
  createPeerIdentity?: (network?: NetworkConfig) => Identity;
}

/** What one spawn produced. */
export interface TestPeerSpawn {
  /** Peers that ACTUALLY opened their subscriptions; never the number requested. */
  spawned: number;
  /** Their DIDs, in spawn order. */
  dids: string[];
  /** The batch stop handle. */
  handle: TestPeerHandle;
}

/**
 * Spawn up to `remainingSeats` in-process participants for one cohort.
 *
 * The count is `min(requested ?? remainingSeats, remainingSeats)`, floored at zero, so no caller
 * can ask for more seats than the cohort has (T-05-09-02) and a non-finite or non-positive request
 * spawns nothing rather than being coerced into one. A peer whose `start()` rejects is stopped
 * immediately and left out of the count, so a partial failure reports the honest number rather
 * than claiming seats that were never taken.
 *
 * The abort listener is registered ONCE for the whole batch rather than once per peer: one
 * listener that stops every peer in the batch is strictly fewer listeners than one per peer for
 * the same effect, and it cannot be half-registered if a peer fails mid-loop.
 *
 * There is deliberately no timer here to `unref()` - the peers are event-driven over SSE, so this
 * spawner keeps nothing alive on the event loop of its own.
 */
export async function spawnTestPeers(opts: SpawnTestPeersOptions): Promise<TestPeerSpawn> {
  const makePeer = opts.createPeer ?? ((o) => createParticipant(o));
  const makeIdentity = opts.createPeerIdentity ?? ((network?: NetworkConfig) => (network ? createIdentity(network) : createIdentity()));

  const cap = Number.isFinite(opts.remainingSeats) ? Math.max(0, Math.floor(opts.remainingSeats)) : 0;
  const asked =
    opts.requested === undefined || !Number.isFinite(opts.requested)
      ? opts.requested === undefined
        ? cap
        : 0
      : Math.max(0, Math.floor(opts.requested));
  const wanted = Math.min(asked, cap);

  const peers: Participant[] = [];
  const dids: string[] = [];
  let stopped = false;
  const stopAll = (): void => {
    if (stopped) {
      return;
    }
    stopped = true;
    opts.signal?.removeEventListener('abort', stopAll);
    for (const peer of peers) {
      try {
        peer.stop();
      } catch (err) {
        // A peer that cannot be stopped must never prevent its siblings from being stopped.
        console.error(`[service] failed to stop a test peer: ${String(err)}`);
      }
    }
    peers.length = 0;
  };

  if (wanted === 0 || opts.signal?.aborted) {
    return { spawned: 0, dids: [], handle: { dids: [], stop: stopAll } };
  }
  opts.signal?.addEventListener('abort', stopAll, { once: true });

  for (let i = 0; i < wanted; i += 1) {
    const identity = makeIdentity(opts.network);
    const peer = makePeer({ identity, baseUrl: opts.baseUrl, cohortId: opts.cohortId });
    try {
      await peer.start();
    } catch (err) {
      // Stop the half-built peer rather than leaving its transport holding a socket, and leave it
      // out of the count: the operator is told how many seats were actually taken.
      try {
        peer.stop();
      } catch {
        /* already down */
      }
      console.error(
        `[service] a test peer for cohort ${opts.cohortId} could not start: ${String(err)}`,
      );
      continue;
    }
    peers.push(peer);
    dids.push(identity.did);
  }

  // The signal may have aborted while the loop awaited: stopAll is idempotent and the peers it
  // stops here were pushed after the listener fired, so run it again rather than leaking them.
  if (opts.signal?.aborted) {
    stopAll();
    return { spawned: 0, dids: [], handle: { dids: [], stop: stopAll } };
  }

  return { spawned: dids.length, dids: [...dids], handle: { dids: [...dids], stop: stopAll } };
}

/** A spawn request against a {@link TestPeerRegistry}. */
export interface TestPeerSpawnRequest {
  cohortId: string;
  requested?: number;
  remainingSeats: number;
}

/** Options for {@link createTestPeers}. */
export interface TestPeerRegistryOptions {
  /**
   * This service's base URL, read lazily: `createService` does not know its own port until
   * `start()` resolves, and the peers connect back over that same origin. `undefined` means the
   * service is not listening yet.
   */
  baseUrl: () => string | undefined;
  /** The service's resolved network, threaded to every throwaway identity. */
  network?: NetworkConfig;
  /** The service's stop signal: `service.stop()` tears every peer down on the established path. */
  signal?: AbortSignal;
  /** Test seam: the participant factory. Defaults to `createParticipant`. */
  createPeer?: TestPeerFactory;
  /** Test seam: the throwaway identity factory. Defaults to `createIdentity`. */
  createPeerIdentity?: (network?: NetworkConfig) => Identity;
}

/**
 * The per-service test-peer registry: the badge set the monitor reads, and the per-cohort handles
 * that bound every peer's lifetime. Scoped per `createService` call and NEVER a module singleton,
 * exactly like `seatedRosterKeys` and the runtime settings holder, so one service's rehearsal can
 * never badge (or tear down) another service's members.
 */
export interface TestPeerRegistry {
  /**
   * Every DID this service spawned, as a LIVE set. The monitor holds this exact instance, so a
   * peer spawned after the monitor was constructed is badged without anything being rebuilt.
   * Bounded oldest-first at {@link MAX_TEST_PEER_DIDS}; deliberately not pruned on release,
   * because an ended cohort's members must keep reading `Test peer` in the drill-down.
   */
  readonly dids: ReadonlySet<string>;
  /** How many peers are still running, across every cohort. Zero once everything is torn down. */
  readonly activeCount: number;
  /**
   * Spawn peers for one cohort. Returns `undefined` when this service has no base URL yet (it is
   * not listening), which the route maps to an honest refusal rather than a guessed origin.
   */
  spawn(req: TestPeerSpawnRequest): Promise<{ spawned: number; dids: string[] } | undefined>;
  /** Stop and DROP every peer for one cohort (its settle path). Idempotent. */
  release(cohortId: string): void;
  /** Stop and drop every peer this service spawned (its stop path). Idempotent. */
  stopAll(): void;
}

export function createTestPeers(opts: TestPeerRegistryOptions): TestPeerRegistry {
  /** The live badge set. Never reassigned: the monitor holds this instance. */
  const dids = new Set<string>();
  /** Live batches per cohort. An entry disappears on release / stopAll, which is what makes the count honest. */
  const handles = new Map<string, TestPeerHandle[]>();

  /** Remember a spawned DID, evicting oldest-first past the cap. */
  function rememberDid(did: string): void {
    dids.delete(did);
    dids.add(did);
    while (dids.size > MAX_TEST_PEER_DIDS) {
      const oldest = dids.values().next().value;
      if (oldest === undefined) {
        break;
      }
      dids.delete(oldest);
    }
  }

  function stopBatches(batches: TestPeerHandle[] | undefined): void {
    for (const handle of batches ?? []) {
      handle.stop();
    }
  }

  return {
    dids,

    get activeCount(): number {
      let total = 0;
      for (const batches of handles.values()) {
        for (const handle of batches) {
          total += handle.dids.length;
        }
      }
      return total;
    },

    async spawn(req: TestPeerSpawnRequest): Promise<{ spawned: number; dids: string[] } | undefined> {
      const baseUrl = opts.baseUrl();
      if (!baseUrl) {
        return undefined;
      }
      const result = await spawnTestPeers({
        cohortId: req.cohortId,
        baseUrl,
        requested: req.requested,
        remainingSeats: req.remainingSeats,
        network: opts.network,
        signal: opts.signal,
        createPeer: opts.createPeer,
        createPeerIdentity: opts.createPeerIdentity,
      });
      if (result.spawned > 0) {
        for (const did of result.dids) {
          rememberDid(did);
        }
        const batches = handles.get(req.cohortId) ?? [];
        batches.push(result.handle);
        handles.set(req.cohortId, batches);
      }
      return { spawned: result.spawned, dids: result.dids };
    },

    release(cohortId: string): void {
      stopBatches(handles.get(cohortId));
      handles.delete(cohortId);
    },

    stopAll(): void {
      for (const batches of handles.values()) {
        stopBatches(batches);
      }
      handles.clear();
    },
  };
}

/**
 * The closed verdict union for the gated add-test-peers action, mirroring the cancel / finalize
 * shape: an app-authored outcome the route maps to a status, so no library throw can ever become
 * a response body.
 */
export type AddTestPeersOutcome =
  /** No such live cohort: unknown, never advertised, or already settled - all indistinguishable. */
  | 'unknown'
  /** The cohort is full. */
  | 'no-seats'
  /** This service is not listening yet, so it has no origin for its own peers to connect back to. */
  | 'unavailable'
  /** Every peer failed to start. */
  | 'failed'
  /** The peers that actually took a seat. */
  | { spawned: number; dids: string[] };

/** The seat facts one cohort reports, read live from the runner session. */
export interface CohortSeats {
  seatsJoined: number;
  capacity: number;
}

/** What {@link addTestPeersFor} needs: the seat reader, the registry, and the record-keeping seam. */
export interface AddTestPeersDeps {
  /** Live seats for a cohort, or `undefined` when this service holds no such live cohort. */
  seats: (cohortId: string) => CohortSeats | undefined;
  registry: TestPeerRegistry;
  /** Called once, after a successful spawn, to record the action (the monitor log seam). */
  onSpawned?: (cohortId: string, spawned: number) => void;
}

/**
 * The gated action behind `POST /v1/operator/cohorts/:id/test-peers`. It lives here rather than in
 * `index.ts` so the route-semantics matrix asserts the REAL verdict logic instead of a re-typed
 * copy of it.
 *
 * The seat arithmetic is read LIVE from the session at call time, never from a number the browser
 * sent: the console's rendered remaining-seat count is a poll old by the time the operator clicks,
 * and the cap that actually matters is the one the service enforces.
 */
export async function addTestPeersFor(
  deps: AddTestPeersDeps,
  cohortId: string,
  requested?: number,
): Promise<AddTestPeersOutcome> {
  const seats = deps.seats(cohortId);
  if (!seats) {
    return 'unknown';
  }
  const remainingSeats = Math.max(0, seats.capacity - seats.seatsJoined);
  if (remainingSeats === 0) {
    return 'no-seats';
  }
  const result = await deps.registry.spawn({ cohortId, requested, remainingSeats });
  if (!result) {
    return 'unavailable';
  }
  if (result.spawned === 0) {
    return 'failed';
  }
  deps.onSpawned?.(cohortId, result.spawned);
  return { spawned: result.spawned, dids: result.dids };
}

/** The one seam `createHonoApp` needs; implemented by `createService` over {@link addTestPeersFor}. */
export interface TestPeerSpawner {
  addTestPeers(cohortId: string, requested?: number): Promise<AddTestPeersOutcome>;
}
