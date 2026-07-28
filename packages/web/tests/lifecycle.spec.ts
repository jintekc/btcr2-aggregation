import { describe, expect, it } from 'vitest';
import { cancelAvailability, cancelRung, cohortShortId, typeToConfirmMatches } from '../src/lib/lifecycle';
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
