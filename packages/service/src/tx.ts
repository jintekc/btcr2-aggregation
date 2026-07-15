import { buildFixtureTxData, resolveNetwork } from '@btcr2-aggregation/shared';
import { buildAggregationBeaconTx, selectSpendableUtxo } from '@did-btcr2/method';
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
 * Heuristic funding floor (sats) for the UTXO the live beacon tx will spend. The
 * builder spends exactly one confirmed UTXO - the DEEPEST above its 546-sat dust
 * limit (`selectSpendableUtxo`), NOT the largest - into fee + dust-safe change +
 * the OP_RETURN; at the default 5 sat/vB the ~160 vB tx costs ~800 sats, and P2TR
 * change under 330 sats is dust the builder absorbs into the fee. Below this floor
 * the run is either doomed or forced to burn most of the UTXO as fee - on mainnet,
 * real money - so the pre-flight refuses early with an actionable message. A
 * floor, not a sufficiency proof: a dynamic mainnet fee estimator can still need
 * more.
 */
export const MIN_LIVE_FUNDING_SATS = 2000;

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
      // Spend the SAME Taproot output the real beacon address commits (internal key +
      // recovery/fallback script tree), not a bare aggregate-key output. Without this the
      // optimistic key path still co-signs, but the ADR 042 k-of-n script-path fallback
      // (F1c) is rejected by the library's beacon-output reconstruction check, because a
      // bare key-path prevout does not commit the fallback tapleaf. The cohort carries the
      // network name; resolve it to the scure params so the address decodes correctly.
      return buildFixtureTxData(cohort.cohortKeys, signalBytes, {
        beaconAddress,
        network: resolveNetwork(cohort.network),
      });
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
    // Dust-aware floor on the UTXO the builder will ACTUALLY spend: run the
    // library's own selection (the deepest confirmed UTXO above its 546-sat dust
    // limit - deliberately not the largest) so the pre-flight and the builder can
    // never disagree, and fail before MuSig2 signing starts instead of mid-build.
    // A selection failure (all dust / all unconfirmed) surfaces the library's
    // already-precise reason under the same operator-facing prefix.
    let selected;
    try {
      selected = selectSpendableUtxo(utxos, beaconAddress);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(
        `live beacon tx: cohort beacon address ${beaconAddress} has no spendable UTXO: ${reason}`,
      );
    }
    if (selected.value < MIN_LIVE_FUNDING_SATS) {
      // Topping up CANNOT fix this: the builder always spends the deepest UTXO, and
      // any new funding confirms shallower, so this same UTXO keeps being selected.
      throw new Error(
        `live beacon tx: the UTXO the builder will spend at ${beaconAddress} ` +
          `(${selected.txid}:${selected.vout}, ${selected.value} sats - the deepest confirmed ` +
          `UTXO) is below the ${MIN_LIVE_FUNDING_SATS}-sat funding floor. Adding more funds will ` +
          'NOT help (new UTXOs confirm shallower and are never selected first); run the cohort ' +
          'on a fresh beacon address funded with a single adequate UTXO',
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
