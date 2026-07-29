import { useState } from 'react';
import { Button, Card, ConfirmPanel, SectionTitle } from '../../ui/primitives';
import { LogPanel } from '../LogPanel';
import { fmtWallClock } from '../../lib/clock';
import {
  ADVERTISING_PAUSED_LINE,
  ADVERTISING_RUNNING_LINE,
  BROADCAST_OFF_LINE,
  DISABLE_BROADCAST_BODY_IN_FLIGHT,
  DISABLE_BROADCAST_BODY_NEW,
  DISABLE_BROADCAST_BODY_ONE_WAY,
  DISABLE_BROADCAST_BUSY,
  DISABLE_BROADCAST_HEADING,
  DISABLE_BROADCAST_LABEL,
  FULL_QUIESCE_GUIDANCE,
  KEEP_BROADCAST_LABEL,
  OPERATOR_ACTIONS_EMPTY,
  OPERATOR_ACTIONS_EMPTY_BODY,
  OPERATOR_ACTIONS_LOADING,
  OPERATOR_ACTIONS_TITLE,
  RESTART_HONESTY_LINE,
  useOperator,
} from '../../stores/operator';
import type { LogEntry } from '../../lib/types';

/** The pause control's label (ghost, never accent, never danger: this is a reversible act). */
export const PAUSE_LABEL = 'Pause advertising';

/** The resume control's label; the same treatment, for the same reason. */
export const RESUME_LABEL = 'Resume advertising';

/**
 * The entry point to the third console view (D-12). It lives on THIS card because the settings it
 * opens are service-level facts, exactly like the pause beside it, rather than anything about an
 * individual cohort. Ghost like every other control here: opening a view is not destructive, and
 * Phase 5 adds no new accent CTA.
 */
export const SETTINGS_ENTRY_LABEL = 'Service settings';

/** What the service has told us about advertising. `unknown` until the first ok read lands. */
export type AdvertisingState = 'unknown' | 'running' | 'paused';

/** Everything the controls card renders, derived from the served bit and the in-flight marker. */
export interface ServiceControlsView {
  state: AdvertisingState;
  /** True while a toggle is in flight; both controls disable and neither claim moves. */
  busy: boolean;
  /** Whether the single toggle button renders disabled (in flight, or nothing served yet). */
  toggleDisabled: boolean;
  /** The state line, absent in the `unknown` state so the card makes NO pause claim. */
  stateLine?: string;
  /** The toggle's label, absent in the `unknown` state (there is no state to toggle away from). */
  toggleLabel?: string;
  /** Which route the toggle calls; absent in the `unknown` state. */
  toggleAction?: 'pause' | 'resume';
}

/**
 * The pure controls-card state (SVC-04, D-06 through D-09). Every rendered fact on the card comes
 * from here, so the card's honesty is unit-testable without a DOM
 * (`packages/web/tests/service-controls.spec.ts`).
 *
 * Two properties this function exists to guarantee:
 *
 *  1. An ABSENT bit is `unknown`, NEVER `running`. Before the first ok read the card shows the
 *     restart-honesty line and nothing else, mirroring the health strip's `Checking mode` posture
 *     (UI-SPEC E4 empty). Defaulting to "running" would tell a returning operator that new cohorts
 *     are being offered by a service that may in fact be draining - the console claiming a state
 *     the service never reported is precisely T-05-05-01.
 *
 *  2. An in-flight toggle disables the control but does NOT move the state line. The line keeps
 *     reflecting the last SERVED value until the service reports the new one, which is what makes
 *     a FAILED toggle safe: nothing was painted optimistically, so there is nothing to roll back
 *     (UI-SPEC E4 loading + error).
 */
export function serviceControlsView(input: { paused?: boolean; busy: boolean }): ServiceControlsView {
  if (input.paused === undefined) {
    // Unknown: no claim, no control. Disabled rather than merely absent, so that if a later
    // revision does render a button in this state it cannot be clicked into a guess.
    return { state: 'unknown', busy: input.busy, toggleDisabled: true };
  }
  if (input.paused) {
    return {
      state: 'paused',
      busy: input.busy,
      toggleDisabled: input.busy,
      stateLine: ADVERTISING_PAUSED_LINE,
      toggleLabel: RESUME_LABEL,
      toggleAction: 'resume',
    };
  }
  return {
    state: 'running',
    busy: input.busy,
    toggleDisabled: input.busy,
    stateLine: ADVERTISING_RUNNING_LINE,
    toggleLabel: PAUSE_LABEL,
    toggleAction: 'pause',
  };
}

/**
 * What the kill-switch slot on this card renders (SVC-04, 05-UI-SPEC E9, D-14).
 *
 * `absent` is the answer for every service that is not broadcasting, and for the window before the
 * first ok read: offering a control that stands down money movement on a service that moves none
 * would be an offer to do nothing, and offering it against an UNKNOWN mode would be worse, because
 * an operator who clicks it has taken a one-way action on a service whose mode this console never
 * confirmed.
 */
export type BroadcastControlState = 'absent' | 'available' | 'engaged';

/**
 * The pure kill-switch slot state. It exists for the same reason {@link serviceControlsView} does:
 * the honesty rules here are about what this console may CLAIM, and a rule that lives in a
 * component is a rule the gate cannot reach.
 *
 * Two properties it guarantees:
 *
 *  1. The control appears ONLY on the served live-broadcasting mode. `live-no-broadcast` and
 *     `hermetic` never publish, so there is nothing to stand down, and an undefined mode is
 *     treated exactly like those: no claim, no control (the health strip's `Checking mode`
 *     posture, applied to a control instead of a chip).
 *  2. Once engaged, the control is REPLACED, never merely disabled. A disabled `Disable broadcast`
 *     would imply the act is still pending or still possible from here; it is neither, and the
 *     replacement line names the environment variable that is the only way back.
 */
export function broadcastControlState(input: {
  mode?: 'hermetic' | 'live-no-broadcast' | 'live';
  broadcastDisabled?: boolean;
}): BroadcastControlState {
  if (input.mode !== 'live') {
    return 'absent';
  }
  return input.broadcastDisabled === true ? 'engaged' : 'available';
}

/** What the `Operator actions` log renders, given whether a read has landed yet. */
export type OperatorLogState = 'loading' | 'empty' | 'entries';

/**
 * The pure log state (05-UI-SPEC E13). The distinction it exists to make: an empty array BEFORE
 * the first read and an empty array AFTER one mean different things, and only the second may
 * render `No operator actions this session.` The first is the console-level loading posture, so
 * the log never makes a false claim about the operator's own history.
 *
 * A STALE read keeps whatever entries it already has (the inherited unreachable banner is the
 * error surface, D-25): freezing is honest, dropping entries would not be.
 */
export function operatorLogState(input: { loaded: boolean; entries: number }): OperatorLogState {
  if (!input.loaded) {
    return 'loading';
  }
  return input.entries === 0 ? 'empty' : 'entries';
}

/**
 * The `Service controls` card (SVC-04, 05-UI-SPEC E4), mounted directly under the health strip and
 * above both console views.
 *
 * It carries the advertising drain-mode toggle plus the two pieces of guidance that stop a pause
 * from being misunderstood:
 *
 *  - the restart-honesty line (D-08/D-12): runtime settings live in memory only, so a restart
 *    returns this service to its boot environment;
 *  - the full-quiesce guidance (D-06): pause never RETRACTS, so cohorts already advertised keep
 *    filling and each one must be canceled to make the service genuinely quiet.
 *
 * Both are rendered ALWAYS, including before the first read, because they are facts about how this
 * service works rather than claims about its current state.
 *
 * `Pause advertising` and `Resume advertising` take NO confirmation (05-UI-SPEC reversible-actions
 * rule). They are reversible, and spending confirmation friction on a reversible act would dilute
 * the ladder that `Cancel cohort` depends on. They are `ghost` for the same reason: Phase 5 adds no
 * new accent CTA, and nothing here is destructive.
 *
 * The controls row is `flex-wrap` at the shared `gap-2`, so the button, the state line and any
 * later sibling control (the 05-08 broadcast kill switch lands on this same card) wrap to a second
 * line on narrow widths instead of pushing content off-screen (UI-SPEC E4 overflow).
 */
export function ServiceControls({ baseUrl }: { baseUrl: string }) {
  // The SERVED paused bit, read from the same polled list read the health strip's chip uses, which
  // the service projects from the SAME runtime holder its advertise gate enforces. Undefined until
  // the first ok read: the card then makes no pause claim at all.
  const paused = useOperator((s) => s.health?.paused);
  const pauseBusy = useOperator((s) => s.pauseBusy);
  const pauseMessage = useOperator((s) => s.pauseMessage);
  const pauseError = useOperator((s) => s.pauseError);
  const pause = useOperator((s) => s.pauseAdvertising);
  const resume = useOperator((s) => s.resumeAdvertising);
  const openSettings = useOperator((s) => s.openSettings);
  const consoleView = useOperator((s) => s.view);
  // The kill switch reads the SAME served health payload the pause bit and the mode chip do, so
  // the control, the chip and the enforced behavior all move on one snapshot (D-14).
  const mode = useOperator((s) => s.health?.mode);
  const broadcastDisabled = useOperator((s) => s.health?.broadcastDisabled);
  const broadcastBusy = useOperator((s) => s.broadcastBusy);
  const broadcastError = useOperator((s) => s.broadcastError);
  const disableBroadcast = useOperator((s) => s.disableBroadcast);
  const operatorActions = useOperator((s) => s.operatorActions);
  // A read has landed for this session exactly when the list poll stamped its freshness clock.
  const loaded = useOperator((s) => s.lastUpdated !== undefined);
  const [confirmingBroadcast, setConfirmingBroadcast] = useState(false);

  const view = serviceControlsView({ paused, busy: pauseBusy });
  const broadcast = broadcastControlState({ mode, broadcastDisabled });
  const logState = operatorLogState({ loaded, entries: operatorActions.length });

  return (
    <Card className="space-y-2 px-4 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <SectionTitle>Service controls</SectionTitle>
        {/* No state line in the unknown state: the card says nothing about pause until the
            service has said something about it. */}
        {view.stateLine ? <span className="text-sm text-muted">{view.stateLine}</span> : null}
        {view.toggleLabel && view.toggleAction ? (
          <Button
            variant="ghost"
            disabled={view.toggleDisabled}
            onClick={() =>
              void (view.toggleAction === 'pause' ? pause(baseUrl) : resume(baseUrl))
            }
          >
            {view.toggleLabel}
          </Button>
        ) : null}
        {/* The settings entry point. Hidden while the settings view is already open: an entry
            point to the surface you are already on is not a control, it is noise. */}
        {consoleView.kind !== 'settings' ? (
          <Button variant="ghost" onClick={() => openSettings()}>
            {SETTINGS_ENTRY_LABEL}
          </Button>
        ) : null}
        {/* The kill switch (D-14). Danger tone because this is the rung-3 act on this card, and
            rendered only while a confirm is not open, so the button and its own confirmation are
            never on screen together. */}
        {broadcast === 'available' && !confirmingBroadcast ? (
          <Button variant="danger" onClick={() => setConfirmingBroadcast(true)}>
            {DISABLE_BROADCAST_LABEL}
          </Button>
        ) : null}
      </div>

      {/* Once engaged the control is GONE, replaced by the only route back. A disabled button
          here would imply the act is still pending or still reversible from this console; it is
          neither, and the line names BROADCAST=1 because "set the broadcast environment" is only
          actionable if the operator knows which variable. */}
      {broadcast === 'engaged' ? <p className="text-sm text-muted">{BROADCAST_OFF_LINE}</p> : null}

      {/* The rung-3 ceremony (UI-SPEC E9). Three stacked body lines, in the order an operator
          needs them: what happens to new cohorts, what happens to work already in flight, and
          that there is no way back from here. */}
      {confirmingBroadcast ? (
        <ConfirmPanel
          tone="bad"
          heading={DISABLE_BROADCAST_HEADING}
          body={
            <>
              <p>{DISABLE_BROADCAST_BODY_NEW}</p>
              <p>{DISABLE_BROADCAST_BODY_IN_FLIGHT}</p>
              <p>{DISABLE_BROADCAST_BODY_ONE_WAY}</p>
            </>
          }
          confirmLabel={DISABLE_BROADCAST_LABEL}
          cancelLabel={KEEP_BROADCAST_LABEL}
          busy={broadcastBusy}
          busyLabel={DISABLE_BROADCAST_BUSY}
          onConfirm={() => {
            void disableBroadcast(baseUrl).then(() => setConfirmingBroadcast(false));
          }}
          onCancel={() => setConfirmingBroadcast(false)}
        />
      ) : null}

      {/* A failed engage says so HERE, and the mode chip above stays exactly as the service last
          reported it: nothing was painted, so there is nothing to roll back. */}
      {broadcastError ? (
        <div className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{broadcastError}</div>
      ) : null}

      {/* A failed toggle says so HERE, on the surface that raised it, while the state line above
          stays exactly as the service last reported it. */}
      {pauseError ? (
        <div className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{pauseError}</div>
      ) : null}
      {pauseMessage ? (
        <div className="rounded-lg border border-good/40 bg-good/10 px-3 py-2 text-sm text-good">
          {pauseMessage}
        </div>
      ) : null}

      {/* The restart-honesty line renders ALWAYS, including before the first read: it is a fact
          about how this service stores runtime state, not a claim about its current state. */}
      <p className="text-sm text-muted">{RESTART_HONESTY_LINE}</p>
      {/* The full-quiesce guidance is held back until a state has been SERVED (UI-SPEC E4 empty:
          before the first ok read the card shows only the restart-honesty line). Guidance about
          what pausing does not do is only meaningful once the card can say whether this service is
          paused at all; showing it against an unknown state invites the reading that it IS paused. */}
      {view.state !== 'unknown' ? <p className="text-sm text-muted">{FULL_QUIESCE_GUIDANCE}</p> : null}

      {/* The SERVICE-level operator actions log (D-14/D-15, UI-SPEC E13). It lives on this card
          because these are service-level acts, and it reads from the SAME polled snapshot the
          controls above do, so a pause and its log line land on one tick.

          Three states, and the distinction between the first two is the point: before any read
          the console-level loading posture applies, because claiming "no operator actions this
          session" against a service that has not answered would be a false claim about the
          operator's own history. A STALE read keeps its entries frozen under the list's inherited
          unreachable banner rather than dropping them. */}
      <div className="space-y-1 pt-1">
        {logState === 'loading' ? (
          <>
            <SectionTitle>{OPERATOR_ACTIONS_TITLE}</SectionTitle>
            <p className="text-sm text-muted">{OPERATOR_ACTIONS_LOADING}</p>
          </>
        ) : logState === 'empty' ? (
          <>
            <SectionTitle>{OPERATOR_ACTIONS_TITLE}</SectionTitle>
            <p className="text-sm text-ink">{OPERATOR_ACTIONS_EMPTY}</p>
            <p className="text-sm text-muted">{OPERATOR_ACTIONS_EMPTY_BODY}</p>
          </>
        ) : (
          <LogPanel
            title={OPERATOR_ACTIONS_TITLE}
            entries={operatorActions as LogEntry[]}
            emptyHint={OPERATOR_ACTIONS_EMPTY}
            formatTime={fmtWallClock}
            className="h-48"
          />
        )}
      </div>
    </Card>
  );
}
