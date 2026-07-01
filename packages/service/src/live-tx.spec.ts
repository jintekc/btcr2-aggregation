import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { Address, OutScript, Transaction, p2tr } from '@scure/btc-signer';
import type { BTC_NETWORK } from '@scure/btc-signer/utils';
import { buildCohortConfig, createIdentity, resolveNetwork } from '@btcr2-aggregation/shared';
import type { AggregationServiceRunner, CohortConfig } from '@did-btcr2/aggregation/service';
import type { BitcoinConnection } from '@did-btcr2/bitcoin';
import { describe, expect, it } from 'vitest';
import { makeProvideTxData } from './tx.js';
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

/**
 * A mock esplora connection. `funded` true => `getUtxos` returns one confirmed
 * UTXO backed by a real prev tx that pays the queried address (so
 * `buildAggregationBeaconTx`'s nonWitnessUtxo/txid/witnessUtxo all reconcile);
 * `funded` false => `getUtxos` returns []. Broadcast is disabled.
 */
function mockBitcoin(funded: boolean, valueSats = 100000): BitcoinConnection {
  const prevByTxid = new Map<string, string>();
  return {
    rest: {
      address: {
        getUtxos: async (addr: string) => {
          if (!funded) {
            return [];
          }
          const script = OutScript.encode(Address(NETWORK).decode(addr));
          const prev = new Transaction({ allowUnknownOutputs: true, allowUnknownInputs: true, version: 2 });
          prev.addOutput({ script, amount: BigInt(valueSats) });
          prev.addInput({ txid: new Uint8Array(32), index: 0xffffffff, sequence: 0xffffffff, finalScriptSig: hexToBytes('00') });
          prevByTxid.set(prev.id, prev.hex);
          return [{ txid: prev.id, vout: 0, value: valueSats, status: { confirmed: true, block_height: 100 } }];
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
