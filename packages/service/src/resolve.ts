import { decode, encode } from '@did-btcr2/common';
import type { BitcoinConnection } from '@did-btcr2/bitcoin';
import {
  BeaconSignalDiscovery,
  DidBtcr2,
  type BeaconService,
  type BeaconSignal,
  type CASAnnouncement,
  type DataNeed,
  type DidResolutionResponse,
  type ResolverState,
  type Sidecar,
  type SignedBTCR2Update,
  type SMTProof,
} from '@did-btcr2/method';
import { base64UrlToHash, blockHash, didToIndex, verifySerializedProof } from '@did-btcr2/smt';
import type { ArtifactKind, ArtifactStore } from './store.js';

/**
 * The subset of `@did-btcr2/method`'s {@link import('@did-btcr2/method').Resolver}
 * the driver loop touches: the sans-I/O `resolve()` / `provide()` protocol. Declaring
 * it structurally (rather than importing the concrete class) lets the loop be
 * unit-tested with a scripted fake resolver, and keeps {@link driveResolution}
 * independent of the resolver's private internals.
 */
export interface ResolverLike {
  /** Advance the state machine (needs data, or resolved). */
  resolve(): ResolverState;
  /** Provide the data a prior {@link resolve} requested. */
  provide(need: DataNeed, data: unknown): void;
}

/** Options for {@link resolveBtcr2} and {@link driveResolution}. */
export interface ResolveBtcr2Options {
  /**
   * Bitcoin REST (esplora) connection used to discover on-chain beacon signals
   * (`BeaconSignalDiscovery.indexer`). Required: resolution ALWAYS needs beacon
   * signals (the genesis document's own beacons, at minimum). Inject a real
   * connection for a live resolve, or a mock for the hermetic path - the driver is
   * identical either way.
   */
  bitcoin: BitcoinConnection;
  /**
   * Content-addressed artifact store serving the off-chain resolution artifacts by
   * hex hash: CAS announcements (`NeedCASAnnouncement`), signed update bodies
   * (`NeedSignedUpdate`), SMT proofs (`NeedSMTProof`, selected per-DID), and genesis
   * documents (`NeedGenesisDocument`, EXTERNAL onboarding). Omit to resolve purely
   * from {@link sidecar}.
   */
  store?: ArtifactStore;
  /**
   * Sidecar the DID controller supplies out-of-band. Pre-loaded into the resolver's
   * maps, so any artifact it carries is never re-requested. The privacy-preserving
   * source for an SMT proof (the controller discloses only their own leaf) and the
   * required source for an EXTERNAL genesis document.
   */
  sidecar?: Sidecar;
  /** Passed through to {@link DidBtcr2.resolve} (default 10; bounds multi-round discovery). */
  maxDiscoveryRounds?: number;
  /**
   * Hard cap on driver iterations (one per `resolve()` that returns
   * `action-required`), a loop backstop above any real resolution's round count.
   * Default 64.
   */
  maxIterations?: number;
}

/**
 * Thrown when resolution encounters a beacon signal that is still mempool-resident
 * (unconfirmed): its block metadata carries no confirmation time, so the upstream
 * `@did-btcr2/method` resolver would derive an `Invalid Date` from the missing
 * `block_time` and throw a generic error (surfaced in Phase 3 live UAT, D-46). We detect the
 * condition in-repo and raise this DISTINGUISHABLE, retryable signal instead of forking the
 * library, so the route can answer an honest "resolve again after it confirms" rather than a
 * generic 502. Adopt the upstream `block_time` fix when it ships (RESEARCH A1).
 */
export class UnconfirmedSignalError extends Error {
  constructor(message = 'a beacon signal is awaiting confirmation') {
    super(message);
    this.name = 'UnconfirmedSignalError';
  }
}

/**
 * Whether `err` is the upstream Invalid-Date throw a mempool-resident beacon signal triggers
 * inside the `@did-btcr2/method` resolver. `DateUtils.blocktimeToTimestamp` maps a missing
 * `block_time` to `new Date(NaN)`, and `DateUtils.toISOStringNonFractional` then throws
 * `Invalid date: Invalid Date` (verified in `@did-btcr2/common@9.1.0`). Matched by message shape
 * because the library throws a plain `Error` with no typed error class to catch on. This is the
 * belt-and-suspenders backstop for the proactive {@link hasUnconfirmedSignal} seam guard: if a
 * mempool signal shape slips past detection, the throw is still mapped to the retryable outcome.
 */
function isUpstreamInvalidDateThrow(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /invalid date/i.test(message);
}

/**
 * True when any discovered beacon signal is still mempool-resident (unconfirmed). A confirmed
 * signal carries a finite `blockMetadata.time` (the block's unix timestamp); a mempool-resident
 * one has `block_time` undefined, so `time` is `NaN`/undefined (see
 * `@did-btcr2/method` `BeaconSignalDiscovery.indexer`). Providing such a signal to the resolver is
 * exactly what triggers the upstream Invalid-Date throw (D-46), so the driver detects it FIRST
 * and raises {@link UnconfirmedSignalError} before `provide()`.
 */
function hasUnconfirmedSignal(signals: Map<BeaconService, BeaconSignal[]>): boolean {
  for (const list of signals.values()) {
    for (const signal of list) {
      if (!Number.isFinite(signal?.blockMetadata?.time)) {
        return true;
      }
    }
  }
  return false;
}

/** Fetch `hashHex` from `kind` of `store`, or `undefined` when no store / absent. */
async function getFromStore(
  store: ArtifactStore | undefined,
  kind: ArtifactKind,
  hashHex: string,
): Promise<unknown> {
  if (!store) {
    return undefined;
  }
  return store.get(kind, hashHex);
}

/**
 * Select the SMT proof for `did` at `rootHex` from the store. SMT proofs are stored
 * per-DID (keyed by the member's hex update hash), because every proof in a cohort
 * shares one root, so a flat root-keyed store would keep only one. Resolution is
 * inherently per-DID: only the resolved DID's own proof verifies against its leaf
 * index. This scans the proofs sharing `rootHex` and returns the one that verifies
 * for `did` - the same check `SMTBeacon.processSignals` runs, done here so the driver
 * hands `provide()` a proof that will pass rather than one that throws.
 *
 * Returns `undefined` if no store, or no proof at `rootHex` verifies for `did` (e.g.
 * a cooperative non-inclusion, or the DID was not in this cohort).
 */
async function selectSmtProof(
  store: ArtifactStore | undefined,
  rootHex: string,
  did: string,
): Promise<SMTProof | undefined> {
  if (!store) {
    return undefined;
  }
  const index = didToIndex(did);
  for (const [, value] of await store.entries('proof')) {
    const proof = value as SMTProof;
    // Need the root, the nonce, and (for an inclusion leaf) the updateId. The driver
    // only resolves inclusion proofs; a non-inclusion proof (no updateId) carries no
    // update to apply and is skipped.
    if (!proof?.id || !proof.nonce || !proof.updateId) {
      continue;
    }
    // Wrap the whole decode + verify: an untrusted / corrupt store may hold a proof
    // whose base64url fields are the wrong length (`base64UrlToHash` throws
    // RangeError) or that simply belongs to another member (verification fails).
    // Either way, skip it and keep scanning rather than aborting this DID's resolve.
    try {
      if (encode(decode(proof.id, 'base64urlnopad'), 'hex') !== rootHex) {
        continue;
      }
      // Leaf per spec: inclusion = hash(hash(nonce) || updateId).
      const nonceHash = base64UrlToHash(proof.nonce);
      const candidateHash = blockHash(blockHash(nonceHash), base64UrlToHash(proof.updateId));
      if (verifySerializedProof(proof, index, candidateHash)) {
        return proof;
      }
    } catch {
      // Malformed base64url or a wrong-DID proof: not this DID's proof, keep scanning.
    }
  }
  return undefined;
}

/** Satisfy one {@link DataNeed} by fetching from the indexer / store and providing it. */
async function satisfyNeed(
  resolver: ResolverLike,
  need: DataNeed,
  did: string,
  opts: ResolveBtcr2Options,
): Promise<void> {
  switch (need.kind) {
    case 'NeedBeaconSignals': {
      // The one on-chain read: fetch each in-document beacon address's signals over
      // esplora. Empty signals for a beacon that never fired are normal (and skipped
      // downstream), so an empty result is not an error.
      const signals = await BeaconSignalDiscovery.indexer(
        need.beaconServices as BeaconService[],
        opts.bitcoin,
      );
      // D-46: a mempool-resident (unconfirmed) signal carries no block_time, so providing it would
      // make the upstream resolver derive an Invalid Date and throw generically. Detect it at this
      // seam and raise the distinguishable retryable signal instead (no library fork), so the route
      // can answer an honest "resolve again after it confirms" rather than a generic 502.
      if (hasUnconfirmedSignal(signals)) {
        throw new UnconfirmedSignalError();
      }
      resolver.provide(need, signals);
      return;
    }
    case 'NeedCASAnnouncement': {
      const announcement = await getFromStore(opts.store, 'announcement', need.announcementHash);
      if (announcement === undefined) {
        throw new Error(
          `resolveBtcr2: no CAS announcement for hash ${need.announcementHash} ` +
            `(beacon ${need.beaconServiceId}); publish it to the store or supply a sidecar`,
        );
      }
      resolver.provide(need, announcement as CASAnnouncement);
      return;
    }
    case 'NeedSignedUpdate': {
      const update = await getFromStore(opts.store, 'update', need.updateHash);
      if (update === undefined) {
        throw new Error(
          `resolveBtcr2: no signed update for hash ${need.updateHash} ` +
            `(beacon ${need.beaconServiceId}); publish it to the store or supply a sidecar`,
        );
      }
      resolver.provide(need, update as SignedBTCR2Update);
      return;
    }
    case 'NeedSMTProof': {
      const proof = await selectSmtProof(opts.store, need.smtRootHash, did);
      if (!proof) {
        throw new Error(
          `resolveBtcr2: no SMT proof for did ${did} at root ${need.smtRootHash} ` +
            `(beacon ${need.beaconServiceId}); supply the DID's proof via sidecar or store`,
        );
      }
      resolver.provide(need, proof);
      return;
    }
    case 'NeedGenesisDocument': {
      const genesis = await getFromStore(opts.store, 'genesis', need.genesisHash);
      if (genesis === undefined) {
        throw new Error(
          `resolveBtcr2: no genesis document for hash ${need.genesisHash}; an EXTERNAL ` +
            `(x-HRP) DID must be resolved with its genesis document in the sidecar or store`,
        );
      }
      resolver.provide(need, genesis as object);
      return;
    }
  }
}

/**
 * Drive a {@link ResolverLike} to completion, satisfying each {@link DataNeed} from
 * the injected connection (beacon signals) and the store / sidecar (off-chain
 * artifacts). Exported for direct unit testing with a scripted resolver;
 * {@link resolveBtcr2} is the public entry that constructs the real resolver.
 *
 * @throws if a need cannot be satisfied (missing artifact) or the iteration cap is
 *   exceeded (a resolution that never converges).
 */
export async function driveResolution(
  resolver: ResolverLike,
  did: string,
  opts: ResolveBtcr2Options,
): Promise<DidResolutionResponse> {
  const maxIterations = opts.maxIterations ?? 64;
  try {
    let state = resolver.resolve();
    let iterations = 0;
    while (state.status === 'action-required') {
      if (++iterations > maxIterations) {
        throw new Error(
          `resolveBtcr2: exceeded ${maxIterations} iterations without resolving ${did}`,
        );
      }
      // Satisfy the round's needs in order. Each provide() mutates the resolver;
      // sequential (not parallel) so a need that depends on a just-provided artifact
      // sees it, and so a failure surfaces the specific unmet need.
      for (const need of state.needs) {
        await satisfyNeed(resolver, need, did, opts);
      }
      state = resolver.resolve();
    }
    return state.result;
  } catch (err) {
    // D-46: normalize the unconfirmed-signal condition to ONE distinguishable retryable signal.
    // The satisfyNeed seam raises UnconfirmedSignalError proactively; if a mempool signal shape
    // slips past it, the upstream resolver instead throws the generic Invalid Date during
    // resolve() processing - map that shape here too. Every OTHER error (a missing artifact, an
    // esplora fault, the iteration cap) is a genuine failure and propagates unchanged, so the
    // route still maps it to a generic 502.
    if (err instanceof UnconfirmedSignalError) {
      throw err;
    }
    if (isUpstreamInvalidDateThrow(err)) {
      throw new UnconfirmedSignalError();
    }
    throw err;
  }
}

/**
 * Server-driven did:btcr2 resolution. Constructs the sans-I/O
 * {@link import('@did-btcr2/method').Resolver} for `did` and drives it to completion,
 * fetching on-chain beacon signals over the injected Bitcoin connection and the
 * off-chain artifacts (CAS announcements, signed updates, SMT proofs, genesis
 * documents) from the store / sidecar. Because the driver's `provide()` calls are
 * hash-guarded by the resolver, an untrusted store is safe: a wrong artifact fails
 * the hash check rather than corrupting the result.
 *
 * Runs on the server (not the browser) so `@did-btcr2/method`'s resolution
 * dependencies (`@web5/dids` -> `level`) never enter the web bundle; the browser
 * calls `GET /resolve/:did`.
 *
 * @returns the resolved DID document and its metadata.
 */
export function resolveBtcr2(did: string, opts: ResolveBtcr2Options): Promise<DidResolutionResponse> {
  const resolver = DidBtcr2.resolve(did, {
    sidecar: opts.sidecar,
    maxDiscoveryRounds: opts.maxDiscoveryRounds,
  });
  return driveResolution(resolver as unknown as ResolverLike, did, opts);
}
