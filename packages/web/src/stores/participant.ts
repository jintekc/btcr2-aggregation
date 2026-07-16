import { create } from 'zustand';
import {
  createParticipant,
  type Participant,
} from '@btcr2-aggregation/participant';
import {
  buildPublishPlan,
  buildSingletonRegistrationTx,
  createExternalIdentity,
  createIdentity,
  DEFAULT_NETWORK,
  genesisP2trBeaconAddress,
  identitySecretHex,
  importExternalIdentity,
  importIdentity,
  isExternalIdentity,
  MIN_REGISTRATION_FUNDING_SATS,
  resolveNetwork,
  updateHashBytes,
  updateHashHex,
  type Identity,
  type IdType,
  type NetworkName,
  type PublishableArtifactKind,
} from '@btcr2-aggregation/shared';
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
import { broadcastTx, fetchUtxos, TxProxyError, type Utxo } from '../lib/tx-client';
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
   * `createParticipant` so the runner opts into that cohort alone.
   */
  join(baseUrl: string, cohortId: string): Promise<void>;
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
  /** Resolve this DID via the coordinator (`GET /resolve/:did`) and keep the document. */
  resolve(baseUrl: string): Promise<void>;
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
  regStatus: 'idle' as RegistrationStatus,
  regTxid: null,
  regError: null,
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
    set({ status: 'failed', error: reason, awaitingSeats: null });
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

  return {
    identity: null,
    did: null,
    network: DEFAULT_NETWORK,
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
    pickedCohortId: null,
    error: null,
    log: [],
    beaconRegAddress: null,
    ipfsInfo: null,
    ...INITIAL_OUTCOME,

    async loadConfig(baseUrl) {
      // Probe IPFS availability in parallel: purely additive (the publish panel's
      // enablement), so its failure must never delay or block the network config.
      const ipfsProbe = fetchIpfsInfo(baseUrl).then(
        (info) => set({ ipfsInfo: info }),
        () => set({ ipfsInfo: { enabled: false } }),
      );
      try {
        const dto = await fetchNetworkConfig(baseUrl);
        set({ network: dto.network, configStatus: 'ready' });
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

    async join(baseUrl, cohortId) {
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
        pickedCohortId: cohortId,
        ...INITIAL_OUTCOME,
      });
      append('info', `connecting to ${baseUrl} to join cohort ${cohortId}`);

      // Browse-and-pick (PART-02/D-14): the picked cohortId is threaded into the
      // runner so `shouldJoin` opts into that cohort alone and ignores every other
      // advert on the public transport.
      const participant = createParticipant({ identity, baseUrl, cohortId });
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
        append('good', `joined cohort ${cohortId}; running distributed keygen`);
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
        append('info', 'validating aggregated cohort data');
      });
      r.on('signing-requested', () => {
        append('info', 'co-signing: contributing MuSig2 nonce + partial signature');
      });
      r.on('fallback-requested', () => {
        append('warn', 'key path stalled; co-signing the k-of-n script-path fallback');
      });
      r.on('cohort-complete', (info) => {
        setStep('sign', 'done');
        setStep('anchored', 'done');

        // Capture this participant's own signed update body BEFORE teardown: the
        // runner never re-emits it and it cannot be rebuilt to the same canonical
        // hash (BIP340 signing is non-deterministic). Only present when included.
        const body = info.included ? live?.getSubmittedUpdate(info.cohortId) : undefined;
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
        set({ result, sidecar, status: 'complete', beaconAddress: info.beaconAddress, awaitingSeats: null });
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
      if (!pickedCohortClosed(rows, pickedCohortId)) {
        // Defensive (IN-03): a cohort id never re-enters Advertised once it locks
        // membership (a re-advertise mints a fresh id), but if a flaky/replayed
        // directory re-lists the picked cohort as Advertised after an earlier
        // departure already armed the grace, cancel that stale timer - a genuinely
        // reopened cohort must not be torn down at first-departure + 90s.
        if (joinGrace !== null) {
          clearJoinGrace();
        }
        // Still openly Advertised: keep waiting (wait-for-n). Capture the picked row's
        // live joined / capacity so the join flow can render a truthful "Waiting for the
        // cohort to fill" line. This is the only place awaitingSeats is set to a value.
        const row = rows.find((r) => r.cohortId === pickedCohortId && r.phase === 'Advertised');
        if (row) {
          set({ awaitingSeats: { joined: row.joined, capacity: row.capacity } });
        }
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
        // The row is gone from the Advertised set, so its frozen joined/capacity counts
        // are stale - clear the "Waiting for the cohort to fill (j/n seats)" line rather
        // than keep claiming a live fill count for the 90s grace window (IN-01). The
        // waiting surface disappearing while the seat resolves is the honest state.
        set({ awaitingSeats: null });
        append('info', `cohort ${pickedCohortId} left the open set; awaiting seat confirmation`);
        joinGrace = setTimeout(() => {
          const { seated, status } = get();
          if (!seated && (status === 'connecting' || status === 'live')) {
            set({ joinClosed: true });
            fail('That cohort filled or closed before you were seated. Pick another from the directory.');
          }
        }, JOIN_SEAT_GRACE_MS);
      }
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

      set({ regStatus: 'checking', regError: null });
      append('info', `checking ${beaconRegAddress} for funds`);
      let utxos: Utxo[];
      try {
        utxos = await fetchUtxos(baseUrl, beaconRegAddress);
      } catch (err) {
        const msg = err instanceof TxProxyError ? err.message : String(err);
        set({ regStatus: 'failed', regError: msg });
        append('bad', `funding check failed: ${msg}`);
        return;
      }

      const min = Number(MIN_REGISTRATION_FUNDING_SATS);
      const fundable = utxos
        .filter((u) => u.value >= min)
        .sort((a, b) => b.value - a.value)[0];
      if (!fundable) {
        set({ regStatus: 'awaiting-funds' });
        append('warn', `no spendable funds at ${beaconRegAddress}; fund it (>= ${min} sats) then retry`);
        return;
      }

      set({ regStatus: 'broadcasting' });
      append('info', `funded (${fundable.value} sats); building + signing registration tx`);
      let rawHex: string;
      let txid: string;
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

      try {
        const broadcastTxid = await broadcastTx(baseUrl, rawHex);
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
  };
});
