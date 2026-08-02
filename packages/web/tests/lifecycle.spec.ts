import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FINALIZABLE_PHASES } from '@btcr2-aggregation/shared';
import {
  cancelAvailability,
  cancelRung,
  closedAtNthSeat,
  cohortShortId,
  finalizeAvailability,
  seatReclaimNoteVisible,
  typeToConfirmMatches,
} from '../src/lib/lifecycle';
import {
  AFTER_BROADCAST,
  CANCEL_LABEL,
  CancelConfirm,
  KEEP_RUNNING,
  LifecycleActions,
  RECOVERY_OPERATOR_HELD,
  RECOVERY_THROWAWAY,
  RUNG3_HEADING,
  RUNG4_CONFIRM,
  RUNG4_HEADING,
} from '../src/components/operator/LifecycleActions';
import { asRenderedText, renderStatic } from './support/render';
import type { CohortDetailDTO, FundingView } from '../src/lib/operator';
import type { OperatorState } from '../src/stores/operator';
import type { ParticipantState } from '../src/stores/participant';

/**
 * The render fixtures, and the FILE-SCOPED fakes that carry them into a static render.
 *
 * Both holders are plain mutable objects declared here and read LAZILY by the fakes, which is the
 * recipe `packages/web/tests/support/render.tsx` spells out: a `vi.mock` factory is hoisted above
 * this file's imports, so it may capture a holder but must resolve both the original module and
 * the helper by dynamic import. Every other export of both store modules stays REAL (the fake
 * spreads the actual module), so `CANCEL_BUSY` and `FINALIZE_BUSY` are the shipped constants.
 *
 * Typed as partials of the stores' own state: an untyped literal would turn a misspelled key into
 * an `undefined` indistinguishable from an unseeded store, which is precisely the silent failure
 * the harness docstring warns about.
 *
 * NOTE: nothing in this file seeds a render through zustand's imperative state setter, and nothing
 * can. A static render takes `useSyncExternalStore`'s SERVER snapshot, which zustand implements as
 * `getInitialState()`, so such a seed is invisible; and here the bound hooks ARE the fake, which
 * exposes no setter at all. The demonstration of that trap lives in
 * `packages/web/tests/support/render.spec.tsx`, against a store that test creates itself.
 *
 * The setter is described rather than SPELLED here on purpose (the 05-07 lesson): a repo-wide grep
 * for the token is one of this file's acceptance checks, and a comment that spells the token a
 * guard greps for defeats the guard.
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
 * SVC-04 lifecycle predicates (Phase 5 D-03/D-04). Every availability and ceremony decision the
 * Cancel control makes is a PURE function over the polled detail DTO, so the rules are testable
 * without a DOM and can never drift into inline component logic (the `terminalReason` precedent
 * in `stores/participant.ts`).
 *
 * The three rules under test:
 *
 * - Cancel exists only BEFORE the beacon transaction broadcasts (D-04). After that there is
 *   nothing left to cancel, so the control is HIDDEN rather than disabled.
 * - The confirmation rung is chosen by whether funds have been observed at the cohort's beacon
 *   address: a cancel that can strand real money costs a typed cohort id (D-03 rung 4).
 * - The type-to-confirm gate is an exact, case-sensitive match, so a partial or near-miss value
 *   can never arm the confirm button.
 *
 * NEW spec under `packages/web/tests/` (tests-outside-src convention).
 */

function detail(over: Partial<CohortDetailDTO> = {}): CohortDetailDTO {
  return {
    exists: true,
    members: [],
    seatsJoined: 0,
    capacity: 2,
    phase: 'Advertised',
    submissions: [],
    coSign: { noncesReceived: 0, total: 2, awaitingPartialSigs: false },
    anchor: { enabled: false, state: 'none' },
    fallback: { used: false },
    activity: [],
    ...over,
  };
}

function funding(over: Partial<FundingView> = {}): FundingView {
  return {
    state: 'waiting',
    suggestedMinSats: 2000,
    beaconAddress: 'bcrt1qbeaconaddressexample',
    recoveryKeyState: 'throwaway',
    mainnet: false,
    changeAddressRedirected: false,
    esploraStale: false,
    ...over,
  };
}

describe('cancelAvailability: cancel exists only before the beacon tx broadcasts (D-04)', () => {
  it('is unavailable before the first detail read lands, so no control appears then vanishes', () => {
    // UI-SPEC E1 loading: availability derives from an OBSERVED phase, never from an assumption.
    expect(cancelAvailability(undefined)).toBe('unavailable');
  });

  it('is unavailable for a cohort this service does not know (non-oracle exists:false)', () => {
    expect(cancelAvailability(detail({ exists: false, phase: 'unknown' }))).toBe('unavailable');
  });

  it('is available for an advertised cohort with no anchor at all (the hermetic default)', () => {
    expect(cancelAvailability(detail({ phase: 'Advertised' }))).toBe('available');
  });

  it('is available through the signing arc, right up to the broadcast', () => {
    expect(cancelAvailability(detail({ phase: 'SigningStarted' }))).toBe('available');
    expect(cancelAvailability(detail({ phase: 'NoncesCollected' }))).toBe('available');
    // The funding-wait phases are mid-signing too (04-08 live-UAT widening).
    expect(cancelAvailability(detail({ phase: 'UpdatesCollected' }))).toBe('available');
  });

  it('reads broadcast once the anchor projection reports a broadcast or confirmed transaction', () => {
    expect(
      cancelAvailability(detail({ phase: 'SigningStarted', anchor: { enabled: true, state: 'broadcast', txid: 'ab12' } })),
    ).toBe('broadcast');
    expect(
      cancelAvailability(detail({ phase: 'unknown', anchor: { enabled: true, state: 'confirmed', txid: 'ab12' } })),
    ).toBe('broadcast');
  });

  it('reads broadcast for a FAILED anchor that still carries a txid (the tx is out on the network)', () => {
    // A broadcast that later failed to confirm still put a transaction on the wire, so there is
    // genuinely nothing left to cancel. A failed anchor with NO txid never reached the network.
    expect(
      cancelAvailability(detail({ phase: 'unknown', anchor: { enabled: true, state: 'failed', txid: 'ab12' } })),
    ).toBe('broadcast');
    expect(
      cancelAvailability(detail({ phase: 'SigningStarted', anchor: { enabled: true, state: 'failed' } })),
    ).toBe('available');
  });

  it('is unavailable for a settled cohort with no live phase and no broadcast (nothing to cancel)', () => {
    expect(cancelAvailability(detail({ phase: 'unknown' }))).toBe('unavailable');
  });
});

describe('cancelRung: the ceremony costs more when real money is already at the address (D-03)', () => {
  it('is rung 4 once funds are observed at the beacon address', () => {
    expect(cancelRung(detail({ funding: funding({ state: 'funded' }) }))).toBe(4);
    expect(cancelRung(detail({ funding: funding({ state: 'awaiting-confirmation' }) }))).toBe(4);
  });

  it('is rung 4 for a dead-end address, where funds arrived below the usable minimum', () => {
    // A dead-end cohort HAS received money (it is just below the spendable minimum), so a
    // cancel strands real funds. Skipping the top rung here would be the one case where the
    // ceremony is cheapest exactly when the loss is certain.
    expect(cancelRung(detail({ funding: funding({ state: 'dead-end' }) }))).toBe(4);
  });

  it('is rung 3 while a live cohort is still waiting for its first payment', () => {
    expect(cancelRung(detail({ funding: funding({ state: 'waiting' }) }))).toBe(3);
  });

  it('is rung 3 for a hermetic cohort with no funding view at all', () => {
    expect(cancelRung(detail())).toBe(3);
  });
});

describe('finalizeAvailability: offered exactly when the library primitive works (D-01)', () => {
  it('is unavailable before the first detail read lands, and for an unknown cohort', () => {
    expect(finalizeAvailability(undefined)).toBe('unavailable');
    expect(finalizeAvailability(detail({ exists: false, phase: 'unknown' }))).toBe('unavailable');
  });

  it('is available in every one of the library three signing phases', () => {
    for (const phase of FINALIZABLE_PHASES) {
      expect(finalizeAvailability(detail({ phase }))).toBe('available');
    }
    // The named case, so a future refactor cannot quietly empty the set and still pass.
    expect(finalizeAvailability(detail({ phase: 'NoncesCollected' }))).toBe('available');
  });

  it('is not-signing in the four FUNDING-WAIT phases, proving the wider in-flight set is not reused', () => {
    // These four are in IN_FLIGHT_PHASES (04-08 widened it so a funding cohort stays listed in the
    // public directory), but the library's startFallbackSigning THROWS in them. Reusing that set
    // here would offer a button that can only fail.
    for (const phase of ['UpdatesCollected', 'DataDistributed', 'Validated', 'FallbackRequested']) {
      expect(finalizeAvailability(detail({ phase }))).toBe('not-signing');
    }
  });

  it('is not-signing while a cohort is still filling or collecting updates', () => {
    expect(finalizeAvailability(detail({ phase: 'Advertised' }))).toBe('not-signing');
    expect(finalizeAvailability(detail({ phase: 'CollectingUpdates' }))).toBe('not-signing');
  });

  it('is committed once the served projection reports the fallback was used', () => {
    expect(finalizeAvailability(detail({ phase: 'FallbackRequested', fallback: { used: true, k: 2, n: 3 } }))).toBe(
      'committed',
    );
    // Committed is checked FIRST: a cohort that already fell back has left the finalizable phases,
    // so without that ordering it would tell the operator to wait for a round that already ran.
    expect(finalizeAvailability(detail({ phase: 'unknown', fallback: { used: true } }))).toBe('committed');
  });
});

describe('closedAtNthSeat: the automatic close is a fact on the wire, not a button (D-01)', () => {
  it('is true once every seat is filled', () => {
    expect(closedAtNthSeat(detail({ seatsJoined: 2, capacity: 2 }))).toBe(true);
  });

  it('is false while seats remain', () => {
    expect(closedAtNthSeat(detail({ seatsJoined: 1, capacity: 2 }))).toBe(false);
  });

  it('is false before the first read, for an unknown cohort, and for a zero-capacity projection', () => {
    // The zero case matters: the pre-first-read projection is 0 of 0, which must not read as
    // "every seat filled".
    expect(closedAtNthSeat(undefined)).toBe(false);
    expect(closedAtNthSeat(detail({ exists: false, seatsJoined: 0, capacity: 0 }))).toBe(false);
    expect(closedAtNthSeat(detail({ seatsJoined: 0, capacity: 0 }))).toBe(false);
  });
});

describe('seatReclaimNoteVisible: the honest workaround shows only while a seat could be reclaimed (D-18)', () => {
  it('shows while a cohort is advertised with seats still open', () => {
    expect(seatReclaimNoteVisible(detail({ phase: 'Advertised', seatsJoined: 1, capacity: 2 }))).toBe(true);
  });

  it('hides once the nth seat fills, because there is no abandoned seat left to reclaim', () => {
    expect(seatReclaimNoteVisible(detail({ phase: 'Advertised', seatsJoined: 2, capacity: 2 }))).toBe(false);
  });

  it('hides mid-signing and for a settled or unknown cohort', () => {
    expect(seatReclaimNoteVisible(detail({ phase: 'SigningStarted', seatsJoined: 1, capacity: 2 }))).toBe(false);
    expect(seatReclaimNoteVisible(detail({ phase: 'unknown' }))).toBe(false);
    expect(seatReclaimNoteVisible(undefined)).toBe(false);
  });
});

describe('typeToConfirmMatches: an exact, case-sensitive gate', () => {
  it('refuses a prefix, a superstring, and a case difference', () => {
    expect(typeToConfirmMatches('abc1', 'abc12')).toBe(false);
    expect(typeToConfirmMatches('abc123', 'abc12')).toBe(false);
    expect(typeToConfirmMatches('ABC12', 'abc12')).toBe(false);
  });

  it('accepts an exact match, ignoring surrounding whitespace a paste may carry', () => {
    expect(typeToConfirmMatches('abc12', 'abc12')).toBe(true);
    expect(typeToConfirmMatches(' abc12 ', 'abc12')).toBe(true);
  });

  it('never matches an empty input', () => {
    expect(typeToConfirmMatches('', 'abc12')).toBe(false);
    expect(typeToConfirmMatches('   ', 'abc12')).toBe(false);
  });
});

describe('cohortShortId: a typeable short id, never a truncation glyph', () => {
  it('is the plain first 8 characters, with no ellipsis to type', () => {
    expect(cohortShortId('0123456789abcdef')).toBe('01234567');
  });

  it('leaves an already-short id untouched', () => {
    expect(cohortShortId('abc12')).toBe('abc12');
  });
});

/**
 * The SHIPPED rung-4 gate calls the predicate the seven assertions above cover (05-19,
 * `05-AUDIT.md` entry 10).
 *
 * Read Skeptic 1's narrowing before reading this as a live bug: it is NOT one. The duplicate
 * inline comparison in `ConfirmPanel` and `typeToConfirmMatches` agree on every value the app can
 * pass, because the single call site always passes an eight-character cohort-id prefix. They
 * diverge only on an empty or whitespace-only EXPECTED value, where the inline expression armed
 * immediately and the predicate never does, and that is unreachable today. What was genuinely
 * broken is COVERAGE: the gate that ships had none, while the assertions above claimed to pin it
 * (`05-02-PLAN.md` explicitly required the component to call the predicate), so weakening the
 * shipped expression to case-insensitive or prefix matching would have kept the whole suite green.
 *
 * `packages/web` has no DOM harness, so this is a SOURCE-CONTAINMENT read in the style
 * `packages/web/tests/terms.spec.ts` already uses. Its ceiling is worth stating rather than
 * leaving a reader to infer: a weakening that KEEPS the predicate call and adds a disjunct
 * (`typeToConfirmMatches(...) || typed.length > 0`) would still pass. What it genuinely catches is
 * the arming computation moving back inline or away from the predicate, which is the regression
 * that actually happened once.
 */
describe('ConfirmPanel arms through the tested predicate (05-19)', () => {
  const PRIMITIVES_SRC = readFileSync(
    fileURLToPath(new URL('../src/ui/primitives.tsx', import.meta.url)),
    'utf8',
  );

  it('imports the predicate from the lifecycle module', () => {
    expect(PRIMITIVES_SRC).toMatch(/import\s*\{[^}]*typeToConfirmMatches[^}]*\}\s*from\s*'\.\.\/lib\/lifecycle'/);
  });

  it('computes the armed flag through the predicate', () => {
    expect(PRIMITIVES_SRC).toMatch(/const armed =[^;]*typeToConfirmMatches\(/);
  });

  it('has exactly ONE arming computation, so no duplicate comparison sits beside the call', () => {
    // The duplicate is the whole defect: two rules for one gate means the spec covers the copy
    // that does not ship. One `const armed =` and no surviving `typed.trim() === ` comparison.
    expect(PRIMITIVES_SRC.split('const armed =').length - 1).toBe(1);
    expect(PRIMITIVES_SRC).not.toContain('typed.trim() ===');
  });

  it('keeps the button disabled expression reading that single flag', () => {
    expect(PRIMITIVES_SRC).toContain('disabled={busy || !armed}');
  });
});

const COHORT_ID = 'cohort-abc-123456';

/**
 * The post-broadcast cancel suppression, RENDERED (05-21, `05-AUDIT-2.md` entry 2).
 *
 * This is the only barrier there is. `packages/service/src/operator-cohorts.ts` checks that the
 * cohort is advertised and then calls `runner.stopCohort` unconditionally, and the route adds only
 * an id-shape check, so there is NO server-side post-broadcast guard behind this JSX. Swapping the
 * two arms would leave `Cancel cohort` on a cohort whose beacon transaction is already on the
 * wire, and until this block existed nothing in the repo would have noticed.
 *
 * Asserted against real markup rather than a source grep, which is what the harness in
 * `packages/web/tests/support/render.tsx` bought. The two rows are also this block's ANTI-VACUITY
 * control: the same component under two fixtures must produce two different outputs, so a row
 * cannot pass because the fixture never reached the renderer.
 */
describe('LifecycleActions hides Cancel once the beacon transaction is out (D-04, rendered)', () => {
  beforeEach(() => {
    // Reset between rows, so one fixture cannot leak into the next describe.
    operatorFixture.current = {};
    participantFixture.current = { network: 'regtest' };
  });

  function markup(over: Partial<CohortDetailDTO>): string {
    // The provenance matches the rendered cohort, as the store holds it after a poll that was not
    // raced (Gap 1). Without it the component now refuses to render at all, which is itself
    // evidence the refusal below is wired rather than decorative.
    operatorFixture.current = { detail: detail(over), detailCohortId: COHORT_ID };
    return renderStatic(
      createElement(LifecycleActions, { baseUrl: 'http://svc.example', cohortId: COHORT_ID }),
    );
  }

  it('renders the post-broadcast line and NO cancel control once the anchor carries a txid', () => {
    const html = markup({
      phase: 'SigningStarted',
      anchor: { enabled: true, state: 'broadcast', txid: 'ab12' },
    });
    expect(html).toContain(asRenderedText(AFTER_BROADCAST));
    // Hidden, not disabled: a disabled button would imply the act is still possible under some
    // condition, and after a broadcast it is not.
    expect(html).not.toContain(CANCEL_LABEL);
  });

  it('renders the cancel control and NO post-broadcast line while the cohort is still live', () => {
    const html = markup({ phase: 'Advertised' });
    expect(html).toContain(CANCEL_LABEL);
    expect(html).not.toContain(asRenderedText(AFTER_BROADCAST));
  });
});

/**
 * The second barrier behind the store's round guard (`05-VERIFICATION.md` Gap 1, review CR-1).
 *
 * `LifecycleActions` receives the cohort it will ACT on as a prop and reads the data it REASONS
 * about from a shared store slot, so during a navigation race the two can describe different
 * cohorts. Every availability, rung, seat count and recovery-key disclosure it renders is derived
 * from the slot, while the confirm click targets the prop: an unfunded cohort A's late answer
 * paints the cheap rung-3 ceremony, and one click cancels the funded cohort B on screen.
 *
 * The component's answer is a REFUSAL, never a fallback, because there is no safe default rung to
 * guess. The store's round guard stops the wrong data being painted; this stops the ceremony being
 * armed at all if any future path ever paints it anyway, which is the difference between a bug that
 * strands funds and a bug that renders an empty card.
 *
 * The negative rows assert EMPTY markup rather than a missing label, so a row cannot pass because
 * a label moved, and the first row is this block's anti-vacuity control.
 */
describe('LifecycleActions refuses a cohort it cannot tie the served data to (Gap 1, rendered)', () => {
  const OTHER_COHORT = 'cohort-zzz-999999';

  beforeEach(() => {
    operatorFixture.current = {};
    participantFixture.current = { network: 'regtest' };
  });

  function markupWith(fixture: Partial<OperatorState>): string {
    operatorFixture.current = fixture;
    return renderStatic(
      createElement(LifecycleActions, { baseUrl: 'http://svc.example', cohortId: COHORT_ID }),
    );
  }

  it('renders the cancel control when the served detail is provably about THIS cohort', () => {
    // The anti-vacuity control: without it every negative row below would pass against a fixture
    // that never reached the renderer.
    const html = markupWith({ detail: detail({ phase: 'Advertised' }), detailCohortId: COHORT_ID });
    expect(html).toContain(CANCEL_LABEL);
  });

  it('renders NOTHING when the served detail is an answer about a DIFFERENT cohort', () => {
    const html = markupWith({ detail: detail({ phase: 'Advertised' }), detailCohortId: OTHER_COHORT });
    expect(html).toBe('');
  });

  it('renders NOTHING when the served detail carries no provenance at all', () => {
    // An unattributed document is not evidence about any cohort.
    const html = markupWith({ detail: detail({ phase: 'Advertised' }) });
    expect(html).toBe('');
  });

  it('refuses the FUNDED rung-4 path the same way, so cheap friction never stands in for expensive', () => {
    // This is the exact substitution the gap describes: cohort A is unfunded and cohort B, on
    // screen, is funded. Rendering anything here shows a rung-3 ceremony over a rung-4 act.
    const html = markupWith({
      detail: detail({ phase: 'SigningStarted', funding: funding({ state: 'funded' }) }),
      detailCohortId: OTHER_COHORT,
    });
    expect(html).toBe('');
    expect(html).not.toContain(RUNG4_HEADING);
    expect(html).not.toContain(CANCEL_LABEL);
  });
});

/**
 * The rung-4 type-to-confirm gate, RENDERED at its CALL SITE (05-21, `05-AUDIT-2.md` entry 1).
 *
 * 05-19 pinned the CALLEE: `typeToConfirmMatches` and the single arming expression in
 * `packages/web/src/ui/primitives.tsx`. It never pinned the call site, so deleting
 * `typeToConfirm={short}` from the rung-4 panel (an operator arms a funded cancel on the first
 * click, and can strand real money) or adding it to the rung-3 panel (an ordinary cancel gains
 * friction it was designed not to have) both shipped green. `CancelConfirm` is exported for this
 * block, because in the app the panel only appears after a click and a static render cannot click.
 *
 * Each rung asserts TWO independent facts, and the pair is the point. The gate's presence is what
 * an operator SEES; the confirm button's disabled state is what actually stops the destructive
 * act. Asserting only the first would pass if the gate rendered but armed nothing; asserting only
 * the second would pass if the operator were given no instruction about what to type.
 */
describe('CancelConfirm chooses the rung and wires its gate (D-03, rendered)', () => {
  const SHORT = cohortShortId(COHORT_ID);

  function rungMarkup(over: Partial<CohortDetailDTO>): string {
    return renderStatic(
      createElement(CancelConfirm, {
        detail: detail(over),
        cohortId: COHORT_ID,
        activeNetwork: 'regtest',
        busy: false,
        onConfirm: () => {},
        onCancel: () => {},
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
   * Whether the confirm button is disabled, read off the ATTRIBUTE and never the class list: the
   * shared `Button` base carries `disabled:cursor-not-allowed disabled:opacity-40` on every render,
   * so a plain substring check for "disabled" would be true no matter what.
   */
  function confirmDisabled(html: string, label: string): boolean {
    return /<button[^>]*\sdisabled=""/.test(buttonWith(html, label));
  }

  /** The rendered type-to-confirm gate: the instruction label, its input, and the value to type. */
  function gateRendered(html: string): boolean {
    return (
      html.includes('for="confirm-type-to-confirm"') &&
      html.includes('id="confirm-type-to-confirm"') &&
      html.includes(SHORT)
    );
  }

  for (const state of ['funded', 'awaiting-confirmation', 'dead-end'] as const) {
    it(`asks for the typed cohort id and starts DISARMED for a ${state} cohort`, () => {
      const html = rungMarkup({ funding: funding({ state }) });
      expect(html).toContain(RUNG4_HEADING);
      expect(gateRendered(html)).toBe(true);
      // Nothing typed yet, so the destructive act is genuinely gated, not merely narrated.
      expect(confirmDisabled(html, RUNG4_CONFIRM)).toBe(true);
    });
  }

  it('keeps the ordinary cancel at low friction: no typed id, and the confirm is already armed', () => {
    const html = rungMarkup({ phase: 'Advertised' });
    expect(html).toContain(RUNG3_HEADING);
    expect(html).not.toContain(RUNG4_HEADING);
    expect(gateRendered(html)).toBe(false);
    expect(html).not.toContain('confirm-type-to-confirm');
    expect(confirmDisabled(html, CANCEL_LABEL)).toBe(false);
  });

  it('states the recovery-key situation on the rung-4 panel, in whichever form applies', () => {
    // The 04 D-40 disclosure: whether the money at this beacon address is recoverable is exactly
    // what an operator needs BEFORE the confirm can arm, and only the STATE ever crosses the wire.
    const held = rungMarkup({ funding: funding({ state: 'funded', recoveryKeyState: 'operator-held' }) });
    expect(held).toContain(asRenderedText(RECOVERY_OPERATOR_HELD));
    expect(held).not.toContain(asRenderedText(RECOVERY_THROWAWAY));

    const throwaway = rungMarkup({ funding: funding({ state: 'funded', recoveryKeyState: 'throwaway' }) });
    expect(throwaway).toContain(asRenderedText(RECOVERY_THROWAWAY));
    expect(throwaway).not.toContain(asRenderedText(RECOVERY_OPERATOR_HELD));
  });

  it('offers the same way out of both rungs', () => {
    expect(rungMarkup({ funding: funding({ state: 'funded' }) })).toContain(KEEP_RUNNING);
    expect(rungMarkup({ phase: 'Advertised' })).toContain(KEEP_RUNNING);
  });

  it('has exactly ONE type-to-confirm call site in the whole component', () => {
    // The rendered rows above are the primary proof; this pins the invariant they rest on, in the
    // source-read idiom this file already uses for `ui/primitives.tsx`. One call site means the
    // gate cannot be present at BOTH rungs, which no single rendered row can show.
    const src = readFileSync(
      fileURLToPath(new URL('../src/components/operator/LifecycleActions.tsx', import.meta.url)),
      'utf8',
    );
    expect(src.split('typeToConfirm').length - 1).toBe(1);
  });
});

describe('the shipped cancel copy is pinned at the source (05-AUDIT-2.md entries 1 and 2)', () => {
  /**
   * The forbidden long dash, spelled ONCE as an escaped constant (the 05-22 precedent from
   * `packages/web/tests/service-controls.spec.ts`). A guard written with the literal character
   * puts that character in the very file a repo-wide house-style scan reads, so the guard reports
   * its own source as a violation.
   */
  const LONG_DASH = '\u2014';

  it('contains no long dash in any authored cancel string', () => {
    // Long dashes in authored copy propagate straight into shipped UI strings; guard at the source,
    // in the shape `packages/web/tests/settings.spec.ts` already uses.
    for (const copy of [
      CANCEL_LABEL,
      AFTER_BROADCAST,
      KEEP_RUNNING,
      RUNG3_HEADING,
      RUNG4_HEADING,
      RUNG4_CONFIRM,
      RECOVERY_OPERATOR_HELD,
      RECOVERY_THROWAWAY,
    ]) {
      expect(copy).not.toContain(LONG_DASH);
    }
  });
});

describe('the empty expected value keeps the gate disarmed (the one divergence the duplicate had)', () => {
  it('never arms on an empty or whitespace-only expected value', () => {
    // The inline comparison armed IMMEDIATELY here (`''.trim() === ''.trim()`), which is the only
    // value where the two rules ever disagreed. Now that the component calls the predicate, this
    // row covers the shipped gate rather than a copy of it.
    expect(typeToConfirmMatches('', '')).toBe(false);
    expect(typeToConfirmMatches('anything', '')).toBe(false);
    expect(typeToConfirmMatches('', '   ')).toBe(false);
    expect(typeToConfirmMatches('   ', '   ')).toBe(false);
  });
});
