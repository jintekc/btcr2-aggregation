/**
 * The one selection convention for the operator-funded cohort beacon (LIVE-01, D-36/D-37).
 *
 * This module is the single home of the funding predicate so the operator DISPLAY watch
 * (feeding the monitor's funding view, D-44) and the authoritative onProvideTxData WAIT
 * (`tx.ts`, D-38) can never disagree about whether a beacon address is funded. Both run the
 * library's own {@link selectSpendableUtxo} over the polled UTXO set and compare THE SELECTED
 * (deepest confirmed, above-dust) UTXO against ONE suggested minimum - never an existence check
 * over the set (the anti-pattern D-36 forbids, RESEARCH Pattern 2).
 *
 * The app is watch-only: it never holds or spends the funding keys. The operator funds the
 * beacon address from their own external wallet; this module only OBSERVES the chain and
 * classifies what it sees. The dead-end verdict deliberately preserves the "topping up cannot
 * fix this" fact from the {@link file://./tx.ts} pre-flight: the builder always spends the
 * DEEPEST confirmed UTXO, so a below-minimum deep UTXO cannot be rescued by adding shallower
 * funds (they confirm later and are never selected first).
 */

import { selectSpendableUtxo } from '@did-btcr2/method';
import type { AddressUtxo, BitcoinConnection } from '@did-btcr2/bitcoin';
import { MIN_LIVE_FUNDING_SATS } from './tx.js';

/**
 * The four honest funding states (D-36). `waiting`: no spendable UTXO yet (an empty address,
 * or only dust that topping up CAN fix). `awaiting-confirmation`: a candidate UTXO exists but
 * is not yet confirmed (the mempool state, which confirming CAN advance). `funded`: the
 * selected confirmed UTXO meets the suggested minimum (the cohort can anchor). `dead-end`: the
 * selected confirmed UTXO is BELOW the minimum band - terminal, because the builder always
 * spends this same deepest UTXO and topping up confirms shallower (D-37).
 */
export type FundingStateName = 'waiting' | 'awaiting-confirmation' | 'funded' | 'dead-end';

/** The classified funding state plus, when a UTXO was selected, the one the builder would spend. */
export interface FundingState {
  state: FundingStateName;
  /** Present for `funded` / `dead-end`: the deepest confirmed non-dust UTXO the builder spends. */
  selected?: AddressUtxo;
}

/**
 * Slack (ms) subtracted from the remaining cohort TTL when clamping the funding-wait deadline
 * (D-38, Pitfall 3). The wait must throw its specific "funding never arrived" reason from inside
 * onProvideTxData a comfortable margin BEFORE the library's `cohortTtlMs` timer (armed at
 * advertise, never reset) can fire and win the settlement race with a generic reason.
 */
export const FUNDING_SLACK_MS = 10_000;

/**
 * The single suggested-minimum number (D-37). The displayed ask, the watch threshold, the
 * pre-flight floor, and the dead-end band are all THIS one value, so the operator never funds
 * against a threshold the builder disagrees with. Fee derivation can only ever RAISE the ask
 * above the {@link MIN_LIVE_FUNDING_SATS} floor (a dynamic mainnet fee estimator may need more
 * than the static floor), never lower it.
 */
export function computeSuggestedMinSats(feeDerivedNeed?: number): number {
  return Math.max(MIN_LIVE_FUNDING_SATS, feeDerivedNeed ?? 0);
}

/**
 * Classify a beacon address's funding from its polled UTXO set (D-36, RESEARCH Pattern 2).
 *
 * The decision is ALWAYS the library's {@link selectSpendableUtxo} over the SELECTED (deepest
 * confirmed, above-dust) UTXO, never `utxos.length` or `.some(confirmed)`:
 * - empty set -> `waiting` (nothing to fund yet).
 * - selection throws (`NO_SPENDABLE_BEACON_UTXO`): any UNCONFIRMED UTXO present ->
 *   `awaiting-confirmation` (a candidate is in the mempool, confirming advances it); otherwise
 *   all-dust -> `waiting` (topping up over the 546-sat dust limit is fixable, planning note 8).
 * - selected value BELOW the suggested minimum -> terminal `dead-end` (D-37).
 * - selected value AT or ABOVE the minimum -> `funded`.
 *
 * `beaconAddress` is threaded to `selectSpendableUtxo` (it scopes selection to that address),
 * matching the `tx.ts` pre-flight call exactly so watch and builder share one convention.
 */
export function classifyFunding(
  utxos: AddressUtxo[],
  suggestedMinSats: number,
  beaconAddress: string,
): FundingState {
  if (utxos.length === 0) {
    return { state: 'waiting' };
  }
  let selected: AddressUtxo;
  try {
    selected = selectSpendableUtxo(utxos, beaconAddress);
  } catch {
    // NO_SPENDABLE_BEACON_UTXO: distinguish an all-unconfirmed set (a candidate is in the
    // mempool, so confirming will produce a spendable UTXO) from an all-dust set (only sub-dust
    // outputs, which topping up over the 546-sat limit can still fix - so it stays `waiting`).
    return utxos.some((u) => !u.status.confirmed)
      ? { state: 'awaiting-confirmation' }
      : { state: 'waiting' };
  }
  // The SELECTED deepest-confirmed-non-dust UTXO is the exact one the builder will spend, so the
  // floor is applied to it (not to the largest balance): a below-minimum deep UTXO dead-ends
  // even when a larger shallower UTXO exists, because the builder never selects the shallower one.
  if (selected.value < suggestedMinSats) {
    return { state: 'dead-end', selected };
  }
  return { state: 'funded', selected };
}

/** The clamp inputs (D-38): the configured funding window and the cohort's remaining TTL. */
export interface FundingDeadlineInput {
  /** Operator-configured funding window (ms). `undefined` => no configured window (unbounded leg). */
  configuredWindowMs?: number;
  /**
   * Remaining cohort TTL (ms) at the moment the wait starts. `undefined` (or a non-finite value)
   * => the cohort has no TTL armed, so the TTL leg does not clamp. The library's `cohortTtlMs` is
   * armed at advertise and never reset, so this must be the REMAINING budget, not the full TTL.
   */
  remainingTtlMs?: number;
  /** Slack (ms) subtracted from the TTL leg so the wait beats the library timer (see {@link FUNDING_SLACK_MS}). */
  slackMs: number;
}

/** The clamped wait deadline plus, when the TTL leg truncated the configured window, the honest disclosure. */
export interface FundingDeadline {
  /** The wait's deadline (ms). May be `Infinity` when neither leg bounds it. */
  deadlineMs: number;
  /**
   * The truncated window rounded to whole minutes, present ONLY when the remaining-TTL leg
   * clamped the deadline below the configured window (D-38). The funding stage discloses this
   * honestly so the operator is not surprised by a shorter-than-configured window.
   */
  truncatedWindowMin?: number;
}

/**
 * Compute the funding-wait deadline as `min(configuredWindow, remainingTtl - slack)` (D-38,
 * RESEARCH Pattern 3). Shared by the authoritative wait (`tx.ts`, for the throw) and the
 * operator surface (`index.ts`, for the truncated-window disclosure) so both agree on the window.
 *
 * The TTL leg subtracts {@link FundingDeadlineInput.slackMs} so the wait's specific "funding
 * never arrived" reason settles the cohort BEFORE the library's `cohortTtlMs` fires with a
 * generic reason (the first-settlement-wins race, Pitfall 3). When the (slack-adjusted) TTL leg
 * is the binding constraint AND is finite, the window is reported as truncated.
 */
export function computeFundingDeadline({
  configuredWindowMs,
  remainingTtlMs,
  slackMs,
}: FundingDeadlineInput): FundingDeadline {
  const windowLeg = configuredWindowMs ?? Infinity;
  const ttlLeg =
    remainingTtlMs === undefined || !Number.isFinite(remainingTtlMs)
      ? Infinity
      : Math.max(0, remainingTtlMs - slackMs);
  const deadlineMs = Math.min(windowLeg, ttlLeg);
  // Only a FINITE TTL leg that binds below the configured window is a truncation to disclose;
  // an unbounded TTL leg (no cohort TTL) never truncates the operator's configured window.
  if (Number.isFinite(ttlLeg) && ttlLeg < windowLeg) {
    return { deadlineMs, truncatedWindowMin: Math.max(0, Math.round(deadlineMs / 60_000)) };
  }
  return { deadlineMs };
}

/** Options for {@link createFundingWatch}. */
export interface FundingWatchOptions {
  /** Bitcoin REST (esplora) connection used to poll the beacon address's UTXO set. */
  bitcoin: BitcoinConnection;
  /** The cohort's beacon address to watch (known at `keygen-complete`, D-44). */
  beaconAddress: string;
  /** The one suggested minimum ({@link computeSuggestedMinSats}) the classification compares against. */
  suggestedMinSats: number;
  /** Poll cadence (ms). Default 5000, mirroring the broadcast confirm-poll interval. */
  pollIntervalMs?: number;
  /** Aborts the poll loop (wired to `service.stop()`). */
  signal?: AbortSignal;
  /**
   * Called after each poll with the classified state and whether the LAST read succeeded
   * (`lastObservationOk`). A failed read reports the last-known state frozen (D-43 stale-honesty)
   * with `lastObservationOk: false`, so the consumer can mark the funding view stale without
   * inventing a state and can honor D-39 blind-lapse honesty.
   */
  onState: (state: FundingState, meta: { lastObservationOk: boolean }) => void;
}

/** Handle for a running funding watch. */
export interface FundingWatchHandle {
  /**
   * Stop polling (idempotent). Safe to call after the loop has already retired itself on the
   * terminal `funded` state (see {@link createFundingWatch}) - it only aborts a signal nobody
   * is waiting on any more.
   */
  stop(): void;
}

/**
 * A cancelable, unref'd sleep that resolves early if `signal` aborts. Mirrors the
 * {@link file://./broadcast.ts} `delay` idiom (kept local so the watch does not depend on the
 * broadcast module's private helper): the timer is unref'd so the watch never keeps the process
 * alive, and an abort resolves it at once.
 */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      cleanup();
      resolve();
    };
    const cleanup = (): void => signal?.removeEventListener('abort', onAbort);
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    if (typeof (timer as { unref?: () => void }).unref === 'function') {
      (timer as { unref: () => void }).unref();
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Start a watch-only funding poll loop for the operator DISPLAY surface (D-44). It reads the
 * beacon address's UTXO set on an interval, classifies it via {@link classifyFunding}, and pushes
 * each result to `onState` alongside `lastObservationOk`.
 *
 * The loop is fire-and-forget, abortable, and unref'd (it never blocks `service.stop()` nor keeps
 * the process alive). A read that THROWS (an esplora outage) does not fabricate a state: the loop
 * re-emits the last successful classification with `lastObservationOk: false` so the funding view
 * freezes stale-honest (D-43) while the state itself is unchanged. `lastObservationOk` starts
 * false until the first successful read lands, so blind-lapse honesty (D-39) never rests on an
 * observation that has not yet happened.
 *
 * This DISPLAY watch is deliberately independent of the authoritative onProvideTxData wait in
 * `tx.ts`: they share the predicate + minimum but poll separately, so the operator sees funding
 * progress from the moment keygen completes even though the builder's wait is what actually gates
 * signing.
 *
 * `funded` is a TERMINAL DISPLAY state: the loop emits it once and then retires itself. The funding
 * stage's whole job ends there (the anchor stages take over from that point), and continuing to
 * poll is actively DISHONEST rather than merely wasteful - a live-UAT field finding on plan 04-08.
 * The beacon tx routes its change BACK to the beacon address by default ({@link file://./tx.ts}
 * `LiveTxConfig.changeAddress`, ADR 044), so seconds after the cohort anchors the address holds
 * only a small change UTXO. {@link classifyFunding} is stateless and would (correctly, for a
 * never-funded address) classify that leftover as `dead-end`, and the monitor's last-write-wins
 * funding view would then show "Funded below the minimum" on a cohort that just anchored
 * successfully. Retiring at `funded` removes the source of that regression; the monitor keeps a
 * matching no-regression guard as a backstop for any straggler in-flight poll (D-44).
 *
 * The AUTHORITATIVE wait in `tx.ts` is unaffected: it runs its own independent poll with its own
 * exit conditions and never consults this handle.
 */
export function createFundingWatch(opts: FundingWatchOptions): FundingWatchHandle {
  const controller = new AbortController();
  const signal = opts.signal
    ? anySignal([opts.signal, controller.signal])
    : controller.signal;
  const pollIntervalMs = opts.pollIntervalMs ?? 5000;
  // The last SUCCESSFULLY-classified state; a failed read freezes to this rather than inventing one.
  let lastState: FundingState = { state: 'waiting' };

  const loop = async (): Promise<void> => {
    while (!signal.aborted) {
      let observationOk: boolean;
      try {
        const utxos = await opts.bitcoin.rest.address.getUtxos(opts.beaconAddress);
        lastState = classifyFunding(utxos, opts.suggestedMinSats, opts.beaconAddress);
        observationOk = true;
      } catch {
        // Esplora outage: keep the last-known state frozen (D-43), only the freshness bit flips.
        observationOk = false;
      }
      if (signal.aborted) {
        return;
      }
      opts.onState(lastState, { lastObservationOk: observationOk });
      // Terminal DISPLAY state: `funded` is the last thing this watch has to say. Retire the loop
      // so a post-anchor change UTXO at the beacon address (change routes back there by default,
      // ADR 044) can never be re-classified as `dead-end` and overwrite the funded view. Only a
      // SUCCESSFUL classification can produce `funded` (a failed read re-emits the frozen
      // last-known state, and the loop has already retired if that state was funded), so this
      // never retires on a stale reading. Abort first so `stop()` stays idempotent either way.
      if (lastState.state === 'funded') {
        controller.abort();
        return;
      }
      await delay(pollIntervalMs, signal);
    }
  };
  void loop();

  return {
    stop(): void {
      controller.abort();
    },
  };
}

/**
 * Combine multiple abort signals into one that aborts when ANY input aborts (a minimal stand-in
 * for `AbortSignal.any`, which is not guaranteed across the supported Node range). Used so a
 * caller-supplied signal and the watch's own controller both stop the loop.
 */
function anySignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  const onAbort = (): void => {
    controller.abort();
    for (const s of signals) {
      s.removeEventListener('abort', onAbort);
    }
  };
  for (const s of signals) {
    if (s.aborted) {
      controller.abort();
      break;
    }
    s.addEventListener('abort', onAbort, { once: true });
  }
  return controller.signal;
}
