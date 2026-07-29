import { create } from 'zustand';
import {
  login as apiLogin,
  logout as apiLogout,
  advertise as apiAdvertise,
  readvertise as apiReadvertise,
  cancelCohort as apiCancelCohort,
  createDraft as apiCreateDraft,
  updateDraft as apiUpdateDraft,
  discardDraft as apiDiscardDraft,
  dismissEnded as apiDismissEnded,
  disableBroadcast as apiDisableBroadcast,
  downloadExport as apiDownloadExport,
  finalizeCohort as apiFinalizeCohort,
  pauseAdvertising as apiPauseAdvertising,
  resumeAdvertising as apiResumeAdvertising,
  fetchOperatorCohorts,
  fetchCohortDetail,
  fetchSettings as apiFetchSettings,
  saveSettings as apiSaveSettings,
  sessionProbe,
  type ActivityEntryDTO,
  type CohortDetailDTO,
  type CohortSummaryDTO,
  type DraftInput,
  type OperatorCohortDTO,
  type CohortDefaultsDTO,
  type ServiceHealthDTO,
  type ServiceMetricsDTO,
  type SettingsPatchDTO,
  type SettingsSnapshotDTO,
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

/** Draft-edit lifecycle; mirrors {@link CreateStatus} because the two forms behave identically. */
export type EditStatus = 'idle' | 'saving' | 'error';

/**
 * The next-cohort-only line (D-13), rendered on the draft-edit form. It is the human half of a
 * rule the SERVER enforces (`updateDraft` refuses anything that is not a draft): the operator is
 * told up front that an advertised cohort keeps its shape, rather than discovering it by being
 * refused. 05-UI-SPEC verbatim, em-dash-free.
 */
export const NEXT_COHORT_ONLY_LINE =
  'Applies to new cohorts only. A cohort that is already advertised keeps the shape it was advertised with.';

/**
 * The reason a NON-draft row states in place of an edit action (05-UI-SPEC). Stating it beats
 * hiding the action silently: an operator who edited one row and cannot find the control on the
 * next needs to know it is the cohort's state, not a bug or a missing permission.
 */
export const EDIT_UNAVAILABLE_REASON = 'Only a draft can be edited. This cohort is already advertised.';

/** Transient advertise success copy (UI-SPEC verbatim, em-dash-free). */
const ADVERTISED_OK = 'Advertised. Now joinable in the directory.';

/** Transient re-advertise success copy (an expired cohort brought back to the directory). */
const READVERTISED_OK = 'Re-advertised. Back in the directory as a fresh cohort.';

/** Exact invalid-password copy (UI-SPEC); never reveals whether a session/account exists. */
const INVALID_PASSWORD =
  'Incorrect password. Check the operator password set for this service and try again.';
const THROTTLED = 'Too many attempts. Wait a few minutes and try again.';
const UNREACHABLE = 'Could not reach the service. Check that it is running, then reload.';

/** Bad-tone copy when the gated per-cohort JSON export could not be served (review WR-06). */
export const EXPORT_FAILED = 'Could not download the monitoring record. Check the service, then try again.';

/** Bad-tone copy when a draft discard did not take (review WR-06). */
export const DISCARD_FAILED = 'Could not discard the draft. Try again.';

/**
 * Exact action-error copy for a one-shot lifecycle action that did not take (05-UI-SPEC error
 * state). The second sentence is load-bearing: a failed destructive action must say plainly that
 * NOTHING changed, so the operator does not go looking for damage or click again on a cohort that
 * is still running. Em-dash-free per house style.
 */
export const ACTION_FAILED = "That action didn't go through. Nothing about this cohort changed.";

/** The same line with the service's own reason, when it gave one. */
export function actionFailedWith(reason?: string): string {
  return reason ? `That action didn't go through: ${reason}. Nothing about this cohort changed.` : ACTION_FAILED;
}

/**
 * The advertising DRAIN-MODE copy set (SVC-04, 05-UI-SPEC E4, D-06 through D-09). Every string
 * below is exact contract copy and is asserted verbatim by
 * `packages/web/tests/service-controls.spec.ts`, because these are the sentences that stop a pause
 * from being misunderstood. All are free of the long dash per house style.
 */

/**
 * The paused state line. Its second clause is the load-bearing half: pause is DRAIN MODE, not a
 * kill switch, so an operator reading it must not conclude that their open cohorts just died.
 */
export const ADVERTISING_PAUSED_LINE =
  'New cohorts are not being advertised. Cohorts already advertised keep filling, and everything else on this service keeps running.';

/** The running state line, rendered only once the service has actually reported not-paused. */
export const ADVERTISING_RUNNING_LINE = 'New cohorts are being advertised normally.';

/** Transient good-tone confirmation after a successful pause. */
export const PAUSED_OK = 'Advertising paused.';

/** Transient good-tone confirmation after a successful resume. */
export const RESUMED_OK = 'Advertising resumed.';

/**
 * The reason rendered beside the disabled `Advertise cohort` / `Re-advertise` buttons while
 * paused. A disabled control with no reason is indistinguishable from a broken one, and the
 * server would refuse the click with a 409 anyway (D-06), so the console states the same fact up
 * front rather than letting the operator discover it by being refused.
 */
export const ADVERTISE_DISABLED_REASON = 'Advertising is paused.';

/**
 * The restart-honesty line (D-08/D-12). Runtime settings are deliberately non-persistent
 * (`packages/service/src/runtime-settings.ts` has no write path of any kind, and a spec pins that
 * absence), so this sentence is true only while that stays true. Durable state across a restart
 * is DUR-01, a v2 requirement.
 */
export const RESTART_HONESTY_LINE =
  'Pause, broadcast, and settings changes live in memory for this session. A restart returns this service to its boot environment.';

/**
 * The full-quiesce guidance (D-06). Pause never RETRACTS: a cohort advertised before the pause
 * stays in the public directory, stays joinable, and stays counted. An operator who wants the
 * service genuinely quiet needs pause PLUS a cancel each, and this is where they are told so.
 */
export const FULL_QUIESCE_GUIDANCE =
  'Pausing does not end cohorts that are already open. Cancel each one if you need this service fully quiet.';

/** The in-flight confirm label for a cancel (the shipped ellipsis character, no invented spinner). */
export const CANCEL_BUSY = 'Canceling…';

/** The in-flight confirm label for a finalize, matching the {@link CANCEL_BUSY} treatment. */
export const FINALIZE_BUSY = 'Finalizing…';

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
export type OperatorView = { kind: 'list' } | { kind: 'detail'; cohortId: string } | { kind: 'settings' };

/** Settings-surface lifecycle; mirrors {@link EditStatus} because both are one form's save. */
export type SettingsStatus = 'idle' | 'loading' | 'saving' | 'error';

/**
 * The settings model, stated in words directly under the view heading (D-12, UI-SPEC E8).
 *
 * This sentence is the product decision made visible. Nothing here persists, because durability is
 * DUR-01 and a quiet write path would change this product's state model without anyone deciding
 * to. An operator who is not told that would reasonably assume a saved setting survives a restart,
 * and discover otherwise from a service that silently reverted overnight.
 */
export const SETTINGS_MODEL_LINE =
  'Environment variables set these at boot. Changes here apply to this running service only, and a restart returns every value to its environment default.';

/** Transient good-tone confirmation after a settings save (UI-SPEC verbatim, em-dash-free). */
export const SETTINGS_SAVED_OK = 'Settings updated for this session.';

/**
 * The honest limit on participation terms (SVC-05, D-19). The terms step lives in this web app; a
 * client that speaks the aggregation protocol directly can still opt into a cohort without ever
 * seeing them. Saying so on the setting itself is the difference between a feature and a claim
 * about enforcement this service cannot make.
 */
export const TERMS_HONEST_LIMIT =
  'These terms are enforced in this web app. A client that speaks the protocol directly can still opt in without accepting them.';

/** The ghost link back to the cohort list, shared verbatim with the drill-down. */
export const BACK_TO_COHORTS = 'Back to cohorts';

/**
 * The BROADCAST KILL-SWITCH copy set (SVC-04, 05-UI-SPEC E9, D-14). Every string below is exact
 * contract copy, free of the long dash, and each one is load-bearing: this is the control that
 * stands down money movement, and the one control in this console whose effect cannot be undone
 * from this console. The three body lines say, in order, what happens to new cohorts, what happens
 * to cohorts already in flight, and that there is no way back from here.
 */
export const DISABLE_BROADCAST_LABEL = 'Disable broadcast';
export const DISABLE_BROADCAST_HEADING = 'Disable broadcast for new cohorts?';
export const DISABLE_BROADCAST_BODY_NEW =
  'New cohorts will be created on the fixture path and will not publish anything to Bitcoin.';
export const DISABLE_BROADCAST_BODY_IN_FLIGHT =
  'Cohorts already in flight finish under the mode they started with, and chain reads (resolve and anchor tracking) stay on.';
export const DISABLE_BROADCAST_BODY_ONE_WAY =
  'You cannot turn broadcast back on from here. Restart this service with its broadcast environment set to re-enable it.';
export const KEEP_BROADCAST_LABEL = 'Keep broadcast on';
/** The in-flight confirm label, matching the {@link CANCEL_BUSY} treatment (no invented spinner). */
export const DISABLE_BROADCAST_BUSY = 'Disabling…';
/**
 * What replaces the control once the switch has engaged. It names the environment variable
 * outright, because "restart with its broadcast environment set" is only actionable if the
 * operator knows which one, and this is the moment they need it.
 */
export const BROADCAST_OFF_LINE =
  'Broadcast is off for new cohorts. Restart this service with BROADCAST=1 to turn it back on.';
/*
 * The warn-tone health chip label lives in `components/operator/HealthStrip.tsx` beside the other
 * chip labels that file renders inline, rather than here: every chip on that strip is authored in
 * one place, and the audit grep that proves the chip is rendered alongside the mode chip reads
 * that file.
 */

/**
 * The ENDED-RECORD DISMISSAL copy set (SVC-04, 05-UI-SPEC E10, D-15). Rung 1 of the ceremony
 * ladder: neutral tone, a simple confirm, no typed value. The body's three sentences are the whole
 * reason this is rung 1 and not rung 3 - the cohort already ended, nothing real changes, and the
 * only cost is that the record is gone.
 */
export const DISMISS_LABEL = 'Dismiss';
export const DISMISS_HEADING = 'Remove this record?';
export const DISMISS_BODY =
  "This clears the ended cohort's record and its activity log from your console for this session. The cohort itself already ended, so nothing on the chain or in the directory changes. There is no undo.";
export const DISMISS_CONFIRM_LABEL = 'Dismiss record';
export const KEEP_RECORD_LABEL = 'Keep it';
/** The in-flight confirm label for a dismissal. */
export const DISMISS_BUSY = 'Dismissing…';

/**
 * The SERVICE-level `Operator actions` log copy (SVC-04, 05-UI-SPEC E13). The empty body states
 * the same in-memory model the restart-honesty line states, because an operator who finds an empty
 * log after a restart needs to know whether their actions were forgotten or never recorded.
 */
export const OPERATOR_ACTIONS_TITLE = 'Operator actions';
export const OPERATOR_ACTIONS_EMPTY = 'No operator actions this session.';
export const OPERATOR_ACTIONS_EMPTY_BODY =
  'Actions you take here, like pausing advertising or canceling a cohort, are listed as you take them. This service keeps them in memory, so a restart clears them.';
/**
 * What the log shows before the first read lands. It is the console-level loading posture, NOT the
 * empty state: claiming "no operator actions this session" against a service that has not answered
 * yet would be a false claim about the operator's own history (UI-SPEC E13 loading).
 */
export const OPERATOR_ACTIONS_LOADING = 'Checking operator actions';

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
   * The served service health (D-17/D-43): the honest broadcast mode + esplora reachability the
   * health strip renders. `undefined` until the first ok list read lands (and after a sign-out or
   * a session expiry), which the strip renders as "Checking mode" rather than presuming hermetic.
   *
   * Set ONLY from the served `monitoring.health` (review CR-01): a service that broadcasts real
   * Bitcoin must never be able to display "Hermetic", so the mode is never defaulted client-side.
   */
  health?: ServiceHealthDTO;
  /**
   * True when the last LIST poll was unreachable, so the displayed list/metrics are frozen
   * last-known state (D-25) and the unreachable banner shows; cleared on the next ok read.
   */
  listStale: boolean;
  /** Create-form submit status; drives the button's `Creating…` label. */
  createStatus: CreateStatus;
  /** Server (or client) validation message for the create form, when present. */
  formError?: string;
  /**
   * The draft id currently being EDITED in place (SVC-04 criterion 3, D-10), or undefined when no
   * row is in edit mode. Exactly one row can be editing at a time: two open forms would let the
   * operator save one shape while looking at another.
   */
  editingDraftId?: string;
  /** Draft-edit submit status; drives the `Saving…` label and disables the form's fields. */
  editStatus: EditStatus;
  /**
   * This service's current cohort-timing defaults (D-11), from the gated list read. Undefined
   * until a read lands (or on a service that serves none), in which case the create form's timing
   * help omits the default figure instead of claiming one.
   */
  defaults?: CohortDefaultsDTO;
  /**
   * Server (or client) validation message for the draft-edit form. Separate from
   * {@link OperatorState.formError} for the 05-02 reason: the create form and an open edit form are
   * on screen at the same time, so one shared field would render the same message under both.
   */
  editError?: string;
  /** Advertise-action status; drives the row's `Advertising…` label. */
  advertiseStatus: AdvertiseStatus;
  /** The draft id currently being advertised, so only that row shows the spinner. */
  advertisingId?: string;
  /** Transient good-tone confirmation shown after a successful advertise. */
  advertiseMessage?: string;
  /**
   * Bad-tone message for a one-shot operator ACTION that failed (export, discard), rendered
   * beside the action that raised it (review WR-06). Distinct from `formError` (the create form)
   * and from `error` (the login screen): those two surfaces are not visible from the drill-down,
   * which is exactly why a failed export used to produce no feedback at all.
   */
  actionError?: string;
  /**
   * True while a pause or resume toggle is in flight (SVC-04, D-06), so both service controls
   * disable and the card renders its in-flight posture. Deliberately NOT a paused value: the
   * rendered state comes only from the served bit, so a toggle can never paint its own outcome.
   */
  pauseBusy: boolean;
  /**
   * Transient good-tone confirmation after a successful pause or resume, cleared by the same
   * guarded `setTimeout` idiom as {@link OperatorState.advertiseMessage}. It is its own field
   * because it renders on the `Service controls` card, which is on screen at the same time as the
   * cohort list where `advertiseMessage` renders.
   */
  pauseMessage?: string;
  /**
   * Bad-tone message for a pause or resume that did NOT take. Separate from `actionError` for the
   * same reason `pauseMessage` is separate from `advertiseMessage`: the controls card and the
   * cohort list are visible simultaneously, so sharing one field would render the same failure
   * twice on one screen. The 05-02 rule stands - a one-shot action error belongs to the surface
   * that raised it. The copy is the shared {@link ACTION_FAILED} line.
   */
  pauseError?: string;
  /**
   * The SERVED service-level operator actions (SVC-04, D-14/D-15), from the `monitoring` sibling
   * of the gated list read. Empty until the first ok read lands, which is why the log's rendering
   * keys on {@link OperatorState.lastUpdated} rather than on this array being empty: an empty
   * array before any read and an empty array after one mean different things.
   */
  operatorActions: ActivityEntryDTO[];
  /**
   * True while the broadcast kill switch is in flight (SVC-04, D-14), so the confirm renders its
   * in-flight label and both its buttons disable. Deliberately NOT a disabled value: the rendered
   * state comes only from the served bit, so a failed engage paints nothing to roll back.
   */
  broadcastBusy: boolean;
  /**
   * Bad-tone message for a kill switch that did NOT engage. Its own field for the 05-02 reason:
   * the controls card and the cohort list are on screen together, so a shared field would render
   * one failure on two surfaces.
   */
  broadcastError?: string;
  /**
   * The cohort id whose dismissal is in flight (SVC-04, D-15), so exactly the confirming row
   * renders its in-flight label and disables both buttons.
   */
  dismissing?: string;
  /**
   * The served settings snapshot (SVC-04 criterion 3, D-12), or undefined until the settings view's
   * own read lands. It is the ONLY source the settings form renders from, which is what makes a
   * rejected save safe: nothing was painted locally, so a refusal leaves every field showing the
   * value the SERVICE still holds.
   */
  settings?: SettingsSnapshotDTO;
  /** Settings read/save lifecycle; drives the `Saving…` label and disables the fields. */
  settingsStatus: SettingsStatus;
  /**
   * Inline error for the settings form: the service's own 400 message, or the shared unreachable
   * line. Its own field for the 05-02 reason - the controls card and the settings view are
   * different surfaces, and a one-shot action error belongs to the surface that raised it.
   */
  settingsError?: string;
  /** Transient good-tone confirmation after a successful settings save. */
  settingsMessage?: string;
  /** SPA-internal drill-down view (D-03): the cohort list, one open cohort detail, or settings. */
  view: OperatorView;
  /**
   * The cohort id whose cancel is in flight (SVC-04), so exactly the confirming panel renders its
   * in-flight label and disables both buttons. Undefined whenever nothing is being canceled.
   */
  cancelling?: string;
  /**
   * The cohort id whose finalize is in flight (SVC-04), so exactly the confirming panel renders
   * its in-flight label and disables both buttons. Undefined whenever nothing is being finalized.
   */
  finalizing?: string;
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
  /**
   * Drop to the login screen with the honest session-expired copy (D-16), clearing every gated
   * slice. The ONE place expiry is handled, shared by the polled reads and by the one-shot
   * actions (review WR-06), so a 401 never means two different things.
   */
  expireSession: () => void;
  /** Reload the operator cohort list. */
  refreshCohorts: (baseUrl: string) => Promise<void>;
  /**
   * Create a draft; on a 400 set `formError`, on success clear it and refresh the list.
   * Forwards the whole two-field {@link DraftInput} (`{ beaconType, size, threshold }`)
   * unchanged - size = n seats, threshold = k the signing floor (G-02-1).
   */
  submitDraft: (baseUrl: string, input: DraftInput) => Promise<void>;
  /**
   * Open the in-place edit form for one draft, clearing any stale message from a previous edit so
   * a fresh form never opens carrying someone else's error.
   */
  beginEdit: (id: string) => void;
  /**
   * Close the edit form, discarding the unsaved edit. It NEVER deletes anything: discarding a
   * draft stays the shipped `Discard draft` danger action, and conflating the two would put a
   * destructive outcome behind a button whose word is `Cancel`.
   */
  cancelEdit: () => void;
  /**
   * Save an in-place draft edit (D-10). Follows the `submitDraft` idiom: a 401 takes the one
   * shared session-expiry path, the server's own 400 message lands in {@link editError} so the
   * inline slot renders the service's words verbatim, and success closes the form and re-reads the
   * list so the row renders what the SERVICE now holds rather than what the browser sent.
   */
  saveDraftEdit: (baseUrl: string, id: string, input: DraftInput) => Promise<void>;
  /** Advertise a draft; on success show the transient confirmation and refresh the list. */
  advertise: (baseUrl: string, id: string) => Promise<void>;
  /** Re-advertise an expired cohort; on success show the confirmation and refresh the list. */
  readvertise: (baseUrl: string, id: string) => Promise<void>;
  /**
   * Discard an un-advertised draft, then refresh the list. Branches on the discriminated result
   * (review WR-06): a 401 drops to the login screen with the session-expired copy, and any other
   * failure raises {@link DISCARD_FAILED} instead of looking identical to a success.
   */
  discard: (baseUrl: string, id: string) => Promise<void>;
  /**
   * Download the open cohort's gated JSON export (D-34). Branches on the discriminated result
   * exactly like the polled reads (review WR-06): `unauthorized` routes through the SAME honest
   * re-login path as a 401 poll (D-16), and `unreachable` surfaces {@link EXPORT_FAILED}, so a
   * click can no longer be a silent no-op.
   */
  exportCohort: (baseUrl: string, id: string) => Promise<void>;
  /**
   * Cancel a live cohort (SVC-04, D-01/D-04), then return to the list. Branches on the
   * discriminated result exactly like {@link discard}: `unauthorized` takes the ONE shared
   * session-expiry path (D-16), and any other failure raises the action-error copy while leaving
   * every cohort fact untouched - the console never paints an optimistic Canceled chip, so a
   * failed cancel can never make this service look like it ended a cohort it did not (T-05-02-02).
   */
  cancelCohort: (baseUrl: string, id: string) => Promise<void>;
  /**
   * Finalize a cohort's stalled signing round on the k-of-n fallback path (SVC-04, D-01).
   * Branches like {@link cancelCohort}, with one extra branch: a `refused` 409 raises the
   * action-error copy WITH the server's reason, because the usual cause is a phase race the
   * operator could not have seen (the polled detail went stale between render and click).
   *
   * Unlike a cancel, the drill-down STAYS OPEN on success: the cohort is still alive and about to
   * anchor, and the operator wants to watch it. The committed state arrives from the next detail
   * read, never from an optimistic local edit.
   */
  finalizeCohort: (baseUrl: string, id: string) => Promise<void>;
  /**
   * Pause advertising service-wide (SVC-04, D-06): new cohorts stop being offered while every
   * cohort already advertised keeps filling. Branches like {@link discard}: `unauthorized` takes
   * the ONE shared session-expiry path (D-16), and any other failure raises the action-error copy
   * with the previous state line untouched.
   *
   * On success it re-reads the list rather than setting the paused bit locally, so the card, the
   * health-strip chip and the disabled advertise controls all render from the SERVED snapshot -
   * the same derivation the server's advertise gate enforces. There is no optimistic set anywhere
   * on this path (T-05-05-01).
   */
  pauseAdvertising: (baseUrl: string) => Promise<void>;
  /** Resume advertising; the exact mirror of {@link pauseAdvertising}, and equally non-optimistic. */
  resumeAdvertising: (baseUrl: string) => Promise<void>;
  /**
   * Engage the ONE-WAY broadcast kill switch (SVC-04, D-14): new cohorts stop publishing anything
   * to Bitcoin while cohorts already in flight finish under the mode they started with. Branches
   * like {@link pauseAdvertising} - `unauthorized` takes the ONE shared session-expiry path
   * (D-16), any other failure raises the action-error copy - and, like it, sets no local
   * broadcast value: the chip and the replacement line both render from the SERVED bit, so a
   * failed engage cannot leave this console claiming a service stood down when it did not.
   *
   * There is deliberately no counterpart action. Re-enabling is a restart, and the copy says so.
   */
  disableBroadcast: (baseUrl: string) => Promise<void>;
  /**
   * Dismiss one ENDED cohort's record from this console (SVC-04, D-15), then re-read the list so
   * the row disappears from the SERVED projection rather than from an optimistic local filter.
   * Branches like {@link discard}. Nothing real is touched server-side, so a failure leaves both
   * the record and the cohort exactly as they were.
   */
  dismissEnded: (baseUrl: string, id: string) => Promise<void>;
  /**
   * Open the service settings view (D-12). SPA-internal view state only, exactly like the
   * drill-down: no routed URL is introduced this phase.
   */
  openSettings: () => void;
  /** Leave the settings view for the cohort list, dropping the form's transient slice. */
  closeSettings: () => void;
  /**
   * Read the gated settings snapshot once. Branches like every other gated read: `unauthorized`
   * takes the ONE shared session-expiry path (D-16), `unreachable` raises the shared line without
   * blanking a snapshot already on screen (D-25), `ok` replaces the snapshot.
   */
  loadSettings: (baseUrl: string) => Promise<void>;
  /**
   * Save the whole settings form in ONE request (D-12). A rejection applies NOTHING: the service
   * validates the set and refuses it whole, and this store writes no field locally either way, so
   * the surface can never render a half-saved state. On success the SERVED snapshot replaces the
   * previous one, so a value the service normalized displays as the service holds it.
   */
  saveSettings: (baseUrl: string, patch: SettingsPatchDTO) => Promise<void>;
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

/**
 * The shared body of {@link OperatorState.pauseAdvertising} and
 * {@link OperatorState.resumeAdvertising} (SVC-04, D-06). Both toggles have identical mechanics
 * and differ only in which route they call and which confirmation they show, so they share one
 * implementation: two copies of a non-optimistic update path is two places for an optimistic set
 * to creep back in.
 *
 * The ordering here is the honesty contract. `pauseBusy` goes up FIRST (both controls disable),
 * the served result comes back, and only then does `refreshCohorts` re-read the list so the state
 * line, the health-strip chip and the disabled advertise controls all change together from ONE
 * served snapshot. Neither failure branch writes a paused value, so a failed toggle leaves the
 * previous state line exactly where it was (T-05-05-01, UI-SPEC E4 error).
 */
async function runAdvertisingToggle(
  set: (partial: Partial<OperatorState>) => void,
  get: () => OperatorState,
  baseUrl: string,
  verb: 'pause' | 'resume',
): Promise<void> {
  set({ pauseBusy: true, pauseError: undefined, pauseMessage: undefined });
  const result = verb === 'pause' ? await apiPauseAdvertising(baseUrl) : await apiResumeAdvertising(baseUrl);
  if (result.kind === 'unauthorized') {
    // The ONE shared session-expiry path (D-16); `expireSession` clears `pauseBusy` itself.
    get().expireSession();
    return;
  }
  if (result.kind === 'unreachable') {
    // Nothing changed on the service, so nothing changes on screen except this line.
    set({ pauseBusy: false, pauseError: ACTION_FAILED });
    return;
  }
  const message = result.value ? PAUSED_OK : RESUMED_OK;
  set({ pauseBusy: false, pauseMessage: message });
  // Re-read so the rendered state comes from the SERVED snapshot, never from `result.value`
  // written into local state: the console must show what the list read reports.
  await get().refreshCohorts(baseUrl);
  // Clear the transient confirmation after a few seconds, but only if it is still the same
  // message (a later toggle may have replaced it) - the shipped guarded-timeout idiom.
  setTimeout(() => {
    if (get().pauseMessage === message) {
      set({ pauseMessage: undefined });
    }
  }, 4000);
}

export const useOperator = create<OperatorState>((set, get) => ({
  auth: 'checking',
  error: undefined,
  cohorts: [],
  rows: [],
  metrics: undefined,
  health: undefined,
  listStale: false,
  createStatus: 'idle',
  formError: undefined,
  editingDraftId: undefined,
  editStatus: 'idle',
  editError: undefined,
  defaults: undefined,
  advertiseStatus: 'idle',
  advertisingId: undefined,
  advertiseMessage: undefined,
  actionError: undefined,
  pauseBusy: false,
  pauseMessage: undefined,
  pauseError: undefined,
  operatorActions: [],
  broadcastBusy: false,
  broadcastError: undefined,
  dismissing: undefined,
  settings: undefined,
  settingsStatus: 'idle',
  settingsError: undefined,
  settingsMessage: undefined,
  view: { kind: 'list' },
  cancelling: undefined,
  finalizing: undefined,
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
        // Drop the served mode on sign-out: the next session must re-read it rather than render
        // a stale mode claim against a service that may have been restarted into another mode.
        health: undefined,
        // Same reasoning for the timing defaults: they are this service's current values, and the
        // service may be restarted into different ones before the next sign-in.
        defaults: undefined,
        listStale: false,
        formError: undefined,
        createStatus: 'idle',
        // Close any open edit form with the rest of the gated state: an unsaved edit belongs to
        // the session that opened it, and the next sign-in must start from what the service holds.
        editingDraftId: undefined,
        editStatus: 'idle',
        editError: undefined,
        advertiseStatus: 'idle',
        advertisingId: undefined,
        advertiseMessage: undefined,
        actionError: undefined,
        // Drop the pause slice with the rest of the gated state: the next session must re-read the
        // served bit rather than render a claim about a service that may have been restarted.
        pauseBusy: false,
        pauseMessage: undefined,
        pauseError: undefined,
        // Drop the operator log and the kill-switch slice with the rest of the gated state: the
        // log is session-scoped server-side too, and the next session must re-read it rather than
        // render one session's actions under another's sign-in.
        operatorActions: [],
        broadcastBusy: false,
        broadcastError: undefined,
        dismissing: undefined,
        // Drop the settings snapshot with the rest of the gated state: it is this service's
        // in-memory configuration, and the service may be restarted into different values before
        // the next sign-in.
        settings: undefined,
        settingsStatus: 'idle',
        settingsError: undefined,
        settingsMessage: undefined,
        view: { kind: 'list' },
        cancelling: undefined,
        finalizing: undefined,
        detail: undefined,
        detailStale: false,
        lastUpdated: undefined,
      });
    }
  },

  expireSession() {
    set({
      auth: 'logged-out',
      error: SESSION_EXPIRED,
      cohorts: [],
      rows: [],
      metrics: undefined,
      health: undefined,
      defaults: undefined,
      listStale: false,
      actionError: undefined,
      editingDraftId: undefined,
      editStatus: 'idle',
      editError: undefined,
      pauseBusy: false,
      pauseMessage: undefined,
      pauseError: undefined,
      operatorActions: [],
      broadcastBusy: false,
      broadcastError: undefined,
      dismissing: undefined,
      settings: undefined,
      settingsStatus: 'idle',
      settingsError: undefined,
      settingsMessage: undefined,
      view: { kind: 'list' },
      // Drop any in-flight action marker: the next sign-in must start with no control claiming
      // to be mid-cancel.
      cancelling: undefined,
      finalizing: undefined,
      detail: undefined,
      detailStale: false,
      lastUpdated: undefined,
    });
  },

  async refreshCohorts(baseUrl) {
    // The list read is discriminated like the drill-down poll (D-16/D-25): a 401 is a
    // session expiry (honest re-login), an unreachable read freezes the last-known list
    // and raises the banner, and an ok read updates the list + monitoring + freshness stamp.
    const result = await fetchOperatorCohorts(baseUrl);
    if (result.kind === 'unauthorized') {
      // Session expired mid-monitoring (D-16): drop to the login screen with the honest
      // re-login copy and clear the drill-down, through the one shared expiry path.
      get().expireSession();
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
      // Served mode + esplora reachability (review CR-01, D-17/D-43). Left undefined when the
      // service serves no health (fail-closed boot / an older service): the strip then says
      // "Checking mode" instead of claiming a mode the service never reported.
      health: result.value.monitoring?.health,
      // The served operator log (D-14/D-15). A service that serves none reads as an empty ring
      // rather than a stale one from a previous read; the log's LOADING posture is keyed on
      // `lastUpdated` below, so an empty array here is never rendered as a false empty claim.
      operatorActions: result.value.monitoring?.operatorActions ?? [],
      // This service's CURRENT window defaults (D-11), for the create form's help. Left undefined
      // when the service serves none: the caption then omits the figure rather than naming one
      // this service never reported.
      defaults: result.value.defaults,
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

  beginEdit(id) {
    set({ editingDraftId: id, editStatus: 'idle', editError: undefined });
  },

  cancelEdit() {
    // Nothing is deleted and nothing is sent: the draft on the service is untouched, so closing
    // the form is the whole action (UI-SPEC E6 partial).
    set({ editingDraftId: undefined, editStatus: 'idle', editError: undefined });
  },

  async saveDraftEdit(baseUrl, id, input) {
    set({ editStatus: 'saving', editError: undefined });
    try {
      const result = await apiUpdateDraft(baseUrl, id, input);
      if (result.ok) {
        // Close the form and RE-READ: the row must render what the service now holds, not what
        // this browser sent, so a value the server normalized is never displayed as the operator
        // typed it.
        set({ editingDraftId: undefined, editStatus: 'idle', editError: undefined });
        await get().refreshCohorts(baseUrl);
        return;
      }
      if ('unauthorized' in result) {
        // The ONE shared session-expiry path (D-16); it clears the edit slice itself.
        get().expireSession();
        return;
      }
      // The service's own message, rendered verbatim in the inline slot the create form uses.
      set({ editStatus: 'error', editError: result.error });
    } catch {
      set({ editStatus: 'error', editError: UNREACHABLE });
    }
  },

  async advertise(baseUrl, id) {
    set({ advertiseStatus: 'advertising', advertisingId: id, advertiseMessage: undefined, formError: undefined });
    try {
      const liveCohortId = await apiAdvertise(baseUrl, id);
      if (liveCohortId) {
        set({ advertiseStatus: 'idle', advertisingId: undefined, advertiseMessage: ADVERTISED_OK });
        await get().refreshCohorts(baseUrl);
        // Land the operator in the freshly-advertised cohort's drill-down (D-13). Advertise mints a
        // NEW live cohort id server-side (the draft is deleted), so open the LIVE id the advertise
        // response returned, NOT the stale draft id (which the monitor has no entry for). Guard on a
        // still-signed-in session so a 401 during the refresh above (which drops to logged-out) is
        // not overridden.
        if (get().auth === 'logged-in') {
          get().openCohort(liveCohortId);
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
    set({ actionError: undefined });
    const result = await apiDiscardDraft(baseUrl, id);
    if (result.kind === 'unauthorized') {
      // Session expiry takes the same honest re-login path as every gated read (D-16).
      get().expireSession();
      return;
    }
    if (result.kind === 'unreachable') {
      set({ actionError: DISCARD_FAILED });
      return;
    }
    await get().refreshCohorts(baseUrl);
  },

  async exportCohort(baseUrl, id) {
    set({ actionError: undefined });
    const result = await apiDownloadExport(baseUrl, id);
    if (result.kind === 'unauthorized') {
      get().expireSession();
      return;
    }
    if (result.kind === 'unreachable') {
      set({ actionError: EXPORT_FAILED });
    }
  },

  async cancelCohort(baseUrl, id) {
    set({ actionError: undefined, cancelling: id });
    const result = await apiCancelCohort(baseUrl, id);
    if (result.kind === 'unauthorized') {
      // Session expiry takes the same honest re-login path as every gated read and every other
      // one-shot action (D-16), so a 401 never means two different things. `expireSession` clears
      // `cancelling` itself.
      get().expireSession();
      return;
    }
    if (result.kind === 'unreachable') {
      // Nothing about the cohort changed: leave the list, the detail, and the open drill-down
      // exactly as they were and say so in words. The route's own 404 body is deliberately
      // opaque (`unknown cohort`, an anti-oracle answer), so no reason is passed through: the
      // console says only what it honestly knows.
      set({ actionError: actionFailedWith(), cancelling: undefined });
      return;
    }
    // The cancel took. Return to the list and re-read it, so the Canceled chip arrives from the
    // SERVED projection rather than from an optimistic local edit (T-05-02-02).
    set({ cancelling: undefined });
    get().closeCohort();
    await get().refreshCohorts(baseUrl);
  },

  async finalizeCohort(baseUrl, id) {
    set({ actionError: undefined, finalizing: id });
    const result = await apiFinalizeCohort(baseUrl, id);
    if (result.kind === 'unauthorized') {
      // The ONE shared session-expiry path, same as every gated read and one-shot action (D-16).
      // `expireSession` clears `finalizing` itself.
      get().expireSession();
      return;
    }
    if (result.kind === 'refused') {
      // The server refused with a reason it authored (never a library string), so it is rendered
      // verbatim inside the action-error line. Nothing about the cohort changed.
      set({ actionError: actionFailedWith(result.reason || undefined), finalizing: undefined });
      return;
    }
    if (result.kind === 'unreachable') {
      set({ actionError: actionFailedWith(), finalizing: undefined });
      return;
    }
    // The finalize took. The cohort is STILL LIVE (it is now anchoring on the fallback path), so
    // the drill-down stays open and simply re-reads: the committed state arrives from the served
    // projection rather than from an optimistic local edit.
    set({ finalizing: undefined });
    await get().pollDetail(baseUrl);
  },

  async pauseAdvertising(baseUrl) {
    await runAdvertisingToggle(set, get, baseUrl, 'pause');
  },

  async resumeAdvertising(baseUrl) {
    await runAdvertisingToggle(set, get, baseUrl, 'resume');
  },

  async disableBroadcast(baseUrl) {
    set({ broadcastBusy: true, broadcastError: undefined });
    const result = await apiDisableBroadcast(baseUrl);
    if (result.kind === 'unauthorized') {
      // The ONE shared session-expiry path (D-16); `expireSession` clears `broadcastBusy` itself.
      get().expireSession();
      return;
    }
    if (result.kind === 'unreachable') {
      // Nothing on the service changed, so nothing on screen changes except this line: the mode
      // chip, the control and the log all still show the last SERVED state.
      set({ broadcastBusy: false, broadcastError: ACTION_FAILED });
      return;
    }
    // No local broadcast value is written here, deliberately. The chip and the replacement line
    // both render from the served bit, so re-reading is what makes them move - and what makes a
    // half-landed call safe, since nothing was painted to roll back.
    set({ broadcastBusy: false });
    await get().refreshCohorts(baseUrl);
  },

  async dismissEnded(baseUrl, id) {
    set({ actionError: undefined, dismissing: id });
    const result = await apiDismissEnded(baseUrl, id);
    if (result.kind === 'unauthorized') {
      get().expireSession();
      return;
    }
    if (result.kind === 'unreachable') {
      // The server's 404 body is deliberately opaque, so no reason is passed through. Nothing was
      // dismissed and nothing real was ever at risk, so the row stays exactly as it was.
      set({ actionError: actionFailedWith(), dismissing: undefined });
      return;
    }
    // Re-read rather than filtering the row out locally: the list must show what the SERVICE now
    // projects, which is also what makes a dismissal that raced another read resolve correctly.
    set({ dismissing: undefined });
    await get().refreshCohorts(baseUrl);
  },

  openSettings() {
    // Clear the form's transient slice on the way in: a stale error or confirmation from an
    // earlier visit must never render beside freshly served values. The snapshot itself is left
    // alone so a return visit shows the last-known settings while the read is in flight, rather
    // than blanking a form the operator just came back to.
    set({
      view: { kind: 'settings' },
      settingsStatus: 'loading',
      settingsError: undefined,
      settingsMessage: undefined,
      actionError: undefined,
    });
  },

  closeSettings() {
    set({ view: { kind: 'list' }, settingsStatus: 'idle', settingsError: undefined, settingsMessage: undefined });
  },

  async loadSettings(baseUrl) {
    const result = await apiFetchSettings(baseUrl);
    if (result.kind === 'unauthorized') {
      // The ONE shared session-expiry path (D-16); it clears the settings slice itself.
      get().expireSession();
      return;
    }
    if (result.kind === 'unreachable') {
      // Keep whatever snapshot is already on screen (D-25): a transient fault must not blank a
      // form the operator may be mid-way through reading.
      set({ settingsStatus: 'error', settingsError: UNREACHABLE });
      return;
    }
    set({ settings: result.value, settingsStatus: 'idle', settingsError: undefined });
  },

  async saveSettings(baseUrl, patch) {
    set({ settingsStatus: 'saving', settingsError: undefined, settingsMessage: undefined });
    try {
      const result = await apiSaveSettings(baseUrl, patch);
      if (result.ok) {
        // The SERVED snapshot replaces the previous one. Never the patch that was sent: a value
        // the service normalized (a trimmed name, cleared terms) must display as the service holds
        // it, not as it was typed.
        set({ settings: result.snapshot, settingsStatus: 'idle', settingsMessage: SETTINGS_SAVED_OK });
        // The service name rides `GET /v1/config`, which the participant store owns, so a rename
        // reaches the health strip and the public header on the next load rather than through a
        // second copy of the name held here.
        setTimeout(() => {
          if (get().settingsMessage === SETTINGS_SAVED_OK) {
            set({ settingsMessage: undefined });
          }
        }, 4000);
        return;
      }
      if ('unauthorized' in result) {
        get().expireSession();
        return;
      }
      // A rejection applies NOTHING (the service validates the set and refuses it whole), and this
      // store writes no field either, so every rendered value still shows what the service holds.
      set({ settingsStatus: 'error', settingsError: result.error });
    } catch {
      set({ settingsStatus: 'error', settingsError: UNREACHABLE });
    }
  },

  openCohort(id) {
    // Start the drill-down in its checking state: clear any prior cohort's detail so the
    // page renders its documented empty/checking lines until the first poll lands (D-03,
    // UI-SPEC E4/E5 loading), rather than briefly showing a stale cohort's members. The
    // one-shot `actionError` is cleared too: it belongs to the surface that raised it, so a
    // failed action on the LIST must not follow the operator into a cohort it never touched.
    set({
      view: { kind: 'detail', cohortId: id },
      actionError: undefined,
      detail: undefined,
      detailStale: false,
      lastUpdated: undefined,
    });
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
      get().expireSession();
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
