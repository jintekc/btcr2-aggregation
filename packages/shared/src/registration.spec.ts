import { canonicalHash } from '@did-btcr2/common';
import { bytesToHex } from '@noble/hashes/utils';
import { p2tr } from '@scure/btc-signer';
import { TEST_NETWORK } from '@scure/btc-signer/utils';
import { describe, expect, it } from 'vitest';
import {
  base64UrlHashToHex,
  buildSingletonRegistrationTx,
  createIdentity,
  genesisP2trBeaconAddress,
  MAX_REGISTRATION_FEE_SATS,
  MIN_REGISTRATION_FUNDING_SATS,
  REGISTRATION_FEE_SATS,
  updateHashBytes,
  updateHashHex,
} from './index.js';

// A representative signed-update-shaped object; the hash helpers are content
// hashes, so any stable JSON object exercises them.
const SAMPLE = {
  '@context': ['https://btcr2.dev/context/v1'],
  patch: [{ op: 'add', path: '/service/-', value: { type: 'CASBeacon' } }],
  targetHash: 'zzz',
  sourceHash: 'yyy',
} as const;

describe('update hash helpers', () => {
  it('updateHashHex matches @did-btcr2/common canonicalHash (hex) and is 64 hex chars', () => {
    expect(updateHashHex(SAMPLE)).toBe(canonicalHash(SAMPLE, { encoding: 'hex' }));
    expect(updateHashHex(SAMPLE)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('updateHashBytes is the 32 raw bytes of updateHashHex', () => {
    const bytes = updateHashBytes(SAMPLE);
    expect(bytes).toHaveLength(32);
    expect(bytesToHex(bytes)).toBe(updateHashHex(SAMPLE));
  });

  it('base64UrlHashToHex converts the default (base64url) canonical hash to the hex form', () => {
    // canonicalHash defaults to base64urlnopad; its hex bridge must equal the hex encoding.
    expect(base64UrlHashToHex(canonicalHash(SAMPLE))).toBe(updateHashHex(SAMPLE));
  });
});

describe('genesisP2trBeaconAddress', () => {
  it('derives the P2TR SingletonBeacon address (bech32m, deterministic, matches BeaconUtils)', () => {
    const { keys } = createIdentity();
    const addr = genesisP2trBeaconAddress(keys);
    // mutinynet uses TEST_NETWORK (tb HRP), taproot witness v1 -> tb1p...
    expect(addr.startsWith('tb1p')).toBe(true);
    // Deterministic and byte-identical to the BeaconUtils #initialP2TR derivation.
    const expected = p2tr(keys.publicKey.compressed.slice(1, 33), undefined, TEST_NETWORK).address;
    expect(addr).toBe(expected);
    expect(genesisP2trBeaconAddress(keys)).toBe(addr);
  });

  it('gives distinct addresses for distinct keys', () => {
    expect(genesisP2trBeaconAddress(createIdentity().keys)).not.toBe(
      genesisP2trBeaconAddress(createIdentity().keys),
    );
  });
});

describe('buildSingletonRegistrationTx', () => {
  const updateHash = updateHashBytes(SAMPLE);
  const utxo = { txid: 'bb'.repeat(32), vout: 0, value: 100_000 };

  it('builds a signed tx with change first and the OP_RETURN update-hash output LAST', () => {
    const { keys } = createIdentity();
    const tx = buildSingletonRegistrationTx({ keys, utxo, updateHash });
    expect(tx.txid).toMatch(/^[0-9a-f]{64}$/);
    expect(tx.rawHex).toMatch(/^[0-9a-f]+$/);
    expect(tx.fee).toBe(REGISTRATION_FEE_SATS);
    expect(tx.change).toBe(BigInt(utxo.value) - REGISTRATION_FEE_SATS);

    const hashHex = bytesToHex(updateHash);
    // OP_RETURN push-32 of the update hash (asm: OP_RETURN OP_PUSHBYTES_32 <hash>).
    const opReturn = `6a20${hashHex}`;
    expect(tx.rawHex).toContain(opReturn);
    // The P2TR change output (script 5120<32>) must precede the OP_RETURN: the
    // resolver's indexer reads only the LAST vout, so the signal has to be last.
    const changeIdx = tx.rawHex.indexOf('5120');
    expect(changeIdx).toBeGreaterThanOrEqual(0);
    expect(changeIdx).toBeLessThan(tx.rawHex.indexOf(opReturn));
  });

  it('rejects a UTXO too small to cover fee + dust-safe change', () => {
    const { keys } = createIdentity();
    expect(() =>
      buildSingletonRegistrationTx({ keys, utxo: { ...utxo, value: 500 }, updateHash }),
    ).toThrow(/too small/);
    // The threshold is fee + dust.
    expect(Number(MIN_REGISTRATION_FUNDING_SATS)).toBe(Number(REGISTRATION_FEE_SATS) + 330);
  });

  it('rejects a non-32-byte update hash', () => {
    const { keys } = createIdentity();
    expect(() =>
      buildSingletonRegistrationTx({ keys, utxo, updateHash: new Uint8Array(31) }),
    ).toThrow(/32 bytes/);
  });

  it('rejects a fee above the burn-guard cap (real-money fat-finger protection)', () => {
    const { keys } = createIdentity();
    const bigUtxo = { ...utxo, value: 10_000_000 };
    expect(() =>
      buildSingletonRegistrationTx({ keys, utxo: bigUtxo, updateHash, fee: MAX_REGISTRATION_FEE_SATS + 1n }),
    ).toThrow(/cap/);
    // The cap itself is still buildable.
    const tx = buildSingletonRegistrationTx({ keys, utxo: bigUtxo, updateHash, fee: MAX_REGISTRATION_FEE_SATS });
    expect(tx.fee).toBe(MAX_REGISTRATION_FEE_SATS);
  });

  it('rejects a non-positive fee (a zero-fee tx never relays)', () => {
    const { keys } = createIdentity();
    expect(() => buildSingletonRegistrationTx({ keys, utxo, updateHash, fee: 0n })).toThrow(/positive/);
    expect(() => buildSingletonRegistrationTx({ keys, utxo, updateHash, fee: -1000n })).toThrow(/positive/);
  });
});
