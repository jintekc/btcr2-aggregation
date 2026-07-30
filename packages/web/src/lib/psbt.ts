import { bytesToHex } from '@noble/hashes/utils';
import { Transaction } from '@scure/btc-signer';
import type { NetworkConfig } from '@btcr2-aggregation/shared';

/**
 * The verdict on a PSBT handed back by a participant's own wallet (PART-06, D-21, UI-SPEC E17).
 *
 * A discriminated union rather than a boolean plus a message, so every reason maps one to one onto
 * the sentence the participant is shown and a new outcome cannot be added without the renderer
 * having to answer for it. The ok variant carries what the success copy claims, all of it read
 * from the returned transaction rather than from remembered state.
 */
export type PsbtVerdict =
  | {
      ok: true;
      /** The fee the returned transaction actually pays, in satoshis. */
      feeSats: bigint;
      /** What output 0 pays back to the registration address, in satoshis. */
      paysSats: bigint;
      /** The address output 0 pays, decoded from the transaction itself. */
      toAddress: string | undefined;
      /** The network-serialized signed transaction, ready for the shipped broadcast call. */
      rawHex: string;
      /**
       * The transaction id. Readable only here, because it is taken AFTER `finalize()`; asking
       * for it any earlier throws (see the second trap below).
       */
      txid: string;
    }
  | { ok: false; reason: 'unparseable' | 'mismatched' | 'unsigned' | 'bad-sighash' }
  // Carries the fee it rejected, because the sentence for this one names the actual number: a
  // participant cannot check a fee in their wallet without being told which fee we objected to.
  | { ok: false; reason: 'fee-out-of-band'; feeSats: bigint };

/**
 * Judge a returned PSBT against the exact template this page created.
 *
 * Pure, DOM-free and exported so the panel renders it and the predicate is unit-testable, in the
 * shape of this codebase's other exported classifiers (`terminalReason` in
 * {@link file://../stores/participant.ts}, `classifyEndpoint` in {@link file://./esplora.ts}): it
 * returns a verdict for every input and throws for none, because the caller's job is to show a
 * sentence, not to handle an exception.
 *
 * On this path the app never signs; the participant's own wallet does. The app's duty is the
 * REVERSE of signing, and it is the only thing standing between an untrusted PSBT and a
 * broadcast: prove that what came back is byte for byte the transaction that went out
 * (T-05-12-01). The comparison anchor is the WITNESS-FREE serialization, so it pins the version,
 * the inputs, the outputs, the amounts, the scripts and the locktime: a tampered input, output,
 * amount, address or OP_RETURN payload all move those bytes and are all caught by that one
 * comparison. What it provably cannot see is the SIGHASH FLAG, which lives in the PSBT field and
 * in the witness and in neither of those bytes, so it gets its own check below
 * (`.planning/phases/05-operator-cohort-lifecycle-control/05-AUDIT.md` entry 3, where a
 * SIGHASH_NONE-signed PSBT was executed against this validator and returned ok with a valid txid).
 * Those are the two dimensions, and this docstring names both rather than claiming the byte
 * comparison closes everything.
 *
 * TWO traps decide the implementation and both are counter-intuitive enough to state here.
 *
 * FIRST, raw hex is NEVER compared. BIP340 signing mixes in auxiliary randomness, so a signature
 * over the same sighash differs on every signing; the transaction id excludes the witness, so an
 * externally-signed transaction has an IDENTICAL transaction id and DIFFERENT raw hex. Comparing
 * `extract()` output, or the locally-signed `rawHex`, would reject every legitimately signed PSBT.
 * The comparison anchor is `unsignedTx`, the witness-free serialization, which is stable across
 * signing (05-RESEARCH Pitfall 9; both halves asserted in `packages/shared/tests/psbt.spec.ts`).
 *
 * SECOND, `Transaction.id` THROWS on an unfinalized transaction, so it is never requested before
 * `finalize()`. `unsignedTx` and `fee` are both readable beforehand, which is exactly what makes
 * the check ordering below legal.
 *
 * The order is fixed and each step exists because the next one cannot run without it:
 *
 *  1. parse - anything that is not a PSBT throws inside `fromPSBT`, so nothing else is knowable;
 *  2. template match - the load-bearing check; a strict byte comparison already subsumes the fee
 *     check, since any fee change moves the change output and therefore the bytes;
 *  3. signature presence, then the sighash pin - `finalize()` throws `finalize/taproot: unknown
 *     input` on an unsigned input, so an unsigned PSBT must be recognized BEFORE any finalize is
 *     attempted, and a signature that does not commit to this transaction's outputs must be
 *     refused before one too, so no broadcastable bytes are ever produced for it;
 *  4. fee band - defence in depth, kept as its own branch so an out-of-band fee gets its own
 *     sentence rather than being folded into the generic mismatch;
 *  5. finalize and extract - only now, and only for a PSBT that has passed everything above.
 *
 * `allowUnknownOutputs` is passed on parse because the registration transaction carries an
 * `OP_RETURN` output the library treats as unknown; it is the same flag the builder uses.
 */
export function validateSignedPsbt(
  psbtBytes: Uint8Array,
  templateHex: string,
  expectedFeeSats: bigint,
  network: NetworkConfig,
): PsbtVerdict {
  let tx: Transaction;
  try {
    tx = Transaction.fromPSBT(psbtBytes, { allowUnknownOutputs: true });
  } catch {
    return { ok: false, reason: 'unparseable' };
  }

  try {
    // (2) The witness-free bytes, never the raw hex. See the trap note above.
    if (bytesToHex(tx.unsignedTx) !== templateHex) {
      return { ok: false, reason: 'mismatched' };
    }
    // (3) No taproot key signature means finalize would throw, so say so instead.
    const tapKeySig = tx.getInput(0)?.tapKeySig;
    if (!tapKeySig) {
      return { ok: false, reason: 'unsigned' };
    }
    // (3b) BIP341: a 64-byte signature is SIGHASH_DEFAULT; a 65-byte one carries an explicit flag
    // in its trailing byte, and only SIGHASH_ALL (0x01) commits to every output. Anything else is
    // refused HERE, before any finalize, so a signature that does not bind this transaction's
    // outputs never becomes broadcastable hex.
    if (tapKeySig.length === 65 && tapKeySig[64] !== 0x01) {
      return { ok: false, reason: 'bad-sighash' };
    }
    // (4) The template match already pins the fee; this branch survives so a looser future
    // comparison, or a template built with a different fee, still gets its own honest sentence.
    if (tx.fee > expectedFeeSats) {
      return { ok: false, reason: 'fee-out-of-band', feeSats: tx.fee };
    }
    // (5) Everything above passed, so this transaction is the one this page built.
    tx.finalize();
    return {
      ok: true,
      feeSats: tx.fee,
      paysSats: tx.getOutput(0).amount ?? 0n,
      toAddress: tx.getOutputAddress(0, network.scureNetwork),
      rawHex: bytesToHex(tx.extract()),
      txid: tx.id,
    };
  } catch {
    // A PSBT that parsed but cannot be read or finalized is still just a PSBT this app will not
    // broadcast. Reporting it as unparseable keeps the promise that no input escapes as a throw.
    return { ok: false, reason: 'unparseable' };
  }
}
