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
