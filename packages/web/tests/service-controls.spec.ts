import { describe, expect, it } from 'vitest';
import {
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
