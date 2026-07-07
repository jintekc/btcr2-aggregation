import type { AddressInfo } from 'node:net';
import { serve, type ServerType } from '@hono/node-server';
import {
  AggregationServiceRunner,
  HttpServerTransport,
  type CohortConfig,
  type PendingOptIn,
} from '@did-btcr2/aggregation/service';
import { resolveBtcr2SenderPk } from '@did-btcr2/method';
import { bytesToHex } from '@noble/hashes/utils';
import {
  assertNetworkAllowed,
  hasBakedAggregateBeacon,
  resolveNetwork,
  type Identity,
  type NetworkConfig,
} from '@btcr2-aggregation/shared';
import type { BitcoinConnection, FeeEstimator } from '@did-btcr2/bitcoin';
import { createHonoApp } from './hono-adapter.js';
import { makeProvideTxData, type LiveTxConfig } from './tx.js';
import { persistCohortArtifacts } from './persist.js';
import { GenesisStagingCache, persistMemberGenesis } from './genesis-capture.js';
import { decideRosterOptIn } from './roster.js';
import {
  attachBeaconBroadcast,
  BeaconBroadcaster,
  type BeaconBroadcastHandle,
} from './broadcast.js';
import type { ArtifactStore } from './store.js';
import type { IpfsNode } from './ipfs.js';

export { createHonoApp, type HonoAppOptions } from './hono-adapter.js';
export { makeProvideTxData, MIN_LIVE_FUNDING_SATS, type LiveTxConfig } from './tx.js';
export { bridgeRunnerToSse, type DashboardExtras } from './dashboard-sse.js';
export {
  BeaconBroadcaster,
  attachBeaconBroadcast,
  broadcastAndConfirm,
  rawBeaconTxHex,
  type BeaconAnchorEvents,
  type BeaconBroadcastHandle,
  type BroadcastConfirmOptions,
  type BroadcastResult,
  type AttachBeaconBroadcastOptions,
} from './broadcast.js';
export { startDemoServer, type DemoServer, type DemoServerOptions } from './demo-server.js';
export {
  ARTIFACT_KINDS,
  type ArtifactKind,
  type ArtifactValueByKind,
  type ArtifactStore,
  MemoryArtifactStore,
  FileSystemArtifactStore,
  isHexKey,
  normalizeHexKey,
  putAnnouncement,
  putProof,
  putUpdate,
  putGenesis,
  exportSidecar,
  mountArtifactRoutes,
} from './store.js';
export {
  persistCohortArtifacts,
  type PersistableCohort,
  type PersistSummary,
} from './persist.js';
export {
  resolveBtcr2,
  driveResolution,
  type ResolveBtcr2Options,
  type ResolverLike,
} from './resolve.js';
export { createOfflineBitcoinConnection } from './offline-chain.js';
export { deriveCohortBeaconAddress } from './beacon-address.js';
export { decideRosterOptIn, bytesEqual, type RosterDecision } from './roster.js';
export {
  GenesisStagingCache,
  persistMemberGenesis,
  type GenesisPersistOutcome,
} from './genesis-capture.js';
export {
  createIpfsNode,
  validatePinRequest,
  DEFAULT_PIN_TIMEOUT_MS,
  MAX_PIN_REQUEST,
  type IpfsNode,
  type IpfsNodeOptions,
  type PinOutcome,
  type PinSource,
} from './ipfs.js';

export interface CreateServiceOptions {
  /** Service identity (the coordinator). */
  identity: Identity;
  /** Cohort configuration the runner advertises on `run()`. */
  config: CohortConfig;
  /**
   * SSE heartbeat interval, in ms. Defaults to 0 (disabled) so a one-shot M1
   * process exits cleanly once a cohort completes. The long-lived demo server
   * sets a positive value (e.g. 15000) to keep advert/inbox SSE connections
   * alive through idle periods and intermediary proxies.
   */
  heartbeatIntervalMs?: number;
  /**
   * Maximum accepted request-body size (in body-string length) for the transport's
   * authenticated POST routes. Bounds the work an unauthenticated party can force
   * before the EXTERNAL (x1) genesis-bootstrap hash check runs, so a large fake
   * genesis cannot be parsed and hashed (a request over the cap gets 413 before its
   * body is parsed). Defaults to the transport's own default (64 KiB), well above a
   * real genesis document. See ADR 066 section 5 (bootstrap DoS surface).
   */
  maxBodyBytes?: number;
  /**
   * Per-cohort overall TTL, in ms. Left undefined the runner NEVER times a
   * cohort out, so a participant who joins then walks away mid-flow leaves the
   * cohort's completion promise pending forever (it can neither complete nor
   * fail). The long-lived booth MUST set this so a stalled cohort rejects and
   * the advertise loop can move on.
   */
  cohortTtlMs?: number;
  /**
   * Per-phase stall timeout, in ms. Bounds each protocol phase (keygen, nonce,
   * signing); if a participant drops mid-round the phase times out and the
   * cohort fails fast for the remaining members instead of hanging.
   */
  phaseTimeoutMs?: number;
  /**
   * Absolute path to the built web SPA (e.g. `packages/web/dist`). When set, the
   * server also serves the app from this origin (production same-origin
   * topology). Omit for the headless M1 path, which serves no UI.
   */
  webDistDir?: string;
  /**
   * Content-addressed artifact store. When set, the server exposes read-only
   * `GET /cas/*` routes serving the off-chain resolution artifacts (CAS
   * announcements, SMT proofs, signed updates) by hex hash. The cohort artifacts
   * are persisted into it when live broadcasting is enabled (M3c). Omit for the
   * headless M1 path, which persists nothing.
   */
  store?: ArtifactStore;
  /**
   * Opt in to the LIVE beacon-transaction path: instead of the zero-chain fixture
   * tx, the runner builds a real aggregation beacon tx (`buildAggregationBeaconTx`)
   * that spends a funded UTXO at the cohort's beacon address. Default false (the
   * fixture path, which keeps the hermetic gate chain-free). Requires {@link bitcoin}.
   */
  live?: boolean;
  /**
   * Injected Bitcoin REST (esplora) connection for the live path. Required when
   * {@link live} is true. Injected (not constructed here) so the live path is
   * testable with a mock connection and so the operator controls the esplora host.
   */
  bitcoin?: BitcoinConnection;
  /**
   * Fee estimator forwarded to the runner and honored by the live beacon-tx
   * builder. Defaults to the runner's static 5 sat/vB; inject a dynamic estimator
   * (mempool API / Bitcoin Core) for production live runs.
   */
  feeEstimator?: FeeEstimator;
  /**
   * Change address for the live beacon tx. Defaults to the beacon address; set the
   * operator funding wallet to avoid reusing the cohort address for change.
   */
  changeAddress?: string;
  /**
   * Permit a live run against mainnet. Default false: a mainnet {@link config}
   * network with {@link live} true throws (real funds guard). No effect on the
   * fixture path.
   */
  allowMainnet?: boolean;
  /**
   * Broadcast the signed beacon transaction to the network on each
   * `signing-complete`, then poll for its first confirmation, surfacing the
   * lifecycle on {@link Service.broadcaster}. Requires {@link live} (broadcasting
   * the zero-chain fixture tx is meaningless and throws). Default false, so the
   * live path can build + sign a real tx without pushing it (the hermetic
   * live-mock e2e relies on that). Broadcast is independent of {@link store}:
   * persistence fires on `signing-complete` regardless of broadcast success.
   */
  broadcast?: boolean;
  /**
   * Interval between confirmation polls for a broadcast beacon tx, in ms. Default
   * 5000. Only used when {@link broadcast} is true.
   */
  confirmPollIntervalMs?: number;
  /**
   * Overall wait for a broadcast beacon tx's first confirmation, in ms. Default
   * 180000 (~6 mutinynet blocks). On expiry the tx is still broadcast; the
   * `beacon-anchored` event reports `confirmed: false`. Only used when
   * {@link broadcast} is true.
   */
  confirmTimeoutMs?: number;
  /**
   * Opt-in IPFS pinning node (ADR 0011), created with `createIpfsNode` and
   * injected like {@link bitcoin} - the caller owns its lifecycle. Enables
   * `GET /v1/ipfs` (as enabled) and `POST /v1/ipfs/pin`, which sources verified
   * bytes from {@link store} or fetches them over bitswap from the publishing
   * peer. Independent of the live path: pinning moves data, never funds.
   */
  ipfs?: IpfsNode;
  /**
   * Restrict cohort opt-ins to this FIXED roster of 33-byte compressed public
   * keys (ADR 0012). A pre-provisioned (baked-genesis) cohort derives its
   * aggregate beacon address from the roster BEFORE the cohort runs
   * (`deriveCohortBeaconAddress`); the address commits to the exact seated key
   * set, so a single interloper opt-in would silently invalidate every baked
   * genesis and strand any pre-funding. With this set, an opt-in whose
   * `participantPk` is not in the roster is rejected. Pair it with
   * `maxParticipants` on the {@link config} so the cohort cannot overfill.
   * Omit (default) for open cohorts - the pre-baked behavior, unchanged.
   */
  rosterPks?: Uint8Array[];
}

export interface StartedService {
  port: number;
  baseUrl: string;
}

export interface Service {
  /** The aggregation runner driving the cohort. Attach event listeners to it. */
  readonly runner: AggregationServiceRunner;
  /** The underlying sans-I/O HTTP server transport. */
  readonly transport: HttpServerTransport;
  /**
   * Beacon-tx broadcast emitter, present only when the service runs with
   * `live` + `broadcast`. Subscribe to observe `beacon-broadcast` /
   * `beacon-anchored` / `beacon-broadcast-failed` for each cohort's on-chain tx.
   */
  readonly broadcaster?: BeaconBroadcaster;
  /** Start listening. Pass port 0 (default) for an ephemeral port. */
  start(port?: number, host?: string): Promise<StartedService>;
  /** Stop the runner, transport, and HTTP server. */
  stop(): Promise<void>;
}

/**
 * Create an aggregation service: an {@link HttpServerTransport} mounted under Hono
 * on a real port, driven by an {@link AggregationServiceRunner} configured with the
 * fixture beacon-tx callback. Senders are authenticated by resolving their DID to a
 * communication public key (`resolveBtcr2SenderPk`): a KEY (`k1`) DID decodes to its
 * key directly, and an EXTERNAL (`x1`) DID is bootstrap-authenticated from the
 * self-verifying genesis document on its opt-in (ADR 066), so both onboarding models
 * are first-class. SSE heartbeats are disabled so the process exits cleanly once a
 * cohort completes.
 */
export function createService(opts: CreateServiceOptions): Service {
  const { did, keys } = opts.identity;

  // Staging for BAKED x1 geneses seen at bootstrap-auth, promoted to the durable
  // store only on `participant-accepted` (the membership trust boundary; ADR 0012).
  // Only baked-shape geneses are staged: a CLASSIC x1 genesis maps its DID to the
  // controller's personal funding address, and auto-publishing that without the
  // controller's say-so would be an unconsented disclosure (an SMT cohort member
  // in particular chose the privacy-preserving beacon type) - classic x1 stays on
  // the controller-supplied sidecar `POST /resolve/:did` path. A baked genesis is
  // operator-authored for aggregator-served resolution, so persisting it is the
  // point. No store, nothing to promote into, so nothing is staged.
  const genesisStaging = opts.store ? new GenesisStagingCache() : undefined;

  // Roster keys already seated per cohort, so a duplicate opt-in cannot drift the
  // aggregate off the pre-derived baked address (ADR 0012). Keyed by cohort id
  // because each advertise round is a fresh cohort. Only used with `rosterPks`.
  const seatedRosterKeys = new Map<string, Set<string>>();

  const transport = new HttpServerTransport({
    // Genesis-aware sender resolution: a KEY (k1) sender's key is decoded from its
    // DID; an EXTERNAL (x1) sender that is not yet a registered peer is
    // bootstrap-authenticated from the self-verifying `genesisDocument` carried on
    // its opt-in (ADR 066). k1 behavior is unchanged (no genesis -> decode the DID).
    // The wrapper additionally stages a successfully-authenticated BAKED genesis
    // for possible promotion at acceptance; it never changes the auth result.
    resolveSenderPk: (senderDid: string, senderOpts?: { genesisDocument?: object }) => {
      const pk = resolveBtcr2SenderPk(senderDid, senderOpts);
      if (genesisStaging && pk && senderOpts?.genesisDocument) {
        const genesis = senderOpts.genesisDocument as Record<string, unknown>;
        if (hasBakedAggregateBeacon(genesis)) {
          genesisStaging.remember(senderDid, genesis);
        }
      }
      return pk;
    },
    heartbeatIntervalMs: opts.heartbeatIntervalMs ?? 0,
    // Bound the opt-in body before the genesis hash check (default 64 KiB); passed
    // through only when set so the transport default otherwise applies.
    ...(opts.maxBodyBytes !== undefined ? { maxBodyBytes: opts.maxBodyBytes } : {}),
  });
  transport.registerActor(did, keys);

  // Resolve the opt-in LIVE beacon-tx config. Off by default (the fixture path
  // keeps the gate chain-free). When on, a BitcoinConnection is required and a
  // mainnet target must be explicitly allowed (real-funds guard). The scure
  // network params come from the shared registry (single source of truth) so
  // address decoding matches everywhere.
  let live: LiveTxConfig | undefined;
  let netConfig: NetworkConfig | undefined;
  if (opts.live) {
    if (!opts.bitcoin) {
      throw new Error('createService: live=true requires an injected `bitcoin` connection');
    }
    // assertNetworkAllowed returns the resolved config (and enforces the mainnet
    // opt-in); reuse it for both the scure address params and the dashboard's
    // explorer URL so the network registry stays the single source of truth.
    netConfig = assertNetworkAllowed(opts.config.network, { allowMainnet: opts.allowMainnet ?? false });
    live = {
      bitcoin: opts.bitcoin,
      network: netConfig.scureNetwork,
      changeAddress: opts.changeAddress,
    };
  }

  // `onProvideTxData` reads `runner` lazily (only when signing starts, long after
  // construction), so closing over the const binding here is safe.
  const runner: AggregationServiceRunner = new AggregationServiceRunner({
    transport,
    did,
    keys,
    config: opts.config,
    onProvideTxData: makeProvideTxData(() => runner, live),
    // Forward the fee estimator (else the runner defaults to a static 5 sat/vB);
    // the live beacon-tx builder reads it via the onProvideTxData info.
    feeEstimator: opts.feeEstimator,
    // Undefined => disabled (the one-shot M1 path relies on that). The booth
    // passes both so abandoned/stalled cohorts reject instead of wedging.
    cohortTtlMs: opts.cohortTtlMs,
    phaseTimeoutMs: opts.phaseTimeoutMs,
    // Fixed-roster gate for pre-provisioned (baked) cohorts: accept an opt-in only
    // when its key is BOUND to the authenticated sender (participantPk ===
    // communicationPk, which the transport cross-checks against the sender's
    // genesis), is in the roster, and is not already seated - so the aggregated key
    // set, and therefore the pre-derived beacon address, cannot drift (ADR 0012,
    // `decideRosterOptIn`). Omitted (the default) leaves the library's accept-all
    // behavior untouched. Seated keys are tracked per cohort (rounds re-advertise
    // under fresh cohort ids).
    ...(opts.rosterPks !== undefined
      ? {
          onOptInReceived: async (optIn: PendingOptIn) => {
            const seen = seatedRosterKeys.get(optIn.cohortId) ?? new Set<string>();
            const decision = decideRosterOptIn(opts.rosterPks!, optIn, seen);
            if (decision.accepted) {
              seen.add(bytesToHex(optIn.participantPk));
              seatedRosterKeys.set(optIn.cohortId, seen);
            } else {
              console.warn(
                `[service] rejected opt-in from ${optIn.participantDid} for cohort ` +
                  `${optIn.cohortId}: ${decision.reason}`,
              );
            }
            return { accepted: decision.accepted };
          },
        }
      : {}),
  });

  // When a store is configured, harvest each completed cohort's off-chain
  // resolution artifacts (the per-member signed updates plus the CAS announcement
  // or SMT proofs) and persist them under the exact hex keys a did:btcr2 resolver
  // will request. The artifacts live on the cohort accessor, NOT on the
  // `signing-complete` result, so a handler that read only the result would
  // persist nothing and resolution would silently fail. Fire-and-forget: a persist
  // failure must never crash the runner, so it is caught and logged. The headless
  // M1/M2 path configures no store, so this never runs in the hermetic gate; the
  // hermetic persist test wires a MemoryArtifactStore here explicitly.
  if (opts.store) {
    const store = opts.store;
    runner.on('signing-complete', ({ cohortId }) => {
      const cohort = runner.session.getCohort(cohortId);
      if (!cohort) {
        return;
      }
      void persistCohortArtifacts(store, cohort).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[service] failed to persist cohort ${cohortId} artifacts: ${message}`);
      });
    });
    // Promote a staged BAKED genesis to the durable store the moment its sender is
    // ACCEPTED into a cohort (ADR 0012). Acceptance is the trust boundary: it is
    // operator-gated (rosterPks / onOptInReceived) and bounded per cohort, unlike
    // the bootstrap-auth seam the staging cache sits on. From here the member's x1
    // DID resolves via a sidecar-less `GET /resolve/:did` (NeedGenesisDocument is
    // served from the store). Fire-and-forget like the artifact persist: a write
    // failure must never disturb the protocol.
    runner.on('participant-accepted', ({ cohortId, participantDid }) => {
      const genesis = genesisStaging?.take(participantDid);
      if (!genesis) {
        return;
      }
      void persistMemberGenesis(store, participantDid, genesis)
        .then((outcome) => {
          if (outcome === 'hash-mismatch') {
            // Bootstrap-auth verified the genesis against this DID, so a mismatch
            // here means the staged content was corrupted - loud, not silent.
            console.error(
              `[service] staged genesis for accepted member ${participantDid} (cohort ${cohortId}) ` +
                'failed re-verification against the DID commitment; NOT persisted',
            );
          }
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[service] failed to persist genesis for ${participantDid}: ${message}`);
        });
    });
  }

  // Opt-in live broadcast: on each `signing-complete`, push the signed beacon tx to
  // the network and poll for confirmation, surfacing the lifecycle on `broadcaster`.
  // Independent of persistence (a separate `signing-complete` listener) so a
  // broadcast failure never blocks the artifact write, and vice versa. Requires the
  // live path (broadcasting the fixture tx is meaningless), which already guarantees
  // a `bitcoin` connection.
  let broadcaster: BeaconBroadcaster | undefined;
  let broadcastHandle: BeaconBroadcastHandle | undefined;
  if (opts.broadcast) {
    if (!live) {
      throw new Error(
        'createService: broadcast=true requires live=true (refusing to broadcast the fixture tx)',
      );
    }
    broadcaster = new BeaconBroadcaster();
    broadcastHandle = attachBeaconBroadcast(runner, {
      bitcoin: live.bitcoin,
      broadcaster,
      pollIntervalMs: opts.confirmPollIntervalMs,
      confirmTimeoutMs: opts.confirmTimeoutMs,
    });
  }

  const app = createHonoApp(transport, {
    runner,
    webDistDir: opts.webDistDir,
    store: opts.store,
    broadcaster,
    network: netConfig,
    // The always-present network name served on `GET /v1/config` so the browser
    // derives its addresses/DIDs at runtime. Sourced from the cohort config (the
    // single source of truth for this coordinator's chain) and validated by
    // resolveNetwork, independent of the live/broadcast path.
    networkName: resolveNetwork(opts.config.network).name,
    // The read-only resolve route is independent of the live/broadcast path: a
    // Bitcoin connection alone (to run the beacon-signal indexer) plus the artifact
    // store is enough to serve `GET /resolve/:did`. Passed whenever a connection is
    // injected, so an operator can offer resolution without broadcasting.
    bitcoin: opts.bitcoin,
    ipfs: opts.ipfs,
  });
  let server: ServerType | undefined;

  return {
    runner,
    transport,
    broadcaster,
    start(port = 0, host = '127.0.0.1'): Promise<StartedService> {
      transport.start();
      return new Promise<StartedService>((resolve, reject) => {
        try {
          server = serve({ fetch: app.fetch, port, hostname: host }, (info: AddressInfo) => {
            resolve({ port: info.port, baseUrl: `http://${host}:${info.port}` });
          });
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
    },
    stop(): Promise<void> {
      // Abort any in-flight confirmation poll before tearing down the runner.
      broadcastHandle?.stop();
      runner.stop();
      transport.stop();
      return new Promise<void>((resolve) => {
        if (!server) {
          resolve();
          return;
        }
        server.close(() => resolve());
      });
    },
  };
}
