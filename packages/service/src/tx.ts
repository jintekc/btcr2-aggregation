import { buildFixtureTxData } from '@btcr2-aggregation/shared';
import type { AggregationServiceRunner, OnProvideTxData } from '@did-btcr2/aggregation/service';

/**
 * Build the service's `onProvideTxData` callback. The callback is invoked by the
 * runner once keygen has finalized and signing starts, with the cohort id and the
 * committed `signalBytes`. It reaches into the finalized cohort for the sorted
 * MuSig2 `cohortKeys` and returns the fixture beacon transaction to sign.
 *
 * The runner is created with this callback, so the runner reference is read lazily
 * (the callback only fires well after construction).
 */
export function makeProvideTxData(getRunner: () => AggregationServiceRunner): OnProvideTxData {
  return async ({ cohortId, signalBytes }) => {
    const cohort = getRunner().session.getCohort(cohortId);
    if (!cohort) {
      throw new Error(`onProvideTxData: unknown cohort ${cohortId}`);
    }
    return buildFixtureTxData(cohort.cohortKeys, signalBytes);
  };
}
