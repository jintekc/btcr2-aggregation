import { describe, expect, it } from 'vitest';
import {
  DISCOVERY_WINDOW_ERROR,
  FUNDING_WINDOW_ERROR,
  ONE_MINUTE_MS,
  SIZE_ERROR,
  THRESHOLD_ERROR,
  clampDisclosure,
  discoveryWindowHelp,
  effectiveMs,
  fundingWindowHelp,
  msToMinutesText,
  parseWindow,
  validateCohortForm,
  windowKeys,
} from '../src/lib/cohort-form';

/**
 * SVC-04 criterion 3 shared-form coverage (05-06, D-10/D-11).
 *
 * The create form and the draft-edit form must enforce the same rules and render the same words.
 * That property is only checkable because both sides delegate to this one pure module, so these
 * tests ARE the drift guard: a rule or a string that regressed on one form would have to regress
 * here first.
 */
describe('window parsing', () => {
  it('reads an EMPTY field as unset, never as a zero window', () => {
    // The load-bearing distinction (UI-SPEC E7 empty): empty means "use this service's default",
    // and a 0 would mean "no window at all", which is a different instruction entirely.
    expect(parseWindow('')).toEqual({ kind: 'unset' });
  });

  it('reads a whitespace-only field as unset, so a stray space is not an invalid number', () => {
    expect(parseWindow('   ')).toEqual({ kind: 'unset' });
  });

  it('converts whole minutes to milliseconds on the wire', () => {
    expect(parseWindow('30')).toEqual({ kind: 'ms', ms: 30 * ONE_MINUTE_MS });
  });

  it('refuses a fraction, a zero, and a negative, mirroring the server guard', () => {
    expect(parseWindow('1.5').kind).toBe('invalid');
    expect(parseWindow('0').kind).toBe('invalid');
    expect(parseWindow('-5').kind).toBe('invalid');
  });

  it('refuses text that is not a number at all', () => {
    expect(parseWindow('soon').kind).toBe('invalid');
  });

  it('round-trips a served window back into the minutes field, and keeps an absent one EMPTY', () => {
    // An absent window must render as an empty box, because that is what makes the empty field
    // mean "default" consistently in both directions.
    expect(msToMinutesText(30 * ONE_MINUTE_MS)).toBe('30');
    expect(msToMinutesText(undefined)).toBe('');
  });

  it('falls back to the service default when the operator typed nothing', () => {
    expect(effectiveMs({ kind: 'unset' }, 30 * ONE_MINUTE_MS)).toBe(30 * ONE_MINUTE_MS);
    expect(effectiveMs({ kind: 'ms', ms: ONE_MINUTE_MS }, 30 * ONE_MINUTE_MS)).toBe(ONE_MINUTE_MS);
    expect(effectiveMs({ kind: 'unset' }, undefined)).toBeUndefined();
  });
});

describe('the wire keys', () => {
  it('OMITS an unset window entirely rather than sending a null or a zero', () => {
    expect(windowKeys({ kind: 'unset' }, { kind: 'unset' })).toEqual({});
  });

  it('sends only the window the operator actually set', () => {
    expect(windowKeys({ kind: 'ms', ms: 600_000 }, { kind: 'unset' })).toEqual({ discoveryWindowMs: 600_000 });
  });

  it('sends both when both are set', () => {
    expect(windowKeys({ kind: 'ms', ms: 600_000 }, { kind: 'ms', ms: 300_000 })).toEqual({
      discoveryWindowMs: 600_000,
      fundingWindowMs: 300_000,
    });
  });
});

describe('shared validation', () => {
  const ok = { kind: 'unset' } as const;

  it('passes a valid k-of-n with no windows', () => {
    expect(validateCohortForm({ size: 3, threshold: 2, discovery: ok, funding: ok })).toBeUndefined();
  });

  it('returns the exact size string for a size below 1', () => {
    expect(validateCohortForm({ size: 0, threshold: 1, discovery: ok, funding: ok })).toBe(SIZE_ERROR);
  });

  it('returns the exact threshold string for a k above n', () => {
    expect(validateCohortForm({ size: 2, threshold: 3, discovery: ok, funding: ok })).toBe(THRESHOLD_ERROR);
  });

  it('returns the exact discovery-window string for an invalid window', () => {
    expect(validateCohortForm({ size: 2, threshold: 2, discovery: { kind: 'invalid' }, funding: ok })).toBe(
      DISCOVERY_WINDOW_ERROR,
    );
  });

  it('returns the exact funding-window string for an invalid window', () => {
    expect(validateCohortForm({ size: 2, threshold: 2, discovery: ok, funding: { kind: 'invalid' } })).toBe(
      FUNDING_WINDOW_ERROR,
    );
  });

  it('reports the FIRST problem in render order, so the message points at the field above', () => {
    // Both the size and the discovery window are wrong; the size is the field that renders first.
    expect(
      validateCohortForm({ size: 0, threshold: 9, discovery: { kind: 'invalid' }, funding: { kind: 'invalid' } }),
    ).toBe(SIZE_ERROR);
  });

  it('does NOT judge the shorten-only ceiling client-side', () => {
    // The ceiling depends on the service's runner cohort TTL, which this client is never told, so
    // a large window passes here and the SERVER refuses it with the real maximum named. Guessing
    // it would either block a legal value or promise one the service cannot keep.
    expect(
      validateCohortForm({ size: 2, threshold: 2, discovery: { kind: 'ms', ms: 86_400_000 }, funding: ok }),
    ).toBeUndefined();
  });
});

describe('the timing help copy', () => {
  it('names this service default when the service reported one (UI-SPEC E7)', () => {
    expect(discoveryWindowHelp(30 * ONE_MINUTE_MS)).toBe(
      "How long this cohort stays advertised before it expires. Leave it empty to use this service's default of 30 min.",
    );
    expect(fundingWindowHelp(20 * ONE_MINUTE_MS)).toBe(
      "How long this service waits for this cohort's beacon address to be funded. Leave it empty to use this service's default of 20 min.",
    );
  });

  it('OMITS the figure when the service reported no default, rather than inventing one', () => {
    // An operator told "the default is 30 min" by a console that guessed has been misled about
    // what their own service will actually do.
    expect(discoveryWindowHelp(undefined)).toBe(
      "How long this cohort stays advertised before it expires. Leave it empty to use this service's default.",
    );
    expect(fundingWindowHelp(undefined)).toBe(
      "How long this service waits for this cohort's beacon address to be funded. Leave it empty to use this service's default.",
    );
  });

  it('carries no long dash in any form string (house style, checker-blocked at the source)', () => {
    const strings = [
      SIZE_ERROR,
      THRESHOLD_ERROR,
      DISCOVERY_WINDOW_ERROR,
      FUNDING_WINDOW_ERROR,
      discoveryWindowHelp(600_000),
      discoveryWindowHelp(undefined),
      fundingWindowHelp(600_000),
      fundingWindowHelp(undefined),
      clampDisclosure(600_000, 900_000) ?? '',
    ];
    for (const s of strings) {
      expect(s).not.toMatch(/[—–]/);
    }
  });
});

describe('the funding clamp disclosure (04 D-38, preserved)', () => {
  it('discloses the shortened figure when the funding window outlives the cohort', () => {
    // 10 min discovery less the 10s slack = 9.833 min, rounded to 10 for display.
    expect(clampDisclosure(10 * ONE_MINUTE_MS, 30 * ONE_MINUTE_MS)).toBe(
      "This cohort's remaining lifetime shortens the funding window to about 10 min.",
    );
  });

  it('says NOTHING when no clamp will bite, so the disclosure is never noise', () => {
    expect(clampDisclosure(30 * ONE_MINUTE_MS, 5 * ONE_MINUTE_MS)).toBeUndefined();
  });

  it('says nothing when either window is unknown, rather than disclosing a guess', () => {
    expect(clampDisclosure(undefined, 5 * ONE_MINUTE_MS)).toBeUndefined();
    expect(clampDisclosure(30 * ONE_MINUTE_MS, undefined)).toBeUndefined();
  });
});
