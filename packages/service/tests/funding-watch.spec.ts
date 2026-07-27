import { describe, expect, it } from 'vitest';
import type { AddressUtxo, BitcoinConnection } from '@did-btcr2/bitcoin';
import {
  classifyFunding,
  computeFundingDeadline,
  computeSuggestedMinSats,
  createFundingWatch,
  FUNDING_SLACK_MS,
} from '../src/funding-watch.js';
import { MIN_LIVE_FUNDING_SATS } from '../src/tx.js';

/**
 * Hermetic coverage of the one selection convention (LIVE-01, D-36/D-37). No chain, no esplora:
 * `classifyFunding` is a pure predicate over synthetic UTXO sets, and the watch is driven by a
 * mock connection whose `getUtxos` we control (including a thrown read for the D-39 lastObservationOk
 * bit). The address argument only scopes `selectSpendableUtxo`; a fixed sentinel is enough here.
 */

const ADDR = 'bcrt1pfundingaddresssentineldoesnotdecodehere';

/**
 * One synthetic esplora UTXO. `height` orders `selectSpendableUtxo`'s deepest-first pick: a LOWER
 * block_height is older / deeper (more confirmations), so it is selected before a higher-height
 * (shallower) UTXO, exactly as on a real chain.
 */
function utxo(value: number, opts: { confirmed?: boolean; height?: number } = {}): AddressUtxo {
  const confirmed = opts.confirmed ?? true;
  return {
    txid: `tx-${value}-${opts.height ?? 0}-${confirmed ? 'c' : 'u'}`,
    vout: 0,
    value,
    status: {
      confirmed,
      block_height: confirmed ? (opts.height ?? 100) : (undefined as unknown as number),
      block_hash: confirmed ? 'hash' : (undefined as unknown as string),
      block_time: confirmed ? 1_700_000_000 : (undefined as unknown as number),
    },
  };
}

describe('computeSuggestedMinSats (D-37, one consistent number)', () => {
  it('never returns below the MIN_LIVE_FUNDING_SATS floor', () => {
    expect(computeSuggestedMinSats()).toBe(MIN_LIVE_FUNDING_SATS);
    expect(computeSuggestedMinSats(0)).toBe(MIN_LIVE_FUNDING_SATS);
    expect(computeSuggestedMinSats(MIN_LIVE_FUNDING_SATS - 1)).toBe(MIN_LIVE_FUNDING_SATS);
  });

  it('only RISES with a fee-derived need above the floor', () => {
    expect(computeSuggestedMinSats(MIN_LIVE_FUNDING_SATS + 500)).toBe(MIN_LIVE_FUNDING_SATS + 500);
  });
});

describe('classifyFunding (D-36 selection predicate, never an existence check)', () => {
  const min = computeSuggestedMinSats(); // 2000

  it('waiting on an empty UTXO set', () => {
    expect(classifyFunding([], min, ADDR)).toEqual({ state: 'waiting' });
  });

  it('waiting on an all-dust set (topping up over dust is fixable)', () => {
    // 500 <= 546 dust limit: selectSpendableUtxo finds nothing spendable and no unconfirmed UTXO,
    // so this stays `waiting` (fixable by adding funds), NOT a dead-end.
    expect(classifyFunding([utxo(500)], min, ADDR).state).toBe('waiting');
  });

  it('awaiting-confirmation when a candidate UTXO exists but is unconfirmed', () => {
    // Above the dust limit but unconfirmed: no spendable UTXO yet, but a candidate is in the
    // mempool, so confirming will advance it (distinct from all-dust waiting).
    expect(classifyFunding([utxo(100_000, { confirmed: false })], min, ADDR).state).toBe(
      'awaiting-confirmation',
    );
  });

  it('funded when the selected confirmed UTXO meets the minimum', () => {
    const result = classifyFunding([utxo(100_000)], min, ADDR);
    expect(result.state).toBe('funded');
    expect(result.selected?.value).toBe(100_000);
  });

  it('funded exactly at the minimum (boundary)', () => {
    expect(classifyFunding([utxo(min)], min, ADDR).state).toBe('funded');
  });

  it('dead-end when the selected confirmed UTXO is below the minimum (one sat under)', () => {
    const result = classifyFunding([utxo(min - 1)], min, ADDR);
    expect(result.state).toBe('dead-end');
    expect(result.selected?.value).toBe(min - 1);
  });

  it('the SELECTED (deepest) UTXO drives the decision: a shallower larger UTXO does not rescue a deep dead-end', () => {
    // A deep 600-sat UTXO (height 50) plus a shallower 100k UTXO (height 100). The builder spends
    // the DEEPEST (600), so this is a dead-end even though a larger balance exists - a
    // largest-balance check would wrongly report `funded` and the cohort would die after keygen.
    const result = classifyFunding([utxo(600, { height: 50 }), utxo(100_000, { height: 100 })], min, ADDR);
    expect(result.state).toBe('dead-end');
    expect(result.selected?.value).toBe(600);
  });
});

describe('computeFundingDeadline (D-38 clamp)', () => {
  it('is the configured window when the TTL leg does not bind', () => {
    const { deadlineMs, truncatedWindowMin } = computeFundingDeadline({
      configuredWindowMs: 600_000,
      remainingTtlMs: 3_600_000,
      slackMs: FUNDING_SLACK_MS,
    });
    expect(deadlineMs).toBe(600_000);
    expect(truncatedWindowMin).toBeUndefined();
  });

  it('clamps to (remaining TTL - slack) and discloses the truncated window when the TTL leg binds', () => {
    // remaining TTL 120s, slack 10s => TTL leg 110s < configured window 600s: the deadline is the
    // slack-adjusted TTL and the window is disclosed as truncated (rounded to whole minutes).
    const { deadlineMs, truncatedWindowMin } = computeFundingDeadline({
      configuredWindowMs: 600_000,
      remainingTtlMs: 120_000,
      slackMs: 10_000,
    });
    expect(deadlineMs).toBe(110_000);
    expect(truncatedWindowMin).toBe(2); // round(110000 / 60000) = 2
  });

  it('is min(window, ttl - slack): the smaller leg always wins', () => {
    expect(
      computeFundingDeadline({ configuredWindowMs: 60_000, remainingTtlMs: 3_600_000, slackMs: 10_000 })
        .deadlineMs,
    ).toBe(60_000);
    expect(
      computeFundingDeadline({ configuredWindowMs: 3_600_000, remainingTtlMs: 60_000, slackMs: 10_000 })
        .deadlineMs,
    ).toBe(50_000);
  });

  it('never truncates on an unbounded TTL leg (no cohort TTL armed)', () => {
    const { deadlineMs, truncatedWindowMin } = computeFundingDeadline({
      configuredWindowMs: 600_000,
      remainingTtlMs: undefined,
      slackMs: FUNDING_SLACK_MS,
    });
    expect(deadlineMs).toBe(600_000);
    expect(truncatedWindowMin).toBeUndefined();
  });

  it('treats a NON-FINITE configured window as unbounded, never producing a NaN deadline (review WR-04)', () => {
    // A NaN window (a caller that derived it from its own malformed env) used to yield
    // `Math.min(NaN, ttlLeg) = NaN`. The wait's `Date.now() - start < NaN` is then false on the
    // FIRST evaluation, so it never polled once and still threw the "could not observe the chain"
    // blind-lapse reason - the exact false verdict D-39 exists to prevent.
    const noTtl = computeFundingDeadline({ configuredWindowMs: NaN, remainingTtlMs: undefined, slackMs: 10_000 });
    expect(noTtl.deadlineMs).toBe(Infinity);
    expect(noTtl.truncatedWindowMin).toBeUndefined();

    // With a TTL armed, the TTL leg simply becomes the binding one (and discloses the truncation).
    const withTtl = computeFundingDeadline({ configuredWindowMs: NaN, remainingTtlMs: 120_000, slackMs: 10_000 });
    expect(withTtl.deadlineMs).toBe(110_000);
    expect(withTtl.truncatedWindowMin).toBe(2);
  });
});

/** A mock connection whose `getUtxos` yields the queued results in order (a thrown result = an outage). */
function mockConnection(reads: Array<AddressUtxo[] | Error>): BitcoinConnection {
  let i = 0;
  return {
    rest: {
      address: {
        getUtxos: async () => {
          const next = reads[Math.min(i, reads.length - 1)];
          i += 1;
          if (next instanceof Error) {
            throw next;
          }
          return next;
        },
      },
    },
  } as unknown as BitcoinConnection;
}

describe('createFundingWatch (D-43 / D-39 lastObservationOk)', () => {
  it('reports lastObservationOk true on a successful read with the classified state', async () => {
    const seen = await new Promise<{ state: string; ok: boolean }>((resolve) => {
      const handle = createFundingWatch({
        bitcoin: mockConnection([[utxo(100_000)]]),
        beaconAddress: ADDR,
        suggestedMinSats: computeSuggestedMinSats(),
        pollIntervalMs: 5,
        onState: (state, meta) => {
          handle.stop();
          resolve({ state: state.state, ok: meta.lastObservationOk });
        },
      });
    });
    expect(seen).toEqual({ state: 'funded', ok: true });
  });

  it('reports lastObservationOk false after a thrown getUtxos read, freezing the last-known state', async () => {
    const seen = await new Promise<{ state: string; ok: boolean }>((resolve) => {
      const handle = createFundingWatch({
        bitcoin: mockConnection([new Error('esplora unreachable')]),
        beaconAddress: ADDR,
        suggestedMinSats: computeSuggestedMinSats(),
        pollIntervalMs: 5,
        onState: (state, meta) => {
          handle.stop();
          resolve({ state: state.state, ok: meta.lastObservationOk });
        },
      });
    });
    // The failed read freezes to the initial last-known state (`waiting`) and only flips the bit.
    expect(seen.ok).toBe(false);
    expect(seen.state).toBe('waiting');
  });
});

/**
 * A stateful mock esplora that yields each queued read IN ORDER and then repeats the final read
 * forever - the way a real beacon address behaves once its funding UTXO is spent and only the
 * change output remains. `calls()` exposes the read count so a retired poll loop is provable by
 * the absence of further reads (not merely by the absence of further emissions).
 */
function sequencedConnection(reads: AddressUtxo[][]): { bitcoin: BitcoinConnection; calls: () => number } {
  let i = 0;
  const bitcoin = {
    rest: {
      address: {
        getUtxos: async () => {
          const next = reads[Math.min(i, reads.length - 1)];
          i += 1;
          return next;
        },
      },
    },
  } as unknown as BitcoinConnection;
  return { bitcoin, calls: () => i };
}

/** Poll `predicate` until it holds, failing loudly rather than hanging the suite on a regression. */
async function waitUntil(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('timed out waiting for the funding watch');
    }
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

describe('createFundingWatch retires at funded (post-anchor change UTXO, live-UAT 04-08)', () => {
  it('emits funded once, stops polling, and never regresses to dead-end on the leftover change UTXO', async () => {
    const min = computeSuggestedMinSats(); // 2000
    // The exact live sequence the UAT hit: an empty address, then the operator's adequate confirmed
    // funding, then - after the beacon tx spends it - ONLY the small change output, which routes
    // back to the beacon address by default (ADR 044). That leftover is confirmed, above dust, and
    // below the minimum, so a still-running watch would classify it `dead-end` and (last-write-wins)
    // show "Funded below the minimum" on a cohort that had just anchored successfully.
    const chain = sequencedConnection([[], [utxo(100_000)], [utxo(600, { height: 200 })]]);
    const states: string[] = [];
    const handle = createFundingWatch({
      bitcoin: chain.bitcoin,
      beaconAddress: ADDR,
      suggestedMinSats: min,
      pollIntervalMs: 5,
      onState: (state) => {
        states.push(state.state);
      },
    });
    try {
      await waitUntil(() => states.includes('funded'));
      const callsAtFunded = chain.calls();
      // Wait out many poll intervals: a live loop would have read the change-only set several times.
      await new Promise((resolve) => setTimeout(resolve, 80));

      // (a) the view reaches funded, and (b) funded is the LAST word - no dead-end ever follows.
      expect(states).toEqual(['waiting', 'funded']);
      // (c) the loop retired: not one further esplora read after the funded classification.
      expect(chain.calls()).toBe(callsAtFunded);
    } finally {
      // Idempotent even though the loop already retired itself.
      handle.stop();
    }
  });

  it('keeps polling through the unfunded states (only funded is terminal)', async () => {
    // The retirement is specific to `funded`: a cohort that is still waiting (or has a pre-funding
    // dead-end verdict) must keep being observed, so topping-up / confirmation still surfaces.
    const min = computeSuggestedMinSats();
    const chain = sequencedConnection([[], [utxo(100_000, { confirmed: false })], [utxo(600)]]);
    const states: string[] = [];
    const handle = createFundingWatch({
      bitcoin: chain.bitcoin,
      beaconAddress: ADDR,
      suggestedMinSats: min,
      pollIntervalMs: 5,
      onState: (state) => {
        states.push(state.state);
      },
    });
    try {
      await waitUntil(() => states.length >= 4);
      expect(states.slice(0, 3)).toEqual(['waiting', 'awaiting-confirmation', 'dead-end']);
      // A pre-funding dead-end keeps being re-observed exactly as shipped (the watch is watch-only
      // and the operator surface owns the terminal messaging, not the loop).
      expect(states[3]).toBe('dead-end');
    } finally {
      handle.stop();
    }
  });
});
