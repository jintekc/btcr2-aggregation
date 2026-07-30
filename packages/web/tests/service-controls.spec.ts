import { describe, expect, it } from 'vitest';
import { BROADCAST_OFF_CHIP } from '../src/components/operator/HealthStrip';
import {
  broadcastControlState,
  operatorLogState,
  PAUSE_LABEL,
  RESUME_LABEL,
  serviceControlsView,
} from '../src/components/operator/ServiceControls';
import {
  ADVERTISING_PAUSED_LINE,
  ADVERTISING_RUNNING_LINE,
  RESTART_HONESTY_LINE,
  FULL_QUIESCE_GUIDANCE,
  ADVERTISE_DISABLED_REASON,
  BROADCAST_OFF_LINE,
  DISABLE_BROADCAST_BODY_IN_FLIGHT,
  DISABLE_BROADCAST_BODY_NEW,
  DISABLE_BROADCAST_BODY_ONE_WAY,
  DISABLE_BROADCAST_HEADING,
  DISABLE_BROADCAST_LABEL,
  DISMISS_BODY,
  DISMISS_CONFIRM_LABEL,
  DISMISS_HEADING,
  DISMISS_LABEL,
  DISMISS_READVERTISE_LINE,
  KEEP_BROADCAST_LABEL,
  KEEP_RECORD_LABEL,
  OPERATOR_ACTIONS_EMPTY,
  OPERATOR_ACTIONS_EMPTY_BODY,
  OPERATOR_ACTIONS_LOADING,
  OPERATOR_ACTIONS_TITLE,
} from '../src/stores/operator';

/**
 * SVC-04 service-controls coverage (05-05, D-06 through D-09).
 *
 * The whole point of the drain-mode pause is that the console can never claim a state the
 * SERVICE has not reported. That honesty is a pure function of two inputs (the served paused
 * bit and whether a toggle is in flight), so it is proven here without a DOM: the component
 * only renders what this predicate returns.
 *
 * The three properties the predicate exists to guarantee:
 *  1. An ABSENT bit is `unknown`, never `running`. Before the first ok read the card must make
 *     no pause claim at all, mirroring the health strip's `Checking mode` posture (UI-SPEC E4
 *     empty). Defaulting to "running" would tell a returning operator their service is offering
 *     new cohorts when it may well be draining.
 *  2. An in-flight toggle disables both controls but does NOT flip the state line: the line
 *     keeps reflecting the last SERVED value until the service reports the new one (UI-SPEC E4
 *     loading + error). This is what makes a FAILED toggle safe - nothing was ever painted
 *     optimistically, so there is nothing to roll back.
 *  3. The copy is exact contract copy from 05-UI-SPEC, so the sentences an operator relies on
 *     (pause does not retract; a restart forgets) cannot drift by a word.
 */

describe('serviceControlsView: the card state comes only from the SERVED bit', () => {
  it('is unknown before the first read lands, so the card makes no pause claim', () => {
    const view = serviceControlsView({ paused: undefined, busy: false });
    expect(view.state).toBe('unknown');
    // No state line and no toggle: an unknown service gets the restart-honesty line ONLY.
    expect(view.stateLine).toBeUndefined();
    expect(view.toggleLabel).toBeUndefined();
    expect(view.toggleAction).toBeUndefined();
    // Nothing to toggle TO, so the (absent) control is disabled rather than merely hidden.
    expect(view.toggleDisabled).toBe(true);
  });

  it('never infers paused from an absent value (the E4 empty-state guard)', () => {
    // The inverse of the honest failure: an absent bit must not fall through to either claim.
    expect(serviceControlsView({ paused: undefined, busy: false }).state).not.toBe('paused');
    expect(serviceControlsView({ paused: undefined, busy: false }).state).not.toBe('running');
  });

  it('is running when the service reports not paused, offering Pause advertising', () => {
    const view = serviceControlsView({ paused: false, busy: false });
    expect(view.state).toBe('running');
    expect(view.stateLine).toBe(ADVERTISING_RUNNING_LINE);
    expect(view.toggleLabel).toBe(PAUSE_LABEL);
    expect(view.toggleAction).toBe('pause');
    expect(view.toggleDisabled).toBe(false);
  });

  it('is paused when the service reports paused, offering Resume advertising', () => {
    const view = serviceControlsView({ paused: true, busy: false });
    expect(view.state).toBe('paused');
    expect(view.stateLine).toBe(ADVERTISING_PAUSED_LINE);
    expect(view.toggleLabel).toBe(RESUME_LABEL);
    expect(view.toggleAction).toBe('resume');
    expect(view.toggleDisabled).toBe(false);
  });
});

describe('serviceControlsView: an in-flight toggle disables without flipping the claim', () => {
  it('disables the control while a pause is in flight and keeps the SERVED running line', () => {
    const view = serviceControlsView({ paused: false, busy: true });
    expect(view.busy).toBe(true);
    expect(view.toggleDisabled).toBe(true);
    // The optimistic flip that must NOT happen: the line still says the service is advertising,
    // because the service has not yet said otherwise.
    expect(view.state).toBe('running');
    expect(view.stateLine).toBe(ADVERTISING_RUNNING_LINE);
  });

  it('disables the control while a resume is in flight and keeps the SERVED paused line', () => {
    const view = serviceControlsView({ paused: true, busy: true });
    expect(view.busy).toBe(true);
    expect(view.toggleDisabled).toBe(true);
    expect(view.state).toBe('paused');
    expect(view.stateLine).toBe(ADVERTISING_PAUSED_LINE);
  });

  it('stays unknown while busy, so a toggle can never manufacture a first claim', () => {
    const view = serviceControlsView({ paused: undefined, busy: true });
    expect(view.state).toBe('unknown');
    expect(view.stateLine).toBeUndefined();
    expect(view.toggleDisabled).toBe(true);
  });
});

describe('the controls-card copy is the exact 05-UI-SPEC contract copy', () => {
  it('states the restart-honesty line in words', () => {
    expect(RESTART_HONESTY_LINE).toBe(
      'Pause, broadcast, and settings changes live in memory for this session. A restart returns this service to its boot environment.',
    );
  });

  it('states the full-quiesce guidance in words, because pause never retracts', () => {
    expect(FULL_QUIESCE_GUIDANCE).toBe(
      'Pausing does not end cohorts that are already open. Cancel each one if you need this service fully quiet.',
    );
  });

  it('states the paused line as drain mode, not as a dead service', () => {
    expect(ADVERTISING_PAUSED_LINE).toBe(
      'New cohorts are not being advertised. Cohorts already advertised keep filling, and everything else on this service keeps running.',
    );
  });

  it('states the running line and the disabled-advertise reason verbatim', () => {
    expect(ADVERTISING_RUNNING_LINE).toBe('New cohorts are being advertised normally.');
    expect(ADVERTISE_DISABLED_REASON).toBe('Advertising is paused.');
  });

  it('carries no long dash in any card string (house style, checker-blocked at the source)', () => {
    const strings = [
      ADVERTISING_PAUSED_LINE,
      ADVERTISING_RUNNING_LINE,
      RESTART_HONESTY_LINE,
      FULL_QUIESCE_GUIDANCE,
      ADVERTISE_DISABLED_REASON,
      PAUSE_LABEL,
      RESUME_LABEL,
    ];
    for (const s of strings) {
      expect(s).not.toContain('—');
    }
  });
});

describe('broadcastControlState: the kill switch appears only where it can do something (D-14)', () => {
  it('is absent before the first read lands, so a one-way control is never offered blind', () => {
    expect(broadcastControlState({ mode: undefined, broadcastDisabled: undefined })).toBe('absent');
  });

  it('is absent on every non-broadcasting mode (there is nothing to stand down)', () => {
    expect(broadcastControlState({ mode: 'hermetic' })).toBe('absent');
    expect(broadcastControlState({ mode: 'live-no-broadcast' })).toBe('absent');
  });

  it('is available on the served live-broadcasting mode', () => {
    expect(broadcastControlState({ mode: 'live', broadcastDisabled: false })).toBe('available');
    // An absent bit on a live service is not a broadcast-off claim: the control still stands.
    expect(broadcastControlState({ mode: 'live' })).toBe('available');
  });

  it('is REPLACED once engaged, never merely disabled', () => {
    // `engaged` renders the restart line instead of the control. A disabled button would imply
    // the act is still pending or still possible from this console; it is neither.
    expect(broadcastControlState({ mode: 'live', broadcastDisabled: true })).toBe('engaged');
  });
});

describe('operatorLogState: an empty log before a read is not an empty log (UI-SPEC E13)', () => {
  it('is loading until a read lands, so the console never makes a false empty claim', () => {
    expect(operatorLogState({ loaded: false, entries: 0 })).toBe('loading');
  });

  it('is empty only once the service has actually answered with nothing', () => {
    expect(operatorLogState({ loaded: true, entries: 0 })).toBe('empty');
  });

  it('renders entries once there are any', () => {
    expect(operatorLogState({ loaded: true, entries: 1 })).toBe('entries');
  });
});

describe('the kill-switch and dismissal copy is exact contract copy (05-UI-SPEC E9/E10/E13)', () => {
  it('states all three kill-switch confirm body lines, including the no-way-back line', () => {
    expect(DISABLE_BROADCAST_HEADING).toBe('Disable broadcast for new cohorts?');
    expect(DISABLE_BROADCAST_BODY_NEW).toBe(
      'New cohorts will be created on the fixture path and will not publish anything to Bitcoin.',
    );
    expect(DISABLE_BROADCAST_BODY_IN_FLIGHT).toBe(
      'Cohorts already in flight finish under the mode they started with, and chain reads (resolve and anchor tracking) stay on.',
    );
    expect(DISABLE_BROADCAST_BODY_ONE_WAY).toBe(
      'You cannot turn broadcast back on from here. Restart this service with its broadcast environment set to re-enable it.',
    );
    expect(KEEP_BROADCAST_LABEL).toBe('Keep broadcast on');
  });

  it('names the environment variable in the post-engage replacement line', () => {
    // "Restart with its broadcast environment set" is only actionable if the operator knows which
    // one, and this is the moment they need it.
    expect(BROADCAST_OFF_LINE).toBe(
      'Broadcast is off for new cohorts. Restart this service with BROADCAST=1 to turn it back on.',
    );
    expect(BROADCAST_OFF_CHIP).toBe('Broadcast off (this session)');
  });

  // The 05-19 disclosure line (`DISMISS_READVERTISE_LINE`) joins this dismissal copy set. Its
  // CONTENT is pinned in `packages/web/tests/operator-rows.spec.ts`, beside the predicate that
  // decides which rows it renders on, so a future copy change has two places to find.
  it('states the rung-1 dismissal copy, including that there is no undo', () => {
    expect(DISMISS_HEADING).toBe('Remove this record?');
    expect(DISMISS_BODY).toContain('There is no undo.');
    expect(DISMISS_BODY).toContain('nothing on the chain or in the directory changes');
    expect(DISMISS_CONFIRM_LABEL).toBe('Dismiss record');
    expect(KEEP_RECORD_LABEL).toBe('Keep it');
  });

  it('states the operator-log empty heading and body', () => {
    expect(OPERATOR_ACTIONS_TITLE).toBe('Operator actions');
    expect(OPERATOR_ACTIONS_EMPTY).toBe('No operator actions this session.');
    expect(OPERATOR_ACTIONS_EMPTY_BODY).toContain('a restart clears them');
  });

  it('carries no long dash in any of it (house style, checker-blocked at the source)', () => {
    const strings = [
      DISABLE_BROADCAST_LABEL,
      DISABLE_BROADCAST_HEADING,
      DISABLE_BROADCAST_BODY_NEW,
      DISABLE_BROADCAST_BODY_IN_FLIGHT,
      DISABLE_BROADCAST_BODY_ONE_WAY,
      KEEP_BROADCAST_LABEL,
      BROADCAST_OFF_LINE,
      BROADCAST_OFF_CHIP,
      DISMISS_LABEL,
      DISMISS_HEADING,
      DISMISS_BODY,
      DISMISS_CONFIRM_LABEL,
      DISMISS_READVERTISE_LINE,
      KEEP_RECORD_LABEL,
      OPERATOR_ACTIONS_TITLE,
      OPERATOR_ACTIONS_EMPTY,
      OPERATOR_ACTIONS_EMPTY_BODY,
      OPERATOR_ACTIONS_LOADING,
    ];
    for (const s of strings) {
      expect(s).not.toContain('—');
    }
  });
});
