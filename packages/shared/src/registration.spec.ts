import { canonicalHash } from '@did-btcr2/common';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { p2tr, Transaction } from '@scure/btc-signer';
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

  /**
   * The before-and-after pin for the PART-06 template split (05-12 task 1).
   *
   * Every value below was captured by RUNNING the builder before it was split, against a fixed
   * secret and a fixed UTXO, so the refactor is pinned rather than assumed. It is deliberately
   * green on both sides of the change: that is what makes it a regression pin.
   *
   * One value cannot be pinned as a literal and it is worth saying why rather than quietly
   * omitting it. The signed `rawHex` is NOT reproducible: BIP340 signing mixes in auxiliary
   * randomness, so two runs over the same transaction produce different witnesses. Everything the
   * raw hex commits to IS deterministic though, so the pin re-parses the signed transaction and
   * asserts its witness-free bytes and its transaction id, which is strictly what "the same
   * transaction" means here. See `packages/shared/tests/psbt.spec.ts` for the same fact asserted
   * from the other direction.
   */
  describe('the template split is behavior-preserving (golden pin, captured pre-refactor)', () => {
    const FIXED_SECRET_HEX = '11'.repeat(32);
    const FIXED_UPDATE_HASH = hexToBytes('ab'.repeat(32));
    const FIXED_UTXO = { txid: 'bb'.repeat(32), vout: 0, value: 100_000 };
    const GOLDEN_TXID = '6ac4b0669c4ef787484fe94486d232ef9cbb70b4f1b2548727e94289e13fd2c2';
    // Version 2, the fixed input, then change (99000 sats to the P2TR beacon script) FIRST and
    // the zero-value `OP_RETURN OP_PUSHBYTES_32 <updateHash>` LAST. The two long runs are written
    // as repeats of the fixed inputs above rather than transcribed, so a typo cannot fake a pass.
    const GOLDEN_TEMPLATE_HEX =
      `0200000001${'bb'.repeat(32)}0000000000ffffffff` +
      '02b882010000000000225120' +
      '2a64b1ee3375f3bb4b367b8cb8384a47f73cf231717f827c6c6fbbf5aecf0c36' +
      `0000000000000000226a20${'ab'.repeat(32)}00000000`;

    it('returns the same transaction id, fee, change and transaction body for a fixed input', () => {
      const keys = new SchnorrKeyPair({ secretKey: hexToBytes(FIXED_SECRET_HEX) });
      const tx = buildSingletonRegistrationTx({
        keys,
        utxo: FIXED_UTXO,
        updateHash: FIXED_UPDATE_HASH,
      });

      expect(tx.txid).toBe(GOLDEN_TXID);
      expect(tx.fee).toBe(REGISTRATION_FEE_SATS);
      expect(tx.change).toBe(BigInt(FIXED_UTXO.value) - REGISTRATION_FEE_SATS);

      const parsed = Transaction.fromRaw(hexToBytes(tx.rawHex), { allowUnknownOutputs: true });
      expect(parsed.id).toBe(GOLDEN_TXID);
      expect(bytesToHex(parsed.unsignedTx)).toBe(GOLDEN_TEMPLATE_HEX);
    });
  });
});
