import { LocalSigner, SchnorrKeyPair } from '@did-btcr2/keypair';
import { DidBtcr2, Resolver, Updater } from '@did-btcr2/method';
import { bytesToHex } from '@noble/hashes/utils';
import { Script, Transaction, p2tr } from '@scure/btc-signer';
import * as musig2 from '@scure/btc-signer/musig2';
import type { CohortConfig, SigningTxData } from '@did-btcr2/aggregation/service';

export type { CohortConfig, SigningTxData } from '@did-btcr2/aggregation/service';

/**
 * Bitcoin network label used for every DID and cohort config in this app. In M1
 * this is cosmetic (no chain interaction); it becomes load-bearing in M3 when the
 * fixture beacon tx is swapped for a real mutinynet transaction.
 */
export const NETWORK = 'mutinynet';

/** A did:btcr2 KEY identity: the DID string paired with its Schnorr keypair. */
export interface Identity {
  did: string;
  keys: SchnorrKeyPair;
}

/** Generate a fresh did:btcr2 KEY identity on {@link NETWORK}. */
export function createIdentity(): Identity {
  const keys = SchnorrKeyPair.generate();
  const did = DidBtcr2.create(keys.publicKey.compressed, { idType: 'KEY', network: NETWORK });
  return { did, keys };
}

/**
 * Reconstruct a did:btcr2 KEY identity from its 32-byte secret (hex string or
 * raw bytes). This is the "bring your own DID" path: an attendee who saved the
 * secret from a prior {@link createIdentity} re-derives the exact same DID
 * without re-running keygen. The DID is a pure function of the secret, so the
 * result is deterministic.
 */
export function importIdentity(secret: string | Uint8Array): Identity {
  const keys = SchnorrKeyPair.fromSecret(secret);
  const did = DidBtcr2.create(keys.publicKey.compressed, { idType: 'KEY', network: NETWORK });
  return { did, keys };
}

/**
 * The hex-encoded 32-byte secret backing an identity. The demo lets an attendee
 * copy this so they can re-import the same DID later via {@link importIdentity}.
 * These are throwaway demo keys, never a real mnemonic, so nothing of value is
 * at risk.
 */
export function identitySecretHex(identity: Identity): string {
  return bytesToHex(identity.keys.raw.secret!);
}

/**
 * Derive a valid x-only recovery key (64 hex chars) for a cohort config.
 * CohortConfig requires both recoveryKey and recoverySequence (ADR 042 recovery
 * leaf); deriving from a freshly generated key avoids invalid-point errors at
 * beacon-address computation.
 */
export function deriveRecoveryKey(): string {
  return bytesToHex(SchnorrKeyPair.generate().publicKey.xOnly);
}

/**
 * Build a CAS cohort config for `participants` signers. recoveryKey and
 * recoverySequence are required by the protocol and easy to miss, so they are set
 * here once for the whole app.
 */
export function buildCohortConfig(participants: number): CohortConfig {
  return {
    beaconType: 'CASBeacon',
    minParticipants: participants,
    network: NETWORK,
    recoveryKey: deriveRecoveryKey(),
    recoverySequence: 144,
  };
}

/**
 * Build a signed did:btcr2 update that appends a CAS beacon service pointing at
 * the cohort's beacon address. Returned to the participant runner's
 * onProvideUpdate callback as the participant's contribution to the cohort.
 */
export function buildSignedUpdate(did: string, kp: SchnorrKeyPair, beaconAddress: string) {
  const doc = Resolver.deterministic({
    genesisBytes: kp.publicKey.compressed,
    hrp: 'k',
    idType: 'KEY',
    version: 1,
    network: NETWORK,
  });
  const vm = doc.verificationMethod[0];
  const unsigned = Updater.construct(
    doc,
    [
      {
        op: 'add',
        path: '/service/-',
        value: {
          id: `${did}#beacon-cas`,
          type: 'CASBeacon',
          serviceEndpoint: `bitcoin:${beaconAddress}`,
        },
      },
    ],
    1,
  );
  return Updater.sign(did, unsigned, vm, new LocalSigner(kp.raw.secret!));
}

/**
 * Build the fixture Bitcoin transaction the service signs in M1: a Taproot
 * key-path spend of a dummy prevout locked to the cohort's MuSig2 aggregate key,
 * carrying the committed signal in an OP_RETURN. No Bitcoin node and no broadcast:
 * the prevout is a fixture, so only the internal consistency of the MuSig2 partial
 * signatures matters (the message every signer signs is the taproot sighash
 * derived from this tx and its prevout). The OP_RETURN binds the signing approval
 * to the validated cohort signal.
 */
export function buildFixtureTxData(cohortKeys: Uint8Array[], signalBytes: Uint8Array): SigningTxData {
  const aggregateKey = musig2.keyAggExport(musig2.keyAggregate(cohortKeys));
  const payment = p2tr(aggregateKey);
  const prevOutValue = 100000n;
  const fee = 500n;

  const tx = new Transaction({ version: 2, allowUnknownOutputs: true });
  tx.addInput({
    txid: '00'.repeat(32),
    index: 0,
    witnessUtxo: { amount: prevOutValue, script: payment.script },
  });
  tx.addOutput({ script: payment.script, amount: prevOutValue - fee });
  tx.addOutput({ script: Script.encode(['RETURN', signalBytes]), amount: 0n });

  return { tx, prevOutScripts: [payment.script], prevOutValues: [prevOutValue] };
}
