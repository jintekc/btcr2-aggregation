import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestPeerAction } from '../src/components/operator/CohortDetail';
import { BROADCAST_OFF_CHIP, HealthStrip, MODE_LABEL } from '../src/components/operator/HealthStrip';
import {
  broadcastControlState,
  operatorLogState,
  PAUSE_LABEL,
  RESUME_LABEL,
  ServiceControls,
  serviceControlsView,
} from '../src/components/operator/ServiceControls';
import {
  ADD_TEST_PEERS_BODY,
  ADD_TEST_PEERS_BUSY,
  ADD_TEST_PEERS_CANCEL_LABEL,
  ADD_TEST_PEERS_LABEL,
  addTestPeersConfirmLabel,
  addTestPeersHeading,
  addTestPeersHelp,
  liveTestPeersLine,
  NO_SEATS_LEFT_REASON,
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
import { asRenderedText, renderStatic } from './support/render';
import type { ServiceMode } from '../src/lib/operator';
import type { OperatorState } from '../src/stores/operator';
import type { ParticipantState } from '../src/stores/participant';

/**
 * The render fixtures, and the FILE-SCOPED fakes that carry them into a static render.
 *
 * This file keeps its own render blocks rather than splitting them into a sibling, because the
 * check 05-22 required BEFORE writing came back clean: every pre-existing row here calls a pure
 * selector or reads an exported copy constant, and NOT ONE of them touches a bound store hook. The
 * fake spreads the actual module, so `DISMISS_BODY` and every other constant above stays the
 * shipped one; only `useOperator` and `useParticipant` are replaced. (`packages/web/tests/
 * terms-render.spec.tsx` is a sibling precisely because `terms.spec.ts` does have live hook calls,
 * which `vi.mock`, being file-scoped, could not have served.)
 *
 * The recipe is the one `packages/web/tests/support/render.tsx` spells out: a `vi.mock` factory is
 * hoisted above this file's imports, so it may CAPTURE a plain holder but must resolve both the
 * original module and the helper by dynamic import. The holders are typed as partials of the
 * stores' own state, so a misspelled fixture key is a compile error rather than an `undefined`
 * indistinguishable from an unseeded store.
 *
 * There is no `setState` in this file, and there cannot be. A static render takes
 * `useSyncExternalStore`'s SERVER snapshot, which zustand implements as `getInitialState()`, so a
 * `setState` seed is invisible; and here the bound hooks ARE the fake, which exposes none. Every
 * row of the mode matrix below would render the pre-first-read fallback and pass while proving
 * nothing.
 */
const operatorFixture: { current: Partial<OperatorState> } = { current: {} };
const participantFixture: { current: Partial<ParticipantState> } = { current: {} };

vi.mock('../src/stores/operator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/stores/operator')>();
  const { selectorFake } = await import('./support/render');
  return { ...actual, useOperator: selectorFake(() => operatorFixture.current) };
});

vi.mock('../src/stores/participant', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/stores/participant')>();
  const { selectorFake } = await import('./support/render');
  return { ...actual, useParticipant: selectorFake(() => participantFixture.current) };
});

/**
 * Whether `label` renders as a COMPLETE chip, rather than merely appearing somewhere in the markup.
 *
 * `Live` is a substring of `Live (no broadcast)`, so a plain `toContain` could never assert that
 * the live-no-broadcast row does not ALSO claim plain live, which is exactly the both-directions
 * property the mode matrix rests on. Every chip on the health strip is a `Badge`, which renders its
 * children directly inside one `<span>`, so the closing tag is what makes the match exact.
 */
function chipRendered(html: string, label: string): boolean {
  return html.includes(`>${asRenderedText(label)}</span>`);
}

/**
 * The character house style forbids in authored copy, spelled as an ESCAPE and once.
 *
 * Every guard in this file compares against this constant rather than pasting the character in
 * literally, which is what lets the repo-wide scan for it over this file return nothing. A guard
 * that must contain the character it forbids reads as a violation to every grep that looks, and
 * 05-21 had to record exactly that as an acceptance criterion it could not meet. The two
 * pre-existing guards below were converted to it; the comparison is byte-identical, so neither
 * assertion changed meaning.
 */
const LONG_DASH = '\u2014';

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
      expect(s).not.toContain(LONG_DASH);
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
    // EXACT equality on all three sentences (`05-AUDIT-2.md` entry 22). What the two easily
    // droppable phrases cost if they go: without "and its activity log" and " for this session"
    // the confirm reads as if the record were permanently destroyed SERVER side, when in fact it
    // clears one console for one session (D-15, UI-SPEC E10). A promise about what an act costs
    // must not be able to narrow silently, and containment alone let it.
    expect(DISMISS_BODY).toBe(
      "This clears the ended cohort's record and its activity log from your console for this session. The cohort itself already ended, so nothing on the chain or in the directory changes. There is no undo.",
    );
    // Kept beside the exact pin because they name WHICH facts are load-bearing, which the one
    // long string does not make obvious to a reader.
    expect(DISMISS_BODY).toContain('There is no undo.');
    expect(DISMISS_BODY).toContain('nothing on the chain or in the directory changes');
    expect(DISMISS_CONFIRM_LABEL).toBe('Dismiss record');
    expect(KEEP_RECORD_LABEL).toBe('Keep it');
  });

  it('keeps the additive re-advertise line as its OWN exact sentence', () => {
    // Two constants, not one, and this pin is what keeps them distinguishable. The line is an
    // ADDITIVE disclosure rendered as a second stacked paragraph only on rows where the cost is
    // real, so folding it into `DISMISS_BODY` would state a cost that most dismissals do not
    // carry. `packages/web/tests/operator-rows.spec.ts` pins the two FACTS it must name, beside
    // the predicate that decides which rows it renders on; this pins the sentence itself.
    expect(DISMISS_READVERTISE_LINE).toBe(
      'This also removes the cohort from your cohort list, so it can no longer be re-advertised.',
    );
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
      expect(s).not.toContain(LONG_DASH);
    }
  });
});

/**
 * The health strip's MODE CHIP (`05-AUDIT-2.md` entry 6, D-14/D-17, T-05-08-03).
 *
 * This chip is the operator's only statement of whether this service moves real Bitcoin, and its
 * semantic feed is genuinely covered end to end: `monitor.serviceHealth` has server rows, the wire
 * shape has route rows, `state.health` has store rows. Only the LAST HOP was not, and
 * `05-VALIDATION.md:76` records that hop's verify method as `build`, which is itself the admission.
 * Relabelling `live`, or rewriting the chip expression to render `Hermetic` whenever the broadcast
 * kill switch is engaged, both shipped green.
 *
 * Every row asserts in BOTH directions, the expected label present and the other two absent. A
 * presence check alone would pass a chip that rendered every label at once.
 */
describe('the health strip renders the SERVED mode and reads nothing else (rendered)', () => {
  beforeEach(() => {
    // Reset between rows so one fixture cannot leak into the next. The network must be a real
    // registry name: the strip resolves it through the network registry, and an unknown value
    // does not render.
    operatorFixture.current = {};
    participantFixture.current = { network: 'regtest' };
  });

  /**
   * Exhaustive by CONSTRUCTION: a fourth `ServiceMode` makes this record a type error, so a new
   * mode cannot be added without a row below. A plain `ServiceMode[]` would not do: an array
   * literal is checked for MEMBERSHIP, never for completeness, so a hand-listed array silently
   * keeps typechecking while the matrix stops being a matrix.
   */
  const EVERY_MODE: Record<ServiceMode, true> = {
    hermetic: true,
    'live-no-broadcast': true,
    live: true,
  };
  const ALL_MODES = Object.keys(EVERY_MODE) as ServiceMode[];

  /** What the strip says before the first ok list read lands. Inline JSX, so it is spelled here. */
  const CHECKING_MODE = 'Checking mode';

  function strip(health?: OperatorState['health']): string {
    operatorFixture.current = { health };
    return renderStatic(createElement(HealthStrip));
  }

  it('carries exactly one label per ServiceMode, each pinned word for word', () => {
    expect(MODE_LABEL.hermetic).toBe('Hermetic');
    expect(MODE_LABEL['live-no-broadcast']).toBe('Live (no broadcast)');
    expect(MODE_LABEL.live).toBe('Live');
    // Derived from the union rather than hand-listed, so a fourth mode with no label fails here.
    expect(Object.keys(MODE_LABEL).sort()).toEqual([...ALL_MODES].sort());
  });

  it('carries no long dash in any mode label (house style, checker-blocked at the source)', () => {
    for (const label of Object.values(MODE_LABEL)) {
      expect(label).not.toContain(LONG_DASH);
    }
  });

  /**
   * THE ANTI-VACUITY CONTROL for this whole block, and it was written and run FIRST, before any
   * row asserting an absence. Until something renders, an assertion that a label is missing passes
   * against a fixture that never reached the renderer at all, which is the exact failure the
   * `getInitialState()` trap produces for a `setState` seed.
   */
  it('renders the live label on a live service (anti-vacuity: a fixture really does arrive)', () => {
    const html = strip({ mode: 'live', esploraReachable: true, paused: false });
    expect(chipRendered(html, MODE_LABEL.live)).toBe(true);
    expect(chipRendered(html, CHECKING_MODE)).toBe(false);
  });

  for (const mode of ALL_MODES) {
    it(`renders ONLY the ${mode} label when the service serves ${mode}`, () => {
      const html = strip({ mode, esploraReachable: mode === 'hermetic' ? 'n/a' : true, paused: false });
      expect(chipRendered(html, MODE_LABEL[mode])).toBe(true);
      for (const other of ALL_MODES.filter((m) => m !== mode)) {
        expect(chipRendered(html, MODE_LABEL[other])).toBe(false);
      }
    });
  }

  it('makes NO mode claim at all before the first read lands', () => {
    // Not a fourth mode: a distinct posture. Presuming "Hermetic" on a service that has not
    // answered would tell the operator it does not touch the chain while it may be broadcasting
    // real Bitcoin. On its own this row is indistinguishable from a broken fixture, which is why
    // the live row above must already be passing.
    const html = strip(undefined);
    expect(chipRendered(html, CHECKING_MODE)).toBe(true);
    for (const mode of ALL_MODES) {
      expect(chipRendered(html, MODE_LABEL[mode])).toBe(false);
    }
  });

  it('keeps the LIVE label and adds the broadcast-off chip once the kill switch engages', () => {
    // The D-14 property in one row, and it takes all three assertions together: the live label
    // present proves the mode was not rewritten, the hermetic label absent proves it was not
    // rewritten to THAT, and the broadcast-off chip present proves the flip is disclosed at all.
    // No single one of the three catches a mutation that makes the mode chip read the kill switch.
    // The service really did boot live and its chain reads really are still live; saying otherwise
    // would report a boot mode it never had (T-05-08-03).
    const html = strip({ mode: 'live', esploraReachable: true, paused: false, broadcastDisabled: true });
    expect(chipRendered(html, MODE_LABEL.live)).toBe(true);
    expect(chipRendered(html, MODE_LABEL.hermetic)).toBe(false);
    expect(chipRendered(html, BROADCAST_OFF_CHIP)).toBe(true);
  });

  it('keeps the mode label unchanged and adds the paused chip beside it while draining', () => {
    // Pause says whether this service is offering NEW cohorts; the mode says how it signs and
    // broadcasts. The paused chip rides beside the mode chip, never instead of it (D-07).
    const html = strip({ mode: 'live', esploraReachable: true, paused: true });
    expect(chipRendered(html, MODE_LABEL.live)).toBe(true);
    expect(chipRendered(html, 'Advertising paused')).toBe(true);
    expect(chipRendered(html, CHECKING_MODE)).toBe(false);
  });
});

/**
 * The TEST-PEER surface (`05-AUDIT-2.md` entry 14, SVC-04, D-17, 05-UI-SPEC E11).
 *
 * Two defects meet here, and they are the same fact attacked from two directions: the whole
 * test-peer copy family could be reworded undetected, and `disabled={remaining === 0}` could be
 * deleted undetected. The only pins that existed read the SEPARATE service-side constant, and
 * `packages/web` does not depend on `packages/service`, so the browser bundle's own copy was
 * unguarded. The settings family has had a literal pin plus an em-dash guard since 05-17; this
 * block gives the test-peer family the same treatment.
 */
describe('the test-peer copy family is exact contract copy (UI-SPEC E11)', () => {
  it('states the control label, the body and the two confirm labels in words', () => {
    expect(ADD_TEST_PEERS_LABEL).toBe('Fill remaining seats with test peers');
    expect(ADD_TEST_PEERS_BODY).toBe(
      'They join the remaining seats and co-sign like any other participant. They are badged as test peers everywhere on this console.',
    );
    expect(ADD_TEST_PEERS_CANCEL_LABEL).toBe('Cancel');
    expect(ADD_TEST_PEERS_BUSY).toBe('Adding…');
  });

  it('interpolates the seat count into all three counted lines', () => {
    // Pinned through their OUTPUT, so a change to an interpolation is caught as well as a change
    // to the words around it. The count is what the service would enforce a moment later, so a
    // heading that named a different number than the button would be a real defect.
    expect(addTestPeersHelp(3)).toBe(
      'Adds 3 in-process test participants so you can rehearse this service on your own. They use throwaway keys created inside this process.',
    );
    expect(addTestPeersHeading(3)).toBe('Add 3 test peers to this cohort?');
    expect(addTestPeersConfirmLabel(3)).toBe('Add 3 test peers');
  });

  it('names the network in the live-cohort line, because those peers co-sign for real', () => {
    expect(liveTestPeersLine('regtest')).toBe(
      'This is a live cohort, so test peers co-sign for real and their DIDs are anchored on regtest.',
    );
  });

  it('states the seat-exhausted refusal reason, which the service must repeat byte for byte', () => {
    // THE CONTRACT, in words: this is the sentence an operator reads BEFORE clicking, and the
    // service's own 409 refusal reason is the sentence they would read if they clicked anyway.
    // UI-SPEC E11 requires them to be one string rather than two that can drift.
    //
    // The counterpart lives in `packages/service/src/operator-cohorts.ts` as its own
    // `NO_SEATS_LEFT_REASON`, pinned by `packages/service/tests/test-peers.spec.ts` (the 409 body
    // assertion) and again by `packages/service/tests/lifecycle-routes.spec.ts`. It is deliberately
    // NOT imported here: `packages/web` does not depend on `packages/service`, and adding that
    // dependency to make a byte-identity claim testable would couple the browser bundle to the
    // server for the sake of a test. Two independent literal pins of the same sentence is the
    // shape this repo already uses for the threshold error.
    expect(NO_SEATS_LEFT_REASON).toBe('This cohort has no seats left.');
  });

  it('carries no long dash anywhere in the family (house style, checker-blocked at the source)', () => {
    const family = [
      ADD_TEST_PEERS_LABEL,
      ADD_TEST_PEERS_BODY,
      ADD_TEST_PEERS_CANCEL_LABEL,
      ADD_TEST_PEERS_BUSY,
      NO_SEATS_LEFT_REASON,
      addTestPeersHelp(3),
      addTestPeersHeading(3),
      addTestPeersConfirmLabel(3),
      liveTestPeersLine('regtest'),
    ];
    for (const copy of family) {
      expect(copy).not.toContain(LONG_DASH);
    }
  });
});

/**
 * The seat-exhausted refusal, RENDERED (`05-AUDIT-2.md` entry 14, defect #10).
 *
 * The disabled binding and the reason beside it are one fact in two places, so both directions are
 * asserted on each row and the two rows are each other's anti-vacuity control: one asserts exactly
 * what the other denies, so neither can pass against a component that renders nothing.
 *
 * The seat count is a PROP, so this block needs no store fixture for the fact under test. The
 * component's three incidental store reads (`addTestPeers`, `addingTestPeers`, `testPeerError`)
 * are served by the file-scoped fake as `undefined`, which is the unseeded posture: no in-flight
 * marker and no error paragraph, which is exactly the state this row is about.
 */
describe('TestPeerAction refuses a full cohort in the markup, not only in words (rendered)', () => {
  beforeEach(() => {
    operatorFixture.current = {};
    participantFixture.current = { network: 'regtest' };
  });

  function peerMarkup(remaining: number): string {
    return renderStatic(
      createElement(TestPeerAction, {
        baseUrl: 'http://svc.example',
        cohortId: 'cohort-1',
        remaining,
        live: false,
        network: 'regtest',
      }),
    );
  }

  /** The one rendered `<button>` carrying `label`, so a disabled read lands on the right control. */
  function buttonWith(html: string, label: string): string {
    const buttons = html.match(/<button\b[^>]*>.*?<\/button>/g) ?? [];
    const found = buttons.filter((b) => b.includes(label));
    expect(found, `exactly one button labelled ${label}`).toHaveLength(1);
    return found.join('');
  }

  /**
   * Whether the control is disabled, read off the ATTRIBUTE and never the class list: the shared
   * `Button` base carries `disabled:cursor-not-allowed disabled:opacity-40` on every render, so a
   * plain substring check for "disabled" would be true no matter what the binding says.
   */
  function controlDisabled(html: string): boolean {
    return /<button[^>]*\sdisabled=""/.test(buttonWith(html, ADD_TEST_PEERS_LABEL));
  }

  it('renders the control DISABLED beside the refusal reason when no seats are left', () => {
    const html = peerMarkup(0);
    expect(html).toContain(asRenderedText(NO_SEATS_LEFT_REASON));
    expect(html).not.toContain(asRenderedText(addTestPeersHelp(0)));
    // Disabled rather than hidden: the act is a real one that simply has nothing left to do here,
    // and an operator who cannot see the control cannot learn why it is unavailable.
    expect(controlDisabled(html)).toBe(true);
  });

  it('renders the control ENABLED beside the counted help line while seats remain', () => {
    const html = peerMarkup(2);
    expect(html).toContain(asRenderedText(addTestPeersHelp(2)));
    expect(html).not.toContain(asRenderedText(NO_SEATS_LEFT_REASON));
    expect(controlDisabled(html)).toBe(false);
  });
});

/**
 * The one-way broadcast kill switch's MODE GUARD, rendered (`05-AUDIT-2.md` entry 16, D-14).
 *
 * `broadcastControlState` is already covered above, and those rows stay: they are load-bearing
 * about the RULE. What was missing is proof the COMPONENT consults it. Deleting
 * `broadcast === 'available' &&` from the button's guard shipped green, and a danger-toned one-way
 * control appearing on a service that will never broadcast is verbatim the fail signal the UAT
 * procedure for test 17 describes. The audit proposed closing this in a browser leg because no
 * spec in this repo could render a component; 05-21 changed that, so it closes here, in the
 * cheapest gate to keep green, and 05-27 adds the real-Chromium witness as a second and
 * independent one.
 */
describe('ServiceControls offers the kill switch only where it can act (rendered)', () => {
  beforeEach(() => {
    participantFixture.current = { network: 'regtest' };
    operatorFixture.current = {};
  });

  /** The card under one served health payload. `view` and `operatorActions` are incidental reads
   *  the component makes on every render; seeded at their real initial values so the rows below
   *  are about the kill switch and nothing else. */
  function card(health: OperatorState['health']): string {
    operatorFixture.current = { view: { kind: 'list' }, operatorActions: [], health };
    return renderStatic(createElement(ServiceControls, { baseUrl: 'http://svc.example' }));
  }

  /**
   * THE ANTI-VACUITY CONTROL, written and run FIRST. Three of the four rows below assert an
   * ABSENCE, and without this one they would all pass against a fixture that never reached the
   * renderer at all.
   */
  it('offers the control on a live service with broadcasting still available', () => {
    const html = card({ mode: 'live', esploraReachable: true, paused: false, broadcastDisabled: false });
    expect(html).toContain(asRenderedText(DISABLE_BROADCAST_LABEL));
    expect(html).not.toContain(asRenderedText(BROADCAST_OFF_LINE));
  });

  it('offers NOTHING to stand down on a hermetic service', () => {
    const html = card({ mode: 'hermetic', esploraReachable: 'n/a', paused: false });
    expect(html).not.toContain(asRenderedText(DISABLE_BROADCAST_LABEL));
  });

  it('offers NOTHING on a live service that was never going to broadcast', () => {
    // Verbatim the UAT fail signal: a danger-toned one-way control on a service that will never
    // broadcast asks the operator to stand down something that was never standing.
    const html = card({ mode: 'live-no-broadcast', esploraReachable: true, paused: false });
    expect(html).not.toContain(asRenderedText(DISABLE_BROADCAST_LABEL));
  });

  it('REPLACES the control with the one-way line once the switch is already engaged', () => {
    // Two assertions, and the second is the point: a disabled-but-present control would satisfy a
    // presence check on the line alone, and the shipped decision is that the control is GONE, not
    // disabled. A disabled button would imply the act is still pending or still reversible from
    // this console, and it is neither.
    const html = card({ mode: 'live', esploraReachable: true, paused: false, broadcastDisabled: true });
    expect(html).toContain(asRenderedText(BROADCAST_OFF_LINE));
    expect(html).not.toContain(asRenderedText(DISABLE_BROADCAST_LABEL));
  });
});
