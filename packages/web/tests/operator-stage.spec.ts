import { describe, expect, it } from 'vitest';
import { IN_FLIGHT_PHASES, OPEN_PHASES } from '@btcr2-aggregation/shared';
import { deriveOperatorStage, stageOrder } from '../src/components/operator/OperatorStageTimeline';
import type { CohortDetailDTO } from '../src/lib/operator';

/**
 * Review WR-05 coverage: the drill-down stage timeline must place a cohort in a funding-wait
 * phase at Co-signing, not Submissions.
 *
 * `CO_SIGN_PHASES` was a FOURTH copy of the in-flight phase set that omitted the four post-seat
 * funding-wait phases the service's `operator-cohorts.ts` / `monitor.ts` and the web
 * `lib/directory.ts` were all deliberately widened to include (SVC-JOIN-2). On a HERMETIC cohort
 * (the default, and the one the e2e exercises) sitting in `Validated` / `UpdatesCollected` /
 * `DataDistributed` with no nonce yet observed, the drill-down's primary visual anchor reported
 * the cohort was still collecting submissions while it was actually mid-signing. All four copies
 * now read one shared source.
 *
 * NEW spec under `packages/web/tests/` (tests-outside-src convention).
 */

function detail(over: Partial<CohortDetailDTO> = {}): CohortDetailDTO {
  return {
    exists: true,
    members: [],
    seatsJoined: 2,
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

describe('deriveOperatorStage (WR-05: the timeline reads the shared in-flight set)', () => {
  const order = stageOrder(false);

  it('places EVERY in-flight phase at co-signing, including the four funding-wait phases', () => {
    for (const phase of IN_FLIGHT_PHASES) {
      // No submissions, no nonces, no anchor: the phase string alone must carry the stage, which
      // is exactly the hermetic case the divergent copy got wrong.
      expect(deriveOperatorStage(detail({ phase }), order)).toBe('co-signing');
    }
    // The specific regression: these four used to read 'submissions'.
    for (const phase of ['UpdatesCollected', 'DataDistributed', 'Validated', 'FallbackRequested']) {
      expect(IN_FLIGHT_PHASES.has(phase)).toBe(true);
      expect(deriveOperatorStage(detail({ phase }), order)).toBe('co-signing');
    }
  });

  it('still places the pre-signing phases at filling / submissions', () => {
    expect(deriveOperatorStage(detail({ phase: 'Advertised' }), order)).toBe('filling');
    expect(deriveOperatorStage(detail({ phase: 'CohortSet' }), order)).toBe('submissions');
    expect(deriveOperatorStage(detail({ phase: 'CollectingUpdates' }), order)).toBe('submissions');
    // The joinable tier and the in-flight tier stay disjoint, so no phase can claim both stages.
    for (const phase of OPEN_PHASES) {
      expect(IN_FLIGHT_PHASES.has(phase)).toBe(false);
    }
  });

  it('keeps the furthest-along ratchet: observed facts still bump past the phase string', () => {
    const withFunding = stageOrder(true);
    expect(
      deriveOperatorStage(detail({ phase: 'Validated', funding: undefined }), withFunding),
    ).toBe('co-signing');
    expect(
      deriveOperatorStage(
        detail({
          phase: 'Validated',
          funding: {
            state: 'waiting',
            suggestedMinSats: 2000,
            beaconAddress: 'bcrt1pbeacon',
            recoveryKeyState: 'throwaway',
            mainnet: false,
            changeAddressRedirected: false,
            esploraStale: false,
          },
        }),
        withFunding,
      ),
    ).toBe('funding');
    expect(
      deriveOperatorStage(
        detail({ phase: 'Validated', anchor: { enabled: true, state: 'broadcast' } }),
        withFunding,
      ),
    ).toBe('anchor');
  });
});
