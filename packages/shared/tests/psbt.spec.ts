import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { Transaction } from '@scure/btc-signer';
import { describe, expect, it } from 'vitest';
import {
  buildRegistrationTemplate,
  buildSingletonRegistrationTx,
  exportRegistrationPsbt,
  MAX_REGISTRATION_FEE_SATS,
  psbtBase64ToBytes,
  psbtBytesToBase64,
  REGISTRATION_FEE_SATS,
  resolveNetwork,
} from '../src/index.js';

/**
 * The PSBT round trip for the KEY first-update registration transaction (PART-06, D-21).
 *
 * These rows exist because ONE property decides the whole validation design on the browser side,
 * and it is counter-intuitive: an externally-signed transaction has an IDENTICAL transaction id
 * but DIFFERENT raw hex. BIP340 signing mixes in auxiliary randomness, so two signatures over the
 * same sighash differ byte for byte; the transaction id is taken over the witness-free
 * serialization, so it does not move. A validator that compared raw hex would therefore reject
 * every legitimately signed PSBT, and a spec that asserted raw-hex equality would be asserting
 * something false. Both facts are pinned below so neither can be re-derived by guesswork later.
 *
 * The second trap is `Transaction.id`, which THROWS on an unfinalized transaction. The browser
 * validator must never ask for it before finalizing, so this file proves the throw rather than
 * describing it.
 *
 * Test files live outside `src/` by project convention; this is the first spec under
 * `packages/shared/tests/`, following the `packages/service/tests/` and `packages/web/tests/`
 * precedent from Phase 4 and 05-10.
 */

/**
 * A FIXED secret, so every value below is reproducible. `createIdentity()` mints a random key,
 * which is right for the shipped specs but useless for a golden comparison.
 */
const SECRET_HEX = '11'.repeat(32);
const UPDATE_HASH = hexToBytes('ab'.repeat(32));
const UTXO = { txid: 'bb'.repeat(32), vout: 0, value: 100_000 };

function fixedKeys(): SchnorrKeyPair {
  return new SchnorrKeyPair({ secretKey: hexToBytes(SECRET_HEX) });
}

/** What an external wallet does: parse the PSBT, sign it, hand the PSBT back. */
function signLikeAWallet(base64: string): string {
  const bytes = psbtBase64ToBytes(base64);
  expect(bytes).not.toBeNull();
  const tx = Transaction.fromPSBT(bytes!, { allowUnknownOutputs: true });
  tx.sign(hexToBytes(SECRET_HEX));
  return psbtBytesToBase64(tx.toPSBT(0));
}

describe('buildRegistrationTemplate', () => {
  it('carries every guard the signing builder applies, with identical messages', () => {
    const keys = fixedKeys();
    expect(() =>
      buildRegistrationTemplate({ keys, utxo: UTXO, updateHash: UPDATE_HASH, fee: 0n }),
    ).toThrow(/fee must be positive, got 0 sats \(a zero-fee tx never relays\)/);
    expect(() =>
      buildRegistrationTemplate({ keys, utxo: UTXO, updateHash: UPDATE_HASH, fee: -1000n }),
    ).toThrow(/fee must be positive/);
    expect(() =>
      buildRegistrationTemplate({
        keys,
        utxo: { ...UTXO, value: 10_000_000 },
        updateHash: UPDATE_HASH,
        fee: MAX_REGISTRATION_FEE_SATS + 1n,
      }),
    ).toThrow(/refusing to burn the funding UTXO/);
    expect(() =>
      buildRegistrationTemplate({ keys, utxo: { ...UTXO, value: 500 }, updateHash: UPDATE_HASH }),
    ).toThrow(/funding UTXO \(500 sats\) is too small/);
    expect(() =>
      buildRegistrationTemplate({ keys, utxo: UTXO, updateHash: new Uint8Array(31) }),
    ).toThrow(/updateHash must be 32 bytes, got 31/);
  });

  it('builds the same body the signing builder builds: change first, OP_RETURN last', () => {
    const template = buildRegistrationTemplate({
      keys: fixedKeys(),
      utxo: UTXO,
      updateHash: UPDATE_HASH,
    });
    expect(template.outputsLength).toBe(2);
    expect(template.inputsLength).toBe(1);
    expect(template.fee).toBe(REGISTRATION_FEE_SATS);
    expect(template.getOutput(0).amount).toBe(BigInt(UTXO.value) - REGISTRATION_FEE_SATS);
    // The resolver's beacon-signal indexer reads only the FINAL vout, so the OP_RETURN is last.
    const hex = bytesToHex(template.unsignedTx);
    expect(hex.indexOf('5120')).toBeLessThan(hex.indexOf(`6a20${bytesToHex(UPDATE_HASH)}`));
  });
});

describe('exportRegistrationPsbt', () => {
  it('serializes a PSBT that parses back to the exact template it reports', () => {
    const keys = fixedKeys();
    const { base64, templateHex } = exportRegistrationPsbt({
      keys,
      utxo: UTXO,
      updateHash: UPDATE_HASH,
    });
    // A BIP-174 PSBT starts with the magic bytes `psbt\xff`, which is `cHNidP8` in base64.
    expect(base64.startsWith('cHNidP8')).toBe(true);

    const bytes = psbtBase64ToBytes(base64);
    expect(bytes).not.toBeNull();
    const parsed = Transaction.fromPSBT(bytes!, { allowUnknownOutputs: true });
    // The comparison anchor the browser validator uses: witness-free unsigned bytes, NOT raw hex.
    expect(bytesToHex(parsed.unsignedTx)).toBe(templateHex);
    expect(templateHex).toBe(
      bytesToHex(buildRegistrationTemplate({ keys, utxo: UTXO, updateHash: UPDATE_HASH }).unsignedTx),
    );
    // The handed-out PSBT is UNSIGNED: that is the entire point of handing it out.
    expect(parsed.getInput(0).tapKeySig).toBeUndefined();
  });

  it('tolerates whitespace on the way back in and refuses non-base64 text', () => {
    const { base64 } = exportRegistrationPsbt({
      keys: fixedKeys(),
      utxo: UTXO,
      updateHash: UPDATE_HASH,
    });
    // A pasted PSBT arrives wrapped, indented, or with a trailing newline.
    const wrapped = `  ${base64.slice(0, 40)}\n${base64.slice(40)}\n`;
    expect(psbtBase64ToBytes(wrapped)).toEqual(psbtBase64ToBytes(base64));
    // A decode failure is a returned null, never a throw: the caller turns it into a verdict.
    expect(psbtBase64ToBytes('not a psbt at all !!!')).toBeNull();
    expect(psbtBase64ToBytes('')).toBeNull();
  });
});

describe('the wallet round trip', () => {
  it('reproduces the SAME transaction id as the fully local path', () => {
    const keys = fixedKeys();
    const local = buildSingletonRegistrationTx({ keys, utxo: UTXO, updateHash: UPDATE_HASH });
    const { base64 } = exportRegistrationPsbt({ keys, utxo: UTXO, updateHash: UPDATE_HASH });

    const returned = signLikeAWallet(base64);
    const app = Transaction.fromPSBT(psbtBase64ToBytes(returned)!, { allowUnknownOutputs: true });
    app.finalize();

    expect(app.id).toBe(local.txid);
  });

  it('produces DIFFERENT raw hex from the local path, which is why raw hex must never be compared', () => {
    const keys = fixedKeys();
    const local = buildSingletonRegistrationTx({ keys, utxo: UTXO, updateHash: UPDATE_HASH });
    const { base64 } = exportRegistrationPsbt({ keys, utxo: UTXO, updateHash: UPDATE_HASH });

    const app = Transaction.fromPSBT(psbtBase64ToBytes(signLikeAWallet(base64))!, {
      allowUnknownOutputs: true,
    });
    app.finalize();
    const rawHex = bytesToHex(app.extract());

    // Same transaction, different bytes: BIP340 auxiliary randomness lands in the WITNESS, and
    // the transaction id is taken over the witness-free serialization.
    expect(rawHex).not.toBe(local.rawHex);
    expect(Transaction.fromRaw(hexToBytes(rawHex), { allowUnknownOutputs: true }).id).toBe(
      local.txid,
    );
  });

  it('refuses to name a transaction id before finalizing, so the validator must not ask', () => {
    const { base64 } = exportRegistrationPsbt({
      keys: fixedKeys(),
      utxo: UTXO,
      updateHash: UPDATE_HASH,
    });
    const signed = Transaction.fromPSBT(psbtBase64ToBytes(signLikeAWallet(base64))!, {
      allowUnknownOutputs: true,
    });
    expect(() => signed.id).toThrow(/not finalized/);
    // The witness-free bytes and the fee ARE readable before finalizing, which is what makes the
    // validator's check ordering (template match, then signature, then fee, then finalize) legal.
    expect(bytesToHex(signed.unsignedTx)).toHaveLength(bytesToHex(signed.unsignedTx).length);
    expect(signed.fee).toBe(REGISTRATION_FEE_SATS);
  });

  it('names the participant registration address from the transaction itself', () => {
    const keys = fixedKeys();
    const network = resolveNetwork('mutinynet');
    const { base64 } = exportRegistrationPsbt({
      keys,
      utxo: UTXO,
      updateHash: UPDATE_HASH,
      network,
    });
    const signed = Transaction.fromPSBT(psbtBase64ToBytes(signLikeAWallet(base64))!, {
      allowUnknownOutputs: true,
    });
    // The success copy claims "to your registration address"; it must read that from the signed
    // transaction rather than from remembered state.
    expect(signed.getOutputAddress(0, network.scureNetwork)).toBe(
      'tb1p9fjtrm3nwhemkjek0wxtswz2glmneu33w9lcylrvd7alttk0psmqds9pcj',
    );
  });
});
