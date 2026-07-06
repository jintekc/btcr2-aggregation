import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { Address, OutScript, Transaction, p2tr } from '@scure/btc-signer';
import type { BTC_NETWORK } from '@scure/btc-signer/utils';
import { buildCohortConfig, createIdentity, resolveNetwork } from '@btcr2-aggregation/shared';
import type { AggregationServiceRunner, CohortConfig } from '@did-btcr2/aggregation/service';
import type { BitcoinConnection } from '@did-btcr2/bitcoin';
import { describe, expect, it } from 'vitest';
import { makeProvideTxData, MIN_LIVE_FUNDING_SATS } from './tx.js';
import { createService } from './index.js';

const NETWORK: BTC_NETWORK = resolveNetwork('regtest').scureNetwork;
// A trivial fee estimator (the OnProvideTxData info requires one). 500 sats flat.
const feeEstimator = { estimateFee: async (): Promise<bigint> => 500n };
const SIGNAL = new Uint8Array(32).fill(9);

/** A runner whose `session.getCohort` returns `cohort` (or undefined). */
function fakeRunner(cohort: unknown): AggregationServiceRunner {
  return { session: { getCohort: () => cohort } } as unknown as AggregationServiceRunner;
}

/** A key-path P2TR beacon address on regtest plus its x-only internal key. */
function makeBeacon(): { beaconAddress: string; internalKey: Uint8Array } {
  const internalKey = SchnorrKeyPair.generate().publicKey.xOnly;
  const beaconAddress = p2tr(internalKey, undefined, NETWORK).address!;
  return { beaconAddress, internalKey };
}

/** One mocked UTXO at the beacon address; `height` orders the builder's depth pick. */
interface MockUtxoSpec {
  value: number;
  confirmed?: boolean;
  height?: number;
}

/**
 * A mock esplora connection. `funded` true => `getUtxos` returns the given UTXOs
 * (one confirmed 100k-sat UTXO by default), each backed by a real prev tx that pays
 * the queried address (so `buildAggregationBeaconTx`'s nonWitnessUtxo/txid/witnessUtxo
 * all reconcile); `funded` false => `getUtxos` returns []. Broadcast is disabled.
 */
function mockBitcoin(funded: boolean, utxos: number | MockUtxoSpec[] = 100000, confirmed = true): BitcoinConnection {
  const specs: MockUtxoSpec[] = typeof utxos === 'number' ? [{ value: utxos, confirmed }] : utxos;
  const prevByTxid = new Map<string, string>();
  return {
    rest: {
      address: {
        getUtxos: async (addr: string) => {
          if (!funded) {
            return [];
          }
          const script = OutScript.encode(Address(NETWORK).decode(addr));
          return specs.map((spec, i) => {
            // Distinct lockTime => distinct txid even for equal values.
            const prev = new Transaction({ allowUnknownOutputs: true, allowUnknownInputs: true, version: 2, lockTime: i });
            prev.addOutput({ script, amount: BigInt(spec.value) });
            prev.addInput({ txid: new Uint8Array(32), index: 0xffffffff, sequence: 0xffffffff, finalScriptSig: hexToBytes('00') });
            prevByTxid.set(prev.id, prev.hex);
            const isConfirmed = spec.confirmed ?? true;
            return {
              txid: prev.id,
              vout: 0,
              value: spec.value,
              status: { confirmed: isConfirmed, block_height: isConfirmed ? (spec.height ?? 100) : undefined },
            };
          });
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

/** The last output's script hex (the OP_RETURN carrying the signal). */
function lastOutputScriptHex(tx: Transaction): string {
  const out = tx.getOutput(tx.outputsLength - 1);
  return out.script ? bytesToHex(out.script) : '';
}

describe('makeProvideTxData - fixture path (default)', () => {
  const cohortKeys = [
    SchnorrKeyPair.generate().publicKey.compressed,
    SchnorrKeyPair.generate().publicKey.compressed,
  ];

  it('returns the fixture beacon tx when no live config is given', async () => {
    const provide = makeProvideTxData(() => fakeRunner({ cohortKeys }));
    const data = await provide({ cohortId: 'c1', beaconAddress: 'unused', signalBytes: SIGNAL, feeEstimator });
    expect(data.prevOutScripts).toHaveLength(1);
    expect(data.prevOutValues).toHaveLength(1);
    // Last output is the OP_RETURN commitment to the signal (6a20 = RETURN PUSH32).
    expect(lastOutputScriptHex(data.tx)).toBe(`6a20${bytesToHex(SIGNAL)}`);
  });

  it('throws when the cohort is unknown', async () => {
    const provide = makeProvideTxData(() => fakeRunner(undefined));
    await expect(
      provide({ cohortId: 'gone', beaconAddress: 'unused', signalBytes: SIGNAL, feeEstimator }),
    ).rejects.toThrow(/unknown cohort/);
  });
});

describe('makeProvideTxData - live path', () => {
  it('surfaces a clear, address-naming error when the beacon address is unfunded', async () => {
    const { beaconAddress, internalKey } = makeBeacon();
    const provide = makeProvideTxData(() => fakeRunner({ internalKey }), {
      bitcoin: mockBitcoin(false),
      network: NETWORK,
    });
    await expect(
      provide({ cohortId: 'c1', beaconAddress, signalBytes: SIGNAL, feeEstimator }),
    ).rejects.toThrow(new RegExp(`no UTXOs.*${beaconAddress}|${beaconAddress}.*no UTXOs`));
  });

  it('refuses a dust-only beacon balance (below the library 546-sat spendable limit)', async () => {
    const { beaconAddress, internalKey } = makeBeacon();
    const provide = makeProvideTxData(() => fakeRunner({ internalKey }), {
      bitcoin: mockBitcoin(true, 500),
      network: NETWORK,
    });
    await expect(
      provide({ cohortId: 'c1', beaconAddress, signalBytes: SIGNAL, feeEstimator }),
    ).rejects.toThrow(/no spendable UTXO.*dust/);
  });

  it('refuses a selectable-but-underfunded UTXO before signing starts (funding floor)', async () => {
    const { beaconAddress, internalKey } = makeBeacon();
    // 600 sats: above the library's 546-sat spendable limit (so it WOULD be
    // selected and die mid-build on fees) but below the app floor.
    const provide = makeProvideTxData(() => fakeRunner({ internalKey }), {
      bitcoin: mockBitcoin(true, 600),
      network: NETWORK,
    });
    await expect(
      provide({ cohortId: 'c1', beaconAddress, signalBytes: SIGNAL, feeEstimator }),
    ).rejects.toThrow(new RegExp(`600 sats.*below the ${MIN_LIVE_FUNDING_SATS}-sat funding floor`));
  });

  it('floors the UTXO the builder will SPEND (deepest), not the largest balance', async () => {
    const { beaconAddress, internalKey } = makeBeacon();
    // The builder deterministically spends the DEEPEST confirmed non-dust UTXO. A
    // deep 600-sat test-send plus a shallower 100k-sat real funding must therefore
    // FAIL the floor (the 600-sat UTXO is what gets spent) - a largest-balance
    // check would wave this through and the cohort would die after keygen.
    const provide = makeProvideTxData(() => fakeRunner({ internalKey }), {
      bitcoin: mockBitcoin(true, [
        { value: 600, height: 50 },
        { value: 100000, height: 100 },
      ]),
      network: NETWORK,
    });
    await expect(
      provide({ cohortId: 'c1', beaconAddress, signalBytes: SIGNAL, feeEstimator }),
    ).rejects.toThrow(/600 sats - the deepest confirmed/);
  });

  it('refuses an unconfirmed-only balance (the builder spends confirmed UTXOs)', async () => {
    const { beaconAddress, internalKey } = makeBeacon();
    const provide = makeProvideTxData(() => fakeRunner({ internalKey }), {
      bitcoin: mockBitcoin(true, 100000, false),
      network: NETWORK,
    });
    await expect(
      provide({ cohortId: 'c1', beaconAddress, signalBytes: SIGNAL, feeEstimator }),
    ).rejects.toThrow(/no spendable UTXO.*unconfirmed/);
  });

  it('builds at exactly the funding floor and refuses one sat below it (boundary)', async () => {
    const { beaconAddress, internalKey } = makeBeacon();
    const at = makeProvideTxData(() => fakeRunner({ internalKey }), {
      bitcoin: mockBitcoin(true, MIN_LIVE_FUNDING_SATS),
      network: NETWORK,
    });
    const data = await at({ cohortId: 'c1', beaconAddress, signalBytes: SIGNAL, feeEstimator });
    expect(data.prevOutValues).toEqual([BigInt(MIN_LIVE_FUNDING_SATS)]);

    const below = makeProvideTxData(() => fakeRunner({ internalKey }), {
      bitcoin: mockBitcoin(true, MIN_LIVE_FUNDING_SATS - 1),
      network: NETWORK,
    });
    await expect(
      below({ cohortId: 'c1', beaconAddress, signalBytes: SIGNAL, feeEstimator }),
    ).rejects.toThrow(/funding floor/);
  });

  it('builds a real aggregation beacon tx spending the funded beacon UTXO', async () => {
    const { beaconAddress, internalKey } = makeBeacon();
    const provide = makeProvideTxData(() => fakeRunner({ internalKey }), {
      bitcoin: mockBitcoin(true, 100000),
      network: NETWORK,
    });
    const data = await provide({ cohortId: 'c1', beaconAddress, signalBytes: SIGNAL, feeEstimator });

    expect(data.prevOutScripts).toHaveLength(1);
    expect(data.prevOutValues).toEqual([100000n]);
    // Change output + OP_RETURN signal (last), per the spec's output ordering.
    expect(data.tx.outputsLength).toBe(2);
    expect(lastOutputScriptHex(data.tx)).toBe(`6a20${bytesToHex(SIGNAL)}`);
    // BeaconTxPlan superset fields confirm the real builder ran on this address.
    const plan = data as { beaconAddress?: string; scriptKind?: string };
    expect(plan.beaconAddress).toBe(beaconAddress);
    expect(plan.scriptKind).toBe('p2tr');
  });
});

describe('createService - live guards', () => {
  const identity = createIdentity();
  const mainnetConfig: CohortConfig = { ...buildCohortConfig(2), network: 'bitcoin' };

  it('throws when live is true without an injected connection', () => {
    expect(() => createService({ identity, config: buildCohortConfig(2), live: true })).toThrow(
      /requires an injected `bitcoin`/,
    );
  });

  it('refuses a live mainnet run without an explicit opt-in', () => {
    expect(() =>
      createService({ identity, config: mainnetConfig, live: true, bitcoin: mockBitcoin(true) }),
    ).toThrow(/mainnet/i);
  });

  it('allows a live mainnet run when allowMainnet is set', () => {
    const service = createService({
      identity,
      config: mainnetConfig,
      live: true,
      bitcoin: mockBitcoin(true),
      allowMainnet: true,
    });
    expect(service.runner).toBeDefined();
  });

  it('constructs a live test-network service, and the fixture default needs no connection', () => {
    expect(
      createService({ identity, config: buildCohortConfig(2), live: true, bitcoin: mockBitcoin(true) }).runner,
    ).toBeDefined();
    expect(createService({ identity, config: buildCohortConfig(2) }).runner).toBeDefined();
  });
});
