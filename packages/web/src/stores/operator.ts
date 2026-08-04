import { create } from 'zustand';
import {
  login as apiLogin,
  logout as apiLogout,
  advertise as apiAdvertise,
  readvertise as apiReadvertise,
  addTestPeers as apiAddTestPeers,
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
export const ADVERTISED_OK = 'Advertised. Now joinable in the directory.';

/** Transient re-advertise success copy (an expired cohort brought back to the directory). */
export const READVERTISED_OK = 'Re-advertised. Back in the directory as a fresh cohort.';

/**
 * Bad-tone copy when the SERVICE answered an advertise and said no (review WR-12). Byte-identical
 * to the sentence this verb has always shown, and named rather than inlined so a row can pin it.
 *
 * It is kept in preference to the shared {@link ACTION_FAILED} line because it names the verb, and
 * the shared line cannot: the cohort list carries a draft's `Advertise cohort` button, an expired
 * row's `Re-advertise` button and several other one-shot actions, all of which raise their failure
 * into the same slot.
 */
export const ADVERTISE_FAILED = 'Could not advertise the draft. Try again.';

/** The re-advertise counterpart of {@link ADVERTISE_FAILED}, equally byte-identical to the shipped sentence. */
export const READVERTISE_FAILED = 'Could not re-advertise the cohort. Try again.';

/** Exact invalid-password copy (UI-SPEC); never reveals whether a session/account exists. */
const INVALID_PASSWORD =
  'Incorrect password. Check the operator password set for this service and try again.';
const THROTTLED = 'Too many attempts. Wait a few minutes and try again.';
export const UNREACHABLE = 'Could not reach the service. Check that it is running, then reload.';

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

/**
 * The honest limit on RETAINED acceptances (SVC-05, T-05-17-05 and T-05-17-07).
 *
 * The acceptance route is anonymous by necessity (a participant accepting terms has no session and
 * never will), so the namespace behind it is bounded oldest-first, exactly like every other
 * retained structure in this service. Two consequences an operator would otherwise discover only
 * when a participant asked, and both are stated here rather than hidden: a participant who
 * re-accepts for the same cohort leaves ONE current record rather than a second proof, and past the
 * bound the oldest record is dropped, so a hash a participant is holding can stop resolving.
 *
 * Nothing server-side reads this namespace, so a dropped record never blocks a join or affects a
 * cohort: what is lost is proof durability, not function. The alternative, refusing new acceptances
 * once the bound is full, would let anyone lock legitimate joiners out of the gate itself.
 */
export const TERMS_RETENTION_NOTE =
  'Acceptances are kept in memory on this service and a restart clears them. Only the most recent few hundred are retained, oldest dropped first, and re-accepting for the same cohort replaces the earlier record.';

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
/**
 * The one ADDITIONAL cost a dismissal carries on a row that still offers Re-advertise (05-19,
 * D-15). Rendered as a second stacked paragraph inside the same rung-1 confirm, and only when
 * {@link file://../lib/operator-rows.ts} `dismissDropsReadvertise` says the cost is real.
 *
 * A separate constant rather than an edit to {@link DISMISS_BODY}: that body's sentences are
 * still true on every row, its shipped content pin stays green, and none of the fixed dismissal
 * copy in `05-UI-SPEC.md` has to be re-approved for an additive disclosure. It names the two
 * facts that matter (the cohort leaves the cohort list, and it can no longer be re-advertised),
 * because a confirmation that promises less than the action costs is the exact defect class this
 * sentence exists to close.
 */
export const DISMISS_READVERTISE_LINE =
  'This also removes the cohort from your cohort list, so it can no longer be re-advertised.';
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

/**
 * The TEST-PEER copy set (SVC-04, 05-UI-SPEC E11, D-17). Rung 2 of the ceremony ladder: warn tone,
 * a simple confirm stating the consequence, no typed value. Nothing is destroyed by adding a peer,
 * but on a live cohort the peers co-sign for real, so the confirm says so BEFORE the act rather
 * than leaving the operator to discover it from a block explorer (T-05-09-04).
 *
 * The framing throughout is REHEARSING YOUR OWN SERVICE. There is no automatic seat padding
 * anywhere in this product and no boot-time spawn loop; every peer exists because the operator
 * asked for it, on one named cohort (HOST-03 posture). Every string is exact contract copy and
 * free of the long dash per house style; the only interpolations are a small integer seat count
 * and the service's own network name.
 *
 * The member-row BADGE and LINE are deliberately not here: they are authored in
 * `components/operator/CohortDetail.tsx` beside the other member-row labels that file renders
 * inline, the same way `HealthStrip.tsx` owns its chip labels.
 */
export const ADD_TEST_PEERS_LABEL = 'Fill remaining seats with test peers';
export const addTestPeersHelp = (remaining: number): string =>
  `Adds ${remaining} in-process test participants so you can rehearse this service on your own. ` +
  'They use throwaway keys created inside this process.';
export const addTestPeersHeading = (remaining: number): string =>
  `Add ${remaining} test peers to this cohort?`;
export const ADD_TEST_PEERS_BODY =
  'They join the remaining seats and co-sign like any other participant. They are badged as test ' +
  'peers everywhere on this console.';
/**
 * The live-mode line, rendered inside the SAME confirm rather than as a separate step. On a live
 * cohort these peers really do co-sign a real transaction and their DIDs really are anchored; that
 * fact belongs where the operator is deciding, not on a page they may never open.
 */
export const liveTestPeersLine = (network: string): string =>
  `This is a live cohort, so test peers co-sign for real and their DIDs are anchored on ${network}.`;
export const addTestPeersConfirmLabel = (remaining: number): string => `Add ${remaining} test peers`;
export const ADD_TEST_PEERS_CANCEL_LABEL = 'Cancel';
/** The in-flight confirm label, matching the {@link CANCEL_BUSY} treatment (no invented spinner). */
export const ADD_TEST_PEERS_BUSY = 'Adding…';
/**
 * The reason beside the disabled control on a full cohort. Byte-identical to the service's own
 * 409 refusal reason, so the sentence an operator reads before clicking and the sentence they
 * would read if they clicked anyway are one string rather than two that can drift.
 */
export const NO_SEATS_LEFT_REASON = 'This cohort has no seats left.';

/**
 * Exported ONLY so a render fixture can be typed as `Partial<OperatorState>` (05-21).
 *
 * A render seeded through an untyped object literal turns a misspelled key into an `undefined`
 * that is indistinguishable from an unseeded store, which is the same silent failure that makes a
 * `setState` seed vacuous. Typed against the real state, the typo is a compile error, and since
 * 05-21 put `packages/web/tests` inside the root `tsc -b`, `pnpm test` now catches it.
 */
export interface OperatorState {
  auth: OperatorAuthStatus;
  /**
   * A monotonic identifier for ONE operator session (review WR-06).
   *
   * It sits beside {@link OperatorState.auth} because it qualifies it: `auth` reports whether SOME
   * session is live, and this reports WHICH one. A status cannot serve as an identity, because
   * `logged-in` to `logged-out` to `logged-in` is the same string and a different session, while a
   * gated read is evidence about exactly one of them. Any guard that must decide whether an answer
   * still belongs to the session that asked compares this, never `auth` alone.
   *
   * That sentence is general law, and it is now TRUE of every gated call site rather than of the
   * four reads alone (review IN-09): all fifteen (the four gated reads and the eleven action verbs)
   * capture and compare through the one shared trio above `useOperator`, whose docstring names the
   * single documented exception (`probe`'s session-ended branches, which decide from
   * {@link OperatorState.liveSessionRound} because no round asked their question).
   *
   * Bumped on every path that makes a session LIVE (a successful `signIn`, a `probe` that finds a
   * session live where none was live before) and on every path that ENDS one (`signOut`,
   * `expireSession`). The correctness argument only needs the START bumps: if every new session
   * takes a fresh round, two sessions can never share one. The END bumps are what make the field
   * mean what its name says - with them a round identifies exactly one session, live or ended, and
   * an ended round is retired the instant it ends; without them a round only identifies "at most
   * one live session at a time", and a future guard that compared a round without also checking the
   * status would be silently wrong.
   *
   * The probe bump is a TRANSITION, not a landing (review IN-07). `OperatorConsole` is mounted
   * conditionally on the operator tab, so an ordinary switch away and back re-runs `probe` against
   * the session already signed in; bumping there would retire the round of a session that never
   * ended and make this field identify a probe EVENT rather than a session. What the field
   * guarantees, which every guard below leans on: two sessions never share a round, so an unchanged
   * round means no session boundary was crossed.
   *
   * That transition is decided from {@link OperatorState.liveSessionRound}, a stored fact, and not
   * from this field's neighbour `auth` (review WR-11). A status snapshot has to be taken before
   * `probe`'s own first assignment to be meaningful at all, and a snapshot taken there is wrong the
   * moment two probes overlap: the second reads `checking`, concludes no session was live, and
   * bumps. React StrictMode makes that routine in development and a fast tab toggle reaches it in
   * production.
   *
   * Client-side only: nothing puts this on the wire. Which session asked is a fact the caller
   * already holds, and serving it would add a second source of truth for a question already
   * answered locally.
   */
  sessionRound: number;
  /**
   * The round of the session that is currently LIVE, and `undefined` when none is (review WR-11).
   *
   * What it buys over {@link OperatorState.auth}: a status is erased by the very next thing that
   * happens, including `probe`'s own first assignment, so any condition decided from it has to be
   * captured before that assignment and is then wrong as soon as two probes overlap. This is a
   * stored fact that ONLY a session start or a session end moves, so two concurrent probes cannot
   * disagree about it, and a deliberate `signOut` landing while a probe is in flight has already
   * answered it: the probe reads the cleared value and correctly does nothing, rather than
   * narrating an expiry about a session the operator themselves just ended.
   *
   * Set beside every round bump that STARTS a session (`signIn`'s 200 branch, and `probe`'s branch
   * where a session becomes live), to the same value the round takes. Cleared by the shared
   * `GATED_SLICE_RESET`, so both paths that END a session drop it with everything else and no third
   * place has to remember.
   *
   * Client-side only, on the same reasoning as {@link OperatorState.sessionRound}: which session is
   * live is a fact the client already holds, and serving it would add a second source of truth for
   * a question already answered locally.
   */
  liveSessionRound?: number;
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
  /**
   * The cohort id whose test-peer spawn is in flight (SVC-04, D-17), so exactly the confirming
   * panel renders its in-flight label and disables both buttons. Undefined whenever no spawn is
   * running.
   */
  addingTestPeers?: string;
  /**
   * Bad-tone message for a test-peer spawn that did NOT take. Its own field for the same reason
   * {@link broadcastError} has one: the drill-down already renders the shared `actionError` on both
   * the Lifecycle and the Export cards, so reusing it here would print one failure three times down
   * a single page.
   */
  testPeerError?: string;
  /** Last-known monitoring detail for the open drill-down; undefined until the first poll lands. */
  detail?: CohortDetailDTO;
  /**
   * The cohort id the currently held {@link detail} is an answer ABOUT
   * (`05-VERIFICATION.md` Gap 1, review CR-1).
   *
   * It exists because the served `CohortDetailDTO` carries no id of its own and this `detail` slot
   * is SHARED by every drill-down, so the identity of the painted data would otherwise be an
   * inference from {@link view} rather than a stored fact. A component that acts on one cohort
   * (`LifecycleActions` receives it as a prop) while reasoning about this slot needs to be able to
   * prove the two are the same cohort, and during a navigation race they can differ.
   *
   * Always written and cleared in the SAME `set` call as `detail`: a provenance id that outlives
   * the document it names is a stale claim the next reader would believe.
   */
  detailCohortId?: string;
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
   * Fill a cohort's remaining seats with in-process test participants (SVC-04, D-17), so one
   * operator can rehearse the whole loop on their own service. Branches exactly like
   * {@link finalizeCohort}: `unauthorized` takes the one shared expiry path, a `refused` 409
   * raises the action-error copy WITH the server's reason (usually "no seats left", meaning the
   * cohort filled between the render and the click), and a fault says nothing changed.
   *
   * On success the drill-down STAYS OPEN and simply re-reads: the new members arrive from the
   * SERVED projection, never from an optimistic insert, which is also what keeps their `Test peer`
   * badge a served fact rather than a local guess.
   */
  addTestPeers: (baseUrl: string, id: string, count?: number) => Promise<void>;
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
 * The ONE set of fields every path that ENDS an operator session clears (review IN-11).
 *
 * The rule it holds: ending a session is one act, so a field added to one ending path can never be
 * missed by the other, because there is only one list. Before this constant there were two, and
 * they had already diverged by five fields ({@link OperatorState.createStatus},
 * {@link OperatorState.formError}, {@link OperatorState.advertiseStatus},
 * {@link OperatorState.advertisingId}, {@link OperatorState.advertiseMessage}), which is how a
 * failed advertise message from one session reached the next session's create form.
 *
 * It deliberately holds NEITHER {@link OperatorState.auth}, NOR {@link OperatorState.sessionRound},
 * NOR {@link OperatorState.error}: those three differ between the two paths on purpose (each sets
 * its own status, takes its own next round, and carries its own copy - undefined for a deliberate
 * sign-out, the session-expired line for an expiry), and folding them in would force every caller
 * to override them immediately after spreading, which reads as an accident rather than a decision.
 *
 * The reasoning for clearing each group, recorded once here because it is now true of BOTH paths:
 *
 * - The served MODE and the timing DEFAULTS are facts about this service's current boot. The
 *   ordinary reason a session ends is a service restart, so the next session must re-read them
 *   rather than render a mode claim (whether this service can move Bitcoin) from a boot that is
 *   gone.
 * - An open EDIT form belongs to the session that opened it: an unsaved edit is not state the next
 *   sign-in should inherit, and it must start from what the service holds.
 * - The PAUSE slice is a claim about a service that may have been restarted, on the same reasoning
 *   as the served mode.
 * - The OPERATOR LOG and the kill-switch slice are session-scoped server-side too, so rendering
 *   one session's actions under another's sign-in would attribute acts to an operator who never
 *   took them.
 * - The SETTINGS snapshot is this service's in-memory configuration, and the service may be
 *   restarted into different values before the next sign-in. It is also what the console shell's
 *   once-per-session read latch keys on, so retaining it makes the next session skip its own read.
 * - Every IN-FLIGHT ACTION marker goes, so the next sign-in starts with no control claiming to be
 *   mid-cancel, mid-finalize or mid-spawn.
 */
const GATED_SLICE_RESET: Partial<OperatorState> = {
  // No session is live once either path has run, so the stored fact says so (review WR-11). It
  // lives here rather than beside each caller's own round bump precisely so neither path can end a
  // session while leaving the console recording one.
  liveSessionRound: undefined,
  cohorts: [],
  rows: [],
  metrics: undefined,
  health: undefined,
  defaults: undefined,
  listStale: false,
  createStatus: 'idle',
  formError: undefined,
  editingDraftId: undefined,
  editStatus: 'idle',
  editError: undefined,
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
  addingTestPeers: undefined,
  testPeerError: undefined,
  detail: undefined,
  detailCohortId: undefined,
  detailStale: false,
  lastUpdated: undefined,
};

/**
 * The session-identity rule, in one place, used by every gated call that can end a session
 * (review IN-09).
 *
 * The rule: an answer is evidence about the session that ASKED, never about whichever session
 * happens to be live when it lands. `logged-in` to `logged-out` to `logged-in` is the same string
 * and a different session, so the question "does this answer still belong to me" is decided on
 * {@link OperatorState.sessionRound}, an identity, and never on {@link OperatorState.auth} alone.
 *
 * The trio is used as a sentence: capture the asking round before the await with {@link askingRound},
 * then ask {@link stillAsking} before writing anything, and {@link expireIfStillAsking} before
 * ending the session on a 401. Every gated read and every gated action verb in this store uses it,
 * which is what makes the general-law sentence in `sessionRound`'s own docstring true rather than
 * aspirational. Before this, the four reads followed it and the eleven action verbs did not, and a
 * reader could not tell which of those was a decision.
 *
 * A capture is `undefined` when NO session was live at the time of asking, and an undefined capture
 * never matches. That is the half that refuses an answer to a question nobody asked, rather than
 * letting it match a value some LATER session holds.
 *
 * There is exactly ONE documented exception, and it is `probe`'s session-ended branches. They
 * decide from {@link OperatorState.liveSessionRound}, the stored fact, read at landing time,
 * because nobody asked the probe's question in a round: the probe is the path that discovers a
 * session ended WITHOUT a 401 (an idle expiry seen on the way back to the operator tab), so it has
 * no asking round to compare and must consult what the console records as live. Stated here rather
 * than left to be inferred, because an exemption nobody wrote down is what IN-09 filed against the
 * previous arrangement.
 *
 * Client-side only, like the field it reads: nothing here goes on the wire, and no request is
 * cancelled. The guard makes a late answer HARMLESS rather than preventing it, which is what both
 * shipped precedents (`refreshCohorts` and `fetchCohortFate` in `stores/participant.ts`) already do.
 */
function askingRound(get: () => OperatorState): number | undefined {
  return get().auth === 'logged-in' ? get().sessionRound : undefined;
}

/** True when the session that asked is still the one running; see {@link askingRound}. */
function stillAsking(get: () => OperatorState, asked: number | undefined): boolean {
  return asked !== undefined && get().sessionRound === asked;
}

/**
 * End the session on a 401, but only when the 401 answers the session that is live right now; see
 * {@link askingRound}. It narrows WHOSE refusal counts and never WHETHER a real expiry counts: a
 * 401 aimed at the live session still ends it immediately, on whichever call discovers it.
 */
function expireIfStillAsking(get: () => OperatorState, asked: number | undefined): void {
  if (stillAsking(get, asked)) {
    get().expireSession();
  }
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
  // The asking session, captured before the await like every other gated call (review IN-09).
  const askedInRound = askingRound(get);
  const result = verb === 'pause' ? await apiPauseAdvertising(baseUrl) : await apiResumeAdvertising(baseUrl);
  if (result.kind === 'unauthorized') {
    // The ONE shared session-expiry path (D-16); `expireSession` clears `pauseBusy` itself. Scoped
    // to the session that ASKED: a refusal aimed at a session that has already ended must not end
    // the one that replaced it.
    expireIfStillAsking(get, askedInRound);
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
  // No session has started yet, so no read can hold a matching round.
  sessionRound: 0,
  // ... and none is live, which is what the probe about to run decides from.
  liveSessionRound: undefined,
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
  addingTestPeers: undefined,
  testPeerError: undefined,
  detail: undefined,
  detailCohortId: undefined,
  detailStale: false,
  lastUpdated: undefined,

  async probe(baseUrl) {
    set({ auth: 'checking', error: undefined });
    try {
      const state = await sessionProbe(baseUrl);
      if (state === 'logged-in') {
        // Decided from the STORED live-session fact, read at LANDING time, never from the `auth`
        // status (review WR-11). A status has to be captured before this method's own first
        // statement to say anything at all, and a capture taken there is wrong the moment two
        // probes overlap: the second reads `checking`, concludes no session was live, and bumps.
        if (get().liveSessionRound === undefined) {
          // A live session STARTS here (a returning operator whose cookie is still good), so it
          // takes a fresh round before the read it fires below captures one, and records that round
          // as the live one.
          const started = get().sessionRound + 1;
          set({ auth: state, sessionRound: started, liveSessionRound: started });
        } else {
          // The probe merely CONFIRMED the session already recorded as live. No session boundary
          // was crossed, so the round stands: `OperatorConsole` is mounted conditionally on the
          // operator tab, and retiring the round on every switch away and back would discard a read
          // that was in flight across the switch and would make the round identify a probe event
          // rather than a session (review IN-07).
          set({ auth: state });
        }
        void get().refreshCohorts(baseUrl);
      } else if (get().liveSessionRound !== undefined) {
        // A live session ENDED, discovered HERE rather than by a read's 401 (review CR-03). The tab
        // switch is what reaches this: `OperatorConsole` is mounted conditionally on the operator
        // tab, and nothing polls while the operator is on the participant tab, so an idle
        // server-side expiry is seen for the first time on the way back. It is the same fact
        // `expireSession` exists for, so it takes the same path: the round is retired and the whole
        // gated slice goes with it, which is exactly what the session-expired copy already promises
        // ("Monitoring rebuilds from this service's state after you sign in").
        //
        // Decided from the stored fact, so two overlapping probes end ONE session between them.
        get().expireSession();
        if (state === 'disabled') {
          // The service rebooted without an operator password, and that notice is owed to the
          // operator. It lands AFTER the slice has been cleared rather than instead of it.
          set({ auth: 'disabled', error: undefined });
        }
      } else {
        // The other case this branch is reached on, and the only one it used to reason about: no
        // session was live, so none ended. A round retired by a probe no session ever held would be
        // a number that identifies nothing, and an expiry narrated to a console that never signed
        // in would be an event the operator did not have.
        set({ auth: state });
      }
    } catch {
      if (get().liveSessionRound !== undefined) {
        // A transport fault is NOT evidence that a session ended, so this path claims no expiry
        // (the copy below stays the unreachable line). It equally must not hand a live session's
        // gated slice to whoever signs in next, so the slice goes either way (review CR-03).
        get().expireSession();
      }
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
        // A live session STARTS here, so it takes a fresh round and records it as the live one
        // (review WR-11). Every other branch below leaves no session live, so none of them takes a
        // round, and each says so in BOTH places rather than only in the status: they are reachable
        // only from the login screen, where nothing is live, so clearing the stored fact there is
        // agreement between the two rather than a session change.
        const started = get().sessionRound + 1;
        set({ auth: 'logged-in', error: undefined, sessionRound: started, liveSessionRound: started });
        void get().refreshCohorts(baseUrl);
      } else if (status === 429) {
        set({ auth: 'logged-out', error: THROTTLED, liveSessionRound: undefined });
      } else if (status === 404) {
        set({ auth: 'disabled', error: undefined, liveSessionRound: undefined });
      } else {
        set({ auth: 'logged-out', error: INVALID_PASSWORD, liveSessionRound: undefined });
      }
    } catch {
      set({ auth: 'logged-out', error: UNREACHABLE, liveSessionRound: undefined });
    }
  },

  async signOut(baseUrl) {
    try {
      await apiLogout(baseUrl);
    } finally {
      set({
        // The ONE list both ending paths clear (review IN-11); its docstring carries the reasoning
        // for each group that used to sit inline here.
        ...GATED_SLICE_RESET,
        auth: 'logged-out',
        // The session ENDS here, so its round is retired with the rest of its state: any read it
        // issued is now an answer about a session nobody is running.
        sessionRound: get().sessionRound + 1,
        // A deliberate sign-out is not a failure, so it carries no copy at all.
        error: undefined,
      });
    }
  },

  expireSession() {
    set({
      // The SAME list `signOut` clears, spread from one definition (review IN-11). The five fields
      // this path used to miss (`createStatus`, `formError`, `advertiseStatus`, `advertisingId`,
      // `advertiseMessage`) come with it, so a failed advertise message from the session that just
      // ended can no longer render on the next session's create form.
      ...GATED_SLICE_RESET,
      auth: 'logged-out',
      // The session ENDS here too, on the same reasoning as `signOut` above: an expiry retires the
      // round so a read issued under it can never match the round of whoever signs in next.
      sessionRound: get().sessionRound + 1,
      // The honest re-login copy (D-16): an expiry is a fact the operator has to be told, which is
      // the one thing that distinguishes this path from a deliberate sign-out.
      error: SESSION_EXPIRED,
    });
  },

  async refreshCohorts(baseUrl) {
    // The list read is discriminated like the drill-down poll (D-16/D-25): a 401 is a
    // session expiry (honest re-login), an unreachable read freezes the last-known list
    // and raises the banner, and an ok read updates the list + monitoring + freshness stamp.
    //
    // Capture the SESSION this question is asked in, the way `pollDetail` below captures the
    // cohort its question is about: an identity, not a status. Nothing cancels a request already in
    // flight, and the console polls this read every 4000 ms against an 8000 ms client timeout, so
    // two reads are routinely outstanding at once (`05-VERIFICATION.md` W5, review WR-01/WR-06).
    //
    // Undefined when no session is live, so an answer to a question nobody asked has nothing to
    // match against and is refused below whatever session may have signed in meanwhile.
    const askedInRound = askingRound(get);
    const result = await fetchOperatorCohorts(baseUrl);
    if (result.kind === 'unauthorized') {
      // Session expired mid-monitoring (D-16): drop to the login screen with the honest
      // re-login copy and clear the drill-down, through the one shared expiry path.
      //
      // The branch keeps its position AHEAD of the round guard below, matching `pollDetail`, and it
      // can keep it because it now carries its OWN comparison. A 401 is evidence about the session
      // that ASKED, never about whichever session happens to be live when the answer lands: a
      // status is not an identity, and `logged-in` to `logged-out` to `logged-in` is the same
      // string and a different session. Without the comparison, an unauthorized answer issued by a
      // session that already ended signs the session that REPLACED it out, telling the operator
      // their session expired about a cookie this service would still accept, and taking the whole
      // gated slice with it (review WR-08).
      //
      // No status comparison here, deliberately: every path that ends a session bumps the round, so
      // an unchanged round already proves this session never ended, while a status check would
      // additionally refuse a genuine expiry landing inside a probe's `checking` window and defer
      // it to the next tick for no benefit. An undefined capture means no live session asked, so
      // there is nothing to end.
      expireIfStillAsking(get, askedInRound);
      return;
    }
    // The round guard. Everything BELOW this point is a fact about ONE session, the freshness flag
    // as much as the list, so an answer that outlived the session that asked is discarded whole. A
    // list read is evidence about the service the ASKING session was watching; it is no evidence at
    // all about the next one, which may sign in to a service restarted into another mode. That is
    // exactly what `signOut` and `expireSession` promise above when they clear the gated slice, and
    // what the SESSION_EXPIRED copy promises the operator ("Monitoring rebuilds from this service's
    // state after you sign in"). Without this, the late write repaints the cohort list, the metrics
    // and the broadcast-mode chip, which is a claim about whether this service can move money.
    //
    // The comparison is on the session IDENTITY, never on the status alone (review WR-06). The
    // sequence a status comparison lets through is ABA: session A expires, the operator signs
    // straight back in as B (a password-manager fill is a second or two, well inside the poll
    // window), and A's answer lands while `auth` reads `logged-in` again. The string is identical,
    // the session is not, so B would be shown A's cohort list, metrics, operator log and
    // broadcast-mode chip, plus a freshness stamp B never earned.
    //
    // The shipped precedent is `pollDetail`'s round guard, keyed on the COHORT because that is what
    // a detail read is a fact about. One house rule, applied to each path's own subject.
    //
    // Two things are rejected here, and only two (review IN-10): an answer to a question no live
    // session asked, which the undefined capture refuses, and an answer that outlived the session
    // that did ask, which the round comparison refuses. A THIRD clause used to sit here comparing
    // the auth status, and it is gone: every path that ends a session bumps the round, the probe
    // included since it stopped bumping on a mere confirmation, so an unchanged round already
    // proves this session never ended. All the status clause added was refusing an ok answer that
    // lands while a probe is in flight, when `auth` reads `checking` because the probe's own first
    // statement set it.
    //
    // That is the same argument the 401 branch directly above already records for declining a
    // status comparison there, and the two now agree rather than making opposite cases about one
    // clause in one method, which is how the asymmetry survived a green gate. All four gated reads
    // (this one, `pollDetail`, `loadSettings` and `saveSettings`) therefore compare one thing
    // composed one way; adding the clause to the other three instead would also be uniform and
    // would be the wrong uniformity, deferring a genuine expiry for a poll tick for no benefit.
    if (!stillAsking(get, askedInRound)) {
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
    // The asking session, captured before the await like every other gated call (review IN-09).
    const askedInRound = askingRound(get);
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
        // The ONE shared session-expiry path (D-16); it clears the edit slice itself. Scoped to the
        // session that ASKED (review IN-09).
        expireIfStillAsking(get, askedInRound);
        return;
      }
      // The service's own message, rendered verbatim in the inline slot the create form uses.
      set({ editStatus: 'error', editError: result.error });
    } catch {
      set({ editStatus: 'error', editError: UNREACHABLE });
    }
  },

  async advertise(baseUrl, id) {
    // The one-shot ACTION-ERROR field is the slot this verb owns, so it is the one cleared on entry
    // (review WR-12). The create form's `formError` is deliberately no longer touched here, in
    // either direction: that field is the create form's own validation slot, and `CreateCohortForm`
    // renders only while the `New cohort` form is open, so an advertise failure written there was
    // invisible on the surface the button lives on. `actionError` renders in bad tone at the top of
    // `OperatorCohortList`, beside the good-tone advertise confirmation and directly above the rows
    // whose buttons raise it, and it is already where a failed discard and a failed dismissal land.
    set({ advertiseStatus: 'advertising', advertisingId: id, advertiseMessage: undefined, actionError: undefined });
    // The asking session, captured before the await like every other gated call (review IN-09).
    const askedInRound = askingRound(get);
    const result = await apiAdvertise(baseUrl, id);
    if (result.kind === 'unauthorized') {
      // The ONE shared session-expiry path (D-16), the same one every other gated verb takes, so a
      // 401 never means two different things. `expireSession` clears both advertise markers itself.
      // Scoped to the session that ASKED (review IN-09).
      expireIfStillAsking(get, askedInRound);
      return;
    }
    // The round guard, ahead of every branch below that writes, exactly as `refreshCohorts` places
    // its own (review WR-13). Nothing below this point is evidence about the session that is live
    // now: it is an answer to a question THIS session asked, and the four lower branches would
    // otherwise write a green confirmation for an action the current operator never took, a
    // bad-tone sentence about a cohort they never touched, and a navigation into a cohort they
    // never opened. The reviewer reproduced all three against one advertise.
    if (!stillAsking(get, askedInRound)) {
      return;
    }
    if (result.kind === 'refused') {
      // The paused-advertising gate (D-06) refused with a reason the SERVICE authored (never a
      // library string), so it is rendered verbatim inside the shared action-error sentence, exactly
      // as a refused finalize is. The draft is untouched: a paused service refuses loudly rather
      // than losing it.
      set({ advertiseStatus: 'error', advertisingId: undefined, actionError: actionFailedWith(result.reason || undefined) });
      return;
    }
    if (result.kind === 'declined') {
      // The service answered and said no (a draft it does not hold, or a 200 naming no cohort). The
      // verb-specific sentence is kept rather than the shared line: it names which action failed,
      // which the shared line cannot on a surface carrying several one-shot actions.
      set({ advertiseStatus: 'error', advertisingId: undefined, actionError: ADVERTISE_FAILED });
      return;
    }
    if (result.kind === 'unreachable') {
      // Kept distinguishable from the branch above: an operator whose own service is unreachable
      // has a different thing to go and check than one whose service refused.
      set({ advertiseStatus: 'error', advertisingId: undefined, actionError: UNREACHABLE });
      return;
    }
    set({ advertiseStatus: 'idle', advertisingId: undefined, advertiseMessage: ADVERTISED_OK });
    await get().refreshCohorts(baseUrl);
    // Land the operator in the freshly-advertised cohort's drill-down (D-13). Advertise mints a
    // NEW live cohort id server-side (the draft is deleted), so open the LIVE id the advertise
    // response returned, NOT the stale draft id (which the monitor has no entry for).
    //
    // The comparison is RE-READ here rather than reusing the one taken above, and that is the whole
    // point of this line: the list re-read on the line above can itself answer 401 and end the
    // session, so a value captured on the near side of that await is stale by the time this decides
    // (review WR-13). Caching one boolean across the refresh would put the same class of bug back in
    // a new place. It also keeps the property the previous check bought, that an expiry during the
    // refresh is never overridden by a drill-down opening on top of the login screen.
    if (stillAsking(get, askedInRound)) {
      get().openCohort(result.value);
    }
    // Clear the transient confirmation after a few seconds, but only if it is still
    // the same message (a later action may have replaced it).
    setTimeout(() => {
      if (get().advertiseMessage === ADVERTISED_OK) {
        set({ advertiseMessage: undefined });
      }
    }, 4000);
  },

  async readvertise(baseUrl, id) {
    // The same slot decision as `advertise` above, for the same reason: this button lives on the
    // cohort list, so its failures belong in the field the cohort list renders.
    set({ advertiseStatus: 'advertising', advertisingId: id, advertiseMessage: undefined, actionError: undefined });
    // The asking session, captured before the await like every other gated call (review IN-09).
    const askedInRound = askingRound(get);
    const result = await apiReadvertise(baseUrl, id);
    if (result.kind === 'unauthorized') {
      // The ONE shared session-expiry path (D-16); `expireSession` clears both markers itself.
      // Scoped to the session that ASKED (review IN-09).
      expireIfStillAsking(get, askedInRound);
      return;
    }
    // The same round guard `advertise` places, for the same reason (review WR-13). This verb has the
    // same five branches and no drill-down landing, so one comparison covers it whole: below here a
    // confirmation, a service reason and two failure sentences would all otherwise be written into a
    // console that re-advertised nothing.
    if (!stillAsking(get, askedInRound)) {
      return;
    }
    if (result.kind === 'refused') {
      // The SAME paused-advertising 409 the advertise route answers, in the service's own words.
      set({ advertiseStatus: 'error', advertisingId: undefined, actionError: actionFailedWith(result.reason || undefined) });
      return;
    }
    if (result.kind === 'declined') {
      set({ advertiseStatus: 'error', advertisingId: undefined, actionError: READVERTISE_FAILED });
      return;
    }
    if (result.kind === 'unreachable') {
      set({ advertiseStatus: 'error', advertisingId: undefined, actionError: UNREACHABLE });
      return;
    }
    set({ advertiseStatus: 'idle', advertisingId: undefined, advertiseMessage: READVERTISED_OK });
    await get().refreshCohorts(baseUrl);
    // Clear the transient confirmation after a few seconds, but only if it is still
    // the same message (a later action may have replaced it).
    setTimeout(() => {
      if (get().advertiseMessage === READVERTISED_OK) {
        set({ advertiseMessage: undefined });
      }
    }, 4000);
  },

  async discard(baseUrl, id) {
    set({ actionError: undefined });
    // The asking session, captured before the await like every other gated call (review IN-09).
    const askedInRound = askingRound(get);
    const result = await apiDiscardDraft(baseUrl, id);
    if (result.kind === 'unauthorized') {
      // Session expiry takes the same honest re-login path as every gated read (D-16), scoped to
      // the session that ASKED (review IN-09).
      expireIfStillAsking(get, askedInRound);
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
    // The asking session, captured before the await like every other gated call (review IN-09).
    const askedInRound = askingRound(get);
    const result = await apiDownloadExport(baseUrl, id);
    if (result.kind === 'unauthorized') {
      expireIfStillAsking(get, askedInRound);
      return;
    }
    if (result.kind === 'unreachable') {
      set({ actionError: EXPORT_FAILED });
    }
  },

  async cancelCohort(baseUrl, id) {
    set({ actionError: undefined, cancelling: id });
    // The asking session, captured before the await like every other gated call (review IN-09).
    const askedInRound = askingRound(get);
    const result = await apiCancelCohort(baseUrl, id);
    if (result.kind === 'unauthorized') {
      // Session expiry takes the same honest re-login path as every gated read and every other
      // one-shot action (D-16), so a 401 never means two different things. `expireSession` clears
      // `cancelling` itself. Scoped to the session that ASKED (review IN-09).
      expireIfStillAsking(get, askedInRound);
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
    // The asking session, captured before the await like every other gated call (review IN-09).
    const askedInRound = askingRound(get);
    const result = await apiFinalizeCohort(baseUrl, id);
    if (result.kind === 'unauthorized') {
      // The ONE shared session-expiry path, same as every gated read and one-shot action (D-16).
      // `expireSession` clears `finalizing` itself. Scoped to the session that ASKED (review IN-09).
      expireIfStillAsking(get, askedInRound);
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

  async addTestPeers(baseUrl, id, count) {
    set({ testPeerError: undefined, addingTestPeers: id });
    // The asking session, captured before the await like every other gated call (review IN-09).
    const askedInRound = askingRound(get);
    const result = await apiAddTestPeers(baseUrl, id, count);
    if (result.kind === 'unauthorized') {
      // The ONE shared session-expiry path (D-16); `expireSession` clears both fields itself.
      // Scoped to the session that ASKED (review IN-09).
      expireIfStillAsking(get, askedInRound);
      return;
    }
    if (result.kind === 'refused') {
      // The server refused with a reason it authored, so it is rendered verbatim. The usual cause
      // is a race: the console's seat count was one poll old and the cohort filled in between.
      set({ testPeerError: actionFailedWith(result.reason || undefined), addingTestPeers: undefined });
      return;
    }
    if (result.kind === 'unreachable') {
      set({ testPeerError: actionFailedWith(), addingTestPeers: undefined });
      return;
    }
    // The spawn took. No member is inserted locally: the peers have to actually seat, which is a
    // protocol round-trip this browser does not observe, so the list must come from the next
    // served read. That is also what makes the `Test peer` badge a served fact.
    set({ addingTestPeers: undefined });
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
    // The asking session, captured before the await like every other gated call (review IN-09).
    const askedInRound = askingRound(get);
    const result = await apiDisableBroadcast(baseUrl);
    if (result.kind === 'unauthorized') {
      // The ONE shared session-expiry path (D-16); `expireSession` clears `broadcastBusy` itself.
      // Scoped to the session that ASKED (review IN-09).
      expireIfStillAsking(get, askedInRound);
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
    // The asking session, captured before the await like every other gated call (review IN-09).
    const askedInRound = askingRound(get);
    const result = await apiDismissEnded(baseUrl, id);
    if (result.kind === 'unauthorized') {
      expireIfStillAsking(get, askedInRound);
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
    // The asking session, captured before the await like every other gated call (review
    // WR-08/WR-09, IN-09).
    const askedInRound = askingRound(get);
    const result = await apiFetchSettings(baseUrl);
    if (result.kind === 'unauthorized') {
      // The ONE shared session-expiry path (D-16); it clears the settings slice itself. Scoped to
      // the session that ASKED: a refusal aimed at a session that has already ended must not end
      // the one that replaced it (review WR-08).
      expireIfStillAsking(get, askedInRound);
      return;
    }
    // The round guard, ahead of BOTH branches that write: a late answer must move neither the
    // snapshot nor the error posture of a console it does not belong to (review WR-09). The write
    // here is not transient either, which is why it earns a guard rather than a comment: the
    // console shell re-reads settings only while the snapshot is undefined, so a dead session's
    // answer landing in that gap makes the new session skip its own read and open the create form
    // on a previous session's defaults.
    if (!stillAsking(get, askedInRound)) {
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
    // The asking session, captured before the await (review WR-08/WR-09, IN-09). A save is
    // operator-initiated and therefore a narrower race than a poll, and it is guarded anyway
    // because the write it lands is the settings snapshot the create form reads.
    const askedInRound = askingRound(get);
    try {
      const result = await apiSaveSettings(baseUrl, patch);
      // One comparison, read by every branch below, because all four of them act: two write into
      // the settings slice, one writes the error posture, and one ends a session (review WR-09).
      // The shared comparison is read ONCE here rather than expiring and then re-deciding, which is
      // the one shape the trio has to support (review IN-09).
      const asking = stillAsking(get, askedInRound);
      if (result.ok) {
        if (!asking) {
          return;
        }
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
        // Scoped to the session that ASKED, as in the three reads above (review WR-08).
        if (asking) {
          get().expireSession();
        }
        return;
      }
      if (!asking) {
        // A refusal about a value the PREVIOUS operator typed is a message the current one cannot
        // act on, so it is discarded with the rest of a dead session's answers.
        return;
      }
      // A rejection applies NOTHING (the service validates the set and refuses it whole), and this
      // store writes no field either, so every rendered value still shows what the service holds.
      set({ settingsStatus: 'error', settingsError: result.error });
    } catch {
      // The transport fault is scoped the same way: it is a fact about the request the asking
      // session made, and the console that replaced it made no save to report on.
      if (stillAsking(get, askedInRound)) {
        set({ settingsStatus: 'error', settingsError: UNREACHABLE });
      }
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
      detailCohortId: undefined,
      detailStale: false,
      lastUpdated: undefined,
    });
  },

  closeCohort() {
    set({
      view: { kind: 'list' },
      detail: undefined,
      detailCohortId: undefined,
      detailStale: false,
      lastUpdated: undefined,
    });
  },

  async pollDetail(baseUrl) {
    const { view } = get();
    if (view.kind !== 'detail') {
      return;
    }
    // Capture the cohort this question is ABOUT, exactly as `fetchCohortFate` does in
    // `stores/participant.ts`. Nothing cancels a request already in flight, so by the time the
    // answer arrives the operator may have opened a different cohort (`05-VERIFICATION.md`
    // Gap 1, review CR-1).
    const askedFor = view.cohortId;
    // And capture the SESSION this question is asked in, exactly as `refreshCohorts` does. The two
    // captures answer different questions and both are needed: a detail answer is a fact about one
    // cohort AND about one session (review WR-08/WR-09, IN-09).
    const askedInRound = askingRound(get);
    const result = await fetchCohortDetail(baseUrl, askedFor);
    if (result.kind === 'unauthorized') {
      // Handled FIRST, ahead of the cohort guard below, and deliberately so: a session expiry is
      // SESSION-scoped, not cohort-scoped. It is true no matter which cohort asked, and deferring
      // it to the next poll tick would leave the operator working a dead session for no reason.
      // Session expired mid-monitoring (D-16): honest re-login. Drop to the login screen
      // and back to the list view so the next sign-in starts clean; distinct from an
      // unreachable fault, which freezes the view below.
      //
      // Scoped to the session that ASKED, on the same reasoning as `refreshCohorts` above: a 401 is
      // evidence about the asker, so a refusal aimed at a session that has already ended must not
      // end the one that replaced it (review WR-08).
      expireIfStillAsking(get, askedInRound);
      return;
    }
    // The round guard. Everything BELOW this point is a fact about ONE cohort, the freshness flag
    // as much as the document, so an answer about a cohort no longer in view is discarded whole: a
    // stale request's failure must not mark the current cohort's view stale, and a stale request's
    // success must not paint it. The shipped precedent is `fetchCohortFate` in
    // `stores/participant.ts`: ask about one id, and apply the answer only if that is still what
    // the store holds.
    //
    // The session comparison JOINS the cohort comparison rather than replacing it, and each refuses
    // something the other cannot see (review WR-09). The cohort comparison cannot see a session
    // boundary the operator crossed while reopening the SAME cohort id, and the session comparison
    // cannot see a navigation inside one session. What this slot holds makes the difference matter:
    // member DIDs and pubkeys, raw signed updates, co-sign progress and the funding view, so a
    // dead session's copy landing in a live one is operator data crossing a session boundary.
    const current = get().view;
    if (!stillAsking(get, askedInRound)) {
      return;
    }
    if (current.kind !== 'detail' || current.cohortId !== askedFor) {
      return;
    }
    if (result.kind === 'unreachable') {
      // Freeze the last-known detail (D-25): keep it visible, flag it stale for the
      // freshness indicator, and retry quietly on the next tick. Never blank the view.
      set({ detailStale: true });
      return;
    }
    // The provenance is written in the SAME call as the document, so the two can never be set apart.
    set({ detail: result.value, detailCohortId: askedFor, detailStale: false, lastUpdated: Date.now() });
  },
}));
