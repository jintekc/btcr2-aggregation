import { describe, expect, it } from 'vitest';
import { statusLabel, type DirectoryCohortDTO } from '../src/lib/directory';

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
