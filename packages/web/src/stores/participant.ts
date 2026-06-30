import { create } from 'zustand';
import {
  createParticipant,
  type Participant,
} from '@btcr2-aggregation/participant';
import {
  createIdentity,
  identitySecretHex,
  importIdentity,
  type Identity,
} from '@btcr2-aggregation/shared';
import { elapsed } from '../lib/clock';
import type { LogEntry, LogLevel, StepKey, StepStatus } from '../lib/types';

/** Connection lifecycle of the in-browser participant. */
export type ParticipantStatus = 'no-identity' | 'ready' | 'connecting' | 'live' | 'complete' | 'failed';

/** What the attendee keeps after their update is included in a cohort. */
export interface ParticipantResult {
  cohortId: string;
  beaconAddress: string;
  beaconType: string;
  included: boolean;
  /** Number of entries in the CAS announcement map (CAS beacons only). */
  announcementEntries: number;
}

interface ParticipantState {
  identity: Identity | null;
  did: string | null;
  /** Hex secret for the current identity (so the attendee can save/re-import it). */
  secret: string | null;
  status: ParticipantStatus;
  steps: Record<StepKey, StepStatus>;
  cohortId: string | null;
  beaconAddress: string | null;
  result: ParticipantResult | null;
  error: string | null;
  log: LogEntry[];

  /** Generate a fresh did:btcr2 KEY identity in-browser. */
  generate(): void;
  /** Reconstruct an identity from a saved secret (hex). Returns an error string on failure. */
  importSecret(hex: string): string | null;
  /** The one explicit user gate: connect to the service and auto-drive the protocol. */
  join(baseUrl: string): Promise<void>;
  /** Tear down the live participant and return to a fresh-but-identified state. */
  leave(): void;
}

// The live participant (transport + runner + event emitters) is intentionally
// kept OUT of reactive state: it is a long-lived object with listeners, not a
// value React should diff. The store holds only the serializable projection.
let live: Participant | null = null;

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
    set({
      identity,
      did: identity.did,
      secret: identitySecretHex(identity),
      status: 'ready',
      steps: { ...INITIAL_STEPS },
      cohortId: null,
      beaconAddress: null,
      result: null,
      error: null,
    });
  }

  return {
    identity: null,
    did: null,
    secret: null,
    status: 'no-identity',
    steps: { ...INITIAL_STEPS },
    cohortId: null,
    beaconAddress: null,
    result: null,
    error: null,
    log: [],

    generate() {
      const identity = createIdentity();
      adopt(identity);
      append('good', `generated identity ${identity.did}`);
    },

    importSecret(hex) {
      const clean = hex.trim().toLowerCase().replace(/^0x/, '');
      if (!/^[0-9a-f]{64}$/.test(clean)) {
        return 'Secret must be 64 hex characters (32 bytes).';
      }
      try {
        const identity = importIdentity(clean);
        adopt(identity);
        append('good', `imported identity ${identity.did}`);
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
      set({ status: 'connecting', error: null, result: null, steps: { ...INITIAL_STEPS } });
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
        const result: ParticipantResult = {
          cohortId: info.cohortId,
          beaconAddress: info.beaconAddress,
          beaconType: info.beaconType,
          included: info.included,
          announcementEntries: info.casAnnouncement ? Object.keys(info.casAnnouncement).length : 0,
        };
        set({ result, status: 'complete', beaconAddress: info.beaconAddress });
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
      const { identity } = get();
      set({
        status: identity ? 'ready' : 'no-identity',
        steps: { ...INITIAL_STEPS },
        cohortId: null,
        beaconAddress: null,
        result: null,
        error: null,
      });
      append('info', 'left the cohort');
    },
  };
});
