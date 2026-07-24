import { buildFixtureTxData, resolveNetwork } from '@btcr2-aggregation/shared';
import { buildAggregationBeaconTx, selectSpendableUtxo } from '@did-btcr2/method';
import type { AggregationServiceRunner, OnProvideTxData } from '@did-btcr2/aggregation/service';
import type { AddressUtxo, BitcoinConnection, BTCNetwork } from '@did-btcr2/bitcoin';
import {
  classifyFunding,
  computeFundingDeadline,
  computeSuggestedMinSats,
  FUNDING_SLACK_MS,
  type FundingState,
} from './funding-watch.js';

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
  /**
   * Funding window in ms (D-38). When set, the live branch WAITS for the operator to fund the
   * cohort beacon address before building: it polls `getUtxos` + {@link classifyFunding} until
   * `funded`, throws the dead-end message on a below-minimum selected UTXO, or throws the specific
   * "funding never arrived" reason on a deadline lapse (from INSIDE onProvideTxData, before either
   * library timer fires). Left undefined, the live branch keeps its original SINGLE-SHOT pre-flight
   * (an unfunded address fails immediately) so direct callers/tests that never configure a window
   * are byte-identical.
   */
  fundingWindowMs?: number;
  /**
   * Returns the cohort's REMAINING TTL in ms (the library `cohortTtlMs` armed at advertise minus
   * elapsed), or undefined when no cohort TTL is armed. The funding wait clamps its deadline to
   * `min(fundingWindowMs, remainingTtl - slack)` (D-38) so it always throws before `cohortTtlMs`
   * fires. Only consulted when {@link fundingWindowMs} is set.
   */
  remainingCohortTtlMs?: (cohortId: string) => number | undefined;
  /** Poll cadence (ms) for the funding wait. Default 5000. Only used when {@link fundingWindowMs} is set. */
  fundingPollIntervalMs?: number;
  /** Slack (ms) subtracted from the remaining-TTL clamp leg. Default {@link FUNDING_SLACK_MS}. */
  fundingSlackMs?: number;
}

/** A cancelable-agnostic unref'd sleep for the funding wait (the runner settles the cohort on stop). */
function fundingSleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (typeof (timer as { unref?: () => void }).unref === 'function') {
      (timer as { unref: () => void }).unref();
    }
  });
}

/**
 * Wait for the operator to fund the cohort beacon address, returning the SELECTED UTXO once
 * `funded` (D-38). Reuses {@link classifyFunding} + {@link computeSuggestedMinSats} so the wait
 * and the operator display watch share ONE selection convention (they can never disagree).
 *
 * The deadline is `min(configuredWindow, remainingTtl - slack)` ({@link computeFundingDeadline}),
 * so the specific reason below settles the cohort's completion BEFORE the library's `phaseTimeoutMs`
 * (fresh on entering the signing phase, kept above the window by the 04-05 boot invariant) or
 * `cohortTtlMs` (armed at advertise) can fire with a generic reason (Pitfall 3). Throw cases:
 * - `dead-end`: the selected confirmed UTXO is below the minimum; the message preserves the
 *   pre-flight's "topping up cannot fix this" wording (D-37).
 * - clean lapse (the LAST read SUCCEEDED): the honest "funding never arrived" reason (D-38).
 * - blind lapse (the last read FAILED, an esplora gap): an uncertainty-honest reason instead of a
 *   false terminal verdict (D-39).
 */
async function waitForFunding(
  live: LiveTxConfig,
  cohortId: string,
  beaconAddress: string,
  suggestedMinSats: number,
): Promise<AddressUtxo> {
  const { deadlineMs } = computeFundingDeadline({
    configuredWindowMs: live.fundingWindowMs,
    remainingTtlMs: live.remainingCohortTtlMs?.(cohortId),
    slackMs: live.fundingSlackMs ?? FUNDING_SLACK_MS,
  });
  const pollIntervalMs = live.fundingPollIntervalMs ?? 5000;
  const start = Date.now();
  let lastObservationOk = false;
  let lastState: FundingState = { state: 'waiting' };

  while (Date.now() - start < deadlineMs) {
    let utxos: AddressUtxo[];
    try {
      utxos = await live.bitcoin.rest.address.getUtxos(beaconAddress);
      lastObservationOk = true;
    } catch {
      // Esplora outage: the read failed, so we cannot classify. Keep the last-known state and
      // record the gap (D-39), then retry after a poll interval.
      lastObservationOk = false;
      await fundingSleep(pollIntervalMs);
      continue;
    }
    lastState = classifyFunding(utxos, suggestedMinSats, beaconAddress);
    if (lastState.state === 'funded') {
      return lastState.selected!;
    }
    if (lastState.state === 'dead-end') {
      const s = lastState.selected!;
      // Topping up CANNOT fix this: the builder always spends the deepest UTXO, and any new
      // funding confirms shallower, so this same UTXO keeps being selected (mirrors the
      // single-shot pre-flight wording so the operator reads one consistent message, D-37).
      throw new Error(
        `live beacon tx: the UTXO the builder will spend at ${beaconAddress} ` +
          `(${s.txid}:${s.vout}, ${s.value} sats - the deepest confirmed ` +
          `UTXO) is below the ${suggestedMinSats}-sat funding floor. Adding more funds will ` +
          'NOT help (new UTXOs confirm shallower and are never selected first); run the cohort ' +
          'on a fresh beacon address funded with a single adequate UTXO',
      );
    }
    await fundingSleep(pollIntervalMs);
  }

  // The funding window lapsed. D-39: a terminal "funding never arrived" verdict is honest ONLY
  // when the LAST watch read was a successful observation; if an esplora gap spanned the lapse we
  // genuinely do not know whether funds arrived, so surface the uncertainty rather than lying.
  if (lastObservationOk) {
    throw new Error(
      `live beacon tx: funding never arrived for ${beaconAddress} within the funding window; ` +
        'the cohort beacon address was not funded to the suggested minimum before the window ' +
        'closed (re-advertise the cohort to try again)',
    );
  }
  throw new Error(
    `live beacon tx: the funding window for ${beaconAddress} ended while this service could not ` +
      'observe the chain, so whether it was funded is unknown; check the address on a block ' +
      'explorer before reusing it',
  );
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

    // The one suggested minimum shared with the operator display watch (D-37); equals
    // MIN_LIVE_FUNDING_SATS unless a fee-derived need raises it.
    const suggestedMinSats = computeSuggestedMinSats();

    if (live.fundingWindowMs !== undefined) {
      // D-38 funding WAIT: the operator-funded product path. Poll until the beacon address is
      // funded (or dead-end / lapse), throwing the specific reason from inside this callback so a
      // real boot surfaces an honest funding message instead of a generic timer expiry. The wait
      // reuses the SAME classifyFunding + suggested minimum as the display watch, so the two can
      // never disagree about spendability.
      await waitForFunding(live, cohortId, beaconAddress, suggestedMinSats);
    } else {
      // Single-shot pre-flight (no window configured): the pre-D-38 behavior, preserved
      // byte-for-byte for direct callers/tests. Pre-flight the funded UTXO so an unfunded cohort
      // fails with an actionable message that names the address to fund, rather than the builder's
      // internal "No UTXOs found" deep in the call stack.
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
      if (selected.value < suggestedMinSats) {
        // Topping up CANNOT fix this: the builder always spends the deepest UTXO, and
        // any new funding confirms shallower, so this same UTXO keeps being selected.
        throw new Error(
          `live beacon tx: the UTXO the builder will spend at ${beaconAddress} ` +
            `(${selected.txid}:${selected.vout}, ${selected.value} sats - the deepest confirmed ` +
            `UTXO) is below the ${suggestedMinSats}-sat funding floor. Adding more funds will ` +
            'NOT help (new UTXOs confirm shallower and are never selected first); run the cohort ' +
            'on a fresh beacon address funded with a single adequate UTXO',
        );
      }
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
