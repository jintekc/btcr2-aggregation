import type { AddressInfo } from 'node:net';
import { serve, type ServerType } from '@hono/node-server';
import {
  AggregationServiceRunner,
  HttpServerTransport,
  type CohortConfig,
  type HttpServerTransportConfig,
  type PendingOptIn,
} from '@did-btcr2/aggregation/service';
import { resolveBtcr2SenderPk } from '@did-btcr2/method';
import { bytesToHex } from '@noble/hashes/utils';
import {
  assertNetworkAllowed,
  hasBakedAggregateBeacon,
  resolveNetwork,
  type BeaconType,
  type Identity,
  type NetworkConfig,
} from '@btcr2-aggregation/shared';
import type { BitcoinConnection, FeeEstimator } from '@did-btcr2/bitcoin';
import { createHonoApp } from './hono-adapter.js';
import { createLoginThrottle, createSessionStore } from './operator-auth.js';
import { createOperatorCohorts } from './operator-cohorts.js';
import { createRuntimeSettings, type RuntimeSettings } from './runtime-settings.js';
import { createCohortIntents } from './cohort-intent.js';
import { createAdvertRepublisher } from './advert-republish.js';
import { createAnchorState } from './anchor-state.js';
import {
  createCohortMonitor,
  OPERATOR_FINALIZED_TEXT,
  type FundingView,
  type ServiceMode,
} from './monitor.js';
import { makeProvideTxData, type LiveTxConfig } from './tx.js';
import {
  computeFundingDeadline,
  computeSuggestedMinSats,
  createFundingWatch,
  FUNDING_SLACK_MS,
  type FundingState,
  type FundingWatchHandle,
} from './funding-watch.js';
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
export {
  SESSION_COOKIE,
  passwordMatches,
  newSessionId,
  createSessionStore,
  createLoginThrottle,
  requireOperator,
  requireSameOrigin,
  loginHandler,
  logoutHandler,
  sessionProbeHandler,
  type SessionStore,
  type LoginThrottle,
  type OperatorAuthConfig,
} from './operator-auth.js';
export {
  createOperatorCohorts,
  type OperatorCohorts,
  type OperatorCohortsOptions,
  type OperatorCohortDTO,
  type DirectoryCohortDTO,
  type ServiceStatusDTO,
  type DraftInput,
} from './operator-cohorts.js';
export { createAnchorState, type AnchorState, type AnchorReadDTO } from './anchor-state.js';
export {
  createRuntimeSettings,
  numericKnob,
  type RuntimeSettings,
  type RuntimeSettingsSeed,
  type SettingField,
  type SettingsPatch,
} from './runtime-settings.js';
export {
  createCohortIntents,
  type CohortIntent,
  type CohortIntentRegistry,
} from './cohort-intent.js';
export {
  createAdvertRepublisher,
  type AdvertRepublisher,
  type AdvertRepublisherDeps,
} from './advert-republish.js';
export {
  createCohortMonitor,
  type CohortMonitor,
  type CohortDetailDTO,
  type CohortExportDTO,
  type CohortMemberDTO,
  type MemberStatus,
  type MemberRound,
  type ActivityLevel,
  type ActivityEntryDTO,
  type SubmissionDTO,
  type CoSignDTO,
  type FallbackDTO,
  type CohortChip,
  type CohortSummaryDTO,
  type ServiceMetricsDTO,
  type ServiceMode,
  type ServiceHealthDTO,
  type FundingView,
} from './monitor.js';
export {
  classifyFunding,
  computeSuggestedMinSats,
  computeFundingDeadline,
  createFundingWatch,
  FUNDING_SLACK_MS,
  type FundingState,
  type FundingStateName,
  type FundingWatchHandle,
  type FundingWatchOptions,
} from './funding-watch.js';
export { makeProvideTxData, MIN_LIVE_FUNDING_SATS, type LiveTxConfig } from './tx.js';
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
   * Advert-cache TTL, in ms: how long the transport keeps a cohort's advert in its
   * SSE replay window so a LATE-connecting participant still receives it on subscribe.
   * The library default is 5 minutes, but the public directory advertises a cohort as
   * joinable for the full {@link cohortTtlMs} discovery window (the demo default is 30
   * min). With the two out of step, a second participant who opens the app more than ~5
   * min after a cohort was advertised sees it as joinable in the directory yet never
   * receives the advert over SSE, so it never opts in and sits at "connecting" forever
   * (the SVC-JOIN-1 live-UAT stall). Left undefined, `createService` defaults this to
   * `cohortTtlMs` so the advert replay window equals the directory discovery window on
   * the product path; the boot-time perpetual auto-advertise loop that used to re-emit
   * adverts is gone (D-17), so the replay window is the ONLY thing keeping a still-open
   * cohort discoverable to a late subscriber. Threaded to the transport only when the
   * resolved value is finite and positive: NaN (a malformed env number) or 0 would
   * silently disable advert replay outright (the expiry comparison against NaN is
   * always false), so anything non-usable falls back to the library default instead.
   */
  advertTtlMs?: number;
  /**
   * Per-cohort overall TTL, in ms: the two-sided cohort lifetime budget from
   * advertise to signing-complete. Left undefined the runner NEVER times a
   * cohort out, so a participant who joins then walks away mid-flow leaves the
   * cohort's completion promise pending forever (it can neither complete nor
   * fail). A long-lived self-hosted service MUST set this so an abandoned cohort
   * rejects instead of lingering. On expiry the runner rejects the completion,
   * and the operator surface records the cohort as expired (surfaced, not
   * silently deleted) so the operator can re-advertise it. The demo-server
   * default is a generous discovery window (30 min); see
   * {@link file://./demo-server.ts} `DEFAULT_COHORT_TTL_MS`.
   */
  cohortTtlMs?: number;
  /**
   * Per-phase stall timeout, in ms: the maximum time allowed between phase
   * transitions, reset on every phase change. This is the runner's single stall
   * timer with no per-phase exemption, so it also bounds the Advertised phase -
   * an idle, unjoined advertised cohort is torn down when this fires. Sized as a
   * generous discovery window so strangers have time to find and join a cohort
   * (the two-sided lifetime knob), not the old fail-fast booth default. On expiry
   * the completion rejects and the operator surface records the cohort as
   * expired rather than silently dropping it. See
   * {@link file://./demo-server.ts} `DEFAULT_PHASE_TIMEOUT_MS`.
   */
  phaseTimeoutMs?: number;
  /**
   * Activate the ADR 042 k-of-n script-path fallback for signing liveness (F1c).
   * n-of-n MuSig2 stays the PRIMARY, cheaper, more private spend and the normal
   * outcome; this only changes what happens when the optimistic signing round
   * STALLS. With it true, a stalled optimistic round (a co-signer vanishing
   * mid-signing so the {@link phaseTimeoutMs} stall timer fires while signing is in
   * flight) falls back to the k-of-n script path (`triggerFallback`) instead of
   * emitting `cohort-failed`, so a single defector cannot deny the whole cohort its
   * anchor. Scoped to the SIGNING phases by the library: a stall in the Advertised
   * phase (an idle, unjoined cohort) still expires - that is the operator-visible
   * discovery-window expiry from plan 02-06, a distinct concern from this one.
   *
   * Default off (library parity) so existing callers/tests are byte-identical; the
   * demo server opts in by default (env `AUTO_FALLBACK=0` to disable). Inert on the
   * fixture/offline path (nothing is broadcast), so it never disturbs the hermetic
   * gate unless a stall is deliberately forced (see `e2e/fallback-cohort.ts`). The
   * fallback leaf's k is sized by the cohort config's `fallbackThreshold`
   * (`buildCohortConfig`, default n-1), already committed into the beacon address.
   */
  autoFallbackOnStall?: boolean;
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
   * Funding window in ms for the live+broadcast path (D-38). The budget the funding wait
   * allows for the operator to fund a cohort beacon address before the wait dead-ends with an
   * honest "funding never arrived" reason. Threaded from {@link file://./demo-server.ts}
   * (env `FUNDING_WINDOW_MS`, default 12 min). The 04-06 funding stage consumes this inside
   * `onProvideTxData`, clamping it per-cohort against the remaining TTL so the wait throws its
   * specific reason before either library timer fires; accepted here now so the boot contract
   * and the funding stage share one option. No effect on the fixture/non-broadcast path.
   */
  fundingWindowMs?: number;
  /**
   * Poll cadence (ms) for the live+broadcast funding wait + operator display watch (D-36/D-38).
   * Default 5000. Lower it in a hermetic mock e2e so the awaiting-funding -> funded transition is
   * observed quickly. Only used on the live+broadcast path.
   */
  fundingPollIntervalMs?: number;
  /**
   * Whether the cohort's ADR-042 recovery key is OPERATOR-HELD (the operator supplied RECOVERY_KEY,
   * so they can recover funds from a below-threshold-failed cohort) versus a THROWAWAY key whose
   * secret was auto-derived and discarded (funds sent to a failed cohort are unrecoverable). Drives
   * the always-shown funding-stage recovery-key disclosure (D-40). Default false (throwaway), the
   * conservative honest default: `buildCohortConfig` always fills `config.recoveryKey` (auto-deriving
   * a throwaway when none is supplied), so the config alone cannot distinguish the two - the caller
   * (demo-server, from the RECOVERY_KEY env) must assert operator-held explicitly.
   */
  recoveryKeyOperatorHeld?: boolean;
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
  /**
   * Optional operator-supplied service display name (D-51). A boot-time constant (env
   * `SERVICE_NAME`, resolved in {@link file://./demo-server.ts}) surfaced additively on
   * `GET /v1/config` so the operator console health strip and the public directory header can
   * label the service. Display text only (no edit surface, no markup); omitted from the config
   * DTO when unset so the frozen public network fields stay byte-identical.
   */
  serviceName?: string;
  /**
   * Operator console password (HOST-01, ADR 0015). When set, this service mounts the
   * operator surface: `POST /v1/operator/login`, the session guard on
   * `/v1/operator/*`, `POST /v1/operator/logout`, `GET /v1/operator/session`, and the
   * gated cohort + monitoring reads. When UNSET (the default), none of that mounts -
   * fail-closed (D-07): the public participant surface still serves, but there is no
   * operator/mutating surface and no gated monitoring. The password is compared with a
   * constant-time check and NEVER logged; never bake it into an image (env only, M4
   * .env-out-of-image lesson). The booth-era `/dashboard/events` SSE telemetry feed is
   * retired (D-02/D-19).
   */
  operatorPassword?: string;
  /**
   * Operator session lifetime in ms (default 24h). Drives both the server-side session
   * expiry and the login cookie's `Max-Age`. Only meaningful with {@link operatorPassword}.
   */
  operatorSessionTtlMs?: number;
  /**
   * Set the `Secure` flag on the operator session cookie (default true). Leave the
   * default for any real deployment (TLS terminates at the reverse proxy, ADR 0014, so
   * the browser sees https). Set false ONLY for a local-http run, else the browser
   * silently drops the cookie over plain http and login 200s then every next request
   * 401s (RESEARCH Pitfall 2). Only meaningful with {@link operatorPassword}.
   */
  operatorCookieSecure?: boolean;
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
  /**
   * This service's runtime settings holder (SVC-04, D-08/D-12): the in-memory, env-seeded
   * configuration the operator console edits. Exposed so a harness can observe or drive a
   * runtime change (pause, rename) without going through an HTTP route, exactly as
   * {@link runner} and {@link transport} are exposed for the protocol.
   */
  readonly settings: RuntimeSettings;
  /** Start listening. Pass port 0 (default) for an ephemeral port. */
  start(port?: number, host?: string): Promise<StartedService>;
  /** Stop the runner, transport, and HTTP server. */
  stop(): Promise<void>;
}

/**
 * Upper bound on the per-cohort side-tables this module keeps outside the runner (review WR-02).
 * Mirrors the 24-entry bound every other per-cohort map in this phase uses (`monitor.ts`
 * `MAX_MONITORED` / `MAX_TERMINAL`, `operator-cohorts.ts` `MAX_TERMINAL`, `anchor-state.ts`), so
 * a long-lived self-hosted service cannot grow them without limit under an operator-triggerable
 * action (T-04-01-02 / T-04-02-03 DoS). The tables are also pruned on both terminal paths; this
 * cap is the backstop for a cohort that reaches neither (a service stopped mid-cohort).
 */
const MAX_PER_COHORT_ENTRIES = 24;

/**
 * Insert into a per-cohort side-table, evicting oldest-first past {@link MAX_PER_COHORT_ENTRIES}.
 * Mirrors the `remember` delete-then-set idiom of {@link file://./anchor-state.ts}: the delete
 * moves a progressing cohort's key to the end of the insertion order, so an in-flight cohort is
 * never the entry evicted.
 */
function rememberBounded<V>(map: Map<string, V>, cohortId: string, value: V): void {
  map.delete(cohortId);
  map.set(cohortId, value);
  while (map.size > MAX_PER_COHORT_ENTRIES) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    map.delete(oldest);
  }
}

/**
 * Derive a block-explorer URL for a beacon ADDRESS from the network's txid explorer template
 * (D-36 funding stage "View on explorer" link). {@link NetworkConfig} exposes only
 * `explorerTxUrl(txid)` (`.../tx/{txid}`); every mempool-style explorer this app targets uses the
 * sibling `.../address/{address}` path, so swap the trailing `/tx/<sentinel>` for `/address/<addr>`.
 * Returns undefined for the offline network (whose `explorerTxUrl` yields an empty string) so the
 * funding stage simply omits the link rather than rendering a dead one.
 */
function addressExplorerUrl(netConfig: NetworkConfig, address: string): string | undefined {
  try {
    const txUrl = netConfig.explorerTxUrl('SENTINEL');
    if (!txUrl) {
      return undefined;
    }
    const base = txUrl.replace(/\/tx\/SENTINEL$/, '');
    // If the template did not end in the expected /tx/<sentinel> shape, do not guess an address URL.
    if (base === txUrl) {
      return undefined;
    }
    return `${base}/address/${address}`;
  } catch {
    return undefined;
  }
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

  // Per-service RUNTIME SETTINGS (SVC-04, D-08/D-12/D-16), constructed alongside the closures
  // above and for the same reason: never a module singleton, so two services in one process
  // cannot share configuration (one service's pause must never drain another's advertising).
  // Seeded ENTIRELY from this call's options - which `demo-server.ts` resolved from the
  // environment - so there is no second env-resolution path and no new env var here. It backs
  // the advertising pause gate, the `paused` bit on the public status read, and the per-request
  // service name on `GET /v1/config`; later plans populate the remaining fields' consumers.
  const runtimeSettings = createRuntimeSettings({
    serviceName: opts.serviceName,
    defaultBeaconType: opts.config.beaconType as BeaconType,
    defaultSize: opts.config.minParticipants,
    defaultThreshold: opts.config.fallbackThreshold,
    defaultDiscoveryWindowMs: opts.cohortTtlMs,
    defaultFundingWindowMs: opts.fundingWindowMs,
  });

  // Operator authentication (HOST-01, ADR 0015), constructed per-createService like the
  // closures above (never a module singleton, so two services in one test process never
  // share sessions) and ONLY when a password is configured. Absent, no operatorAuth is
  // threaded into createHonoApp and the entire operator surface stays unmounted
  // (fail-closed, D-07). Default TTL 24h; Secure cookie defaults on (TLS at the proxy).
  const operatorSessionTtlMs = opts.operatorSessionTtlMs ?? 24 * 60 * 60 * 1000;
  const operatorAuth = opts.operatorPassword
    ? {
        sessions: createSessionStore(operatorSessionTtlMs),
        // ASVS V2 belt-and-suspenders (A5): bound brute-force against a weak password
        // without a lockout that could self-DoS the operator. 10 attempts / 5 min.
        throttle: createLoginThrottle({ maxAttempts: 10, windowMs: 5 * 60 * 1000 }),
        expectedPassword: opts.operatorPassword,
        cookieSecure: opts.operatorCookieSecure ?? true,
        sessionTtlMs: operatorSessionTtlMs,
      }
    : undefined;

  // Build the transport options as a TYPED value (never a conditionally-spread literal): a
  // spread element evades excess-property checking, so a library rename of an option (e.g.
  // `advertTtlMs`) would silently degrade to the library default with everything still
  // compiling. Explicitly-typed property assignments below fail `tsc` the moment the
  // library's `HttpServerTransportConfig` drops or renames a field.
  const transportConfig: HttpServerTransportConfig = {
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
  };
  // Bound the opt-in body before the genesis hash check (default 64 KiB); passed
  // through only when set so the transport default otherwise applies.
  if (opts.maxBodyBytes !== undefined) {
    transportConfig.maxBodyBytes = opts.maxBodyBytes;
  }
  // Equalize the advert SSE replay window with the directory discovery window
  // (SVC-JOIN-1). The library default is 5 min, but a cohort stays joinable in the
  // public directory for the full cohortTtl (demo default 30 min) and no
  // auto-republish loop re-emits the advert (D-17), so a late-connecting second
  // participant would otherwise never receive the advert and hang at "connecting".
  // Default to cohortTtlMs; honor an explicit advertTtlMs override. Threaded ONLY
  // when finite and positive: a malformed env (NaN via a bare Number()) or an
  // explicit 0 would otherwise flow into the transport and silently disable advert
  // replay entirely (the expiry comparison against NaN is always false), which is
  // strictly worse than the 5-minute library default this guard falls back to.
  const advertTtlMs = opts.advertTtlMs ?? opts.cohortTtlMs;
  if (advertTtlMs !== undefined && Number.isFinite(advertTtlMs) && advertTtlMs > 0) {
    transportConfig.advertTtlMs = advertTtlMs;
  }
  const transport = new HttpServerTransport(transportConfig);
  transport.registerActor(did, keys);

  // Resolve the opt-in LIVE beacon-tx config. Off by default (the fixture path
  // keeps the gate chain-free). When on, a BitcoinConnection is required and a
  // mainnet target must be explicitly allowed (real-funds guard). The scure
  // network params come from the shared registry (single source of truth) so
  // address decoding matches everywhere.
  // Advertise timestamps per cohort, for the funding wait's remaining-TTL clamp (D-38). The
  // library's `cohortTtlMs` is armed at advertise and never reset, so the wait must subtract the
  // already-elapsed time; `cohort-advertised` is the earliest per-cohort signal we can stamp.
  //
  // BOUNDED at {@link MAX_PER_COHORT_ENTRIES} with oldest-first eviction, and pruned on both
  // terminal paths (review WR-02): one entry per advertise, never deleted, was unbounded growth
  // driven by an operator-triggerable action on a long-lived self-hosted service (T-04-01-02).
  const advertisedAt = new Map<string, number>();

  /**
   * Aborted by `stop()` (review WR-03). The AUTHORITATIVE funding wait in `tx.ts` runs inside the
   * in-flight `onProvideTxData` promise, which `stop()` can only abandon, not cancel - so without
   * this signal a stopped service kept polling esplora for the rest of the funding window. The
   * operator DISPLAY watches already had this via their own handles; this gives the wait parity.
   */
  const stopController = new AbortController();

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
      // Funding wait (D-38): threaded only when a window is configured (the live+broadcast product
      // path). Without it the live branch keeps its single-shot pre-flight, unchanged.
      fundingWindowMs: opts.fundingWindowMs,
      fundingPollIntervalMs: opts.fundingPollIntervalMs,
      remainingCohortTtlMs:
        opts.cohortTtlMs !== undefined
          ? (cohortId: string): number | undefined => {
              const at = advertisedAt.get(cohortId);
              return at === undefined ? undefined : opts.cohortTtlMs! - (Date.now() - at);
            }
          : undefined,
      // Cancel the wait on `service.stop()` (review WR-03), mirroring the display watches.
      signal: stopController.signal,
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
    // ADR 042 k-of-n script-path fallback on a SIGNING-phase stall (F1c). Undefined
    // => the library default (off), so the optimistic n-of-n key path stays the
    // primary spend and existing callers are unchanged; the demo server threads
    // `true` so the self-hosted product recovers liveness instead of hard-failing a
    // cohort when one co-signer drops mid-round.
    autoFallbackOnStall: opts.autoFallbackOnStall,
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

  // Retained anchor state for the PUBLIC `GET /v1/anchor/:cohortId` read (PART-04,
  // D-20/D-21). Constructed ONLY when a broadcaster exists (a broadcasting service),
  // so its `enabled` bit is mode-honest: a hermetic/non-broadcasting service passes
  // `undefined`, the route stays mounted, and every read is `{ enabled: false, state:
  // 'none' }`. `netConfig` is present here because a broadcaster implies live (guarded
  // above), so the explorer URL derives from the resolved live network.
  const anchorState = broadcaster ? createAnchorState(broadcaster, netConfig) : undefined;

  // Per-service cohort monitoring fold (SVC-03, D-19). Constructed unconditionally right
  // after the runner + broadcaster: it subscribes to the runner's membership + lifecycle
  // events on construction and is mode-agnostic (the fixture path folds members/seats +
  // the ended taxonomy exactly like a live one). The optional `broadcaster` (present only
  // when broadcasting) is threaded so a beacon-tx broadcast that fails after a successful
  // co-sign refines the cohort's fate to `failed` on the operator's summary chips (D-18).
  // It is threaded into createHonoApp, but the gated reads it backs mount ONLY inside the
  // operatorAuth block, so a fail-closed boot exposes no monitoring surface even though the
  // fold still runs harmlessly. Fire-and-forget by construction: its listeners catch their
  // own errors so a monitoring failure never disturbs the protocol (matching the
  // persist/broadcast listeners above). The `anchorState` is threaded so the gated per-cohort
  // detail composes the operator anchor view from the SAME projection the public read serves
  // (byte-untouched, D-18/D-26); a hermetic service passes undefined and the detail reads the
  // mode-honest `{ enabled: false, state: 'none' }`.
  // The resolved broadcast mode (D-17) for the operator health strip: a broadcaster present
  // means the service broadcasts on-chain (`live`); a live esplora path built but not
  // broadcasting is the `live-no-broadcast` middle mode; else the hermetic fixture path. Passed
  // so the monitor reports mode + esplora reachability honestly (04-06 wires the strip + the
  // funding watch's `noteEsploraObservation`).
  const mode: ServiceMode = broadcaster ? 'live' : live ? 'live-no-broadcast' : 'hermetic';
  const monitor = createCohortMonitor(runner, broadcaster, anchorState, mode);

  // Stamp each cohort's advertise time so the funding wait's remaining-TTL clamp is honest (D-38).
  // Registered unconditionally (cheap, harmless off the live path); consumed only by the live
  // config's `remainingCohortTtlMs` closure and the funding watch's truncated-window disclosure.
  runner.on('cohort-advertised', ({ cohortId }) => {
    if (!advertisedAt.has(cohortId)) {
      rememberBounded(advertisedAt, cohortId, Date.now());
    }
  });

  // Live-path funding watch (LIVE-01, D-36 through D-44). ONLY on the broadcasting path: the
  // funding stage cannot exist without a real on-chain beacon (a hermetic/live-no-broadcast cohort
  // never funds a beacon). At `keygen-complete` the beacon address is known, so start a WATCH-ONLY
  // poll that feeds the monitor's funding view (the gated detail read) + the `needs-funding`
  // attention chip. This display watch is separate from the AUTHORITATIVE wait that gates signing
  // in tx.ts (onProvideTxData); both share classifyFunding + the suggested minimum so they agree.
  //
  // Bounded + pruned on both terminal paths like {@link advertisedAt} (review WR-02): a cohort
  // that SUCCEEDS used to leave its retired handle in this map forever (only `cohort-failed`
  // deleted), so a service that anchored many cohorts grew it without limit.
  const fundingWatches = new Map<string, FundingWatchHandle>();
  // The last funding view reported per cohort, so `cohort-failed` can compose the terminal lapse
  // outcome (window-closed vs blind-lapse) from the last-known funding state (D-38/D-39). Written
  // on every watch tick and, before review WR-02, deleted on NO path at all: bounded + pruned the
  // same way. Each entry retains a FundingView (beacon address, explorer URL, flags).
  const lastFundingView = new Map<string, FundingView>();

  /**
   * Release every per-cohort side-table entry for a settled cohort (review WR-02). Called from
   * THREE terminal paths now - `signing-complete` (success), `cohort-failed`, and the operator
   * CANCEL action (via the `onCancel` hook threaded into `createOperatorCohorts`) - because a
   * cohort leaves the runner's live set on all three, and nothing else ever removed these
   * entries. Stopping the watch here is idempotent (the display watch retires itself at
   * `funded`).
   *
   * For cancel this IS the funding-watch retirement (SVC-04): without it a canceled cohort's
   * watch would keep polling esplora for a beacon address nobody will ever fund, and the
   * anonymous `GET /v1/funding/:cohortId` read would keep claiming the cohort awaits funding
   * (the monitor pairs this with its own canceled guard, closing the WR-01 failure mode).
   */
  function releaseCohortTables(cohortId: string): void {
    fundingWatches.get(cohortId)?.stop();
    fundingWatches.delete(cohortId);
    lastFundingView.delete(cohortId);
    advertisedAt.delete(cohortId);
  }

  // Success path: a cohort that anchors settles here and never fires `cohort-failed`, so without
  // this listener its side-table entries were retained for the life of the process. Registered
  // unconditionally (cheap, and `advertisedAt` is populated on the hermetic path too).
  runner.on('signing-complete', ({ cohortId }) => {
    releaseCohortTables(cohortId);
  });
  if (opts.broadcast && live && netConfig) {
    const netConf = netConfig;
    const liveConf = live;
    const suggestedMinSats = computeSuggestedMinSats();
    // The always-shown recovery-key disclosure (D-40) + the mainnet real-money/change-routing bits
    // (D-42), fixed for every cohort of this service. The recovery-key VALUE is never carried, only
    // the STATE (T-04-06-04).
    const recoveryKeyState: FundingView['recoveryKeyState'] = opts.recoveryKeyOperatorHeld
      ? 'operator-held'
      : 'throwaway';
    const mainnet = netConf.isMainnet;
    const changeAddressRedirected = opts.changeAddress !== undefined;
    runner.on('keygen-complete', ({ cohortId, beaconAddress }) => {
      // One watch per cohort (keygen-complete fires once, but guard against a re-emit).
      if (fundingWatches.has(cohortId)) {
        return;
      }
      // Disclose the truncated window honestly (D-38): compute the same clamp the tx.ts wait uses
      // at this moment (keygen-complete and the wait fire near-simultaneously, so this matches).
      const at = advertisedAt.get(cohortId);
      const remainingTtl =
        opts.cohortTtlMs !== undefined && at !== undefined
          ? opts.cohortTtlMs - (Date.now() - at)
          : undefined;
      const { truncatedWindowMin } = computeFundingDeadline({
        configuredWindowMs: opts.fundingWindowMs,
        remainingTtlMs: remainingTtl,
        slackMs: FUNDING_SLACK_MS,
      });
      const explorerUrl = addressExplorerUrl(netConf, beaconAddress);
      const handle = createFundingWatch({
        bitcoin: liveConf.bitcoin,
        beaconAddress,
        suggestedMinSats,
        pollIntervalMs: opts.fundingPollIntervalMs,
        onState: (fundingState: FundingState, { lastObservationOk }) => {
          const view: FundingView = {
            state: fundingState.state,
            suggestedMinSats,
            beaconAddress,
            ...(explorerUrl ? { explorerUrl } : {}),
            recoveryKeyState,
            mainnet,
            changeAddressRedirected,
            ...(truncatedWindowMin !== undefined ? { truncatedWindowMin } : {}),
            // A failed observation freezes the funding state stale (D-43): the state is the
            // last-known one (the watch does not fabricate), only this bit flips.
            esploraStale: !lastObservationOk,
          };
          rememberBounded(lastFundingView, cohortId, view);
          monitor.noteFunding(cohortId, view);
          // Flip the health strip's esplora bit in step (D-43): a failed funding read is exactly the
          // mid-flight outage that must freeze every cohort stale-honest.
          monitor.noteEsploraObservation(lastObservationOk);
        },
      });
      rememberBounded(fundingWatches, cohortId, handle);
    });

    // A cohort that FAILED without reaching `funded` fails for want of funding (the wait threw): fold
    // the terminal lapse outcome into the funding view so the operator sees an honest window-closed
    // vs blind-lapse verdict (D-38/D-39), then stop the now-pointless watch.
    runner.on('cohort-failed', ({ cohortId }) => {
      const handle = fundingWatches.get(cohortId);
      if (!handle) {
        return;
      }
      const last = lastFundingView.get(cohortId);
      if (last && last.state !== 'funded') {
        // Blind lapse when the last observation failed (an esplora gap spanned the lapse), else a
        // clean window-closed lapse. Mirrors the tx.ts wait's own throw discrimination.
        monitor.noteFunding(cohortId, {
          ...last,
          terminal: last.esploraStale ? 'blind-lapse' : 'window-closed',
        });
      }
      // Release the watch handle AND the side-table entries (review WR-02); the terminal verdict
      // above has already been folded into the monitor, which owns its own bounded retention.
      releaseCohortTables(cohortId);
    });
  }

  // Operator on-demand cohort drafts (SVC-01). Constructed per-createService like the
  // auth closures above, and ONLY when the operator surface is enabled - fail-closed
  // (D-07): no operator password, no cohort routes. The active network is the service's
  // single resolved network (D-10, never a form value); the recovery key rides from the
  // service cohort config so a drafted cohort shares the operator's recovery leaf.
  // The per-service cohort intent registry (SVC-04, RESEARCH Pattern 1). Constructed
  // unconditionally alongside the other closure-scoped state (never a module singleton), so
  // every app-side actor that ends a cohort declares WHY before calling the silent
  // `runner.stopCohort`, and the fate consumers read that declaration instead of guessing from
  // an error message. See {@link file://./cohort-intent.ts}.
  const intents = createCohortIntents();

  const operatorCohorts = operatorAuth
    ? createOperatorCohorts({
        // The live runner: advertiseDraft is the sole `advertiseCohort` caller (D-17)
        // and directory/status read `runner.session.cohorts` as the source of truth (D-15).
        runner,
        activeNetwork: resolveNetwork(opts.config.network).name,
        recoveryKey: opts.config.recoveryKey,
        // Thread the service's stall-fallback setting so validateDraft can gate the
        // Decision-4 over-promise guard (a k < size draft needs the fallback, G-02-1).
        autoFallbackOnStall: opts.autoFallbackOnStall,
        // The intent registry the cancel action declares into before stopping a cohort.
        intents,
        // Cancel's event-time side effects, run BEFORE `runner.stopCohort` while the cohort is
        // still live: capture the canceled fate in the monitoring fold (D-23 - the runner emits
        // NOTHING for a stop, so this push seam is the only record the operator would ever see),
        // then release the per-cohort side tables, which is exactly the funding-watch retirement
        // a canceled cohort needs.
        onCancel: (cohortId: string) => {
          monitor.noteCanceled(cohortId);
          releaseCohortTables(cohortId);
        },
        // Finalize's event-time side effect (SVC-04, D-01). The runner emits `'fallback-started'`
        // for BOTH the operator's Finalize now and its own automatic stall timer, so this hook is
        // the only thing that can tell the operator which one happened. Nothing else is released
        // here: unlike a cancel, a finalized cohort is still very much alive and is about to
        // anchor, so its funding watch and side tables must keep running.
        onFinalize: (cohortId: string) => {
          monitor.noteOperatorAction(cohortId, OPERATOR_FINALIZED_TEXT);
        },
        // Advert-slot repair (RESEARCH Pattern 3). The transport holds ONE advert slot and the
        // runner clears it whenever the slot-owning cohort is disposed, so without this a
        // settle silently un-advertises every still-open sibling cohort. Built from the same
        // transport + identity the runner itself publishes with, so the re-published advert is
        // byte-equivalent to the one `AggregationService.advertise` produced.
        republishAdvert: createAdvertRepublisher({ transport, did, keys }),
      })
    : undefined;

  const app = createHonoApp(transport, {
    webDistDir: opts.webDistDir,
    store: opts.store,
    // The always-present network name served on `GET /v1/config` so the browser
    // derives its addresses/DIDs at runtime. Sourced from the cohort config (the
    // single source of truth for this coordinator's chain) and validated by
    // resolveNetwork, independent of the live/broadcast path.
    networkName: resolveNetwork(opts.config.network).name,
    // Optional service display name (D-51), surfaced additively on GET /v1/config for the
    // health strip + public directory header. Undefined leaves the config DTO byte-identical.
    // Threaded still, as the fallback for the (test-only) shape where no holder is wired.
    serviceName: opts.serviceName,
    // The runtime settings holder (SVC-04): the per-request source of the served service name
    // (D-16) and the state behind the gated pause/resume routes.
    runtimeSettings,
    // The read-only resolve route is independent of the live/broadcast path: a
    // Bitcoin connection alone (to run the beacon-signal indexer) plus the artifact
    // store is enough to serve `GET /resolve/:did`. Passed whenever a connection is
    // injected, so an operator can offer resolution without broadcasting.
    bitcoin: opts.bitcoin,
    ipfs: opts.ipfs,
    // Threaded only when a password is configured; undefined leaves the operator
    // surface unmounted (fail-closed, D-07).
    operatorAuth,
    operatorCohorts,
    // Present only when the service broadcasts (mode honesty); the public anchor read
    // is mounted either way (fail-open) and does not weaken the operator gating.
    anchorState,
    // The monitoring fold backing the gated per-cohort detail read (SVC-03). Always
    // threaded; the route only mounts inside the operatorAuth block, so it stays
    // operator-only (D-26).
    monitor,
  });
  let server: ServerType | undefined;

  return {
    runner,
    transport,
    broadcaster,
    settings: runtimeSettings,
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
      // Abort any in-flight confirmation poll + funding watch poll before tearing down the runner.
      broadcastHandle?.stop();
      for (const handle of fundingWatches.values()) {
        handle.stop();
      }
      // ...and the AUTHORITATIVE funding wait inside onProvideTxData (review WR-03), which the
      // runner teardown below can only abandon: without this it kept hitting esplora for the rest
      // of the funding window on a service that had already stopped.
      stopController.abort();
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
