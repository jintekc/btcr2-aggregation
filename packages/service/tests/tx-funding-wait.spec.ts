import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { Address, OutScript, Transaction, p2tr } from '@scure/btc-signer';
import type { BTC_NETWORK } from '@scure/btc-signer/utils';
import { resolveNetwork } from '@btcr2-aggregation/shared';
import type { AggregationServiceRunner } from '@did-btcr2/aggregation/service';
import type { AddressUtxo, BitcoinConnection } from '@did-btcr2/bitcoin';
import { describe, expect, it } from 'vitest';
import { makeProvideTxData, type LiveTxConfig } from '../src/tx.js';
import { computeFundingDeadline, FUNDING_SLACK_MS } from '../src/funding-watch.js';

/**
 * Hermetic coverage of the D-38 funding WAIT inside makeProvideTxData's live branch (LIVE-01).
 * A stateful mock esplora drives the poll loop; short windows + tiny poll intervals keep it fast.
 * The wait proceeds on `funded`, throws the dead-end message on a below-minimum selected UTXO,
 * throws the specific "funding never arrived" reason on a clean lapse (last read succeeded), and
 * throws the uncertainty-honest reason when the last read FAILED (D-39). The clamp math is checked
 * against {@link computeFundingDeadline}.
 */

const NETWORK: BTC_NETWORK = resolveNetwork('regtest').scureNetwork;
const feeEstimator = { estimateFee: async (): Promise<bigint> => 500n };
const SIGNAL = new Uint8Array(32).fill(9);

/** A runner whose `session.getCohort` returns `cohort`. */
function fakeRunner(cohort: unknown): AggregationServiceRunner {
  return { session: { getCohort: () => cohort } } as unknown as AggregationServiceRunner;
}

/** A key-path P2TR beacon address on regtest plus its x-only internal key. */
function makeBeacon(): { beaconAddress: string; internalKey: Uint8Array } {
  const internalKey = SchnorrKeyPair.generate().publicKey.xOnly;
  const beaconAddress = p2tr(internalKey, undefined, NETWORK).address!;
  return { beaconAddress, internalKey };
}

/** One scripted read of the beacon address: what the next `getUtxos` returns (or throws). */
type Read = 'empty' | 'throw' | { value: number; confirmed?: boolean };

/**
 * A mock esplora whose `getUtxos` yields the scripted reads in order (the LAST read repeats once
 * exhausted, so a short window can lapse on a stable state). A `{ value }` read builds a real prev
 * tx paying the queried address so `buildAggregationBeaconTx` reconciles on the funded path; `getHex`
 * serves it back. `send` is disabled.
 */
function mockBitcoin(reads: Read[]): BitcoinConnection {
  const prevByTxid = new Map<string, string>();
  let i = 0;
  return {
    rest: {
      address: {
        getUtxos: async (addr: string): Promise<AddressUtxo[]> => {
          const read = reads[Math.min(i, reads.length - 1)];
          i += 1;
          if (read === 'throw') {
            throw new Error('mock esplora: unreachable');
          }
          if (read === 'empty') {
            return [];
          }
          const confirmed = read.confirmed ?? true;
          const script = OutScript.encode(Address(NETWORK).decode(addr));
          const prev = new Transaction({ allowUnknownOutputs: true, allowUnknownInputs: true, version: 2 });
          prev.addOutput({ script, amount: BigInt(read.value) });
          prev.addInput({ txid: new Uint8Array(32), index: 0xffffffff, sequence: 0xffffffff, finalScriptSig: hexToBytes('00') });
          prevByTxid.set(prev.id, prev.hex);
          return [
            {
              txid: prev.id,
              vout: 0,
              value: read.value,
              status: { confirmed, block_height: confirmed ? 100 : (undefined as unknown as number) } as never,
            },
          ];
        },
      },
      transaction: {
        getHex: async (txid: string) => prevByTxid.get(txid) ?? '',
        send: async () => {
          throw new Error('mock: broadcast disabled');
        },
        isConfirmed: async () => true,
      },
    },
  } as unknown as BitcoinConnection;
}

/** A LiveTxConfig with the funding WAIT enabled (a short window + tiny poll interval). */
function liveConfig(bitcoin: BitcoinConnection, overrides: Partial<LiveTxConfig> = {}): LiveTxConfig {
  return {
    bitcoin,
    network: NETWORK,
    fundingWindowMs: 300,
    fundingPollIntervalMs: 15,
    ...overrides,
  };
}

const lastOutputScriptHex = (tx: Transaction): string => {
  const out = tx.getOutput(tx.outputsLength - 1);
  return out.script ? bytesToHex(out.script) : '';
};

describe('makeProvideTxData - D-38 funding wait', () => {
  it('proceeds to build once the address is funded (empty -> funded auto-advance)', async () => {
    const { beaconAddress, internalKey } = makeBeacon();
    const provide = makeProvideTxData(
      () => fakeRunner({ internalKey }),
      liveConfig(mockBitcoin(['empty', 'empty', { value: 100_000 }]), { fundingWindowMs: 5000 }),
    );
    const data = await provide({ cohortId: 'c1', beaconAddress, signalBytes: SIGNAL, feeEstimator });
    expect(data.prevOutValues).toEqual([100_000n]);
    expect(lastOutputScriptHex(data.tx)).toBe(`6a20${bytesToHex(SIGNAL)}`);
  });

  it('throws the dead-end message on a below-minimum selected UTXO (topping up cannot fix it)', async () => {
    const { beaconAddress, internalKey } = makeBeacon();
    const provide = makeProvideTxData(
      () => fakeRunner({ internalKey }),
      liveConfig(mockBitcoin([{ value: 600 }])),
    );
    await expect(
      provide({ cohortId: 'c1', beaconAddress, signalBytes: SIGNAL, feeEstimator }),
    ).rejects.toThrow(/600 sats.*below the 2000-sat funding floor/);
  });

  it('throws the specific "funding never arrived" reason on a clean lapse (last read a successful empty observation)', async () => {
    const { beaconAddress, internalKey } = makeBeacon();
    const provide = makeProvideTxData(
      () => fakeRunner({ internalKey }),
      liveConfig(mockBitcoin(['empty'])),
    );
    await expect(
      provide({ cohortId: 'c1', beaconAddress, signalBytes: SIGNAL, feeEstimator }),
    ).rejects.toThrow(/funding never arrived/);
  });

  it('throws the uncertainty-honest reason when the last read FAILED (blind lapse, D-39)', async () => {
    const { beaconAddress, internalKey } = makeBeacon();
    const provide = makeProvideTxData(
      () => fakeRunner({ internalKey }),
      liveConfig(mockBitcoin(['throw'])),
    );
    await expect(
      provide({ cohortId: 'c1', beaconAddress, signalBytes: SIGNAL, feeEstimator }),
    ).rejects.toThrow(/could not\s+observe the chain|whether it was funded is unknown/);
  });

  it('does NOT declare "funding never arrived" on a blind lapse (prohibition, D-39)', async () => {
    const { beaconAddress, internalKey } = makeBeacon();
    const provide = makeProvideTxData(
      () => fakeRunner({ internalKey }),
      liveConfig(mockBitcoin(['throw'])),
    );
    await expect(
      provide({ cohortId: 'c1', beaconAddress, signalBytes: SIGNAL, feeEstimator }),
    ).rejects.not.toThrow(/funding never arrived/);
  });

  it('clamps the deadline to min(window, remaining TTL - slack): a short remaining TTL lapses fast', async () => {
    const { beaconAddress, internalKey } = makeBeacon();
    // A generous 60s window but only ~100ms of remaining TTL (minus a tiny slack) => the wait must
    // lapse in well under the window, proving the TTL leg clamps the deadline.
    const provide = makeProvideTxData(
      () => fakeRunner({ internalKey }),
      liveConfig(mockBitcoin(['empty']), {
        fundingWindowMs: 60_000,
        fundingSlackMs: 20,
        remainingCohortTtlMs: () => 120,
      }),
    );
    const start = Date.now();
    await expect(
      provide({ cohortId: 'c1', beaconAddress, signalBytes: SIGNAL, feeEstimator }),
    ).rejects.toThrow(/funding never arrived/);
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it('the clamp math is min(window, remaining TTL - slack)', () => {
    expect(
      computeFundingDeadline({ configuredWindowMs: 600_000, remainingTtlMs: 120_000, slackMs: 10_000 })
        .deadlineMs,
    ).toBe(110_000);
    expect(
      computeFundingDeadline({ configuredWindowMs: 60_000, remainingTtlMs: 3_600_000, slackMs: FUNDING_SLACK_MS })
        .deadlineMs,
    ).toBe(60_000);
  });
});
