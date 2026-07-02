import { create } from 'zustand';
import {
  createParticipant,
  type Participant,
} from '@btcr2-aggregation/participant';
import {
  buildSingletonRegistrationTx,
  createExternalIdentity,
  createIdentity,
  genesisP2trBeaconAddress,
  identitySecretHex,
  importExternalIdentity,
  importIdentity,
  isExternalIdentity,
  MIN_REGISTRATION_FUNDING_SATS,
  updateHashBytes,
  updateHashHex,
  type Identity,
  type IdType,
} from '@btcr2-aggregation/shared';
import { elapsed } from '../lib/clock';
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
  /** Onboarding model of the current identity: KEY (`k1`) or EXTERNAL (`x1`). */
  idType: IdType;
  /** Hex secret for the current identity (so the attendee can save/re-import it). */
  secret: string | null;
  status: ParticipantStatus;
  steps: Record<StepKey, StepStatus>;
  cohortId: string | null;
  beaconAddress: string | null;
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
  /** The one explicit user gate: connect to the service and auto-drive the protocol. */
  join(baseUrl: string): Promise<void>;
  /** Tear down the live participant and return to a fresh-but-identified state. */
  leave(): void;
  /** Download the resolution sidecar JSON (the artifacts a resolver needs). */
  downloadSidecar(): void;
  /**
   * LIVE only: check the beacon address for funds and, when funded, build + sign +
   * broadcast the first-update singleton-beacon registration transaction.
   */
  register(baseUrl: string): Promise<void>;
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

// Watchdog for a join that never discovers a cohort (coordinator unreachable):
// without it, transport.start() resolves and the SSE loops retry forever, so the
// UI would sit in 'connecting' silently. The timer flips to a failed state.
let joinWatchdog: ReturnType<typeof setTimeout> | null = null;
const JOIN_WATCHDOG_MS = 15000;

/**
 * Stop and forget the live participant. Critical after a cohort completes/fails:
 * the runner joins EVERY advert (shouldJoin always true), so a still-live runner
 * would auto-join the booth's next re-advertised cohort and silently re-run the
 * flow, reusing the attendee's key in a signature they never asked for.
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
}

function clearWatchdog(): void {
  if (joinWatchdog !== null) {
    clearTimeout(joinWatchdog);
    joinWatchdog = null;
  }
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
    set({ status: 'failed', error: reason });
    clearWatchdog();
    teardownLive();
  }

  function adopt(identity: Identity): void {
    clearCaptured();
    set({
      identity,
      did: identity.did,
      idType: isExternalIdentity(identity) ? 'EXTERNAL' : 'KEY',
      secret: identitySecretHex(identity),
      status: 'ready',
      steps: { ...INITIAL_STEPS },
      cohortId: null,
      beaconAddress: null,
      error: null,
      // The first-update SingletonBeacon address to fund is the key's genesis P2TR
      // address for both models: for k1 it is one of the deterministic genesis beacons,
      // for x1 it is the one declared in the identity's genesis document (same address).
      beaconRegAddress: genesisP2trBeaconAddress(identity.keys),
      ...INITIAL_OUTCOME,
    });
  }

  return {
    identity: null,
    did: null,
    idType: 'KEY',
    secret: null,
    status: 'no-identity',
    steps: { ...INITIAL_STEPS },
    cohortId: null,
    beaconAddress: null,
    error: null,
    log: [],
    beaconRegAddress: null,
    ...INITIAL_OUTCOME,

    generate(kind = 'KEY') {
      const identity = kind === 'EXTERNAL' ? createExternalIdentity() : createIdentity();
      adopt(identity);
      append('good', `generated ${kind === 'EXTERNAL' ? 'EXTERNAL (x1)' : 'KEY (k1)'} identity ${identity.did}`);
    },

    importSecret(hex, kind = 'KEY') {
      const clean = hex.trim().toLowerCase().replace(/^0x/, '');
      if (!/^[0-9a-f]{64}$/.test(clean)) {
        return 'Secret must be 64 hex characters (32 bytes).';
      }
      try {
        const identity = kind === 'EXTERNAL' ? importExternalIdentity(clean) : importIdentity(clean);
        adopt(identity);
        append('good', `imported ${kind === 'EXTERNAL' ? 'EXTERNAL (x1)' : 'KEY (k1)'} identity ${identity.did}`);
        return null;
      } catch (err) {
        return err instanceof Error ? err.message : String(err);
      }
    },

    async join(baseUrl) {
      const { identity, status } = get();
      if (!identity || status === 'connecting' || status === 'live') {
        return;
      }

      // Re-join after a completed/failed round: tear down the prior participant
      // first so we never leak its SSE streams or leave two runners listening.
      clearWatchdog();
      teardownLive();
      clearCaptured();
      set({ status: 'connecting', error: null, steps: { ...INITIAL_STEPS }, ...INITIAL_OUTCOME });
      append('info', `connecting to coordinator at ${baseUrl}`);

      const participant = createParticipant({ identity, baseUrl });
      live = participant;
      const r = participant.runner;

      r.on('cohort-discovered', (advert) => {
        // Reached the coordinator: the unreachable-coordinator watchdog can stand down.
        clearWatchdog();
        append('info', `discovered cohort ${advert.cohortId} (${advert.beaconType})`);
      });
      r.on('cohort-joined', ({ cohortId }) => {
        // Ignore a stray advert that arrives after this attendee already finished
        // (defense in depth; teardownLive on complete/fail normally prevents it).
        const st = get().status;
        if (st === 'complete' || st === 'failed') {
          return;
        }
        clearWatchdog();
        set({ cohortId, status: 'live' });
        setStep('join', 'done');
        setStep('submit', 'active');
        append('good', `joined cohort ${cohortId}; running distributed keygen`);
      });
      r.on('cohort-ready', ({ cohortId, beaconAddress }) => {
        set({ beaconAddress });
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
        set({ result, sidecar, status: 'complete', beaconAddress: info.beaconAddress });
        append('good', `cohort ${info.cohortId} anchored; your update was ${info.included ? 'included' : 'not included'}`);
        // Stop here: one cohort per Join. Otherwise the still-live runner would
        // auto-join the booth's next advert and reuse this key unbidden.
        clearWatchdog();
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
        setStep('join', 'active');
        append('info', 'listening for cohort adverts');
        // If no advert is discovered within the window, the coordinator is
        // unreachable; surface a failure rather than spinning forever.
        joinWatchdog = setTimeout(() => {
          joinWatchdog = null;
          if (get().status === 'connecting') {
            append('bad', 'could not reach the coordinator (no cohort advert received)');
            fail('Could not reach the coordinator. Check the connection and try again.');
          }
        }, JOIN_WATCHDOG_MS);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        append('bad', `failed to connect: ${message}`);
        fail(message);
      }
    },

    leave() {
      clearWatchdog();
      teardownLive();
      clearCaptured();
      const { identity } = get();
      set({
        status: identity ? 'ready' : 'no-identity',
        steps: { ...INITIAL_STEPS },
        cohortId: null,
        beaconAddress: null,
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

    async register(baseUrl) {
      const { identity, did, beaconRegAddress, result, regStatus } = get();
      // Re-entrancy guard: the button's disabled state lags a React commit, so a
      // sub-frame double-click could fire two concurrent registrations that spend
      // the same UTXO; the second (conflicting) broadcast would fail and clobber the
      // first's 'registered' state. One attempt at a time.
      if (regStatus === 'checking' || regStatus === 'broadcasting') {
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
