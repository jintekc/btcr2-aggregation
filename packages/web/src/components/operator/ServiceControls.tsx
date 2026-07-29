import { Button, Card, SectionTitle } from '../../ui/primitives';
import {
  ADVERTISING_PAUSED_LINE,
  ADVERTISING_RUNNING_LINE,
  FULL_QUIESCE_GUIDANCE,
  RESTART_HONESTY_LINE,
  useOperator,
} from '../../stores/operator';

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

  const view = serviceControlsView({ paused, busy: pauseBusy });

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
      </div>

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
    </Card>
  );
}
