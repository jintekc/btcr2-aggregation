import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
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
import type { CohortDetailDTO, FundingView } from '../src/lib/operator';

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
