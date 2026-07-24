import { create } from 'zustand';
import {
  login as apiLogin,
  logout as apiLogout,
  advertise as apiAdvertise,
  readvertise as apiReadvertise,
  createDraft as apiCreateDraft,
  discardDraft as apiDiscardDraft,
  fetchOperatorCohorts,
  fetchCohortDetail,
  sessionProbe,
  type CohortDetailDTO,
  type CohortSummaryDTO,
  type DraftInput,
  type OperatorCohortDTO,
  type ServiceMetricsDTO,
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

/** Transient advertise success copy (UI-SPEC verbatim, em-dash-free). */
const ADVERTISED_OK = 'Advertised. Now joinable in the directory.';

/** Transient re-advertise success copy (an expired cohort brought back to the directory). */
const READVERTISED_OK = 'Re-advertised. Back in the directory as a fresh cohort.';

/** Exact invalid-password copy (UI-SPEC); never reveals whether a session/account exists. */
const INVALID_PASSWORD =
  'Incorrect password. Check the operator password set for this service and try again.';
const THROTTLED = 'Too many attempts. Wait a few minutes and try again.';
const UNREACHABLE = 'Could not reach the service. Check that it is running, then reload.';

/**
 * Exact session-expired copy (UI-SPEC, D-16), shown when a monitoring poll returns 401
 * mid-session: the operator is dropped to the login screen with an honest re-login line
 * (distinct from a network fault, which freezes the view). Em-dash-free per house style.
 */
export const SESSION_EXPIRED =
  "Your operator session ended. Sign in again to keep monitoring. Monitoring rebuilds from this service's state after you sign in.";

/**
 * SPA-internal drill-down view state (D-03, NO routed URLs this phase): the console shows
 * the cohort list by default and toggles to a single active drill-down by cohort id. The
 * back link returns to the list. Mirrors the participant `participantView` toggle.
 */
export type OperatorView = { kind: 'list' } | { kind: 'detail'; cohortId: string };

interface OperatorState {
  auth: OperatorAuthStatus;
  error?: string;
  /** The operator's own cohorts (drafts, advertised, and expired records). */
  cohorts: OperatorCohortDTO[];
  /**
   * Live monitoring summary rows (one per live or ended cohort), keyed by cohortId, from the
   * `monitoring` sibling of `GET /v1/operator/cohorts` (SVC-03, D-06). Empty until the first
   * list read lands; the list surface maps each advertised cohort to its chip from here.
   */
  rows: CohortSummaryDTO[];
  /** Service-level live counts backing the metrics row (D-06); undefined until the first read. */
  metrics?: ServiceMetricsDTO;
  /**
   * True when the last LIST poll was unreachable, so the displayed list/metrics are frozen
   * last-known state (D-25) and the unreachable banner shows; cleared on the next ok read.
   */
  listStale: boolean;
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
  /** SPA-internal drill-down view (D-03): the cohort list, or one open cohort detail. */
  view: OperatorView;
  /** Last-known monitoring detail for the open drill-down; undefined until the first poll lands. */
  detail?: CohortDetailDTO;
  /**
   * True when the last detail poll was unreachable, so the displayed `detail` is frozen
   * last-known state (D-25); cleared on the next successful poll.
   */
  detailStale: boolean;
  /** Wall-clock (ms) of the last successful detail poll, driving the freshness indicator (D-25). */
  lastUpdated?: number;
  /** Probe the session on mount: resolves to logged-in / logged-out / disabled. */
  probe: (baseUrl: string) => Promise<void>;
  /** Attempt sign-in; maps 200/401/429/404 to the matching status + copy. */
  signIn: (baseUrl: string, password: string) => Promise<void>;
  /** Sign out server-side, then drop to logged-out regardless of the response. */
  signOut: (baseUrl: string) => Promise<void>;
  /** Reload the operator cohort list. */
  refreshCohorts: (baseUrl: string) => Promise<void>;
  /**
   * Create a draft; on a 400 set `formError`, on success clear it and refresh the list.
   * Forwards the whole two-field {@link DraftInput} (`{ beaconType, size, threshold }`)
   * unchanged - size = n seats, threshold = k the signing floor (G-02-1).
   */
  submitDraft: (baseUrl: string, input: DraftInput) => Promise<void>;
  /** Advertise a draft; on success show the transient confirmation and refresh the list. */
  advertise: (baseUrl: string, id: string) => Promise<void>;
  /** Re-advertise an expired cohort; on success show the confirmation and refresh the list. */
  readvertise: (baseUrl: string, id: string) => Promise<void>;
  /** Discard an un-advertised draft, then refresh the list. */
  discard: (baseUrl: string, id: string) => Promise<void>;
  /** Open a cohort's drill-down (D-03): set the detail view and clear any stale prior detail. */
  openCohort: (id: string) => void;
  /** Close the drill-down: return to the cohort list and clear the detail slice. */
  closeCohort: () => void;
  /**
   * Poll the open cohort's gated detail read once (SVC-03). Branches on the discriminated
   * result: `unauthorized` drops to the logged-out state with the session-expired copy
   * (D-16, honest re-login); `unreachable` freezes the last-known `detail` and flags it
   * stale (D-25); `ok` stores the fresh detail, clears the stale flag, and stamps
   * `lastUpdated`. No-op when no drill-down is open.
   */
  pollDetail: (baseUrl: string) => Promise<void>;
}

export const useOperator = create<OperatorState>((set, get) => ({
  auth: 'checking',
  error: undefined,
  cohorts: [],
  rows: [],
  metrics: undefined,
  listStale: false,
  createStatus: 'idle',
  formError: undefined,
  advertiseStatus: 'idle',
  advertisingId: undefined,
  advertiseMessage: undefined,
  view: { kind: 'list' },
  detail: undefined,
  detailStale: false,
  lastUpdated: undefined,

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
        rows: [],
        metrics: undefined,
        listStale: false,
        formError: undefined,
        createStatus: 'idle',
        advertiseStatus: 'idle',
        advertisingId: undefined,
        advertiseMessage: undefined,
        view: { kind: 'list' },
        detail: undefined,
        detailStale: false,
        lastUpdated: undefined,
      });
    }
  },

  async refreshCohorts(baseUrl) {
    // The list read is discriminated like the drill-down poll (D-16/D-25): a 401 is a
    // session expiry (honest re-login), an unreachable read freezes the last-known list
    // and raises the banner, and an ok read updates the list + monitoring + freshness stamp.
    const result = await fetchOperatorCohorts(baseUrl);
    if (result.kind === 'unauthorized') {
      // Session expired mid-monitoring (D-16): drop to the login screen with the honest
      // re-login copy and clear the drill-down, mirroring pollDetail's 401 branch.
      set({
        auth: 'logged-out',
        error: SESSION_EXPIRED,
        cohorts: [],
        rows: [],
        metrics: undefined,
        listStale: false,
        view: { kind: 'list' },
        detail: undefined,
        detailStale: false,
        lastUpdated: undefined,
      });
      return;
    }
    if (result.kind === 'unreachable') {
      // Freeze the last-known list (D-25): keep it visible, flag it stale for the banner +
      // freshness indicator, and retry quietly on the next tick. Never blank the view.
      set({ listStale: true });
      return;
    }
    set({
      cohorts: result.value.cohorts,
      rows: result.value.monitoring?.rows ?? [],
      metrics: result.value.monitoring?.metrics,
      listStale: false,
      lastUpdated: Date.now(),
    });
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
        // Land the operator in the freshly-advertised cohort's drill-down (D-13): the draft
        // id becomes the live cohort id on advertise. Guard on a still-signed-in session so a
        // 401 during the refresh above (which drops to logged-out) is not overridden.
        if (get().auth === 'logged-in') {
          get().openCohort(id);
        }
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

  openCohort(id) {
    // Start the drill-down in its checking state: clear any prior cohort's detail so the
    // page renders its documented empty/checking lines until the first poll lands (D-03,
    // UI-SPEC E4/E5 loading), rather than briefly showing a stale cohort's members.
    set({ view: { kind: 'detail', cohortId: id }, detail: undefined, detailStale: false, lastUpdated: undefined });
  },

  closeCohort() {
    set({ view: { kind: 'list' }, detail: undefined, detailStale: false, lastUpdated: undefined });
  },

  async pollDetail(baseUrl) {
    const { view } = get();
    if (view.kind !== 'detail') {
      return;
    }
    const result = await fetchCohortDetail(baseUrl, view.cohortId);
    if (result.kind === 'unauthorized') {
      // Session expired mid-monitoring (D-16): honest re-login. Drop to the login screen
      // and back to the list view so the next sign-in starts clean; distinct from an
      // unreachable fault, which freezes the view below.
      set({
        auth: 'logged-out',
        error: SESSION_EXPIRED,
        view: { kind: 'list' },
        detail: undefined,
        detailStale: false,
        lastUpdated: undefined,
      });
      return;
    }
    if (result.kind === 'unreachable') {
      // Freeze the last-known detail (D-25): keep it visible, flag it stale for the
      // freshness indicator, and retry quietly on the next tick. Never blank the view.
      set({ detailStale: true });
      return;
    }
    set({ detail: result.value, detailStale: false, lastUpdated: Date.now() });
  },
}));
