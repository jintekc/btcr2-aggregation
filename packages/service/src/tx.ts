import { buildFixtureTxData } from '@btcr2-aggregation/shared';
import { buildAggregationBeaconTx } from '@did-btcr2/method';
import type { AggregationServiceRunner, OnProvideTxData } from '@did-btcr2/aggregation/service';
import type { BitcoinConnection, BTCNetwork } from '@did-btcr2/bitcoin';

/**
 * Configuration for the opt-in LIVE beacon-transaction path. When present,
 * {@link makeProvideTxData} builds a real aggregation beacon tx that spends a
 * funded UTXO at the cohort's beacon address (via `buildAggregationBeaconTx`);
 * when absent, it returns the zero-chain fixture tx (the default). All fields are
 * injected by the caller so the live path is unit-testable with a mock connection.
 */
export interface LiveTxConfig {
  /** Bitcoin REST (esplora) connection used for UTXO / prev-tx lookup. */
  bitcoin: BitcoinConnection;
  /** scure network params for decoding the beacon address + P2TR script. */
  network: BTCNetwork;
  /**
   * Address the change output returns to. Defaults to the beacon address. Supply
   * the operator-funded funding wallet to stop reusing the cohort address for
   * change (ADR 044).
   */
  changeAddress?: string;
}

/**
 * Build the service's `onProvideTxData` callback. The runner invokes it once
 * keygen has finalized and signing starts, with the cohort id, the beacon
 * address, the committed `signalBytes`, and the runner's fee estimator.
 *
 * Fixture path (default, `live` omitted): reach into the finalized cohort for the
 * sorted MuSig2 `cohortKeys` and return the zero-chain fixture beacon tx.
 *
 * Live path (`live` provided): pre-flight the beacon address for a funded UTXO
 * (surfacing a clear operator-facing error if unfunded), then build the real
 * beacon tx with `buildAggregationBeaconTx`, using the cohort's aggregate x-only
 * internal key (`cohort.internalKey`, set at beacon-address computation) and the
 * runner's fee estimator. The returned `BeaconTxPlan` is a structural superset of
 * `SigningTxData`, so the runner consumes it unchanged.
 *
 * The runner is created with this callback, so the runner reference is read lazily
 * (the callback only fires well after construction).
 */
export function makeProvideTxData(
  getRunner: () => AggregationServiceRunner,
  live?: LiveTxConfig,
): OnProvideTxData {
  return async ({ cohortId, beaconAddress, signalBytes, feeEstimator }) => {
    const cohort = getRunner().session.getCohort(cohortId);
    if (!cohort) {
      throw new Error(`onProvideTxData: unknown cohort ${cohortId}`);
    }

    if (!live) {
      return buildFixtureTxData(cohort.cohortKeys, signalBytes);
    }

    // Pre-flight the funded UTXO so an unfunded cohort fails with an actionable
    // message that names the address to fund, rather than the builder's internal
    // "No UTXOs found" deep in the call stack.
    const utxos = await live.bitcoin.rest.address.getUtxos(beaconAddress);
    if (utxos.length === 0) {
      throw new Error(
        `live beacon tx: cohort beacon address ${beaconAddress} has no UTXOs; ` +
          'fund it (operator-funded model) before running a live cohort',
      );
    }

    return buildAggregationBeaconTx({
      beaconAddress,
      // The aggregate x-only internal key the beacon address was derived from;
      // pass it straight through (no recompute from cohortKeys needed).
      internalPubkey: cohort.internalKey,
      signalBytes,
      bitcoin: live.bitcoin,
      network: live.network,
      // Honor a dynamic rate injected at the runner (defaults to 5 sat/vB).
      feeEstimator,
      changeAddress: live.changeAddress,
    });
  };
}
