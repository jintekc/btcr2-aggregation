import { describe, expect, it } from 'vitest';
import { IN_FLIGHT_PHASES, OPEN_PHASES } from '@btcr2-aggregation/shared';
import {
  CANCELED_STAGE_LABEL,
  deriveOperatorStage,
  stageOrder,
  STAGE_CAPTION,
  STAGE_LABEL,
  terminalCanceled,
} from '../src/components/operator/OperatorStageTimeline';
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

/**
 * The base fixture is a PARTIALLY filled cohort (1 of 2 seats). That matters: the timeline now
 * also narrates the automatic nth-seat close, so a fixture with every seat filled would make every
 * phase-only assertion below read `closed` and stop testing what it claims to test.
 */
function detail(over: Partial<CohortDetailDTO> = {}): CohortDetailDTO {
  return {
    exists: true,
    members: [],
    seatsJoined: 1,
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

describe('the automatic Closed stage (SVC-04, D-01): narrated, never a button', () => {
  const order = stageOrder(false);

  it('sits between Filling and Submissions in the stage order', () => {
    expect(order.indexOf('closed')).toBe(order.indexOf('filling') + 1);
    expect(order.indexOf('closed')).toBeLessThan(order.indexOf('submissions'));
  });

  it('is reached the moment the nth seat fills, with no server flag and no phase change', () => {
    // The specific case: still Advertised, but every seat is taken. Closing is the seat count
    // reaching capacity, which is why it needs no primitive of its own.
    expect(deriveOperatorStage(detail({ phase: 'Advertised', seatsJoined: 2, capacity: 2 }), order)).toBe('closed');
  });

  it('is NOT reached while a seat is still open', () => {
    expect(deriveOperatorStage(detail({ phase: 'Advertised', seatsJoined: 1, capacity: 2 }), order)).toBe('filling');
  });

  it('never holds a filled cohort back: a later phase still ratchets past it', () => {
    expect(deriveOperatorStage(detail({ phase: 'CollectingUpdates', seatsJoined: 2, capacity: 2 }), order)).toBe(
      'submissions',
    );
    expect(deriveOperatorStage(detail({ phase: 'SigningStarted', seatsJoined: 2, capacity: 2 }), order)).toBe(
      'co-signing',
    );
  });

  it('carries the exact UI-SPEC label and caption, and is the only captioned stage', () => {
    expect(STAGE_LABEL.closed).toBe('Closed');
    expect(STAGE_CAPTION.closed).toBe('Every seat filled, so this cohort locked and stopped accepting joins.');
    expect(Object.keys(STAGE_CAPTION)).toEqual(['closed']);
  });
});

describe('the terminal Canceled marker (SVC-04, D-01/D-05)', () => {
  it('is read straight off the served fate, never inferred from a phase or an error', () => {
    expect(terminalCanceled(detail({ fate: 'canceled' }))).toBe(true);
    expect(terminalCanceled(detail())).toBe(false);
    // A settled cohort with no fate is an expiry or a completion, not a cancel.
    expect(terminalCanceled(detail({ phase: 'unknown' }))).toBe(false);
  });

  it('does not repaint the stage the cohort actually reached', () => {
    // The marker is APPENDED, so a cohort canceled while filling still derives `filling`: the
    // timeline must never imply a canceled cohort got as far as anchoring.
    const order = stageOrder(false);
    expect(deriveOperatorStage(detail({ phase: 'Advertised', fate: 'canceled' }), order)).toBe('filling');
  });

  it('has a fixed label distinct from every lifecycle stage', () => {
    expect(CANCELED_STAGE_LABEL).toBe('Canceled');
    expect(Object.values(STAGE_LABEL)).not.toContain(CANCELED_STAGE_LABEL);
  });
});
