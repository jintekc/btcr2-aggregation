import { create } from 'zustand';
import {
  createParticipant,
  type Participant,
  type SubmittedUpdate,
} from '@btcr2-aggregation/participant';
import {
  buildPublishPlan,
  buildSingletonRegistrationTx,
  createExternalIdentity,
  createIdentity,
  DEFAULT_NETWORK,
  exportRegistrationPsbt,
  genesisP2trBeaconAddress,
  hasBakedAggregateBeacon,
  identitySecretHex,
  importExternalIdentity,
  importIdentity,
  isExternalIdentity,
  MIN_REGISTRATION_FUNDING_SATS,
  psbtBase64ToBytes,
  psbtBytesToBase64,
  REGISTRATION_FEE_SATS,
  resolveNetwork,
  updateHashBytes,
  updateHashHex,
  type Identity,
  type IdType,
  type NetworkName,
  type PublishableArtifactKind,
} from '@btcr2-aggregation/shared';
import { fetchStatus, type ServiceStatus } from '../lib/directory';
import { fetchAnchor, type AnchorDTO } from '../lib/anchor';
import { fetchFunding } from '../lib/funding';
import { fetchCohortFate } from '../lib/cohort-fate';
import { elapsed } from '../lib/clock';
import { fetchNetworkConfig } from '../lib/config';
import { fetchDirectory, type DirectoryCohortDTO } from '../lib/operator';
import { fetchIpfsInfo, requestPin, type IpfsInfoDTO } from '../lib/ipfs';
import type { BrowserIpfsNode } from '../lib/ipfs-node';
import {
  findAppendedBeacon,
  resolveDid,
  ResolveError,
  type ResolveResponse,
} from '../lib/resolve';
import { buildSidecar, didSlug, downloadJson, type Sidecar } from '../lib/sidecar';
import {
  broadcastTx,
  fetchUtxos,
  TxProxyError,
  type ChainEndpoint,
  type Utxo,
} from '../lib/tx-client';
import { checkEndpoint, confirmTxAt, type EndpointVerdict } from '../lib/esplora';
import { validateSignedPsbt, type PsbtVerdict } from '../lib/psbt';
import type { LogEntry, LogLevel, StepKey, StepStatus } from '../lib/types';

/** Connection lifecycle of the in-browser participant. */
export type ParticipantStatus = 'no-identity' | 'ready' | 'connecting' | 'live' | 'complete' | 'failed';

/** Lifecycle of the LIVE first-update singleton-beacon registration. */
export type RegistrationStatus =
  | 'idle'
  | 'checking'
  | 'awaiting-funds'
  | 'broadcasting'
  | 'registered'
  | 'failed';

/**
 * Where the registration transaction gets signed (PART-06, D-21).
 *
 * `browser` is the shipped path and stays the default, so a participant who never opens the
 * chooser sees exactly the flow that shipped. `wallet` hands the transaction out as an unsigned
 * PSBT and takes a signed one back, so the participant's key never enters this page.
 *
 * This covers the REGISTRATION transaction only. The cohort's n-of-n MuSig2 co-signing round
 * still signs in this browser: `@did-btcr2/aggregation@0.4.0` hard-wires its own key-pair signer
 * and materializes the raw scalar synchronously, so no external signer can be reached through it.
 * That limit is stated in the UI rather than left for a participant to discover.
 */
export type SigningMethod = 'browser' | 'wallet';

/** Lifecycle of a server-driven DID resolution. */
export type ResolutionStatus = 'idle' | 'resolving' | 'resolved' | 'failed';

/** Lifecycle of the opt-in IPFS publish (ADR 0011). */
export type IpfsPublishStatus = 'idle' | 'publishing' | 'published' | 'failed';

/** One published artifact row: the plan entry merged with the coordinator's pin outcome. */
export interface IpfsPublishRow {
  kind: PublishableArtifactKind;
  label: string;
  hashHex: string;
  cid: string;
  /** True once the coordinator pinned the block. */
  pinned: boolean;
  /** Coordinator-side source: 'store' | 'network' | 'local' | 'already-pinned'. */
  source?: string;
  error?: string;
}

/**
 * Load state of the runtime network config (`GET /v1/config`). Identity generation
 * is gated until this is 'ready' so a DID/address is never minted on the wrong chain
 * during the (brief, same-origin) config fetch. A fetch failure degrades to 'ready'
 * on the {@link DEFAULT_NETWORK} default so an older coordinator without the endpoint
 * still works.
 */
export type ConfigStatus = 'loading' | 'ready';

/** What the attendee keeps after their update is included in a cohort. */
export interface ParticipantResult {
  cohortId: string;
  beaconAddress: string;
  beaconType: string;
  included: boolean;
  /** Number of entries in the CAS announcement map (CAS beacons only). */
  announcementEntries: number;
  /**
   * Hex canonical hash of this participant's signed update: the value carried in
   * the registration OP_RETURN and the key the aggregator stores the body under.
   * Null when the participant declined (non-inclusion) so there is no update.
   */
  updateHashHex: string | null;
}

interface ParticipantState {
  identity: Identity | null;
  did: string | null;
  /**
   * The coordinator's Bitcoin network, fetched at runtime from `GET /v1/config`
   * (defaults to {@link DEFAULT_NETWORK} until loaded). Every in-browser address /
   * DID derivation reads this, so the SPA tracks whatever chain the coordinator
   * targets instead of a build-time constant.
   */
  network: NetworkName;
  /**
   * Optional operator-supplied service display name (D-51), read from `GET /v1/config` on load.
   * Null until the config lands or when the operator set no `SERVICE_NAME`. Surfaced on both the
   * operator console health strip and the public directory header; there is no edit surface.
   */
  serviceName: string | null;
  /**
   * The last SERVED public service status (`GET /v1/status`), or `undefined` when no read has
   * landed yet AND after a failed read (SVC-04, Phase 5 D-07). It carries the open-cohort count
   * the service-identity header renders and the advertising `paused` bit the public directory's
   * notice derives from.
   *
   * `undefined` is deliberately load-bearing: it means UNKNOWN, never "not paused". A paused claim
   * is only ever made from a bit this service actually reported, never from an empty directory, a
   * stale snapshot, or a client-side guess (T-05-05-01). Read with `credentials: 'omit'`, so the
   * anonymous surface never sends the operator session cookie.
   */
  publicStatus?: ServiceStatus;
  /**
   * The participant's OWN esplora endpoint, once one has been supplied AND accepted by
   * the chain guard (PART-05, D-20). `null` means the shipped same-origin proxy, which
   * is the zero-config default and needs no setup (ADR 0003).
   *
   * A refused endpoint never lands here: it leaves {@link chainEndpointVerdict} holding
   * its specific reason and this field untouched, so "an endpoint is active" and "an
   * endpoint was typed" can never be confused for one another.
   */
  chainEndpoint: string | null;
  /**
   * The last verdict on a supplied endpoint, or `null` before any has been tried. Its
   * four failure members stay four all the way to the copy: a participant deciding what
   * to do next needs to know whether the endpoint refused their browser, answered about
   * another chain, could not be reached, or was not a URL.
   */
  chainEndpointVerdict: EndpointVerdict | null;
  /** True while the chain probe is in flight; the field disables and no claim is made yet. */
  chainEndpointProbing: boolean;
  /**
   * The opt-in WITHIN the opt-in (D-20): send the registration transaction to the
   * participant's endpoint rather than relaying it through the service. Off by default,
   * and it cannot be on without {@link chainEndpoint}, because a mis-set endpoint must
   * never be able to silently swallow a real transaction.
   */
  broadcastDirect: boolean;
  /**
   * Whether the participant's OWN endpoint sees the beacon transaction in a block, or
   * `null` when no independent check has run. This is an ADDITIONAL confirmation of a
   * txid the service reported, never a replacement for the service's anchor read: that
   * read is keyed by COHORT id, and an esplora endpoint has no notion of a cohort.
   */
  endpointTxConfirmed: boolean | null;
  /** Load state of the runtime network config; gates identity generation. */
  configStatus: ConfigStatus;
  /** Onboarding model of the current identity: KEY (`k1`) or EXTERNAL (`x1`). */
  idType: IdType;
  /** Hex secret for the current identity (so the attendee can save/re-import it). */
  secret: string | null;
  status: ParticipantStatus;
  steps: Record<StepKey, StepStatus>;
  cohortId: string | null;
  beaconAddress: string | null;
  /**
   * True once the picked cohort formed with us in it (the `cohort-ready` seat, D-11).
   * Flips true ONLY in the cohort-ready handler; `cohort-joined` (opt-in sent, not
   * accepted) does not set it. The directory poll drives the negative before this is
   * ever true.
   */
  seated: boolean;
  /**
   * True once we have OPTED IN to the picked cohort (the `cohort-joined` event: opt-in
   * SENT, not yet a granted seat). Distinguishes the two directory-poll outcomes (CR-01):
   * before opt-in, the picked cohort leaving Advertised means we missed it (fail now);
   * after opt-in, it is ambiguous (forming with us vs. filled without us), so the poll
   * ARMS the bounded join-grace timer on the first observed departure (rather than the
   * poll itself owning the outcome), and a real member is never torn down mid-keygen.
   * While opted in and the picked cohort is still Advertised, we wait as long as it
   * stays open. Reset wherever `seated`/`joinClosed` reset.
   */
  optedIn: boolean;
  /**
   * True when the picked cohort filled or closed before we were seated (D-06/D-12): a
   * distinct terminal cause from an ordinary failure or an unreachable service.
   */
  joinClosed: boolean;
  /**
   * While opted in and the picked cohort is still Advertised, the latest polled
   * joined / capacity for the picked row, so the join flow can render a truthful
   * `Waiting for the cohort to fill ({joined}/{capacity} seats)` line instead of a
   * bare, indefinite `Joining...`. Null when not awaiting a seat (never opted in,
   * seated, or after any terminal / reset). Carries only counts already public in
   * the directory row, no DIDs or keys.
   */
  awaitingSeats: { joined: number; capacity: number } | null;
  /** The cohort id the participant picked to join (browse-and-pick, D-14); null when idle. */
  pickedCohortId: string | null;
  /**
   * True while the explicit-submit window is open (PART-03, D-12): the runner has asked
   * this participant to provide its update and is awaiting the user's click. A
   * serializable projection of the module-scope `pendingSubmit` deferred (the built body
   * + its resolver live at module scope, like `live`/`captured`). `deriveStage` reads
   * this flag to enter the `submit-window` stage. Set true by the `onSubmitGate` passed
   * into `createParticipant`; cleared (false) by `submitUpdate()` on the user's click and
   * by every teardown path - the teardown clears WITHOUT settling the deferred (Pitfall 2).
   */
  pendingSubmit: boolean;
  /**
   * Last-known anchor state for the joined cohort (PART-04, D-20/D-22), fetched by the
   * epoch-guarded post-sign anchor poll from the PUBLIC `GET /v1/anchor/:cohortId`. Null
   * until the first read. `enabled: false` is the hermetic (no-broadcast) mode bit that
   * keeps the timeline mode-honest (D-07): signed/complete, never a claimed on-chain anchor.
   */
  anchor: AnchorDTO | null;
  /**
   * True when consecutive anchor-poll (or post-seat directory-poll) reads fail past a
   * small threshold (D-24, closes 02-09 WR-02): a distinct "can't reach this service"
   * signal with quiet auto-retry. NEVER a terminal by itself - stages freeze and a
   * success clears it; a terminal failure lands only via a runner error or a cohort-gone
   * reconnect (D-25).
   */
  unreachable: boolean;
  /**
   * True once we learned the picked cohort is a LIVE (on-chain) cohort that anchors its
   * beacon on Bitcoin (D-44), latched from the first `awaitingFunding` funding-signal read.
   * Drives the join-time "this cohort anchors on-chain; the operator funds its beacon address
   * after seats fill" notice. Never set on a hermetic (no-broadcast) cohort - the public
   * funding read returns `awaitingFunding: false` there, so neither this nor the waiting copy
   * ever surfaces. A per-round fact (reset on adopt/join/leave/start-over via INITIAL_OUTCOME).
   */
  liveCohort: boolean;
  /**
   * True while the picked live cohort is still awaiting its operator's beacon funding (D-44),
   * polled post-seat from the PUBLIC `GET /v1/funding/:cohortId` non-oracle read. Drives the
   * honest "Waiting for the operator to fund this cohort's beacon address." wait copy. Clears
   * to false the moment the funding read reports the beacon funded (or on any teardown). Carries
   * no amount, key, or address - only the single waiting bit the public read exposes.
   */
  awaitingFunding: boolean;
  /**
   * True once this participant observed the runner's `validation-requested` event (D-45): the
   * service asked members to validate the aggregated data, which fires ONLY after it has
   * collected ALL updates. That makes its presence the positive discriminator for the stall copy:
   * a signing-window death with the update submitted but this fact NEVER recorded is a genuine
   * "stalled collecting updates"; a death AFTER it fired is an unexplained co-signing failure, not
   * a collection stall. Read by {@link terminalReason}. A per-round fact (reset via INITIAL_OUTCOME).
   */
  validationRequested: boolean;
  /**
   * True once the SERVICE itself reported that this cohort was canceled by its operator (SVC-04,
   * D-02), read ONCE from the public `GET /v1/cohort-fate/:id` after the post-seat gone streak
   * has already declared the cohort dead. It upgrades the honest terminal fallback into a
   * specific attribution and changes no timing whatsoever.
   *
   * Stays false when the read is unreachable or reports false, so an unreachable service can
   * never fabricate an accusation against an operator (T-05-10-04). A per-round fact (reset via
   * INITIAL_OUTCOME).
   */
  canceled: boolean;
  /**
   * True once this participant observed the runner's `fallback-requested` event (D-23):
   * the n-of-n key-path stalled and the cohort co-signed the ADR-042 k-of-n script-path
   * fallback instead. Drives the explicit k-of-n fallback completion outcome; reset per round.
   */
  fallbackObserved: boolean;
  /**
   * The cooperative non-inclusion reason (D-10), captured from the participant at
   * cohort-complete when this DID declined to submit (a baked beacon-type mismatch). Null
   * when the update was included. A NON-error outcome: the cohort still anchored around us.
   */
  nonInclusionReason: string | null;
  /**
   * The picked cohort's co-sign shape, threaded in from the directory row at join (D-23):
   * `cohortThreshold` = k (the ADR-042 signing floor), `cohortCapacity` = n (the seat count).
   * Null until a join carries them; used only by the k-of-n fallback outcome copy.
   */
  cohortThreshold: number | null;
  cohortCapacity: number | null;
  result: ParticipantResult | null;
  /** The controller's downloadable, sovereign resolution sidecar (once included). */
  sidecar: Sidecar | null;
  error: string | null;
  log: LogEntry[];

  /** The controller's genesis P2TR SingletonBeacon address to fund for registration. */
  beaconRegAddress: string | null;
  regStatus: RegistrationStatus;
  regTxid: string | null;
  regError: string | null;

  /**
   * The external-signer round trip for the registration transaction (PART-06, D-21).
   *
   * EVERY field below is EPHEMERAL by construction. Nothing here is written to local storage,
   * session storage or IndexedDB, and all of it is cleared on every teardown path (it lives in
   * {@link INITIAL_OUTCOME}), which is what makes the panel's "nothing from this step is saved"
   * warning a fact about the code rather than a promise about intent (T-05-12-02). A pasted PSBT
   * is untrusted third-party input and a participant's own transaction; neither belongs in
   * durable browser storage.
   */
  signingMethod: SigningMethod;
  /** The unsigned PSBT handed out, standard base64. Null until the wallet path exports one. */
  psbtBase64: string | null;
  /**
   * The witness-free unsigned transaction bytes of that export, hex. The ONLY thing a returned
   * PSBT is compared against, and the reason a tampered PSBT cannot reach broadcast.
   */
  psbtTemplateHex: string | null;
  /** The base64 the participant pasted or uploaded back. Empty until something comes back. */
  psbtReturned: string;
  /** The verdict on {@link psbtReturned}; null while nothing has been returned. */
  psbtVerdict: PsbtVerdict | null;
  /** True while the unsigned PSBT is being built (it needs a funding read first). */
  psbtExporting: boolean;
  /** Why the export could not be built (no funds yet, or the chain read failed). */
  psbtExportError: string | null;

  resolveStatus: ResolutionStatus;
  resolution: ResolveResponse | null;
  resolveError: string | null;

  /**
   * The coordinator's IPFS publish surface (`GET /v1/ipfs`), probed once
   * alongside the network config. Null until probed; `{ enabled: false }` when
   * the coordinator runs without a pinning node.
   */
  ipfsInfo: IpfsInfoDTO | null;
  ipfsStatus: IpfsPublishStatus;
  /** Per-artifact publish outcomes (once attempted). */
  ipfsResults: IpfsPublishRow[] | null;
  ipfsError: string | null;

  /**
   * Fetch the coordinator's runtime network (`GET /v1/config`) once and adopt it, so
   * in-browser DIDs/addresses target the coordinator's chain. Idempotent-ish: safe to
   * call on mount. Falls back to the current default network (and still flips to
   * 'ready') if the endpoint is unavailable, so generation is never blocked.
   */
  loadConfig(baseUrl: string): Promise<void>;
  /**
   * Read the public `GET /v1/status` once and store it (SVC-04, D-07). On any failure it clears
   * the slice back to `undefined` rather than keeping the last value: a stale snapshot is exactly
   * what must NOT be allowed to keep claiming a service is paused after it stopped answering.
   * Anonymous by construction (`credentials: 'omit'`).
   */
  pollPublicStatus(baseUrl: string): Promise<void>;
  /**
   * Generate a fresh did:btcr2 identity in-browser: a KEY (`k1`) DID, or an EXTERNAL
   * (`x1`) DID with a self-verifying genesis document (default KEY).
   */
  generate(kind?: IdType): void;
  /**
   * Reconstruct an identity of `kind` (default KEY) from a saved 32-byte secret (hex).
   * Returns an error string on failure. An x1 identity re-derives the same genesis (and
   * therefore the same DID) from the secret, mirroring the KEY path.
   */
  importSecret(hex: string, kind?: IdType): string | null;
  /**
   * The one explicit user gate: connect to the service and join the PICKED cohort
   * (browse-and-pick, PART-02/D-14). The chosen `cohortId` is threaded into
   * `createParticipant` so the runner opts into that cohort alone. `sizing` carries the
   * picked directory row's k (threshold) / n (capacity) so the k-of-n fallback outcome
   * copy (D-23) can name them at completion; omitting it is safe (headless callers).
   */
  join(baseUrl: string, cohortId: string, sizing?: { threshold: number; capacity: number }): Promise<void>;
  /**
   * Resolve the open explicit-submit window (PART-03, D-12): the user clicked "Submit
   * my DID update", so settle the module-scope deferred with the exact body that was
   * built when the window opened (the previewed body IS the submitted body, D-29). The
   * runner then records and submits it. Idempotent - a repeated click finds no pending
   * window and is a no-op (mirrors the register()/publishIpfs() re-entrancy guards).
   */
  submitUpdate(): void;
  /**
   * Start the epoch-guarded post-sign anchor poll (PART-04, D-20/D-22) for a joined
   * cohort against the PUBLIC `GET /v1/anchor/:cohortId`. Runs on the ~5s cadence and
   * FREEZES (stops) once the anchor is `confirmed`/`failed` or the service is hermetic
   * (`enabled: false`) - a no-broadcast service is confirmed signed after one read. Drives
   * auto-resolve (D-28) once the stage completes, and raises the D-24 unreachable signal on
   * consecutive read failures WITHOUT going terminal. Called from the cohort-complete handler.
   */
  trackAnchor(baseUrl: string, cohortId: string): void;
  /**
   * Post-seat cohort-gone detection (D-24/D-25), a NEW concern with its OWN predicate that
   * NEVER routes through {@link handleDirectorySnapshot} (Pitfall 6). After seating, a picked
   * cohort absent from the directory entirely (any phase) while the round is still live is a
   * candidate "cohort ended" -> a terminal fail with a best-effort D-25 reason. A row present
   * in a signing phase is normal (D-26 in-flight rows). Driven by the post-seat directory poll.
   *
   * `baseUrl` is OPTIONAL and is used for one thing only: once the gone streak has ALREADY
   * declared the cohort dead, ask the public fate read whether the operator canceled it, and
   * upgrade the terminal copy if so (SVC-04, D-02). Omitting it keeps the inherited behavior
   * byte for byte - the honest fallback, and no network call at all.
   */
  handlePostSeatSnapshot(rows: DirectoryCohortDTO[], baseUrl?: string): void;
  /**
   * Start over from any terminal state (D-10): clear the round record AND erase the
   * in-memory identity (returning to no-identity), tearing down every poll/deferred. The
   * explicit key-custody warning is the UI's (03-06); this store action does the wipe.
   */
  startOver(): void;
  /** Tear down the live participant and return to a fresh-but-identified state. */
  leave(): void;
  /**
   * Feed the latest public directory snapshot to the join lifecycle (D-06/D-12).
   * While awaiting a seat for the picked cohort, a snapshot in which that cohort is
   * no longer Advertised resolves the join to a deterministic "filled or closed"
   * terminal state; once seated it is a no-op. Driven by the join-time directory poll.
   */
  handleDirectorySnapshot(rows: DirectoryCohortDTO[]): void;
  /** Download the resolution sidecar JSON (the artifacts a resolver needs). */
  downloadSidecar(): void;
  /**
   * Opt-in: publish this controller's resolution artifacts to IPFS (ADR 0011).
   * Lazily boots an in-browser Helia node holding the canonical blocks, dials
   * the coordinator's node, and asks it to pin them. Sidecar-download remains
   * the default hand-off; this adds public discoverability (anyone with the
   * on-chain hash - or, for x1, just the DID - can derive the CID and fetch).
   */
  publishIpfs(baseUrl: string): Promise<void>;
  /**
   * LIVE only: check the beacon address for funds and, when funded, build + sign +
   * broadcast the first-update singleton-beacon registration transaction. On
   * mainnet this spends real bitcoin, so it refuses unless the caller passes
   * `acknowledgeMainnet: true` (the RegisterPanel checkbox) - a defense-in-depth
   * gate beneath the UI, driven by the runtime `isMainnet` flag.
   */
  register(baseUrl: string, opts?: { acknowledgeMainnet?: boolean }): Promise<void>;
  /**
   * Choose where the registration transaction gets signed (PART-06). Switching ALWAYS drops any
   * exported or returned PSBT: those are facts about one round trip, and a stale verdict beside a
   * newly chosen path is exactly the kind of leftover that gets acted on by mistake.
   */
  setSigningMethod(method: SigningMethod): void;
  /**
   * Build the unsigned registration PSBT for the participant to sign elsewhere. Reads the funding
   * UTXO through the participant's own chain source when they set one (PART-05), using the SAME
   * selection rule {@link register} uses, so the transaction handed out spends the coin the
   * registration would have spent.
   */
  exportPsbt(baseUrl: string): Promise<void>;
  /**
   * Take a signed PSBT back, as pasted base64 or as the raw bytes of an uploaded `.psbt` file,
   * and judge it against the exact template this page exported. Never throws and never
   * broadcasts: it only produces the verdict the panel renders and the broadcast gate reads.
   */
  submitSignedPsbt(input: string | Uint8Array): void;
  /** Drop the whole round trip (both directions) without touching anything else. */
  clearPsbt(): void;
  /** Resolve this DID via the coordinator (`GET /resolve/:did`) and keep the document. */
  resolve(baseUrl: string): Promise<void>;
  /**
   * Probe `raw` and, only if it is on THIS service's chain, make it the participant's
   * chain-read source (PART-05, D-20). A refused endpoint is not activated and its
   * specific verdict is kept for the copy; nothing about the shipped path changes.
   */
  useChainEndpoint(raw: string): Promise<void>;
  /**
   * The explicit switch back to this service's chain reads. Explicit because the app
   * never decides this on the participant's behalf: they chose a trust source, so
   * leaving it is their act, not a silent recovery from a failed read.
   */
  clearChainEndpoint(): void;
  /** Turn the second (broadcast) opt-in on or off. A no-op without an active endpoint. */
  setBroadcastDirect(on: boolean): void;
}

/**
 * Build the {@link ChainEndpoint} parameter the chain calls take, from the participant's
 * current choice. The ONE place that value is constructed, so there is no second reading
 * of "is the override on" anywhere in the store.
 *
 * `undefined` when no endpoint is active, which is what makes the zero-config path
 * byte-identical to the shipped one rather than merely equivalent to it.
 */
export function chainEndpointFor(state: {
  chainEndpoint: string | null;
  broadcastDirect: boolean;
}): ChainEndpoint | undefined {
  if (!state.chainEndpoint) {
    return undefined;
  }
  return { esploraBase: state.chainEndpoint, broadcastDirect: state.broadcastDirect };
}

// The live participant (transport + runner + event emitters) is intentionally
// kept OUT of reactive state: it is a long-lived object with listeners, not a
// value React should diff. The store holds only the serializable projection.
let live: Participant | null = null;

// The controller's captured first-update artifacts (the signed body + its hash
// bytes + the beacon-specific artifact). Kept at module scope, not in reactive
// state, because the raw bytes/body are inputs to registration, not render values.
// Captured on cohort-complete (before teardown, since the runner never re-emits the
// body and BIP340 signing is non-deterministic).
interface Captured {
  did: string;
  updateHashBytes: Uint8Array;
}
let captured: Captured | null = null;

// The open explicit-submit deferred (PART-03, D-12). Held at module scope (like `live`
// and `captured`), NOT in reactive state: it carries a resolver function and a raw
// signed body, neither of which React should diff. The runner's `onProvideUpdate`
// builds the update EXACTLY ONCE when the window opens (BIP340 signing is
// non-deterministic, so a rebuild would change the canonical hash and break the D-29
// round-trip check), stashes it here with the promise's `resolve`, and awaits. The user
// clicking "Submit my DID update" resolves the deferred with that exact body via
// submitUpdate(); the state carries only the serializable `pendingSubmit: boolean`
// projection. TEARDOWN RULE (Pitfall 2): clearPendingSubmit() drops this WITHOUT
// settling - never resolve it on teardown (a resolve-null would declare an unchosen
// cooperative non-inclusion) and never reject it (a reject inside onProvideUpdate sends
// neither a submit nor a decline and stalls the whole n-of-n cohort). The runner is
// being stopped on every teardown anyway, so the unsettled promise is simply abandoned.
let pendingSubmit: { cohortId: string; update: SubmittedUpdate; resolve: () => void } | null = null;

// Drop the open submit deferred WITHOUT settling it (Pitfall 2). Called from every
// teardown path (leave / fail / re-join / cohort-complete / teardownLive-adjacent).
function clearPendingSubmit(): void {
  pendingSubmit = null;
}

/**
 * The already-built, already-signed update body for the OPEN explicit-submit window
 * (PART-03, D-12), or null when no window is open. An additive, non-reactive read of the
 * module-scope `pendingSubmit` deferred so the SubmitPanel can preview the EXACT body that
 * `submitUpdate()` will submit (the previewed body IS the submitted body, D-29). Not held in
 * reactive state (the raw signed body is not a value React should diff): the serializable
 * `pendingSubmit: boolean` projection drives the SubmitPanel render, and this returns the body
 * that was stashed synchronously in the same callback that flipped that flag true, so reading
 * it during that render is always current. Returns null once the window closes (submit/teardown).
 */
export function pendingSubmitUpdate(): SubmittedUpdate | null {
  return pendingSubmit ? pendingSubmit.update : null;
}

// The in-browser IPFS node (heavy, lazily created on first publish). Module
// scope like `live`: a long-lived object with sockets, not a value React should
// diff. It keeps serving the controller's blocks over bitswap until the round
// resets (leave / new identity / re-join), mirroring teardownLive's symmetry.
let ipfsLive: BrowserIpfsNode | null = null;

// Round token for the async publish flow. publishIpfs spans long awaits (lazy
// chunk load, node boot, a bounded-60s pin request); if the round resets
// mid-flight (leave / re-join / new identity), the stale continuation must not
// write the OLD round's results into the fresh state, resurrect a node the
// teardown already dispatched, or dereference the nulled handle. Every teardown
// bumps the epoch; the flow re-checks it after each await.
let ipfsEpoch = 0;

function teardownIpfs(): void {
  ipfsEpoch += 1;
  if (ipfsLive) {
    ipfsLive.stop().catch(() => {
      // best-effort teardown
    });
    ipfsLive = null;
  }
}

// The join-time directory poll (D-06/D-12): while awaiting a seat for the picked
// cohort, poll the PUBLIC directory (`GET /v1/directory`, the HTTP source of truth
// for every live cohort) every ~5s. A successful poll in which the picked cohort is
// no longer Advertised means it just filled or closed before we were seated - a
// deterministic terminal state. A poll ERROR is ignored so an unreachable service
// never masquerades as a closed cohort. Kept at module scope like `live`: a
// long-lived handle, not a render value. Cleared on seat/complete/fail/leave.
let directoryPoll: ReturnType<typeof setInterval> | null = null;
const DIRECTORY_POLL_MS = 5000;
// Round token for the directory poll's async continuation (mirrors ipfsEpoch). A
// fetchDirectory promise already in flight when the poll is cleared or restarted
// (fail / seat / leave / re-join) would otherwise resolve into the WRONG round:
// handleDirectorySnapshot reads the LIVE pickedCohortId via get(), so a stale snapshot
// taken during round A could falsely fail a legitimate fresh round B join (WR-01).
// clearDirectoryPoll bumps this epoch; the continuation drops any snapshot whose
// captured epoch no longer matches the live one.
let directoryEpoch = 0;

// Join-seat grace window (CR-01). It is armed on the FIRST observed DEPARTURE of the
// picked cohort from the Advertised set (in handleDirectorySnapshot), NOT at opt-in.
// Under the wait-for-n model (02-05: min == max == n, no fillers) an opted-in
// participant whose picked cohort is still Advertised waits as long as it stays
// Advertised - there is no "seat imminent right after opt-in" premise anymore. Only
// once the picked cohort LEAVES Advertised while we are opted-in but unseated is the
// outcome AMBIGUOUS: it may be forming WITH us (cohort-ready imminent, since a cohort
// locks membership at its threshold BEFORE keygen finishes) or filled WITHOUT us. The
// protocol emits no accept/reject signal, so the client cannot distinguish immediately
// and MUST NOT tear down a genuine member mid-keygen (that would drop it from the n-of-n
// MuSig2 round and stall every member). This backstop timer bounds only that genuine
// lock-to-cohort-ready gap: if no cohort-ready lands within the window, the join resolves
// to a deterministic filled-or-closed terminal instead of hanging. The client can never
// hang forever: the cohort's own 30-min discovery window (02-06) bounds the wait
// server-side, and its row-vanish is observed by the poll as exactly such a departure.
// Cleared on seat/complete/fail/leave.
let joinGrace: ReturnType<typeof setTimeout> | null = null;
const JOIN_SEAT_GRACE_MS = 90000;
// One-shot flag so a repeated directory poll (every ~5s) arms the grace and logs the
// "awaiting seat" note at most once per opted-in wait - never re-arming or resetting the
// window out from under itself. Reset whenever the grace window is cleared.
let joinGraceLogged = false;

// The post-sign anchor poll (PART-04, D-20/D-22). Started once a cohort completes; reads
// the PUBLIC anchor state every ~5s until it FREEZES (confirmed/failed, or hermetic
// enabled:false after one read). Module scope like `directoryPoll`: a long-lived handle,
// not a render value. Epoch-guarded so a stale in-flight read from a prior round is dropped
// (WR-01 class). Cleared on leave/fail/re-join/complete-teardown.
let anchorPoll: ReturnType<typeof setInterval> | null = null;
let anchorEpoch = 0;
const ANCHOR_POLL_MS = 5000;
// Consecutive anchor-read failures. Past UNREACHABLE_THRESHOLD the store raises the D-24
// unreachable signal (quiet auto-retry, never a terminal by itself); any success resets it.
let anchorFailures = 0;
const UNREACHABLE_THRESHOLD = 3;
// One-shot per round so auto-resolve (D-28) fires exactly once when the anchor stage
// completes. Reset when a fresh anchor poll starts.
let autoResolved = false;

function clearAnchorPoll(): void {
  if (anchorPoll !== null) {
    clearInterval(anchorPoll);
    anchorPoll = null;
  }
  // Invalidate any fetchAnchor still in flight (mirrors clearDirectoryPoll / WR-01) and
  // reset the failure counter so a new round starts clean.
  anchorEpoch += 1;
  anchorFailures = 0;
}

// The resolver-lag retry (D-28), gated on a LIVE (enabled:true) anchor: on the fixture
// path the resolve answer is immediate and stable, so retries are pointless (Finding 7).
// Module scope + bounded so it never leaks past a teardown.
let resolveLagRetry: ReturnType<typeof setInterval> | null = null;
const RESOLVE_LAG_RETRY_MS = 5000;
const RESOLVE_LAG_MAX_ATTEMPTS = 3;

function clearResolveLagRetry(): void {
  if (resolveLagRetry !== null) {
    clearInterval(resolveLagRetry);
    resolveLagRetry = null;
  }
}

// The post-seat directory poll (D-24/D-25), a NEW concern separate from the pre-seat
// join poll: after seating it watches for the picked cohort vanishing from the directory
// (a stalled/ended cohort goes dark, Finding 2). Its own predicate + epoch; it NEVER
// routes through handleDirectorySnapshot (Pitfall 6). Cleared on complete/fail/leave/re-join.
let postSeatPoll: ReturnType<typeof setInterval> | null = null;
let postSeatEpoch = 0;
const POST_SEAT_POLL_MS = 5000;
// Consecutive post-seat directory-read failures (the only poll running during co-signing).
// Past UNREACHABLE_THRESHOLD it raises the same D-24 unreachable signal; a success resets it.
let postSeatFailures = 0;
// Consecutive post-seat directory-GONE reads (picked cohort absent entirely) required before
// declaring the cohort dead (CR-01, D-24/D-25). A completed cohort legitimately leaves the
// widened directory the instant its phase reaches Complete (operator-cohorts.ts directory()
// drops the row at that transition), and that SAME completion fires the participant's
// cohort-complete SSE on a different channel with no ordering guarantee. Failing on a single
// gone read would false-fail a genuine success when the poll observes the drop before the
// browser processes cohort-complete. Requiring POST_SEAT_GONE_CONFIRMATIONS consecutive gone
// reads gives the racing cohort-complete SSE time to tear the poll down first (cohort-complete
// -> teardownLive -> clearPostSeatPoll bumps postSeatEpoch and resets this streak), so a
// completed cohort's normal directory-drop is never mistaken for a stall. A genuinely dead
// cohort still fails honestly once the bounded streak completes with no intervening completion.
let postSeatGoneStreak = 0;
const POST_SEAT_GONE_CONFIRMATIONS = 2;

// The post-seat funding-signal poll (D-44), a NEW live-path concern separate from every
// other poll: once seated on a live cohort, watch the PUBLIC `GET /v1/funding/:cohortId`
// non-oracle read to learn whether the operator has funded the cohort's beacon address yet,
// so the participant sees honest "waiting for funding" copy instead of a bare co-signing
// spinner. Module scope like the sibling polls: a long-lived handle, not a render value.
// Epoch-guarded (WR-01 class) so a stale in-flight read from a prior round is dropped.
// Cleared on complete/fail/leave/re-join (teardownLive). A fetch error is swallowed (an
// unreachable funding read is never a terminal, and the other polls own the D-24 signal).
let fundingPoll: ReturnType<typeof setInterval> | null = null;
let fundingEpoch = 0;
const FUNDING_POLL_MS = 5000;

function clearFundingPoll(): void {
  if (fundingPoll !== null) {
    clearInterval(fundingPoll);
    fundingPoll = null;
  }
  // Invalidate any fetchFunding still in flight so its stale bit cannot drive the next round.
  fundingEpoch += 1;
}

function clearPostSeatPoll(): void {
  if (postSeatPoll !== null) {
    clearInterval(postSeatPoll);
    postSeatPoll = null;
  }
  postSeatEpoch += 1;
  postSeatFailures = 0;
  // Reset the gone streak so each round (and each completion teardown) starts clean: the
  // cohort-complete -> teardownLive -> clearPostSeatPoll path clears any accumulated streak
  // before the threshold is reached, letting the success completion win the race (CR-01).
  postSeatGoneStreak = 0;
}

/**
 * Stop and forget the live participant. Critical after a cohort completes/fails or
 * closes: under browse-and-pick the runner opts into only the picked cohort, but a
 * still-live runner would keep its SSE streams open and could re-act on a replayed
 * advert for that same cohort id, reusing the participant's key in a signature they
 * never asked for. One cohort per join: tear the runner down at every terminal state.
 */
function teardownLive(): void {
  if (live) {
    try {
      live.stop();
    } catch {
      // best-effort teardown
    }
    live = null;
  }
  // The seat is meaningless without a live runner: tear the grace timer down with it.
  clearJoinGrace();
  // A submit window is meaningless once the runner is gone: drop the deferred WITHOUT
  // settling it (Pitfall 2). The `pendingSubmit: false` state projection is set by the
  // caller's own set() block (leave/fail/join/cohort-complete).
  clearPendingSubmit();
  // The post-seat directory poll and the resolver-lag retry both belong to this round;
  // the anchor poll is (re)started explicitly by trackAnchor after cohort-complete calls
  // teardownLive, so clearing it here is the correct round boundary too.
  clearPostSeatPoll();
  clearResolveLagRetry();
  clearAnchorPoll();
  // The funding-signal poll belongs to this round like the post-seat poll: tear it down at
  // every terminal so a completed/failed round never keeps polling a stale cohort (D-44).
  clearFundingPoll();
}

function clearDirectoryPoll(): void {
  if (directoryPoll !== null) {
    clearInterval(directoryPoll);
    directoryPoll = null;
  }
  // Invalidate any fetchDirectory still in flight so its stale snapshot cannot drive
  // the next round (WR-01). Bumped unconditionally: the interval may have fired and
  // started a fetch that is still pending even after clearInterval.
  directoryEpoch += 1;
}

function clearJoinGrace(): void {
  if (joinGrace !== null) {
    clearTimeout(joinGrace);
    joinGrace = null;
  }
  joinGraceLogged = false;
}

/**
 * Pure browse-and-pick outcome predicate (D-06/D-12): given the latest public
 * directory snapshot, has the picked cohort left the joinable set? A cohort accepts
 * new members ONLY while `phase === 'Advertised'` (it locks membership the instant it
 * reaches its threshold, RESEARCH Finding 3), so the picked cohort is "filled or
 * closed" when no row is both its id AND still Advertised - whether that row advanced
 * phase or vanished entirely. Returns false while it is still present and Advertised.
 */
export function pickedCohortClosed(rows: DirectoryCohortDTO[], pickedId: string): boolean {
  return !rows.some((row) => row.cohortId === pickedId && row.phase === 'Advertised');
}

/**
 * Pure POST-SEAT cohort-gone predicate (D-24/D-25, Pitfall 6). Distinct from
 * {@link pickedCohortClosed}: after seating, a cohort in a signing phase LEGITIMATELY
 * leaves the Advertised set but stays LISTED in the widened directory as an in-flight row
 * (D-26). So "gone" here means absent from the directory ENTIRELY (any phase) - a stalled
 * or ended cohort goes dark (Finding 2). This must never reuse the "left Advertised =
 * closed" logic, which would falsely fail a legitimately signing cohort.
 */
export function postSeatCohortGone(rows: DirectoryCohortDTO[], pickedId: string): boolean {
  return !rows.some((row) => row.cohortId === pickedId);
}

/**
 * Pure seat-line copy derivation for the cohort page's waiting surface (PWEB-1). Extracted
 * from the render so every branch is unit-testable without a DOM stack; {@link
 * file://../components/cohort/CohortPage.tsx} is the sole consumer.
 *
 * - Filling ({@link ParticipantState.awaitingSeats} below capacity): the truthful live
 *   count, "Waiting for the cohort to fill (j/n seats)."
 * - Locked full (joined === capacity): honest UNCERTAINTY, not a claimed seat. The library
 *   silently drops a surplus/duplicate opt-in (no reject signal ever reaches the loser of
 *   the last-seat race), so at n/n this browser may or may not hold a seat until
 *   cohort-ready arrives - say "checking whether this browser got a seat", never
 *   "confirming YOUR seat" (D-25/CR-01 posture: observed facts only).
 * - Null input (not awaiting a seat, or the row left the directory): no line.
 */
export function seatLineCopy(awaitingSeats: { joined: number; capacity: number } | null): string | null {
  if (!awaitingSeats) {
    return null;
  }
  if (awaitingSeats.joined >= awaitingSeats.capacity) {
    return `All ${awaitingSeats.capacity} seats are filled; checking whether this browser got a seat.`;
  }
  return `Waiting for the cohort to fill (${awaitingSeats.joined}/${awaitingSeats.capacity} seats).`;
}

/**
 * The D-01 live-journey stage. This is the SINGLE render authority (Pattern 3): the
 * cohort page and the persistent "Your cohort" chip both derive it from existing store
 * facts via {@link deriveStage}, so the rendered stage can never drift from the event
 * handlers. No parallel stage enum is stored. Terminal states (failed) are read from
 * `status` by the UI, not encoded here.
 */
export type Stage =
  | 'waiting-for-seats'
  | 'seated'
  | 'submit-window'
  | 'co-signing'
  | 'signed'
  | 'anchored'
  | 'resolved';

/** The exact store facts {@link deriveStage} reads (a structural subset of the state). */
export interface StageInput {
  status: ParticipantStatus;
  optedIn: boolean;
  seated: boolean;
  pendingSubmit: boolean;
  steps: Record<StepKey, StepStatus>;
  anchor: AnchorDTO | null;
  resolveStatus: ResolutionStatus;
}

/**
 * Pure render authority (Pattern 3): map existing store facts to the one D-01 stage the
 * cohort page renders. Ordered by precedence from the tail backward so the latest-reached
 * milestone wins:
 *
 * - `resolved` once resolution lands (a read, so it is the true end of the journey).
 * - On a completed cohort, `anchored` only when the anchor read is `enabled` AND
 *   `state === 'confirmed'` (the beacon tx is mined on-chain). A broadcast-but-unconfirmed
 *   anchor (`state === 'broadcast'`) stays `signed`, so the timeline row position and the
 *   persistent "Your cohort" chip never claim "Anchored" while the tx is unconfirmed
 *   (D-07 mode honesty: never claim an anchor on the hermetic no-broadcast path, and never
 *   claim a mined anchor before the tx confirms; 03-VERIFICATION.md Truth 8 / 03-REVIEW.md
 *   WR-02); otherwise `signed`.
 * - `submit-window` while the explicit-submit deferred is open (dominates `seated`: the
 *   runner is awaiting the update right now, D-12/D-13 urgency).
 * - `co-signing` once the update was submitted (`steps.submit === 'done'`).
 * - `seated` once the cohort locked with us in it, before the submit window.
 * - `waiting-for-seats` otherwise (opted in / connecting, still filling).
 */
export function deriveStage(state: StageInput): Stage {
  if (state.resolveStatus === 'resolved') {
    return 'resolved';
  }
  if (state.status === 'complete') {
    const a = state.anchor;
    if (a?.enabled && a.state === 'confirmed') {
      return 'anchored';
    }
    return 'signed';
  }
  if (state.pendingSubmit) {
    return 'submit-window';
  }
  if (state.steps.submit === 'done') {
    return 'co-signing';
  }
  if (state.seated) {
    return 'seated';
  }
  return 'waiting-for-seats';
}

/**
 * The three honest round-trip outcomes (Finding 7 / D-29). Compares the presence of the
 * appended aggregate beacon (via `findAppendedBeacon`) against the anchor read's mode bit:
 *
 * - `reflected`: a live (broadcasting) service AND the resolved document lists the cohort's
 *   beacon service (the update was discovered on-chain).
 * - `hermetic-genesis`: a no-broadcast service has no on-chain signal to discover, so the
 *   resolve returns the genesis document. This is the EXPECTED fixture outcome, NOT a
 *   mismatch - the co-signed update lives in the downloadable sidecar/artifacts.
 * - `not-reflected`: a live service where the beacon is absent - an honest warning + retry.
 */
export type RoundTrip = 'reflected' | 'hermetic-genesis' | 'not-reflected';

export function roundTripOutcome(input: { beaconPresent: boolean; anchorEnabled: boolean }): RoundTrip {
  if (input.beaconPresent && input.anchorEnabled) {
    return 'reflected';
  }
  // A no-broadcast service is the expected genesis outcome even if a beacon somehow
  // appears; the mode bit dominates so the hermetic path is never flagged as a mismatch.
  if (!input.anchorEnabled) {
    return 'hermetic-genesis';
  }
  return 'not-reflected';
}

/**
 * Pure honest-resolve note for the KEY first-update chicken-and-egg (ADR 0007, D-46). A resolver
 * only discovers beacon signals at beacon services ALREADY in the document under resolution
 * ({@link file://../../../../docs/adr/0007-resolve-driver-and-first-update-discovery.md}). A KEY
 * (k1) genesis document contains only the controller's own singleton beacons, never the cohort's
 * aggregate beacon, so the FIRST aggregated update resolves only after the controller's OWN genesis
 * P2TR registration signal (built by `buildSingletonRegistrationTx`) is funded, broadcast, and
 * CONFIRMED. The cohort's aggregate anchor makes 2nd+ updates resolvable, never the first. An
 * EXTERNAL (x1) DID bakes the aggregate beacon into genesis, so it needs no such leg.
 *
 * Returns a plain-language note when a KEY controller's first update is on a live (broadcasting)
 * service but the aggregate beacon is not yet in the resolved document AND their own registration
 * signal is missing or unconfirmed - otherwise null. Uses the store's existing `regStatus` fact
 * (broadcast-tracked, not confirmation-tracked): `registered` means the signal was broadcast but
 * may still be unconfirmed, so the note stays honest about the confirmation wait.
 *
 * `anchorEnabled` (the mode bit) is only the RENDER GATE; the copy never keys an "anchored" claim
 * on it. Claiming "anchored" requires `anchorConfirmed` (`anchor.state === 'confirmed'`), matching
 * this file's confirmed-only anchored discipline everywhere else ({@link anchorSummaryState},
 * {@link deriveStage}; D-07 mode honesty, 03-VERIFICATION.md Truth 8 / 03-REVIEW.md WR-02): the
 * mode bit is true even while the beacon tx is merely broadcast, unposted, or terminally failed,
 * and auto-resolve fires on a failed anchor too ({@link shouldAutoResolve}), so an enabled-keyed
 * "anchored" line would render a factually false claim right under the broadcast-failed narration.
 * The registration guidance itself stays valid in every anchor state (ADR 0007: the first update
 * is discoverable only via the controller's own genesis signal, whatever the cohort anchor did).
 */
export function firstUpdateResolveNote(input: {
  idType: IdType;
  anchorEnabled: boolean;
  anchorConfirmed: boolean;
  beaconPresent: boolean;
  regStatus: RegistrationStatus;
}): string | null {
  // The registration leg is a KEY-only concern (x1 bakes the beacon into genesis).
  if (input.idType !== 'KEY') {
    return null;
  }
  // Hermetic (no-broadcast) services have no on-chain signal to discover at all: the genesis
  // registration note only applies to a live cohort whose anchor really broadcasts.
  if (!input.anchorEnabled) {
    return null;
  }
  // Once the aggregate beacon is present the first update already resolved: nothing to explain.
  if (input.beaconPresent) {
    return null;
  }
  if (input.regStatus === 'registered') {
    return 'Your registration signal is broadcast, but resolution will not show your update until that signal confirms on-chain. Mine or wait a block, then resolve again.';
  }
  // Confirmed-only "anchored" claim (D-07/Truth 8): a broadcast/none/failed anchor gets the
  // state-neutral copy so this note never contradicts the mode-honest anchor narration above it.
  if (input.anchorConfirmed) {
    return 'Your update is anchored, but resolution will not show it until your own genesis registration signal confirms. Complete the "Register first update" step below, then resolve again.';
  }
  return 'Resolution will not show your update until your own genesis registration signal confirms. Complete the "Register first update" step below, then resolve again.';
}

/**
 * Pure mode-honest anchor narration selector (WR-01, D-07/D-22; 03-VERIFICATION.md Truth 7 /
 * 03-REVIEW.md WR-01). Maps every anchor read to exactly one of five honest completion-summary
 * states, replacing the two-way anchored-or-hermetic collapse WR-01 flagged (which mis-narrated
 * a broadcasting or failed live service as a hermetic no-broadcast service, claiming it "does
 * not publish to Bitcoin" when it merely had a pending or failed beacon tx):
 *
 * - `checking`: the pre-first-read window (`anchor === null`) - the anchor read has not landed
 *   yet, so the summary must presume neither live nor hermetic. Distinct from a confirmed
 *   no-broadcast service so a live service that reaches status `complete` synchronously (before
 *   trackAnchor's first fetchAnchor read resolves) never narrates the no-broadcast copy during
 *   that brief window. Mirrors the codebase's existing SubmitPanel `enabled === undefined`
 *   "Checking this service's broadcast mode" neutral handling (D-07 mode honesty).
 * - `hermetic`: a real read shows the service does not broadcast (`!anchor?.enabled`, the D-07
 *   mode bit). The only state that may narrate the no-broadcast copy.
 * - `anchored`: enabled AND `state === 'confirmed'` (the beacon tx is mined/anchored on-chain),
 *   matching the confirmed-only `anchored` boolean and StageTimeline's "Anchored" relabel. A
 *   broadcast-but-unconfirmed anchor is NOT yet anchored: it narrates as `broadcasting` below,
 *   agreeing with AnchorSubSteps' independent `state === 'confirmed'` check so no surface claims
 *   "Anchored" while another shows "Confirmed: pending" (D-07 mode honesty; 03-VERIFICATION.md
 *   Truth 8 / 03-REVIEW.md WR-02).
 * - `broadcast-failed`: enabled AND `state === 'failed'` - the beacon broadcast terminally
 *   failed, so there is no confirmed anchor (a distinct honest state, not hermetic).
 * - `broadcasting`: enabled AND (`state === 'broadcast'`, the tx is accepted but not yet mined)
 *   OR (`state === 'none'`, the tx has not posted yet) - in both cases the summary honestly says
 *   it is broadcasting rather than claiming a mined anchor or no broadcast.
 */
export function anchorSummaryState(
  anchor: AnchorDTO | null,
): 'checking' | 'anchored' | 'broadcasting' | 'broadcast-failed' | 'hermetic' {
  if (anchor === null) {
    return 'checking';
  }
  if (!anchor?.enabled) {
    return 'hermetic';
  }
  if (anchor.state === 'confirmed') {
    return 'anchored';
  }
  if (anchor.state === 'failed') {
    return 'broadcast-failed';
  }
  return 'broadcasting';
}

/**
 * Pure auto-resolve trigger (D-28): should the anchor stage be treated as complete enough
 * to auto-resolve? A hermetic (no-broadcast) service is signed-complete after one anchor
 * read (`enabled: false`, resolve returns the genesis - the expected fixture outcome); a
 * live service auto-resolves once its beacon tx is `confirmed`, OR once its broadcast has
 * terminally `failed` so the participant still reaches a resolve outcome (the honest
 * not-reflected/retry path) instead of freezing with no resolve (WR-01, D-28). A live
 * `broadcast`/`none` (accepted or not yet posted, not yet mined) is NOT yet resolvable. The
 * caller fires resolve() at most once.
 */
export function shouldAutoResolve(anchor: AnchorDTO | null): boolean {
  if (!anchor) {
    return false;
  }
  if (!anchor.enabled) {
    return true;
  }
  return anchor.state === 'confirmed' || anchor.state === 'failed';
}

/**
 * The narration for a cohort the OPERATOR deliberately ended (SVC-04, D-02, UI-SPEC E14). Fixed
 * contract copy, no interpolation. It names the actor because a cancel is a decision, not a
 * malfunction, and the participant deserves to know which it was.
 */
export const CANCELED_NARRATION = 'The operator canceled this cohort.';

/**
 * The inherited honest fallback (03 D-25) for a cohort that ended with no attribution carried.
 * This is what renders when the fate read is unreachable or reports false: no certainty is
 * invented, ever.
 */
export const HONEST_TERMINAL_FALLBACK = "The cohort ended and this service didn't say why.";

/** The dedicated 04 D-45 stall copy, exported so the cancel-versus-stall pin can name it. */
export const STALL_NARRATION = 'This service stalled while collecting updates.';

/**
 * Best-effort terminal reason (D-25/D-45/D-02, UI-SPEC terminal copy). Maps the store's terminal
 * facts to a specific, honest sentence where the cause is recognizable, falling back to the
 * honest "didn't say why" when it is not (never inventing a cause). Exported as a pure function
 * so CohortPage renders it and the stall-predicate rekey is unit-testable.
 *
 * The D-45 fix: the stall copy is keyed on the `validationRequested` fact, NOT on
 * submitted-but-unsigned alone (the predicate that misfired in the Phase 3 live UAT).
 * `validation-requested` fires ONLY after the service collected EVERY member's update, so:
 *
 * - `submitted && !validationRequested` + an unexplained signing-window death is the genuinely
 *   positive "stalled collecting updates" signal -> `This service stalled while collecting updates.`
 * - `submitted && validationRequested && still-unsigned` means updates WERE collected but co-signing
 *   still died unexplained, so a collection stall is provably wrong -> the uncertainty-honest
 *   `Co-signing could not complete, and this service didn't say why.`
 * - A reason string that positively names a stall keeps the dedicated stall copy regardless.
 *
 * The `canceled` input is checked FIRST, and that ordering is load-bearing (SVC-04, D-02,
 * RESEARCH Pitfall 5). A cohort canceled after this participant submitted but before the service
 * reached validation satisfies EVERY condition of the stall branch below - submitted-but-unsigned,
 * no validation-requested, an unexplained reason - so with any other ordering an operator's
 * deliberate act would be narrated to the participant as a service stall, which is precisely the
 * misattribution D-45 exists to prevent. Checking the fact first makes that outcome unreachable
 * rather than unlikely.
 *
 * It is a dedicated BOOLEAN and never another alternative in the regular-expression chain below.
 * The whole point of D-45 was to stop keying narration on message text, and the cancel fact is
 * carried out of band here exactly as it is server-side (the intent registry declares the fate
 * before the library call rather than reading it off a rejection message). A false or absent fact
 * changes nothing: the inherited fallback renders and no certainty is invented (T-05-10-04).
 */
export function terminalReason(input: {
  /**
   * True ONLY when the SERVICE itself reported this cohort canceled, via the public fate read
   * after the post-seat gone streak already declared the cohort dead. Never inferred from a
   * message, a timeout, or an absence.
   */
  canceled: boolean;
  error: string | null;
  steps: Record<StepKey, StepStatus>;
  validationRequested: boolean;
}): string {
  const raw = (input.error ?? '').trim();
  const e = raw.toLowerCase();
  const submittedButUnsigned = input.steps.submit === 'done' && input.steps.sign !== 'done';
  const unexplained = !raw || /didn.t say why/.test(e);

  // FIRST, above every inference: the one fact the service actually stated about this cohort.
  // Everything below this line is best-effort classification of a reason string; this is not.
  if (input.canceled) {
    return CANCELED_NARRATION;
  }
  // POSITIVE stall (D-45): the reason itself names a collecting-updates stall, OR our update is in
  // but the service NEVER reached validation (no validation-requested fact) and the death is
  // otherwise unexplained. The ABSENCE of validation-requested is the positive discriminator, not
  // submitted-but-unsigned alone.
  if (
    /stalled|collectingupdates|collecting updates|waiting for all members/.test(e) ||
    (submittedButUnsigned && !input.validationRequested && unexplained)
  ) {
    return STALL_NARRATION;
  }
  // UNCERTAINTY-HONEST (D-45): the service DID collect every update (validation-requested fired) but
  // co-signing still died unexplained with our update unsigned. We cannot claim a collection stall,
  // so say honestly that co-signing could not complete without a stated reason.
  if (submittedButUnsigned && input.validationRequested && unexplained) {
    return "Co-signing could not complete, and this service didn't say why.";
  }
  if (/tim(e|ed)\s?out|timeout/.test(e)) {
    return 'The cohort ended: phase timed out.';
  }
  if (/no longer available|not available|vanished|no longer exists|left the directory/.test(e)) {
    return 'The cohort ended: the cohort is no longer available.';
  }
  if (/sign/.test(e) && /error|fail/.test(e)) {
    return 'The cohort ended: the signing round errored.';
  }
  if (/seat/.test(e)) {
    return 'The cohort ended: your seat was lost.';
  }
  if (unexplained) {
    return HONEST_TERMINAL_FALLBACK;
  }
  return `The cohort ended: ${raw}`;
}

/** The baked aggregate-beacon service types present in a genesis document (x1 only). */
function bakedAggregateBeaconTypes(genesisDocument: Record<string, unknown>): string[] {
  const service = genesisDocument.service;
  if (!Array.isArray(service)) {
    return [];
  }
  const types: string[] = [];
  for (const entry of service) {
    const type = (entry as { type?: unknown })?.type;
    if (type === 'CASBeacon' || type === 'SMTBeacon') {
      types.push(type);
    }
  }
  return types;
}

/**
 * Pre-seat fit warning (D-19, Finding 6): warn (NEVER block) on the only two fit problems
 * reliably computable BEFORE `cohort-ready` - the beacon ADDRESS is a keygen output and is
 * unknowable pre-seat, so a late cooperative non-inclusion stays the backstop for the rest.
 *
 * 1. Network mismatch: the participant's runtime network must match the cohort's advertised
 *    network or every derived address diverges. An in-app identity always matches (both
 *    derive from `GET /v1/config`); the honest warn case is an imported identity on another
 *    chain.
 * 2. Baked aggregate-beacon TYPE mismatch (x1 only): a baked genesis commits to a beacon
 *    type; if none of its baked aggregate beacons match the picked row's `beaconType`,
 *    submitting into this cohort would strand the DID. The TYPE half is checkable now; the
 *    address half is not (D-19).
 *
 * Returns a plain-language warn string or null. Warn-only: the join-anyway choice is the UI's.
 */
export function preSeatFitWarning(
  identity: Identity | null,
  pickedRow: Pick<DirectoryCohortDTO, 'beaconType' | 'network'>,
  network: NetworkName,
): string | null {
  if (!identity) {
    return null;
  }
  if (pickedRow.network !== network) {
    return `This cohort runs on ${pickedRow.network}, but your identity is on ${network}. Addresses derived for one network do not work on the other.`;
  }
  const genesis = identity.genesisDocument;
  if (genesis && hasBakedAggregateBeacon(genesis)) {
    const bakedTypes = bakedAggregateBeaconTypes(genesis);
    if (bakedTypes.length > 0 && !bakedTypes.includes(pickedRow.beaconType)) {
      return `Your identity bakes a ${bakedTypes.join('/')} aggregate beacon, but this cohort uses ${pickedRow.beaconType}. You can join anyway, but your update may not be included.`;
    }
  }
  return null;
}

const INITIAL_STEPS: Record<StepKey, StepStatus> = {
  join: 'idle',
  submit: 'idle',
  sign: 'idle',
  anchored: 'idle',
};

/** The per-round outcome slice, reset on a fresh identity / join / leave. */
const INITIAL_OUTCOME = {
  result: null,
  sidecar: null,
  anchor: null as AnchorDTO | null,
  unreachable: false,
  liveCohort: false,
  awaitingFunding: false,
  validationRequested: false,
  canceled: false,
  fallbackObserved: false,
  nonInclusionReason: null as string | null,
  cohortThreshold: null as number | null,
  cohortCapacity: null as number | null,
  regStatus: 'idle' as RegistrationStatus,
  regTxid: null,
  regError: null,
  // The external-signer round trip (PART-06). It lives HERE, in the per-round slice, precisely
  // so every teardown path the store already has clears it: a pasted PSBT and the transaction it
  // carries are facts about ONE registration attempt, and nothing about them may outlive it.
  // The default is the shipped browser path, so a reset also restores the shipped flow.
  signingMethod: 'browser' as SigningMethod,
  psbtBase64: null,
  psbtTemplateHex: null,
  psbtReturned: '',
  psbtVerdict: null as PsbtVerdict | null,
  psbtExporting: false,
  psbtExportError: null,
  resolveStatus: 'idle' as ResolutionStatus,
  resolution: null,
  resolveError: null,
  ipfsStatus: 'idle' as IpfsPublishStatus,
  ipfsResults: null,
  ipfsError: null,
} as const;

/** Clear the module-level captured artifacts (paired with an INITIAL_OUTCOME reset). */
function clearCaptured(): void {
  captured = null;
}

/**
 * Pick the UTXO the registration transaction spends: the largest one that can cover the fee plus
 * a dust-safe change output. Exported and shared by BOTH the register path and the unsigned-PSBT
 * export, because the transaction handed to a wallet has to spend the coin the registration would
 * have spent; two copies of this rule is exactly how the two would drift apart.
 *
 * Deliberately largest-first rather than the library's deepest-first selection (a Phase 4
 * upstream finding): a participant's beacon address is funded by hand, so the biggest coin is the
 * one they meant to use.
 */
export function selectFundingUtxo(utxos: Utxo[]): Utxo | undefined {
  const min = Number(MIN_REGISTRATION_FUNDING_SATS);
  return utxos.filter((u) => u.value >= min).sort((a, b) => b.value - a.value)[0];
}

let logSeq = 0;

export const useParticipant = create<ParticipantState>((set, get) => {
  function append(level: LogLevel, text: string): void {
    const entry: LogEntry = { id: ++logSeq, t: elapsed(), level, text };
    // Cap the buffer so a long-running booth tab never grows without bound.
    set((s) => ({ log: [...s.log.slice(-199), entry] }));
  }

  function setStep(key: StepKey, status: StepStatus): void {
    set((s) => ({ steps: { ...s.steps, [key]: status } }));
  }

  /** Flip whichever step is mid-flight to 'failed' so a failure marks the right spot. */
  function failActiveStep(): void {
    set((s) => {
      const next = { ...s.steps };
      let marked = false;
      for (const key of Object.keys(next) as StepKey[]) {
        if (next[key] === 'active') {
          next[key] = 'failed';
          marked = true;
        }
      }
      if (!marked && next.join !== 'done') {
        next.join = 'failed';
      }
      return { steps: next };
    });
  }

  /** Move to a terminal failed state, surface the reason, and stop listening. */
  function fail(reason: string): void {
    failActiveStep();
    // pendingSubmit: false projects the submit-window close; teardownLive() (below) drops
    // the module-scope deferred WITHOUT settling it (Pitfall 2 - never reject on failure).
    // unreachable: false: a terminal failure with a reason supersedes the transient D-24
    // "can't reach this service" signal (the poll is being torn down anyway).
    set({ status: 'failed', error: reason, awaitingSeats: null, pendingSubmit: false, unreachable: false });
    clearDirectoryPoll();
    clearJoinGrace();
    teardownLive();
  }

  function adopt(identity: Identity): void {
    clearCaptured();
    teardownIpfs();
    set({
      identity,
      did: identity.did,
      idType: isExternalIdentity(identity) ? 'EXTERNAL' : 'KEY',
      secret: identitySecretHex(identity),
      status: 'ready',
      steps: { ...INITIAL_STEPS },
      cohortId: null,
      beaconAddress: null,
      seated: false,
      optedIn: false,
      joinClosed: false,
      awaitingSeats: null,
      pendingSubmit: false,
      pickedCohortId: null,
      error: null,
      // The first-update SingletonBeacon address to fund is the key's genesis P2TR
      // address for both models: for k1 it is one of the deterministic genesis beacons,
      // for x1 it is the one declared in the identity's genesis document (same address).
      // Derived on the runtime network so the address matches the coordinator's chain.
      beaconRegAddress: genesisP2trBeaconAddress(identity.keys, resolveNetwork(get().network)),
      ...INITIAL_OUTCOME,
    });
  }

  /**
   * Resolver-lag retry (D-28), started ONLY on a live (enabled:true) anchor by trackAnchor:
   * on esplora-indexed paths the first auto-resolve can predate the beacon's discovery, so
   * re-resolve on a bounded cadence until the appended beacon is reflected or the attempt
   * cap is hit. Pointless on the hermetic path (immediate, stable answer), hence the gate.
   */
  function startResolveLagRetry(baseUrl: string): void {
    clearResolveLagRetry();
    let attempts = 0;
    resolveLagRetry = setInterval(() => {
      attempts += 1;
      const { resolution, did } = get();
      const reflected = Boolean(resolution && did && findAppendedBeacon(resolution.didDocument, did));
      if (reflected || attempts >= RESOLVE_LAG_MAX_ATTEMPTS) {
        clearResolveLagRetry();
        return;
      }
      void get().resolve(baseUrl);
    }, RESOLVE_LAG_RETRY_MS);
  }

  return {
    identity: null,
    did: null,
    network: DEFAULT_NETWORK,
    serviceName: null,
    publicStatus: undefined,
    // The chain-endpoint choice is a per-browser preference, not per-round state, so it
    // deliberately does NOT live in INITIAL_OUTCOME: a participant who set an endpoint
    // keeps it across cohorts, exactly as they would expect a setting to behave.
    chainEndpoint: null,
    chainEndpointVerdict: null,
    chainEndpointProbing: false,
    broadcastDirect: false,
    endpointTxConfirmed: null,
    configStatus: 'loading',
    idType: 'KEY',
    secret: null,
    status: 'no-identity',
    steps: { ...INITIAL_STEPS },
    cohortId: null,
    beaconAddress: null,
    seated: false,
    optedIn: false,
    joinClosed: false,
    awaitingSeats: null,
    pendingSubmit: false,
    pickedCohortId: null,
    error: null,
    log: [],
    beaconRegAddress: null,
    ipfsInfo: null,
    ...INITIAL_OUTCOME,

    async pollPublicStatus(baseUrl) {
      try {
        set({ publicStatus: await fetchStatus(baseUrl) });
      } catch {
        // Unknown, not "running": clearing the slice is what stops an unreachable service from
        // leaving a paused notice on screen indefinitely (UI-SPEC E5 error).
        set({ publicStatus: undefined });
      }
    },

    async loadConfig(baseUrl) {
      // Probe IPFS availability in parallel: purely additive (the publish panel's
      // enablement), so its failure must never delay or block the network config.
      const ipfsProbe = fetchIpfsInfo(baseUrl).then(
        (info) => set({ ipfsInfo: info }),
        () => set({ ipfsInfo: { enabled: false } }),
      );
      try {
        const dto = await fetchNetworkConfig(baseUrl);
        // Adopt the optional service display name (D-51) alongside the network; absent -> null.
        set({ network: dto.network, serviceName: dto.serviceName ?? null, configStatus: 'ready' });
        append('info', `coordinator network: ${dto.label} (${dto.network})`);
      } catch (err) {
        // Degrade gracefully: keep the default network and unblock generation. An
        // older coordinator without /v1/config, or a transient failure, must not
        // wedge the UI in a permanent 'loading' state.
        const msg = err instanceof Error ? err.message : String(err);
        set({ configStatus: 'ready' });
        append('warn', `could not load coordinator network (${msg}); using default ${get().network}`);
      }
      await ipfsProbe;
    },

    generate(kind = 'KEY') {
      const net = resolveNetwork(get().network);
      const identity = kind === 'EXTERNAL' ? createExternalIdentity(net) : createIdentity(net);
      adopt(identity);
      append('good', `generated ${kind === 'EXTERNAL' ? 'EXTERNAL (x1)' : 'KEY (k1)'} identity ${identity.did}`);
    },

    importSecret(hex, kind = 'KEY') {
      const clean = hex.trim().toLowerCase().replace(/^0x/, '');
      if (!/^[0-9a-f]{64}$/.test(clean)) {
        return 'Secret must be 64 hex characters (32 bytes).';
      }
      try {
        const net = resolveNetwork(get().network);
        const identity = kind === 'EXTERNAL' ? importExternalIdentity(clean, net) : importIdentity(clean, net);
        adopt(identity);
        append('good', `imported ${kind === 'EXTERNAL' ? 'EXTERNAL (x1)' : 'KEY (k1)'} identity ${identity.did}`);
        return null;
      } catch (err) {
        return err instanceof Error ? err.message : String(err);
      }
    },

    async join(baseUrl, cohortId, sizing) {
      const { identity, status } = get();
      if (!identity || status === 'connecting' || status === 'live') {
        return;
      }

      // Re-join after a completed/failed round: tear down the prior participant
      // first so we never leak its SSE streams or leave two runners listening.
      // The IPFS node goes too: its blocks belong to the finished round.
      clearDirectoryPoll();
      clearJoinGrace();
      teardownLive();
      teardownIpfs();
      clearCaptured();
      set({
        status: 'connecting',
        error: null,
        steps: { ...INITIAL_STEPS },
        seated: false,
        optedIn: false,
        joinClosed: false,
        awaitingSeats: null,
        pendingSubmit: false,
        pickedCohortId: cohortId,
        ...INITIAL_OUTCOME,
        // Carry the picked row's k/n AFTER the outcome reset so the k-of-n fallback
        // outcome (D-23) can name them at completion. Absent for headless callers.
        cohortThreshold: sizing?.threshold ?? null,
        cohortCapacity: sizing?.capacity ?? null,
      });
      append('info', `connecting to ${baseUrl} to join cohort ${cohortId}`);

      // Browse-and-pick (PART-02/D-14): the picked cohortId is threaded into the
      // runner so `shouldJoin` opts into that cohort alone and ignores every other
      // advert on the public transport.
      //
      // Explicit-submit gate (PART-03, D-12), STRICTLY OPT-IN: only the web store passes
      // `onSubmitGate`; the headless e2e peers and in-process FILLERS omit it and keep the
      // byte-identical auto-submit (Pitfall 1). When the runner asks this participant to
      // provide its update, the participant package has ALREADY built and signed it once
      // (the previewed body is the submitted body, D-29); we stash that body + the promise
      // resolver at module scope and flip the submit-window projection on. submitUpdate()
      // settles it on the user's click. This callback never rejects or resolves-null - the
      // deferred is dropped WITHOUT settling on teardown (clearPendingSubmit, Pitfall 2).
      const participant = createParticipant({
        identity,
        baseUrl,
        cohortId,
        onSubmitGate: (info) =>
          new Promise<void>((resolve) => {
            pendingSubmit = { cohortId: info.cohortId, update: info.update, resolve };
            set({ pendingSubmit: true });
          }),
      });
      live = participant;
      const r = participant.runner;

      r.on('cohort-discovered', (advert) => {
        append('info', `discovered cohort ${advert.cohortId} (${advert.beaconType})`);
      });
      r.on('cohort-joined', ({ cohortId }) => {
        // Ignore a stray advert that arrives after this attendee already finished
        // (defense in depth; teardownLive on complete/fail normally prevents it).
        const st = get().status;
        if (st === 'complete' || st === 'failed') {
          return;
        }
        // cohort-joined = the opt-in was SENT, NOT that a seat was granted (D-11): the
        // protocol emits no accept event. Treat this as "opted in, waiting for the
        // cohort to fill"; `seated` flips only on cohort-ready.
        set({ cohortId, status: 'live', optedIn: true });
        setStep('join', 'done');
        setStep('submit', 'active');
        // D-11 sent-not-accepted semantics: the opt-in was SENT, no seat granted yet, and
        // keygen has NOT started (the cohort still has to fill). Narrate exactly that.
        append('good', `opt-in sent for cohort ${cohortId}; waiting for the cohort to fill`);
        // cohort-joined records the opt-in ONLY and arms nothing. Under the wait-for-n
        // model there is no "seat imminent" premise here: the picked cohort may stay
        // openly Advertised and filling for a long time, and failing at a fixed post-opt-in
        // deadline would falsely close a legitimately-filling cohort (gap G-02-2). The
        // directory poll now owns arming the bounded grace, and only on the FIRST observed
        // departure of the picked cohort from the Advertised set (handleDirectorySnapshot).
      });
      r.on('cohort-ready', ({ cohortId, beaconAddress }) => {
        // The DEFINITIVE seat (D-11): the cohort formed with us in it and membership
        // is locked. This is the only place `seated` flips true. The directory poll
        // can stand down now - a seated cohort legitimately leaves the Advertised
        // set, and that must not read as "filled or closed".
        set({ beaconAddress, seated: true, awaitingSeats: null });
        clearDirectoryPoll();
        clearJoinGrace();
        append('info', `cohort ${cohortId} keygen complete; beacon ${beaconAddress}`);
        // Post-seat cohort-gone watch (D-24/D-25): the pre-seat join poll has stood down,
        // so start a NEW poll that detects the picked cohort vanishing from the directory
        // ENTIRELY (a stalled/ended cohort goes dark, Finding 2). It uses its own predicate
        // via handlePostSeatSnapshot and NEVER the pre-seat handleDirectorySnapshot (Pitfall
        // 6). A fetch error is "unreachable" (D-24), never "cohort gone". Epoch-guarded like
        // the join poll; cleared at cohort-complete/fail/leave/re-join (teardownLive).
        clearPostSeatPoll();
        const seatEpoch = postSeatEpoch;
        postSeatPoll = setInterval(() => {
          fetchDirectory(baseUrl).then(
            (rows) => {
              if (seatEpoch !== postSeatEpoch) {
                return;
              }
              postSeatFailures = 0;
              // The baseUrl rides along so that IF this snapshot completes the gone streak, the
              // handler can ask the public fate read why (SVC-04, D-02). It changes nothing about
              // when the streak triggers.
              get().handlePostSeatSnapshot(rows, baseUrl);
            },
            () => {
              // A directory fetch error is "can't reach this service", not "cohort gone"
              // (D-24). Count consecutive failures toward the unreachable signal; NEVER a
              // terminal by itself (the next tick retries and a success clears it).
              if (seatEpoch !== postSeatEpoch) {
                return;
              }
              postSeatFailures += 1;
              if (postSeatFailures >= UNREACHABLE_THRESHOLD) {
                set({ unreachable: true });
              }
            },
          );
        }, POST_SEAT_POLL_MS);
        // Funding-signal watch (D-44): on a LIVE (on-chain) cohort the operator funds the beacon
        // address AFTER seats fill, so from the seat onward poll the PUBLIC non-oracle funding read
        // and surface honest "waiting for funding" copy. `awaitingFunding: true` also latches the
        // `liveCohort` fact (the read is true ONLY for a live+broadcast cohort still awaiting funding),
        // which drives the join-time "this cohort anchors on-chain" notice. A hermetic cohort always
        // reads false, so neither the notice nor the wait copy ever surfaces there. A fetch error is
        // swallowed (never a terminal; the post-seat/anchor polls own the D-24 unreachable signal).
        clearFundingPoll();
        const fundEpoch = fundingEpoch;
        const fundingTick = (): void => {
          fetchFunding(baseUrl, cohortId).then(
            ({ awaitingFunding }) => {
              if (fundEpoch !== fundingEpoch) {
                return;
              }
              set(
                awaitingFunding
                  ? { awaitingFunding: true, liveCohort: true }
                  : { awaitingFunding: false },
              );
            },
            () => {
              // Ignore: an unreachable funding read is a transient miss, never "not live" and
              // never a terminal. The next tick retries; the latched liveCohort fact is unchanged.
            },
          );
        };
        // Immediate first read (so the wait copy appears without a full cadence), then the interval.
        fundingTick();
        fundingPoll = setInterval(fundingTick, FUNDING_POLL_MS);
      });
      r.on('update-submitted', ({ cohortId }) => {
        setStep('submit', 'done');
        setStep('sign', 'active');
        append('good', `submitted signed DID update for ${cohortId}`);
      });
      r.on('update-declined', ({ cohortId }) => {
        setStep('submit', 'done');
        append('warn', `declined to submit an update for ${cohortId} (non-inclusion)`);
      });
      r.on('validation-requested', () => {
        // D-45: record the positive discriminator for the stall copy. validation-requested fires
        // ONLY after the service has collected ALL updates, so once this is true a later
        // signing-window death is an unexplained co-signing failure, NOT a collecting-updates stall.
        set({ validationRequested: true });
        append('info', 'validating aggregated cohort data');
      });
      r.on('signing-requested', () => {
        append('info', 'co-signing: contributing MuSig2 nonce + partial signature');
      });
      r.on('fallback-requested', () => {
        // D-23: record that the n-of-n key path stalled and the cohort fell back to the
        // ADR-042 k-of-n script path, so the completion outcome can state it explicitly.
        set({ fallbackObserved: true });
        append('warn', 'key path stalled; co-signing the k-of-n script-path fallback');
      });
      r.on('cohort-complete', (info) => {
        setStep('sign', 'done');
        setStep('anchored', 'done');

        // Capture this participant's own signed update body BEFORE teardown: the
        // runner never re-emits it and it cannot be rebuilt to the same canonical
        // hash (BIP340 signing is non-deterministic). Only present when included.
        const body = info.included ? live?.getSubmittedUpdate(info.cohortId) : undefined;
        // Cooperative non-inclusion reason (D-10): captured BEFORE teardown from the same
        // live participant, so the non-error outcome can state WHY the update was not
        // submitted (a baked beacon-type mismatch) while still reporting the anchor result.
        const declineReason = info.included ? null : (live?.getDeclineReason(info.cohortId) ?? null);
        let updateHex: string | null = null;
        let sidecar: Sidecar | null = null;
        if (body) {
          updateHex = updateHashHex(body);
          captured = { did: get().did ?? '', updateHashBytes: updateHashBytes(body) };
          sidecar = buildSidecar({
            update: body,
            casAnnouncement: info.casAnnouncement,
            smtProof: info.smtProof,
            // For an EXTERNAL (x1) controller, carry the genesis so the sidecar can
            // resolve the DID (it is only a commitment to the genesis); undefined for k1.
            genesisDocument: get().identity?.genesisDocument,
          });
        }

        const result: ParticipantResult = {
          cohortId: info.cohortId,
          beaconAddress: info.beaconAddress,
          beaconType: info.beaconType,
          included: info.included,
          announcementEntries: info.casAnnouncement ? Object.keys(info.casAnnouncement).length : 0,
          updateHashHex: updateHex,
        };
        // awaitingSeats: null for symmetry with every sibling terminal (fail/adopt/join/
        // leave/cohort-ready). Benign in practice - cohort-ready nulls it first and the UI
        // hides the line off 'joining' - but a complete parity reset in case ordering drifts (IN-02).
        // pendingSubmit: false: the window is long closed by cohort-complete (the update
        // was submitted and co-signed). teardownLive() (below) drops the module-scope
        // deferred WITHOUT settling it - a resolved deferred here would be a redundant no-op
        // since submitUpdate() already nulled it, but the reset keeps state/module in step.
        set({ result, sidecar, status: 'complete', beaconAddress: info.beaconAddress, awaitingSeats: null, pendingSubmit: false, nonInclusionReason: declineReason });
        append('good', `cohort ${info.cohortId} anchored; your update was ${info.included ? 'included' : 'not included'}`);
        // Refresh the IPFS availability just as the publish panel appears: the
        // page-load probe may predate a coordinator restart that enabled (or
        // moved) the pinning node, and this is the moment the answer matters.
        void fetchIpfsInfo(baseUrl).then(
          (ipfs) => set({ ipfsInfo: ipfs }),
          () => {},
        );
        // Stop here: one cohort per join. Leaving the runner live would keep its SSE
        // streams open and risk re-acting on a replayed advert, reusing this key unbidden.
        clearDirectoryPoll();
        clearJoinGrace();
        teardownLive();
        // Now that the cohort is signed-complete, start the post-sign anchor poll (D-20/
        // D-22): it reads the PUBLIC anchor state to learn the service's mode (enabled) and
        // walk Signed -> Broadcast -> Confirmed on a live service, freezing at first
        // confirmation. On the hermetic default it confirms enabled:false in one read and
        // stops. It also drives auto-resolve (D-28) once the stage completes.
        get().trackAnchor(baseUrl, info.cohortId);
      });
      r.on('cohort-failed', ({ cohortId, reason }) => {
        append('bad', `cohort ${cohortId} failed: ${reason}`);
        fail(reason);
      });
      r.on('error', (err) => {
        const message = err instanceof Error ? err.message : String(err);
        append('bad', `error: ${message}`);
        // The runner routes nearly every mid-flow transport/runtime failure
        // through 'error' (not 'cohort-failed'). If we are mid-flow, make it a
        // terminal, recoverable failure instead of a stuck spinner.
        const st = get().status;
        if (st === 'connecting' || st === 'live') {
          fail(message);
        }
      });

      try {
        await participant.start();
        // WR-02: a fast hermetic/in-process path can open SSE and replay the current
        // advert DURING start(), so cohort-joined/cohort-ready/cohort-complete may have
        // already fired and run their poll/grace teardowns before this point. Re-check
        // the round before arming anything: if it was replaced by a re-join, is already
        // seated, or already reached a terminal state, do not install an orphaned interval.
        if (
          live !== participant ||
          get().seated ||
          get().status === 'complete' ||
          get().status === 'failed'
        ) {
          return;
        }
        setStep('join', 'active');
        append('info', `listening for the advert for cohort ${cohortId}`);
        // Directory-driven join outcome (D-06/D-12), replacing the old fixed no-advert
        // timer: while awaiting a seat, poll the public directory (the HTTP source of
        // truth for all live cohorts) every ~5s. A successful poll in which the picked
        // cohort is no longer Advertised means it just filled or closed -> a
        // deterministic terminal state (handleDirectorySnapshot). A poll ERROR is
        // swallowed: an unreachable service must never masquerade as a closed cohort;
        // the next tick retries. The poll is cleared on seat (cohort-ready),
        // cohort-complete, fail, and leave.
        // Capture the round token now (mirrors ipfsEpoch): a snapshot that resolves
        // after this poll was cleared/restarted belongs to a prior round and must be
        // dropped, not applied against the current pickedCohortId (WR-01).
        const epoch = directoryEpoch;
        directoryPoll = setInterval(() => {
          fetchDirectory(baseUrl).then(
            (rows) => {
              // Drop a stale in-flight snapshot from a prior round; only a fetch issued
              // and resolved within the still-current round may drive the outcome (WR-01).
              if (epoch === directoryEpoch) {
                get().handleDirectorySnapshot(rows);
              }
            },
            () => {
              // Ignore: a fetch error is "unreachable", not "closed" (D-12).
            },
          );
        }, DIRECTORY_POLL_MS);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        append('bad', `failed to connect: ${message}`);
        fail(message);
      }
    },

    handleDirectorySnapshot(rows) {
      const { status, seated, pickedCohortId, optedIn } = get();
      // Only meaningful while awaiting a seat for a picked cohort. Once seated, the
      // picked cohort legitimately leaves the Advertised set (it locked membership),
      // so this is a no-op; likewise if we already left the connecting/live window.
      if (seated || pickedCohortId === null || (status !== 'connecting' && status !== 'live')) {
        return;
      }
      // Reflect the picked cohort's live seat count whenever its row is present in the
      // directory in ANY phase (IN-01, refined for SVC-JOIN-2). The directory now keeps a
      // seated-but-unfinished cohort listed straight through the funding / co-sign window
      // (the widened service DISPLAY_PHASES), so the picked row is still present in
      // CohortSet / UpdatesCollected / Validated / ... after it leaves Advertised, carrying
      // its final joined/capacity (e.g. 2/2). Set awaitingSeats from that row so the cohort
      // page can render a truthful "{joined}/{capacity} seats" line the whole time. Only
      // null the line when the row is absent from the directory ENTIRELY - a genuinely gone
      // cohort - never merely because it advanced past Advertised.
      const pickedRow = rows.find((r) => r.cohortId === pickedCohortId);
      if (pickedRow) {
        set({ awaitingSeats: { joined: pickedRow.joined, capacity: pickedRow.capacity } });
      } else {
        set({ awaitingSeats: null });
      }
      if (!pickedCohortClosed(rows, pickedCohortId)) {
        // Defensive (IN-03): a cohort id never re-enters Advertised once it locks
        // membership (a re-advertise mints a fresh id), but if a flaky/replayed
        // directory re-lists the picked cohort as Advertised after an earlier
        // departure already armed the grace, cancel that stale timer - a genuinely
        // reopened cohort must not be torn down at first-departure + 90s.
        if (joinGrace !== null) {
          clearJoinGrace();
        }
        // Still openly Advertised with a free seat: keep waiting (wait-for-n). The live
        // seat count was already captured above.
        return;
      }
      // The picked cohort has left the Advertised set while we are still unseated.
      if (!optedIn) {
        // We never opted in (no cohort-joined yet): the cohort filled or closed before
        // we could join, so we are provably not a member. Failing now is correct and
        // preserves the legitimate "closed before I could opt in" path.
        append('warn', `cohort ${pickedCohortId} left the open set before seating; it just filled or closed`);
        set({ joinClosed: true });
        fail('That cohort just filled or closed. Pick another from the directory.');
        return;
      }
      // We already opted in. A cohort leaving Advertised is now AMBIGUOUS (CR-01): a
      // cohort locks membership at its threshold BEFORE keygen finishes, so this may be
      // OUR cohort forming with cohort-ready imminent, or one that filled without us. The
      // protocol gives no accept/reject signal, so tearing down here would drop a genuine
      // member mid-keygen and stall the whole n-of-n round. Arm the bounded grace ONCE on
      // this first observed departure (guarded by the joinGraceLogged one-shot so repeated
      // ~5s poll ticks never re-arm or reset the window); cohort-ready clears it and seats
      // the member. If no seat lands within the window, resolve to the deterministic
      // filled-or-closed terminal instead of hanging. The poll itself never fails a member.
      if (!joinGraceLogged) {
        joinGraceLogged = true;
        // Do NOT null awaitingSeats here (SVC-JOIN-2): the cohort has left the Advertised
        // set but is still LISTED in the widened directory with its live counts (captured
        // above), so the "{joined}/{capacity} seats" line stays truthful through the grace
        // window rather than blanking. It nulls only if the row later leaves the directory
        // entirely (handled at the top of this function).
        append('info', `cohort ${pickedCohortId} left the open set; awaiting seat confirmation`);
        joinGrace = setTimeout(() => {
          const { seated, status, awaitingSeats } = get();
          if (!seated && (status === 'connecting' || status === 'live')) {
            set({ joinClosed: true });
            // Full-lock terminal (D-25/CR-01 honesty): when the cohort locked at n/n and no
            // cohort-ready ever reached this browser, TWO causes are indistinguishable from
            // here - the library silently drops a surplus/duplicate opt-in (no reject signal
            // ever reaches the loser of the last-seat race), OR a genuinely granted seat's
            // confirmation was lost. State only the observed facts (locked full, not seated)
            // plus the honest uncertainty; never assert a delivery failure we cannot observe.
            if (awaitingSeats && awaitingSeats.joined === awaitingSeats.capacity) {
              fail(
                `The cohort locked with all ${awaitingSeats.capacity} seats filled and this browser was not seated; it may have filled without you, or your seat confirmation was lost.`,
              );
            } else {
              fail('That cohort filled or closed before you were seated. Pick another from the directory.');
            }
          }
        }, JOIN_SEAT_GRACE_MS);
      }
    },

    submitUpdate() {
      // The user clicked "Submit my DID update". Capture and null the module-scope deferred
      // FIRST so a repeated click is a no-op (idempotent, mirroring register()/publishIpfs()),
      // and always close the submit-window projection. Then resolve the captured deferred
      // with the EXACT body built when the window opened (the previewed body is the submitted
      // body, D-29) - no rebuild, BIP340 signing is non-deterministic. The runner records +
      // submits that body; `update-submitted` advances the timeline.
      const pending = pendingSubmit;
      pendingSubmit = null;
      set({ pendingSubmit: false });
      if (pending) {
        append('good', 'submitting your DID update to the cohort');
        pending.resolve();
      }
    },

    trackAnchor(baseUrl, cohortId) {
      // Fresh round: clear any prior anchor poll / lag retry (bumps anchorEpoch, resets the
      // failure + auto-resolve one-shots), then poll the PUBLIC anchor read.
      clearAnchorPoll();
      clearResolveLagRetry();
      autoResolved = false;
      const epoch = anchorEpoch;
      const tick = (): void => {
        fetchAnchor(baseUrl, cohortId).then(
          (dto) => {
            // Drop a stale in-flight read from a prior round (WR-01 class).
            if (epoch !== anchorEpoch) {
              return;
            }
            anchorFailures = 0;
            set({ anchor: dto, unreachable: false });
            // ADDITIONAL, never a replacement: this poll still reads the SERVICE's anchor
            // model, because that model is keyed by cohort id and an esplora endpoint has
            // no notion of a cohort (05-RESEARCH Pattern 7). All the participant's own
            // endpoint can add is an independent answer about a txid the service already
            // named, so it runs once per txid and only while an endpoint is active.
            const { chainEndpoint, endpointTxConfirmed } = get();
            if (chainEndpoint && dto.txid && endpointTxConfirmed === null) {
              void confirmTxAt(chainEndpoint, dto.txid).then((confirmed) => {
                if (epoch === anchorEpoch) {
                  set({ endpointTxConfirmed: confirmed });
                }
              });
            }
            // Auto-resolve exactly once when the stage completes (D-28): hermetic signed
            // (enabled:false) OR live confirmed. resolve() is a read, so automation is safe.
            if (!autoResolved && shouldAutoResolve(dto)) {
              autoResolved = true;
              void get().resolve(baseUrl);
              // Resolver-lag retry ONLY on a live service (Finding 7): the fixture answer is
              // immediate + stable, so retrying there is pointless.
              if (dto.enabled) {
                startResolveLagRetry(baseUrl);
              }
            }
            // Freeze (D-22): a hermetic service is confirmed signed after one read and must
            // never poll further; a live service freezes at first confirmation/failure.
            if (!dto.enabled || dto.state === 'confirmed' || dto.state === 'failed') {
              clearAnchorPoll();
            }
          },
          () => {
            if (epoch !== anchorEpoch) {
              return;
            }
            // A read error is "can't reach this service" (D-24), never a terminal by itself.
            anchorFailures += 1;
            if (anchorFailures >= UNREACHABLE_THRESHOLD) {
              set({ unreachable: true });
            }
          },
        );
      };
      // Immediate first read (so a hermetic service resolves its mode without a full
      // cadence), then the ~5s interval.
      tick();
      anchorPoll = setInterval(tick, ANCHOR_POLL_MS);
    },

    handlePostSeatSnapshot(rows, baseUrl) {
      const { status, seated, pickedCohortId } = get();
      // Only meaningful while seated in a still-live round for a picked cohort. Before
      // seating the pre-seat join poll owns the window; once complete/failed there is
      // nothing to watch. NEVER routes through handleDirectorySnapshot (Pitfall 6).
      if (!seated || pickedCohortId === null || status !== 'live') {
        return;
      }
      if (postSeatCohortGone(rows, pickedCohortId)) {
        // The picked cohort is absent from the directory ENTIRELY. This is AMBIGUOUS on a
        // single read (CR-01): a completed cohort legitimately drops its row the instant it
        // reaches Complete, which is the SAME completion that fires cohort-complete on a
        // different channel with no ordering guarantee, so a poll that observes the drop
        // first would false-fail a genuine success and discard the sidecar. Require
        // corroboration (D-24/D-25): only after POST_SEAT_GONE_CONFIRMATIONS consecutive
        // gone reads with no intervening completion do we declare the cohort dead. A racing
        // cohort-complete/cohort-failed SSE tears this poll down (teardownLive ->
        // clearPostSeatPoll resets the streak and bumps postSeatEpoch) before the threshold,
        // so the SSE always wins the directory-drop race.
        postSeatGoneStreak += 1;
        if (postSeatGoneStreak < POST_SEAT_GONE_CONFIRMATIONS) {
          append(
            'info',
            `cohort ${pickedCohortId} is not in the directory; a completion may still be arriving`,
          );
          return;
        }
        // The bounded streak completed with no intervening completion: a stalled or ended
        // cohort goes dark and the runner emits no cohort-expired event to members (Finding
        // 2). Land the honest D-25 fallback reason - best-effort, no invented certainty.
        append('warn', `cohort ${pickedCohortId} left the directory before completing`);
        fail(HONEST_TERMINAL_FALLBACK);
        // ...then, and ONLY then, ask why (SVC-04, D-02). The terminal state above is already
        // landed on exactly the shipped timing: the streak's consecutive-reads requirement exists
        // to win the race against cohort-complete (03-07 CR-01) and is untouched, and this read
        // runs AFTER it, once, never on a loop. It can only ever UPGRADE the copy from the honest
        // fallback to the operator's own attribution; an unreachable read or a false answer leaves
        // the fallback exactly as it is, because a network fault must not be able to accuse an
        // operator of anything (T-05-10-04).
        if (baseUrl) {
          const askedFor = pickedCohortId;
          void fetchCohortFate(baseUrl, askedFor).then((fate) => {
            // Guard on the ROUND, not on the poll epoch: `fail()` already tore the poll down, so
            // an epoch check would reject every answer. The question was asked about one cohort in
            // one failed round, so the answer applies only if that is still what the store holds.
            const s = get();
            if (fate.kind !== 'ok' || !fate.canceled) {
              return;
            }
            if (s.pickedCohortId !== askedFor || s.status !== 'failed') {
              return;
            }
            append('info', `service reports cohort ${askedFor} was canceled by the operator`);
            set({ canceled: true });
          });
        }
        return;
      }
      // Present (a signing-phase in-flight row is normal, D-26): the cohort is alive, so any
      // accumulated gone streak restarts and any prior transient unreachable signal clears.
      postSeatGoneStreak = 0;
      if (get().unreachable) {
        set({ unreachable: false });
      }
    },

    startOver() {
      // D-10: clear the round record AND erase the in-memory identity (the explicit
      // key-custody warning is the UI's, 03-06). Tear every poll/deferred/node down and
      // return to no-identity - the browse landing is the only way back in.
      clearDirectoryPoll();
      clearJoinGrace();
      teardownLive();
      teardownIpfs();
      clearCaptured();
      set({
        identity: null,
        did: null,
        idType: 'KEY',
        secret: null,
        status: 'no-identity',
        steps: { ...INITIAL_STEPS },
        cohortId: null,
        beaconAddress: null,
        seated: false,
        optedIn: false,
        joinClosed: false,
        awaitingSeats: null,
        pendingSubmit: false,
        pickedCohortId: null,
        beaconRegAddress: null,
        error: null,
        ...INITIAL_OUTCOME,
      });
      append('info', 'started over: cleared the cohort result and erased the in-memory identity');
    },

    leave() {
      clearDirectoryPoll();
      clearJoinGrace();
      teardownLive();
      teardownIpfs();
      clearCaptured();
      const { identity } = get();
      set({
        status: identity ? 'ready' : 'no-identity',
        steps: { ...INITIAL_STEPS },
        cohortId: null,
        beaconAddress: null,
        seated: false,
        optedIn: false,
        joinClosed: false,
        awaitingSeats: null,
        pendingSubmit: false,
        pickedCohortId: null,
        error: null,
        ...INITIAL_OUTCOME,
      });
      append('info', 'left the cohort');
    },

    downloadSidecar() {
      const { sidecar, did } = get();
      if (!sidecar || !did) {
        return;
      }
      downloadJson(`btcr2-sidecar-${didSlug(did)}.json`, sidecar);
      append('info', 'downloaded resolution sidecar');
    },

    async publishIpfs(baseUrl) {
      const { ipfsInfo, ipfsStatus, sidecar, result } = get();
      // Re-entrancy guard first (the button's disabled state lags a React commit).
      if (ipfsStatus === 'publishing') {
        return;
      }
      if (!ipfsInfo?.enabled) {
        set({ ipfsStatus: 'failed', ipfsError: 'the coordinator does not run an IPFS pinning node' });
        return;
      }
      if (!result?.included || !sidecar?.updates?.[0]) {
        set({ ipfsStatus: 'failed', ipfsError: 'no artifacts to publish (this DID was not included)' });
        return;
      }

      // Round token: if leave/re-join/regenerate resets the round while any await
      // below is in flight, every later step must become a no-op (no stale rows
      // in the new round's state, no resurrected node, no nulled-handle deref).
      const epoch = ipfsEpoch;
      const stale = () => epoch !== ipfsEpoch;

      set({ ipfsStatus: 'publishing', ipfsError: null });
      append('info', 'publishing resolution artifacts to IPFS');
      try {
        // The plan is built from the sidecar - the exact artifact set the
        // controller keeps. SMT proofs are deliberately absent: they are keyed by
        // the cohort's shared root, not their own digest, so no on-chain-derivable
        // CID can address them; they stay in the sidecar (see shared/src/ipfs.ts).
        const plan = buildPublishPlan({
          update: sidecar.updates[0],
          casAnnouncement: sidecar.casUpdates?.[0] as Record<string, string> | undefined,
          genesisDocument: sidecar.genesisDocument as Record<string, unknown> | undefined,
        });

        // Re-probe the coordinator NOW rather than trusting the page-load cache:
        // its pinning node listens on an ephemeral port with a fresh peer id per
        // boot, so after a coordinator restart the cached multiaddrs are dead
        // (and a manual reload was previously the only cure).
        const info = await fetchIpfsInfo(baseUrl).catch(() => null);
        if (stale()) {
          return;
        }
        if (info) {
          set({ ipfsInfo: info });
        }
        if (!info?.enabled || !info.multiaddrs?.length) {
          set({ ipfsStatus: 'failed', ipfsError: 'the coordinator no longer reports an IPFS pinning node' });
          return;
        }

        // Lazy-load the heavy Helia/libp2p chunk only now, on the explicit opt-in:
        // the eager bundle never carries it. Work on a LOCAL handle: the module
        // slot may be nulled by a mid-flight teardown, and the epoch check decides
        // whether this flow's node lives on or is discarded.
        const { createBrowserIpfsNode } = await import('../lib/ipfs-node');
        if (stale()) {
          return;
        }
        let node = ipfsLive;
        if (!node) {
          node = await createBrowserIpfsNode();
          if (stale()) {
            // The round was torn down while the node booted; it must not outlive it.
            node.stop().catch(() => {});
            return;
          }
          ipfsLive = node;
          append('info', `started in-browser IPFS node ${node.peerId}`);
        }
        await node.dialAny(info.multiaddrs);
        if (stale()) {
          return;
        }
        await node.publish(plan);
        if (stale()) {
          return;
        }
        append('good', `holding ${plan.length} artifact block(s); asking the coordinator to pin`);

        const pinResults = await requestPin(baseUrl, plan.map((p) => p.hashHex));
        if (stale()) {
          return;
        }
        const rows: IpfsPublishRow[] = plan.map((p) => {
          const r = pinResults.find((x) => x.hash === p.hashHex);
          return {
            kind: p.kind,
            label: p.label,
            hashHex: p.hashHex,
            cid: p.cid,
            pinned: r?.pinned ?? false,
            source: r?.source,
            error: r?.error,
          };
        });
        const allPinned = rows.every((r) => r.pinned);
        set({
          ipfsStatus: allPinned ? 'published' : 'failed',
          ipfsResults: rows,
          ipfsError: allPinned ? null : 'the coordinator could not pin every artifact',
        });
        for (const row of rows) {
          append(
            row.pinned ? 'good' : 'bad',
            row.pinned
              ? `${row.label} pinned by the coordinator (${row.source}) as ${row.cid}`
              : `${row.label} pin failed: ${row.error ?? 'unknown'}`,
          );
        }
      } catch (err) {
        if (stale()) {
          return;
        }
        const msg = err instanceof Error ? err.message : String(err);
        set({ ipfsStatus: 'failed', ipfsError: msg });
        append('bad', `IPFS publish failed: ${msg}`);
      }
    },

    async register(baseUrl, opts) {
      const { identity, did, beaconRegAddress, result, regStatus } = get();
      // Re-entrancy guard: the button's disabled state lags a React commit, so a
      // sub-frame double-click could fire two concurrent registrations that spend
      // the same UTXO; the second (conflicting) broadcast would fail and clobber the
      // first's 'registered' state. One attempt at a time.
      if (regStatus === 'checking' || regStatus === 'broadcasting') {
        return;
      }
      // Mainnet guard rail: this action spends real bitcoin, so it must never fire
      // without the user's explicit acknowledgment. Enforced here (not only in the
      // panel) so no future caller can skip it; first, before any network I/O.
      if (resolveNetwork(get().network).isMainnet && !opts?.acknowledgeMainnet) {
        set({
          regStatus: 'failed',
          regError: 'Bitcoin mainnet: confirm the real-funds acknowledgment before broadcasting.',
        });
        append('warn', 'registration blocked: mainnet requires the real-funds acknowledgment');
        return;
      }
      if (!identity || !did || !beaconRegAddress || !captured || captured.did !== did) {
        return;
      }
      if (!result?.included) {
        set({ regStatus: 'failed', regError: 'no update to register (this DID was not included)' });
        return;
      }

      // The participant's own chain source, if they chose one (PART-05, D-20). Built ONCE
      // here and threaded as a PARAMETER into the two chain calls below. Deliberately
      // read AFTER all three guards above: the endpoint changes where the chain is read,
      // never whether the acknowledgment, the re-entrancy guard or the funding check run.
      const endpoint = chainEndpointFor(get());
      set({ regStatus: 'checking', regError: null });
      append(
        'info',
        endpoint?.esploraBase
          ? `checking ${beaconRegAddress} for funds at ${endpoint.esploraBase}`
          : `checking ${beaconRegAddress} for funds`,
      );
      let utxos: Utxo[];
      try {
        utxos = await fetchUtxos(baseUrl, beaconRegAddress, endpoint);
      } catch (err) {
        const msg = err instanceof TxProxyError ? err.message : String(err);
        set({ regStatus: 'failed', regError: msg });
        append('bad', `funding check failed: ${msg}`);
        return;
      }

      const fundable = selectFundingUtxo(utxos);
      const min = Number(MIN_REGISTRATION_FUNDING_SATS);
      if (!fundable) {
        set({ regStatus: 'awaiting-funds' });
        append('warn', `no spendable funds at ${beaconRegAddress}; fund it (>= ${min} sats) then retry`);
        return;
      }

      set({ regStatus: 'broadcasting' });
      let rawHex: string;
      let txid: string;
      // The ONE fork in this path, and it is deliberately as late as possible: every guard, the
      // chain source and the funding check above are shared, so the wallet path cannot route
      // around the ADR 0010 acknowledgment, the re-entrancy guard or the funding minimum
      // (T-05-12-03). Below the fork, both paths broadcast through the SAME call.
      if (get().signingMethod === 'wallet') {
        // Re-read the verdict from the store rather than taking bytes from a caller: there is no
        // parameter through which unvalidated hex could reach the broadcast at all, so the only
        // transaction this path can send is one that matched the exported template byte for byte.
        const verdict = get().psbtVerdict;
        if (!verdict?.ok) {
          set({
            regStatus: 'failed',
            regError: 'Bring back a signed PSBT that matches this transaction before broadcasting.',
          });
          append('warn', 'registration blocked: no validated signed PSBT');
          return;
        }
        rawHex = verdict.rawHex;
        txid = verdict.txid;
        append('info', `funded (${fundable.value} sats); broadcasting the externally-signed tx`);
      } else {
        append('info', `funded (${fundable.value} sats); building + signing registration tx`);
        try {
          const tx = buildSingletonRegistrationTx({
            keys: identity.keys,
            utxo: fundable,
            updateHash: captured.updateHashBytes,
            // Sign for the coordinator's runtime network so the funded genesis beacon
            // address and the tx's P2TR script agree with the chain being spent on.
            network: resolveNetwork(get().network),
          });
          rawHex = tx.rawHex;
          txid = tx.txid;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          set({ regStatus: 'failed', regError: msg });
          append('bad', `could not build registration tx: ${msg}`);
          return;
        }
      }

      try {
        // Direct only when BOTH opt-ins are on; otherwise this is the shipped relay, and
        // a failure here is reported as-is. Rerouting a failed direct broadcast through
        // the service would send a real transaction down a path the participant did not
        // choose, which is the repudiation risk T-05-11-05 exists to close.
        const broadcastTxid = await broadcastTx(baseUrl, rawHex, endpoint);
        set({ regStatus: 'registered', regTxid: broadcastTxid });
        append('good', `broadcast first-update registration ${broadcastTxid}`);
      } catch (err) {
        const msg = err instanceof TxProxyError ? err.message : String(err);
        set({ regStatus: 'failed', regError: msg });
        append('bad', `broadcast failed: ${msg}`);
        // Keep the locally-built txid so the user can look it up if it did land.
        set({ regTxid: txid });
      }
    },

    setSigningMethod(method) {
      if (get().signingMethod === method) {
        return;
      }
      // Switching drops the round trip in BOTH directions. A PSBT exported for one path and a
      // verdict from the other are the kind of leftovers that get acted on by accident.
      set({
        signingMethod: method,
        psbtBase64: null,
        psbtTemplateHex: null,
        psbtReturned: '',
        psbtVerdict: null,
        psbtExporting: false,
        psbtExportError: null,
      });
    },

    async exportPsbt(baseUrl) {
      const { identity, did, beaconRegAddress, psbtExporting } = get();
      // Same re-entrancy discipline as register(): one funding read at a time.
      if (psbtExporting || !identity || !did || !beaconRegAddress || !captured || captured.did !== did) {
        return;
      }
      set({ psbtExporting: true, psbtExportError: null });
      // The participant's own chain source when they set one (PART-05): the export must read the
      // same chain the broadcast will use, or it would hand out a transaction spending a coin
      // that does not exist where the transaction lands.
      const endpoint = chainEndpointFor(get());
      let utxos: Utxo[];
      try {
        utxos = await fetchUtxos(baseUrl, beaconRegAddress, endpoint);
      } catch (err) {
        const msg = err instanceof TxProxyError ? err.message : String(err);
        set({ psbtExporting: false, psbtExportError: msg });
        append('bad', `could not read funds for the unsigned PSBT: ${msg}`);
        return;
      }
      const fundable = selectFundingUtxo(utxos);
      if (!fundable) {
        set({
          psbtExporting: false,
          psbtExportError: `No spendable funds at that address yet. Send at least ${MIN_REGISTRATION_FUNDING_SATS.toString()} sats in one payment, then try again.`,
        });
        return;
      }
      try {
        const { base64, templateHex } = exportRegistrationPsbt({
          keys: identity.keys,
          utxo: fundable,
          updateHash: captured.updateHashBytes,
          // The coordinator's runtime network, exactly as the signing path derives it.
          network: resolveNetwork(get().network),
        });
        set({
          psbtBase64: base64,
          psbtTemplateHex: templateHex,
          psbtExporting: false,
          psbtExportError: null,
          // A fresh export invalidates whatever came back for the previous one.
          psbtReturned: '',
          psbtVerdict: null,
        });
        append('info', `built an unsigned registration PSBT spending ${fundable.value} sats`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        set({ psbtExporting: false, psbtExportError: msg });
        append('bad', `could not build the unsigned PSBT: ${msg}`);
      }
    },

    submitSignedPsbt(input) {
      const templateHex = get().psbtTemplateHex;
      if (!templateHex) {
        // Nothing was exported, so there is nothing to compare against and no honest verdict to
        // give. The panel does not offer this step before an export, so this is belt and braces.
        return;
      }
      const text = typeof input === 'string' ? input : psbtBytesToBase64(input);
      if (text.trim().length === 0) {
        // An emptied field is not a rejected PSBT: clear the verdict rather than accuse.
        set({ psbtReturned: text, psbtVerdict: null });
        return;
      }
      const bytes = typeof input === 'string' ? psbtBase64ToBytes(input) : input;
      if (!bytes) {
        set({ psbtReturned: text, psbtVerdict: { ok: false, reason: 'unparseable' } });
        return;
      }
      const verdict = validateSignedPsbt(
        bytes,
        templateHex,
        REGISTRATION_FEE_SATS,
        resolveNetwork(get().network),
      );
      set({ psbtReturned: text, psbtVerdict: verdict });
      append(
        verdict.ok ? 'good' : 'warn',
        verdict.ok
          ? `signed PSBT checks out (${verdict.txid})`
          : `signed PSBT rejected (${verdict.reason})`,
      );
    },

    clearPsbt() {
      set({
        psbtBase64: null,
        psbtTemplateHex: null,
        psbtReturned: '',
        psbtVerdict: null,
        psbtExporting: false,
        psbtExportError: null,
      });
    },

    async resolve(baseUrl) {
      const { did, identity } = get();
      if (!did) {
        return;
      }
      set({ resolveStatus: 'resolving', resolveError: null });
      append('info', `resolving ${did}`);
      try {
        // An EXTERNAL (x1) DID needs its genesis supplied to the resolver (the server
        // does not hold it); a KEY (k1) DID resolves without one.
        const resolution = await resolveDid(baseUrl, did, identity?.genesisDocument);
        set({ resolveStatus: 'resolved', resolution });
        const beacon = findAppendedBeacon(resolution.didDocument, did);
        append(
          'good',
          beacon
            ? `resolved; aggregate beacon present (${beacon.type})`
            : 'resolved; genesis document (aggregate beacon not yet registered on-chain)',
        );
      } catch (err) {
        const msg = err instanceof ResolveError ? err.message : String(err);
        set({ resolveStatus: 'failed', resolveError: msg });
        append('bad', `resolve failed: ${msg}`);
      }
    },

    async useChainEndpoint(raw) {
      // The field disables and the line reads a neutral in-flight label while this runs:
      // no result is claimed until the probe returns (UI-SPEC E16 loading).
      set({ chainEndpointProbing: true, chainEndpointVerdict: null });
      const verdict = await checkEndpoint(raw, get().network);
      if (verdict.kind === 'ok') {
        set({
          chainEndpoint: verdict.base,
          chainEndpointVerdict: verdict,
          chainEndpointProbing: false,
          endpointTxConfirmed: null,
        });
        append('good', `reading the chain from ${verdict.base}`);
        return;
      }
      // A refused endpoint is NOT activated, and nothing about the current path changes.
      // The verdict is kept so the surface can say which of the four things happened.
      set({ chainEndpointVerdict: verdict, chainEndpointProbing: false });
      append('warn', `chain endpoint not used (${verdict.kind})`);
    },

    clearChainEndpoint() {
      // The second opt-in cannot outlive the opt-in it sits inside, and the independent
      // confirmation was a fact about an endpoint that is no longer in use.
      set({
        chainEndpoint: null,
        chainEndpointVerdict: null,
        chainEndpointProbing: false,
        broadcastDirect: false,
        endpointTxConfirmed: null,
      });
      append('info', 'reading the chain through this service');
    },

    setBroadcastDirect(on) {
      // Guarded rather than trusted: broadcasting "directly" with no endpoint would mean
      // broadcasting nowhere, so the flag simply cannot be raised on its own.
      if (on && !get().chainEndpoint) {
        return;
      }
      set({ broadcastDirect: on });
    },
  };
});
