import { create } from 'zustand';
import {
  login as apiLogin,
  logout as apiLogout,
  advertise as apiAdvertise,
  readvertise as apiReadvertise,
  createDraft as apiCreateDraft,
  discardDraft as apiDiscardDraft,
  listCohorts as apiListCohorts,
  sessionProbe,
  type DraftInput,
  type OperatorCohortDTO,
} from '../lib/operator';

/**
 * Operator console auth state machine (mirrors the status-union pattern of
 * `stores/participant.ts`). Login state is determined ONLY via the server session probe
 * (`GET /v1/operator/session`), never by reading the browser cookie - the session
 * cookie is httpOnly and unreadable by design (ADR 0015). `disabled` is the fail-closed
 * boot state (no operator password set, D-07).
 *
 * The store also owns the operator's cohort drafts (SVC-01): `submitDraft` creates,
 * `discard` removes, and `refreshCohorts` reloads the list. The list is refreshed after
 * a successful login/probe so a returning operator sees their existing drafts.
 */
export type OperatorAuthStatus = 'checking' | 'logged-out' | 'logging-in' | 'logged-in' | 'disabled';

/** Create-form lifecycle for the cohort draft submit. */
export type CreateStatus = 'idle' | 'creating' | 'error';

/** Advertise-action lifecycle (per draft row). */
export type AdvertiseStatus = 'idle' | 'advertising' | 'error';

/** Transient advertise success copy (spaced hyphen per house style; UI-SPEC intent). */
const ADVERTISED_OK = 'Advertised - now joinable in the directory.';

/** Transient re-advertise success copy (an expired cohort brought back to the directory). */
const READVERTISED_OK = 'Re-advertised - back in the directory as a fresh cohort.';

/** Exact invalid-password copy (UI-SPEC); never reveals whether a session/account exists. */
const INVALID_PASSWORD =
  'Incorrect password. Check the operator password set for this service and try again.';
const THROTTLED = 'Too many attempts. Wait a few minutes and try again.';
const UNREACHABLE = 'Could not reach the service. Check that it is running, then reload.';

interface OperatorState {
  auth: OperatorAuthStatus;
  error?: string;
  /** The operator's own cohorts (drafts now; advertised entries once plan 03 lands). */
  cohorts: OperatorCohortDTO[];
  /** Create-form submit status; drives the button's `Creating…` label. */
  createStatus: CreateStatus;
  /** Server (or client) validation message for the create form, when present. */
  formError?: string;
  /** Advertise-action status; drives the row's `Advertising…` label. */
  advertiseStatus: AdvertiseStatus;
  /** The draft id currently being advertised, so only that row shows the spinner. */
  advertisingId?: string;
  /** Transient good-tone confirmation shown after a successful advertise. */
  advertiseMessage?: string;
  /** Probe the session on mount: resolves to logged-in / logged-out / disabled. */
  probe: (baseUrl: string) => Promise<void>;
  /** Attempt sign-in; maps 200/401/429/404 to the matching status + copy. */
  signIn: (baseUrl: string, password: string) => Promise<void>;
  /** Sign out server-side, then drop to logged-out regardless of the response. */
  signOut: (baseUrl: string) => Promise<void>;
  /** Reload the operator cohort list. */
  refreshCohorts: (baseUrl: string) => Promise<void>;
  /** Create a draft; on a 400 set `formError`, on success clear it and refresh the list. */
  submitDraft: (baseUrl: string, input: DraftInput) => Promise<void>;
  /** Advertise a draft; on success show the transient confirmation and refresh the list. */
  advertise: (baseUrl: string, id: string) => Promise<void>;
  /** Re-advertise an expired cohort; on success show the confirmation and refresh the list. */
  readvertise: (baseUrl: string, id: string) => Promise<void>;
  /** Discard an un-advertised draft, then refresh the list. */
  discard: (baseUrl: string, id: string) => Promise<void>;
}

export const useOperator = create<OperatorState>((set, get) => ({
  auth: 'checking',
  error: undefined,
  cohorts: [],
  createStatus: 'idle',
  formError: undefined,
  advertiseStatus: 'idle',
  advertisingId: undefined,
  advertiseMessage: undefined,

  async probe(baseUrl) {
    set({ auth: 'checking', error: undefined });
    try {
      const state = await sessionProbe(baseUrl);
      set({ auth: state });
      if (state === 'logged-in') {
        void get().refreshCohorts(baseUrl);
      }
    } catch {
      // A network/stall signal on the probe leaves the operator at the login screen
      // (not 'disabled', which is reserved for the explicit 404 fail-closed signal).
      set({ auth: 'logged-out', error: UNREACHABLE });
    }
  },

  async signIn(baseUrl, password) {
    set({ auth: 'logging-in', error: undefined });
    try {
      const status = await apiLogin(baseUrl, password);
      if (status === 200) {
        set({ auth: 'logged-in', error: undefined });
        void get().refreshCohorts(baseUrl);
      } else if (status === 429) {
        set({ auth: 'logged-out', error: THROTTLED });
      } else if (status === 404) {
        set({ auth: 'disabled', error: undefined });
      } else {
        set({ auth: 'logged-out', error: INVALID_PASSWORD });
      }
    } catch {
      set({ auth: 'logged-out', error: UNREACHABLE });
    }
  },

  async signOut(baseUrl) {
    try {
      await apiLogout(baseUrl);
    } finally {
      set({
        auth: 'logged-out',
        error: undefined,
        cohorts: [],
        formError: undefined,
        createStatus: 'idle',
        advertiseStatus: 'idle',
        advertisingId: undefined,
        advertiseMessage: undefined,
      });
    }
  },

  async refreshCohorts(baseUrl) {
    try {
      const cohorts = await apiListCohorts(baseUrl);
      set({ cohorts });
    } catch {
      // A transient list failure leaves the last-known list in place rather than
      // wiping the operator's view; the next successful refresh reconciles it.
    }
  },

  async submitDraft(baseUrl, input) {
    set({ createStatus: 'creating', formError: undefined });
    try {
      const result = await apiCreateDraft(baseUrl, input);
      if (result.ok) {
        set({ createStatus: 'idle', formError: undefined });
        await get().refreshCohorts(baseUrl);
      } else {
        set({ createStatus: 'error', formError: result.error });
      }
    } catch {
      set({ createStatus: 'error', formError: UNREACHABLE });
    }
  },

  async advertise(baseUrl, id) {
    set({ advertiseStatus: 'advertising', advertisingId: id, advertiseMessage: undefined, formError: undefined });
    try {
      const ok = await apiAdvertise(baseUrl, id);
      if (ok) {
        set({ advertiseStatus: 'idle', advertisingId: undefined, advertiseMessage: ADVERTISED_OK });
        await get().refreshCohorts(baseUrl);
        // Clear the transient confirmation after a few seconds, but only if it is still
        // the same message (a later action may have replaced it).
        setTimeout(() => {
          if (get().advertiseMessage === ADVERTISED_OK) {
            set({ advertiseMessage: undefined });
          }
        }, 4000);
      } else {
        set({ advertiseStatus: 'error', advertisingId: undefined, formError: 'Could not advertise the draft. Try again.' });
      }
    } catch {
      set({ advertiseStatus: 'error', advertisingId: undefined, formError: UNREACHABLE });
    }
  },

  async readvertise(baseUrl, id) {
    set({ advertiseStatus: 'advertising', advertisingId: id, advertiseMessage: undefined, formError: undefined });
    try {
      const ok = await apiReadvertise(baseUrl, id);
      if (ok) {
        set({ advertiseStatus: 'idle', advertisingId: undefined, advertiseMessage: READVERTISED_OK });
        await get().refreshCohorts(baseUrl);
        // Clear the transient confirmation after a few seconds, but only if it is still
        // the same message (a later action may have replaced it).
        setTimeout(() => {
          if (get().advertiseMessage === READVERTISED_OK) {
            set({ advertiseMessage: undefined });
          }
        }, 4000);
      } else {
        set({ advertiseStatus: 'error', advertisingId: undefined, formError: 'Could not re-advertise the cohort. Try again.' });
      }
    } catch {
      set({ advertiseStatus: 'error', advertisingId: undefined, formError: UNREACHABLE });
    }
  },

  async discard(baseUrl, id) {
    await apiDiscardDraft(baseUrl, id);
    await get().refreshCohorts(baseUrl);
  },
}));
