import { describe, expect, it } from 'vitest';
import { directoryNotice, statusLabel, type DirectoryCohortDTO } from '../src/lib/directory';

/**
 * SVC-JOIN-2 label coverage: the web directory helper must mirror the service's widened
 * IN_FLIGHT_PHASES, so a cohort in a funding-wait phase (UpdatesCollected / DataDistributed /
 * Validated / FallbackRequested) renders the plain-language "In progress" label instead of a raw
 * enum string. Because those phases are post-seat, the row is full (joined === capacity); the
 * in-flight label must WIN over a bare "Full" so a stranger sees the service is actively working,
 * not merely full. NEW spec under `packages/web/tests/` (tests-outside-src convention).
 */

const NEW_IN_FLIGHT_PHASES = ['UpdatesCollected', 'DataDistributed', 'Validated', 'FallbackRequested'];

function row(over: Partial<DirectoryCohortDTO> = {}): DirectoryCohortDTO {
  return {
    cohortId: 'cohort-1',
    beaconType: 'CASBeacon',
    network: 'mutinynet',
    threshold: 2,
    capacity: 2,
    joined: 2,
    phase: 'Advertised',
    ...over,
  };
}

describe('statusLabel maps the funding-wait phases to In progress (SVC-JOIN-2)', () => {
  it('labels each new funding-wait phase "In progress" even when the cohort is full', () => {
    for (const phase of NEW_IN_FLIGHT_PHASES) {
      // Full row (joined === capacity): the in-flight label wins over "Full".
      expect(statusLabel(row({ phase, joined: 2, capacity: 2 }))).toBe('In progress');
    }
  });

  it('still labels a full non-in-flight row "Full" (guard against over-widening)', () => {
    // A phase NOT in the widened set (e.g. a full Advertised row) keeps the "Full" label,
    // proving the widening did not swallow the ordinary full-seat case.
    expect(statusLabel(row({ phase: 'Advertised', joined: 2, capacity: 2 }))).toBe('Full');
  });
});

/**
 * SVC-04 public paused-notice coverage (05-05, D-07, UI-SPEC E5).
 *
 * The participant side of drain mode is one sentence, but it is a sentence that must never be
 * invented. These branches pin that the notice is chosen ONLY from a bit the service actually
 * served, and that the two states which look identical from a distance (a deliberately paused
 * service and an idle one) are told apart in words.
 */
describe('directoryNotice fails closed: no paused claim without a served bit', () => {
  it('renders NO notice while the status is unknown, even with rows on screen', () => {
    // The prohibition in one assertion: before the first `GET /v1/status` read lands there is
    // nothing to claim, so the directory keeps its inherited behavior.
    expect(directoryNotice({ paused: undefined, rowCount: 3, unreachable: false })).toBe('none');
  });

  it('renders NO notice while the status is unknown AND the list is empty', () => {
    // The trap this exists to close: an empty directory is NOT evidence of a pause. A paused
    // service and an idle one both show zero open cohorts, which is exactly why the server
    // serves a paused bit rather than letting the client infer one.
    expect(directoryNotice({ paused: undefined, rowCount: 0, unreachable: false })).toBe('none');
  });

  it('never renders a paused notice from stale data when the directory is unreachable', () => {
    // Even holding a paused bit from an earlier read, an unreachable directory keeps its
    // inherited bad-tone card: a notice beside unreachable rows would be a claim about a
    // service that is not answering.
    expect(directoryNotice({ paused: true, rowCount: 2, unreachable: true })).toBe('unreachable');
    expect(directoryNotice({ paused: undefined, rowCount: 0, unreachable: true })).toBe('unreachable');
    expect(directoryNotice({ paused: false, rowCount: 1, unreachable: true })).toBe('unreachable');
  });
});

describe('directoryNotice distinguishes a paused service from an idle one', () => {
  it('puts a notice ABOVE the list when a paused service still has open cohorts', () => {
    // The list is never suppressed by the notice: the rows below are still joinable.
    expect(directoryNotice({ paused: true, rowCount: 1, unreachable: false })).toBe('paused-with-rows');
    expect(directoryNotice({ paused: true, rowCount: 9, unreachable: false })).toBe('paused-with-rows');
  });

  it('uses the distinct paused empty state when a paused service has no open cohorts', () => {
    expect(directoryNotice({ paused: true, rowCount: 0, unreachable: false })).toBe('paused-empty');
  });

  it('keeps the inherited idle empty state for a running service with no cohorts', () => {
    // The whole point of the split: an idle service must not be described as a paused one.
    expect(directoryNotice({ paused: false, rowCount: 0, unreachable: false })).toBe('idle-empty');
  });

  it('renders no notice at all for the ordinary running service with rows', () => {
    expect(directoryNotice({ paused: false, rowCount: 4, unreachable: false })).toBe('none');
  });
});
