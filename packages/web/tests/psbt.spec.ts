import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { Transaction } from '@scure/btc-signer';
import { describe, expect, it } from 'vitest';
import {
  buildRegistrationTemplate,
  buildSingletonRegistrationTx,
  createIdentity,
  exportRegistrationPsbt,
  genesisP2trBeaconAddress,
  psbtBase64ToBytes,
  psbtBytesToBase64,
  REGISTRATION_FEE_SATS,
  resolveNetwork,
  type Identity,
} from '@btcr2-aggregation/shared';
import { validateSignedPsbt } from '../src/lib/psbt';

/**
 * The returned-PSBT validator (PART-06, D-21, UI-SPEC E17).
 *
 * Every row below builds a REAL transaction and drives it through the real validator: each of the
 * five verdicts is produced by its own genuine input, never by a mock, because the whole point of
 * this predicate is that it can tell real transactions apart. A mocked "mismatched" would prove
 * nothing about whether a tampered PSBT is actually caught.
 *
 * The validator is the last thing standing between an untrusted PSBT and a broadcast, so the
 * negative rows matter more than the positive one: a PSBT for a DIFFERENT transaction, an unsigned
 * PSBT, a fee outside the expected band, and bytes that are not a PSBT at all.
 */

const UPDATE_HASH = hexToBytes('ab'.repeat(32));
const OTHER_UPDATE_HASH = hexToBytes('cd'.repeat(32));
const UTXO = { txid: 'bb'.repeat(32), vout: 0, value: 100_000 };
const NETWORK = resolveNetwork('mutinynet');

/** This participant, and a second one standing in for anyone else's transaction. */
const OURS: Identity = createIdentity();
const THEIRS: Identity = createIdentity();

/** The app's own template for the fixture, plus its comparison anchor. */
function ourTemplate(): { base64: string; templateHex: string } {
  return exportRegistrationPsbt({
    keys: OURS.keys,
    utxo: UTXO,
    updateHash: UPDATE_HASH,
    network: NETWORK,
  });
}

/** What an external wallet hands back: the same PSBT, signed. */
function walletSign(base64: string, identity: Identity = OURS): Uint8Array {
  const tx = Transaction.fromPSBT(psbtBase64ToBytes(base64)!, { allowUnknownOutputs: true });
  tx.sign(identity.keys.raw.secret!);
  return tx.toPSBT(0);
}

describe('validateSignedPsbt', () => {
  it('returns the unparseable verdict for anything that is not a PSBT', () => {
    const { templateHex } = ourTemplate();
    for (const bytes of [
      new Uint8Array(0),
      new Uint8Array([1, 2, 3]),
      hexToBytes('deadbeef'.repeat(20)),
      // A raw signed transaction is not a PSBT either, and it is a plausible mistake.
      hexToBytes(
        buildSingletonRegistrationTx({
          keys: OURS.keys,
          utxo: UTXO,
          updateHash: UPDATE_HASH,
          network: NETWORK,
        }).rawHex,
      ),
    ]) {
      const verdict = validateSignedPsbt(bytes, templateHex, REGISTRATION_FEE_SATS, NETWORK);
      expect(verdict).toEqual({ ok: false, reason: 'unparseable' });
    }
  });

  it('returns the mismatched verdict for a valid PSBT for a DIFFERENT transaction', () => {
    const { templateHex } = ourTemplate();

    // A different update hash: the OP_RETURN payload would announce someone else's update.
    const otherHash = exportRegistrationPsbt({
      keys: OURS.keys,
      utxo: UTXO,
      updateHash: OTHER_UPDATE_HASH,
      network: NETWORK,
    });
    expect(
      validateSignedPsbt(walletSign(otherHash.base64), templateHex, REGISTRATION_FEE_SATS, NETWORK),
    ).toEqual({ ok: false, reason: 'mismatched' });

    // A different key: the change would go to someone else's address.
    const otherKey = exportRegistrationPsbt({
      keys: THEIRS.keys,
      utxo: UTXO,
      updateHash: UPDATE_HASH,
      network: NETWORK,
    });
    expect(
      validateSignedPsbt(
        walletSign(otherKey.base64, THEIRS),
        templateHex,
        REGISTRATION_FEE_SATS,
        NETWORK,
      ),
    ).toEqual({ ok: false, reason: 'mismatched' });

    // A different UTXO: the same announcement spending a coin this page never selected.
    const otherUtxo = exportRegistrationPsbt({
      keys: OURS.keys,
      utxo: { ...UTXO, txid: 'cc'.repeat(32) },
      updateHash: UPDATE_HASH,
      network: NETWORK,
    });
    expect(
      validateSignedPsbt(walletSign(otherUtxo.base64), templateHex, REGISTRATION_FEE_SATS, NETWORK),
    ).toEqual({ ok: false, reason: 'mismatched' });
  });

  it('returns the unsigned verdict for the app own template, without attempting a finalize', () => {
    const { base64, templateHex } = ourTemplate();
    const verdict = validateSignedPsbt(
      psbtBase64ToBytes(base64)!,
      templateHex,
      REGISTRATION_FEE_SATS,
      NETWORK,
    );
    // finalize() on an unsigned taproot input throws; the ordering must reach this branch first.
    expect(verdict).toEqual({ ok: false, reason: 'unsigned' });
  });

  it('returns the ok verdict for a correctly signed round trip, despite differing raw hex', () => {
    const { base64, templateHex } = ourTemplate();
    const local = buildSingletonRegistrationTx({
      keys: OURS.keys,
      utxo: UTXO,
      updateHash: UPDATE_HASH,
      network: NETWORK,
    });

    const verdict = validateSignedPsbt(
      walletSign(base64),
      templateHex,
      REGISTRATION_FEE_SATS,
      NETWORK,
    );
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) {
      return;
    }
    expect(verdict.feeSats).toBe(REGISTRATION_FEE_SATS);
    expect(verdict.paysSats).toBe(BigInt(UTXO.value) - REGISTRATION_FEE_SATS);
    // Derived from the transaction, and it really is this participant's own beacon address.
    expect(verdict.toAddress).toBe(genesisP2trBeaconAddress(OURS.keys, NETWORK));
    // The extractable raw hex is a DIFFERENT byte string from the locally-signed one and yet the
    // SAME transaction: this is the whole reason the validator compares witness-free bytes.
    expect(verdict.rawHex).not.toBe(local.rawHex);
    expect(Transaction.fromRaw(hexToBytes(verdict.rawHex), { allowUnknownOutputs: true }).id).toBe(
      local.txid,
    );
  });

  it('returns the fee-out-of-band verdict when the transaction pays more than expected', () => {
    // Built and validated against ITS OWN template, so the fee check is what rejects it rather
    // than the byte comparison: this is the defence-in-depth branch, reachable on its own terms.
    const fat = exportRegistrationPsbt({
      keys: OURS.keys,
      utxo: UTXO,
      updateHash: UPDATE_HASH,
      network: NETWORK,
      fee: REGISTRATION_FEE_SATS * 5n,
    });
    expect(
      validateSignedPsbt(walletSign(fat.base64), fat.templateHex, REGISTRATION_FEE_SATS, NETWORK),
    ).toEqual({ ok: false, reason: 'fee-out-of-band' });

    // A fee AT the expected value is in band, not out of it.
    const exact = ourTemplate();
    expect(
      validateSignedPsbt(walletSign(exact.base64), exact.templateHex, REGISTRATION_FEE_SATS, NETWORK)
        .ok,
    ).toBe(true);
  });

  it('never throws, for any input, including a template hex that is nonsense', () => {
    const { base64, templateHex } = ourTemplate();
    const signed = walletSign(base64);
    const inputs: [Uint8Array, string][] = [
      [new Uint8Array(0), templateHex],
      [new Uint8Array(0), ''],
      [signed, ''],
      [signed, 'not hex at all'],
      [signed, templateHex.toUpperCase()],
      [psbtBase64ToBytes(base64)!, templateHex],
      [signed, templateHex],
    ];
    for (const [bytes, hex] of inputs) {
      expect(() => validateSignedPsbt(bytes, hex, REGISTRATION_FEE_SATS, NETWORK)).not.toThrow();
    }
  });

  it('compares the witness-free bytes, so the template hex it matches is the exported one', () => {
    // Pins the anchor's identity rather than trusting the two call sites to agree: the hex the
    // export reports IS the parsed transaction's unsignedTx, on both sides of the round trip.
    const { base64, templateHex } = ourTemplate();
    expect(templateHex).toBe(
      bytesToHex(
        buildRegistrationTemplate({
          keys: OURS.keys,
          utxo: UTXO,
          updateHash: UPDATE_HASH,
          network: NETWORK,
        }).unsignedTx,
      ),
    );
    // ONE signing, reused: two signings of the same transaction differ (aux randomness), so
    // comparing two separate calls would compare two different byte strings.
    const signed = walletSign(base64);
    const returned = Transaction.fromPSBT(signed, { allowUnknownOutputs: true });
    expect(bytesToHex(returned.unsignedTx)).toBe(templateHex);
    // And the returned PSBT re-serializes to base64 the app can read back (upload/paste parity).
    expect(psbtBase64ToBytes(psbtBytesToBase64(signed))).toEqual(signed);
  });
});
