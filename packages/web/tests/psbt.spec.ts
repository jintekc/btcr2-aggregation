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
import { isAcceptedTapKeySig, validateSignedPsbt } from '../src/lib/psbt';
import { psbtVerdictMessage } from '../src/components/cohort/WalletSignPanel';

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

/**
 * What a TAMPERED return leg hands back: the same PSBT, signed under a non-default sighash
 * flavour. This is the exact shape of the attack in `05-AUDIT.md` entry 3: something between this
 * page and the signer rewrites `PSBT_IN_SIGHASH_TYPE`, the signer honours it, and the returned
 * `tapKeySig` is 65 bytes whose trailing byte is that flag. The witness-free bytes are untouched,
 * which is precisely why the template comparison cannot see this.
 */
function walletSignWithSighash(
  base64: string,
  flag: number,
  identity: Identity = OURS,
): Uint8Array {
  const tx = Transaction.fromPSBT(psbtBase64ToBytes(base64)!, { allowUnknownOutputs: true });
  tx.updateInput(0, { sighashType: flag });
  tx.sign(identity.keys.raw.secret!, [flag]);
  return tx.toPSBT(0);
}

/**
 * Rewrite ONLY the `tapKeySig` field's length prefix and value, leaving the rest of the PSBT a
 * valid serialization. This is the one way to carry an impossible signature length into the
 * validator at all: `@scure/btc-signer`'s `SignatureSchnorr` coder guards `updateInput` as well as
 * `fromPSBT`, so such an input cannot even be built in memory. Splicing the bytes keeps the parsed
 * transaction itself un-stubbed, which is what makes the assertion about signature LENGTH rather
 * than about a mock, and keeps it apart from generic PSBT corruption, which would return the same
 * verdict for an unrelated reason.
 *
 * The field is BIP-174 encoded as a one-byte key (`0x13`, PSBT_IN_TAP_KEY_SIG) with no key data,
 * then a compact-size value length. The marker is located by scanning, and an ambiguous scan (a
 * signature whose own bytes happen to contain the marker, which BIP340 aux randomness allows)
 * throws rather than guessing at which occurrence is the real field.
 */
function spliceTapKeySigLength(signed: Uint8Array, newLen: number): Uint8Array {
  const sigLen = Transaction.fromPSBT(signed, { allowUnknownOutputs: true }).getInput(0)!.tapKeySig!
    .length;
  const marker = [0x01, 0x13, sigLen];
  const at: number[] = [];
  for (let i = 0; i + marker.length <= signed.length; i++) {
    if (marker.every((b, j) => signed[i + j] === b)) {
      at.push(i);
    }
  }
  if (at.length !== 1) {
    throw new Error(`ambiguous tapKeySig marker: ${at.length} occurrences`);
  }
  const start = at[0] + marker.length;
  const sig = signed.slice(start, start + sigLen);
  const value =
    newLen <= sigLen
      ? sig.slice(0, newLen)
      : new Uint8Array([...sig, ...new Uint8Array(newLen - sigLen)]);
  return new Uint8Array([
    ...signed.slice(0, at[0]),
    0x01,
    0x13,
    newLen,
    ...value,
    ...signed.slice(start + sigLen),
  ]);
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

  it('returns the bad-sighash verdict for a signature that does not commit to the outputs', () => {
    // SIGHASH_NONE (0x02): the signature commits to the input set and to NO output, so any mempool
    // observer can respend the same input with the same witness and redirect the change. The
    // witness-free bytes are identical to the template, so this is invisible to check (2).
    const { base64, templateHex } = ourTemplate();
    const verdict = validateSignedPsbt(
      walletSignWithSighash(base64, 0x02),
      templateHex,
      REGISTRATION_FEE_SATS,
      NETWORK,
    );
    expect(verdict).toEqual({ ok: false, reason: 'bad-sighash' });
    // Refused BEFORE any finalize, so no broadcastable bytes are ever produced for it.
    expect('rawHex' in verdict).toBe(false);
    expect('txid' in verdict).toBe(false);
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
    // The verdict names the transaction id too, taken after finalize (asking earlier throws).
    expect(verdict.txid).toBe(local.txid);
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
      // The verdict names the fee it rejected, because the participant is asked to go check it.
    ).toEqual({ ok: false, reason: 'fee-out-of-band', feeSats: REGISTRATION_FEE_SATS * 5n });

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

/**
 * The accepted sighash set (05-AUDIT.md entry 3, both skeptics).
 *
 * The audit executed every flavour below against the shipped validator and every one returned ok
 * with a valid txid, so each row here is genuinely red before the gate lands. The taxonomy matters
 * because the flavours are dangerous in DIFFERENT ways, which is why the gate pins the accepted
 * set rather than blacklisting the one flag the original write-up named.
 */
describe('the accepted sighash set, one row per flavour the audit executed', () => {
  const REFUSED: [number, string][] = [
    [0x02, 'NONE commits to no output at all, so the change can be redirected by any observer'],
    [0x82, 'NONE|ANYONECANPAY frees the outputs AND lets an attacker append inputs'],
    [0x03, 'SINGLE commits to output 0 but leaves the OP_RETURN at vout 1 rewritable'],
    [0x83, 'SINGLE|ANYONECANPAY leaves the OP_RETURN rewritable and the input set open'],
    [0x81, 'ALL|ANYONECANPAY commits to the outputs but lets an attacker append inputs'],
  ];

  for (const [flag, why] of REFUSED) {
    it(`refuses 0x${flag.toString(16).padStart(2, '0')}, because ${why}`, () => {
      const { base64, templateHex } = ourTemplate();
      const verdict = validateSignedPsbt(
        walletSignWithSighash(base64, flag),
        templateHex,
        REGISTRATION_FEE_SATS,
        NETWORK,
      );
      // The REASON, not merely not-ok: reclassifying one of these as mismatched or unparseable
      // would send the participant to re-export a transaction that is in fact fine.
      expect(verdict).toEqual({ ok: false, reason: 'bad-sighash' });
      expect('rawHex' in verdict).toBe(false);
    });
  }

  it('accepts a 64-byte signature, which is SIGHASH_DEFAULT and the common wallet default', () => {
    const { base64, templateHex } = ourTemplate();
    const signed = walletSign(base64);
    // The shape really is the one this row claims to cover.
    expect(
      Transaction.fromPSBT(signed, { allowUnknownOutputs: true }).getInput(0)!.tapKeySig!.length,
    ).toBe(64);
    const verdict = validateSignedPsbt(signed, templateHex, REGISTRATION_FEE_SATS, NETWORK);
    expect(verdict.ok).toBe(true);
    expect(verdict.ok && verdict.txid).toBeTruthy();
  });

  it('accepts a 65-byte signature whose flag is an explicit SIGHASH_ALL', () => {
    // A wallet that always writes the flag byte must not be locked out: 0x01 commits to every
    // output, which is exactly the property the gate is protecting.
    const { base64, templateHex } = ourTemplate();
    const signed = walletSignWithSighash(base64, 0x01);
    const sig = Transaction.fromPSBT(signed, { allowUnknownOutputs: true }).getInput(0)!.tapKeySig!;
    expect(sig.length).toBe(65);
    expect(sig[64]).toBe(0x01);
    const verdict = validateSignedPsbt(signed, templateHex, REGISTRATION_FEE_SATS, NETWORK);
    expect(verdict.ok).toBe(true);
    expect(verdict.ok && verdict.txid).toBeTruthy();
  });

  it('reports the library unparseable verdict for a tapKeySig of an impossible length', () => {
    // Scope, stated so this row is not read as more than it is: the refusal below comes from
    // `@scure/btc-signer`'s OWN `SignatureSchnorr` field coder ("Schnorr signature should be 64 or
    // 65 bytes long"), which guards both `Transaction.fromPSBT` and `updateInput`. So a 63- or
    // 66-byte signature never reaches this app's gate, and its honest public-API outcome is the
    // EXISTING unparseable verdict, not the new one. The app's own default-refuse branch is pinned
    // directly against `isAcceptedTapKeySig` below instead.
    //
    // The bytes are spliced at the serialization layer rather than through a stubbed transaction:
    // ONLY the tapKeySig field's length prefix and value are rewritten, so what this row exercises
    // really is signature length and not generic PSBT corruption.
    const { base64, templateHex } = ourTemplate();
    for (const badLen of [63, 66]) {
      const spliced = spliceTapKeySigLength(walletSign(base64), badLen);
      expect(() => Transaction.fromPSBT(spliced, { allowUnknownOutputs: true })).toThrow(
        /Schnorr signature should be 64 or 65 bytes long/,
      );
      expect(validateSignedPsbt(spliced, templateHex, REGISTRATION_FEE_SATS, NETWORK)).toEqual({
        ok: false,
        reason: 'unparseable',
      });
    }
  });
});

/**
 * The rule itself, asserted where its default-refuse branch is actually reachable.
 *
 * Extracted and exported for exactly this reason: the library rejects a non-64-or-65-byte
 * tapKeySig before this app ever sees it, so "a length nobody enumerated is refused" cannot be
 * pinned end to end. It is still a real property and it gets a real pin, just an honest one that
 * does not pretend to be an end-to-end path. This is also the single definition of the rule, so a
 * future inline copy beside it would be caught by these rows going stale rather than silently
 * diverging.
 */
describe('isAcceptedTapKeySig', () => {
  const sigOf = (len: number, last?: number): Uint8Array => {
    const bytes = new Uint8Array(len).fill(0x7f);
    if (last !== undefined && len > 0) {
      bytes[len - 1] = last;
    }
    return bytes;
  };

  it('accepts the two legitimate shapes and nothing else', () => {
    // 64 bytes is SIGHASH_DEFAULT: no flag byte at all, so there is nothing to be wrong.
    expect(isAcceptedTapKeySig(sigOf(64))).toBe(true);
    // 65 bytes carries an explicit flag, and only ALL commits to every output.
    expect(isAcceptedTapKeySig(sigOf(65, 0x01))).toBe(true);
    for (const flag of [0x02, 0x03, 0x81, 0x82, 0x83]) {
      expect(isAcceptedTapKeySig(sigOf(65, flag))).toBe(false);
    }
  });

  it('refuses by DEFAULT, so a length nobody enumerated is not silently blessed', () => {
    for (const len of [0, 63, 66]) {
      expect(isAcceptedTapKeySig(sigOf(len))).toBe(false);
    }
    // And every remaining 65-byte flag byte, not just the five the audit executed: the rule is a
    // positive accepted set, so anything outside it is refused without needing enumeration.
    for (let flag = 0x00; flag <= 0xff; flag++) {
      expect(isAcceptedTapKeySig(sigOf(65, flag))).toBe(flag === 0x01);
    }
  });
});

describe('psbtVerdictMessage', () => {
  it('gives each of the six verdicts its OWN sentence, and none before anything comes back', () => {
    const { base64, templateHex } = ourTemplate();
    const ok = validateSignedPsbt(walletSign(base64), templateHex, REGISTRATION_FEE_SATS, NETWORK);
    const messages = [
      psbtVerdictMessage(ok),
      psbtVerdictMessage({ ok: false, reason: 'unsigned' }),
      psbtVerdictMessage({ ok: false, reason: 'mismatched' }),
      psbtVerdictMessage({ ok: false, reason: 'unparseable' }),
      psbtVerdictMessage({ ok: false, reason: 'fee-out-of-band', feeSats: 9000n }),
      psbtVerdictMessage({ ok: false, reason: 'bad-sighash' }),
    ];
    // Six outcomes, six distinct strings: a collapsed pair would tell a participant the wrong
    // thing about a transaction they are about to broadcast. The bad-sighash sentence in
    // particular must NOT collapse onto the unparseable one, which is what the switch's `default`
    // arm would do: that PSBT parses perfectly, and saying otherwise sends the participant to
    // re-export instead of to re-sign.
    expect(new Set(messages).size).toBe(6);
    expect(messages[5]).not.toBe(messages[3]);
    for (const m of messages) {
      expect(m).toBeTruthy();
      // The UI-SPEC copy contract: no long dash in any authored string.
      expect(m).not.toMatch(/—/);
    }
    // Nothing returned yet is not an error state.
    expect(psbtVerdictMessage(null)).toBeNull();
    // The fee sentence names the fee it rejected AND the fee it expected.
    expect(messages[4]).toContain('9000 sats');
    expect(messages[4]).toContain(`${REGISTRATION_FEE_SATS.toString()} sats`);
    // The success sentence names what the transaction pays and what it costs.
    expect(messages[0]).toContain((BigInt(UTXO.value) - REGISTRATION_FEE_SATS).toString());
    expect(messages[0]).toContain(`${REGISTRATION_FEE_SATS.toString()} sat fee`);
  });
});
