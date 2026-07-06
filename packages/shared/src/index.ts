import { canonicalHash, canonicalHashBytes, decode, encode } from '@did-btcr2/common';
import { LocalSigner, SchnorrKeyPair } from '@did-btcr2/keypair';
import {
  DidBtcr2,
  GenesisDocument,
  Identifier,
  Resolver,
  Updater,
  type GenesisDocumentLike,
} from '@did-btcr2/method';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { Script, Transaction, p2tr } from '@scure/btc-signer';
import * as musig2 from '@scure/btc-signer/musig2';
import type { CohortConfig, SigningTxData } from '@did-btcr2/aggregation/service';
import { DEFAULT_NETWORK, resolveNetwork, type NetworkConfig, type NetworkName } from './networks.js';

export type { CohortConfig, SigningTxData } from '@did-btcr2/aggregation/service';
export * from './networks.js';

/**
 * The two beacon types this aggregator supports, chosen per cohort. A CAS
 * announcement discloses every cohort member's DID + update hash to any resolver;
 * an SMT proof discloses only the resolved DID's own leaf (privacy). The protocol
 * drives both identically: the difference is which off-chain artifact the cohort
 * builds internally and which service is appended to the participant's update.
 */
export type BeaconType = 'CASBeacon' | 'SMTBeacon';

/** The `#beacon-<slug>` service-id fragment for a beacon type. */
function beaconSlug(beaconType: BeaconType): 'cas' | 'smt' {
  return beaconType === 'SMTBeacon' ? 'smt' : 'cas';
}

/**
 * Bitcoin network label used for every DID and cohort config in this app. In M1
 * this is cosmetic (no chain interaction); it becomes load-bearing in M3 when the
 * fixture beacon tx is swapped for a real beacon transaction. Aliases
 * {@link DEFAULT_NETWORK} so the network registry is the single source of truth.
 */
export const NETWORK = DEFAULT_NETWORK;

/**
 * A did:btcr2 identity: the DID string paired with its Schnorr keypair, plus (for
 * an EXTERNAL identity) the genesis document the DID commits to.
 *
 * - **KEY (`k1`)**: `genesisDocument` is absent. The DID string *is* the key, so a
 *   verifier derives the communication key by decoding the DID.
 * - **EXTERNAL (`x1`)**: `genesisDocument` is present and `keys` is the keypair of
 *   its `capabilityInvocation[0]` verification method. The DID is a hash commitment
 *   to the (canonicalized) genesis, so the document is self-verifying and a verifier
 *   derives the communication key from it with zero trust. The genesis rides in-band
 *   on the cohort opt-in ({@link https://btcr2.dev | ADR 066}); the transport
 *   bootstrap-authenticates the sender from it.
 */
export interface Identity {
  did: string;
  keys: SchnorrKeyPair;
  /** Present only for an EXTERNAL (x1) identity: the self-verifying genesis document. */
  genesisDocument?: Record<string, unknown>;
}

/** The did:btcr2 identifier type this app onboards: KEY (`k1`) or EXTERNAL (`x1`). */
export type IdType = 'KEY' | 'EXTERNAL';

/** True when `identity` is an EXTERNAL (x1) identity (carries a genesis document). */
export function isExternalIdentity(identity: Identity): boolean {
  return identity.genesisDocument !== undefined;
}

/**
 * Generate a fresh did:btcr2 KEY identity. Defaults to the app {@link NETWORK}; pass
 * a {@link NetworkConfig} (e.g. from the runtime `GET /v1/config`) so the DID's
 * network segment reflects the chain the coordinator actually targets.
 */
export function createIdentity(network: NetworkConfig = resolveNetwork(NETWORK)): Identity {
  const keys = SchnorrKeyPair.generate();
  const did = DidBtcr2.create(keys.publicKey.compressed, { idType: 'KEY', network: network.name });
  return { did, keys };
}

/**
 * Build the genesis DID document for an EXTERNAL (x1) identity backed by `keys`.
 *
 * The document uses the placeholder controller id `did:btcr2:_` (the resolver
 * substitutes the real DID; {@link GenesisDocument.toGenesisBytes} canonicalizes it
 * with the placeholder in place, so this exact shape is what the DID commits to). It
 * declares a single Multikey verification method (the `keys`) referenced by every
 * relationship, so `capabilityInvocation[0]` - the aggregation communication key and
 * the DID-update authorization key (ADR 066 decision B) - resolves to `keys`.
 *
 * It also declares one `SingletonBeacon` at the key's genesis P2TR address (the same
 * address {@link genesisP2trBeaconAddress} funds for a KEY DID's first-update
 * registration), so an x1 controller can publish its first aggregated update through
 * its own genesis beacon exactly as a KEY controller does, making the DID resolvable.
 *
 * Pure function of `keys` (+ network), so the derived x1 DID is deterministic and an
 * identity re-imported from the same secret yields the same DID.
 */
export function buildExternalGenesis(
  keys: SchnorrKeyPair,
  network: NetworkConfig = resolveNetwork(NETWORK),
): Record<string, unknown> {
  const beaconAddress = genesisP2trBeaconAddress(keys, network);
  return {
    'id': 'did:btcr2:_',
    '@context': ['https://www.w3.org/ns/did/v1.1', 'https://btcr2.dev/context/v1'],
    'verificationMethod': [
      {
        id: 'did:btcr2:_#key-0',
        type: 'Multikey',
        controller: 'did:btcr2:_',
        publicKeyMultibase: keys.publicKey.multibase.encoded,
      },
    ],
    'authentication': ['did:btcr2:_#key-0'],
    'assertionMethod': ['did:btcr2:_#key-0'],
    'capabilityInvocation': ['did:btcr2:_#key-0'],
    'capabilityDelegation': ['did:btcr2:_#key-0'],
    'service': [
      {
        id: 'did:btcr2:_#service-0',
        type: 'SingletonBeacon',
        serviceEndpoint: `bitcoin:${beaconAddress}`,
      },
    ],
  };
}

/**
 * Derive the EXTERNAL (x1) DID for a genesis document: a bech32m commitment to the
 * hash of the canonicalized genesis, on `network` (default {@link NETWORK}). The
 * genesis bytes are network-independent (placeholder DID), but the DID string's
 * network segment reflects the target chain, so pass the same {@link NetworkConfig}
 * used to build the genesis. Deterministic given the genesis + network.
 */
export function externalDidFromGenesis(
  genesisDocument: Record<string, unknown>,
  network: NetworkConfig = resolveNetwork(NETWORK),
): string {
  return DidBtcr2.create(GenesisDocument.toGenesisBytes(genesisDocument as GenesisDocumentLike), {
    idType: 'EXTERNAL',
    network: network.name,
  });
}

/**
 * Generate a fresh did:btcr2 EXTERNAL (x1) identity: a Schnorr keypair, a
 * self-verifying genesis document whose `capabilityInvocation[0]` is that keypair,
 * and the x1 DID committing to the genesis. Defaults to the app {@link NETWORK}; pass
 * a {@link NetworkConfig} (e.g. the runtime `GET /v1/config`) so both the genesis
 * beacon address and the DID's network segment target the coordinator's chain. This
 * is the "bring your own DID" onboarding path made first-class by ADR 066 (x1 can now
 * authenticate and co-sign on every transport, previously KEY-only over HTTP).
 */
export function createExternalIdentity(network: NetworkConfig = resolveNetwork(NETWORK)): Identity {
  const keys = SchnorrKeyPair.generate();
  const genesisDocument = buildExternalGenesis(keys, network);
  return { did: externalDidFromGenesis(genesisDocument, network), keys, genesisDocument };
}

/**
 * Reconstruct an EXTERNAL (x1) identity from its 32-byte secret (hex string or raw
 * bytes) on `network` (default {@link NETWORK}). The genesis (and therefore the DID)
 * is a pure function of the key + network, so this re-derives the exact same x1 DID -
 * the EXTERNAL analogue of {@link importIdentity}.
 */
export function importExternalIdentity(
  secret: string | Uint8Array,
  network: NetworkConfig = resolveNetwork(NETWORK),
): Identity {
  const keys = SchnorrKeyPair.fromSecret(secret);
  const genesisDocument = buildExternalGenesis(keys, network);
  return { did: externalDidFromGenesis(genesisDocument, network), keys, genesisDocument };
}

/**
 * Reconstruct a did:btcr2 KEY identity from its 32-byte secret (hex string or
 * raw bytes) on `network` (default {@link NETWORK}). This is the "bring your own DID"
 * path: an attendee who saved the secret from a prior {@link createIdentity}
 * re-derives the exact same DID without re-running keygen. The DID is a pure function
 * of the secret + network, so the result is deterministic.
 */
export function importIdentity(
  secret: string | Uint8Array,
  network: NetworkConfig = resolveNetwork(NETWORK),
): Identity {
  const keys = SchnorrKeyPair.fromSecret(secret);
  const did = DidBtcr2.create(keys.publicKey.compressed, { idType: 'KEY', network: network.name });
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
 * Build a cohort config for `participants` signers and the given `beaconType`
 * (default CAS). recoveryKey and recoverySequence are required by the protocol and
 * easy to miss, so they are set here once for the whole app. The protocol drives
 * CAS and SMT cohorts identically; the cohort builds the matching artifact (CAS
 * announcement map or SMT tree) internally. `network` defaults to the app
 * {@link NETWORK}; the coordinator passes its operator-configured network so the
 * cohort and the browser's runtime `GET /v1/config` agree on one chain.
 *
 * `recoveryKey` is the x-only public key of the cohort's ADR 042 recovery leaf: a
 * Taproot script path that lets the recovery-key holder sweep the beacon UTXO alone
 * once `recoverySequence` blocks (a BIP-68 relative timelock; 144 is roughly one day)
 * have passed since the funding confirmed. When omitted, a THROWAWAY key is derived
 * and its secret immediately discarded, so the recovery path exists structurally but
 * nobody can ever spend it. That is fine on test networks and for the zero-chain
 * fixture path; an operator funding a beacon with real value MUST pass a recovery
 * key whose secret they actually hold (derived offline; only the public key belongs
 * here). See docs/adr/0010-mainnet-guard-rails.md.
 */
export function buildCohortConfig(
  participants: number,
  beaconType: BeaconType = 'CASBeacon',
  network: NetworkName = NETWORK,
  recoveryKey?: string,
): CohortConfig {
  if (recoveryKey !== undefined) {
    if (!/^[0-9a-f]{64}$/i.test(recoveryKey)) {
      throw new Error('recoveryKey must be 64 hex chars (an x-only Schnorr public key)');
    }
    try {
      // Fail fast on a key that is not a valid x-only point: p2tr's BIP341 tweak
      // lifts the x coordinate and throws for an off-curve key, which would otherwise
      // only surface deep in cohort keygen at beacon-address computation.
      p2tr(hexToBytes(recoveryKey.toLowerCase()));
    } catch {
      throw new Error('recoveryKey is not a valid x-only Schnorr public key (off-curve x coordinate)');
    }
  }
  return {
    beaconType,
    minParticipants: participants,
    network,
    recoveryKey: recoveryKey?.toLowerCase() ?? deriveRecoveryKey(),
    recoverySequence: 144,
  };
}

/**
 * Build a signed did:btcr2 update that appends a beacon service (CAS or SMT,
 * default CAS) pointing at the cohort's beacon address. Returned to the
 * participant runner's onProvideUpdate callback as the participant's contribution
 * to the cohort. The service `type` and `#beacon-<slug>` id fragment match the
 * cohort's beacon type, with distinct fragments (`#beacon-cas` vs `#beacon-smt`)
 * so a DID that ever rides both a CAS and an SMT cohort never collides on
 * `/service/-`.
 *
 * KEY (`k1`) and EXTERNAL (`x1`) identities differ only in how the current document
 * is resolved before the patch is applied: a KEY DID resolves deterministically from
 * its public key; an EXTERNAL DID resolves from its (self-verifying) `genesisDocument`.
 * Either way the update is signed with `capabilityInvocation[0]` - which is
 * `doc.verificationMethod[0]` for both (a KEY DID's sole key, or the x1 genesis's
 * `#key-0` that every relationship references) - so the signer `kp` MUST be that key.
 */
export function buildSignedUpdate(
  did: string,
  kp: SchnorrKeyPair,
  beaconAddress: string,
  beaconType: BeaconType = 'CASBeacon',
  genesisDocument?: Record<string, unknown>,
) {
  const doc = genesisDocument
    ? Resolver.external(Identifier.decode(did), genesisDocument)
    : Resolver.deterministic({
        genesisBytes: kp.publicKey.compressed,
        hrp: 'k',
        idType: 'KEY',
        version: 1,
        // Reconstruct the deterministic document on the DID's OWN network, decoded from
        // the identifier - NOT the build-time default. A k1 DID minted on a non-default
        // runtime network (via GET /v1/config: signet/regtest/...) must resolve to a
        // document whose `id` and verificationMethod ids match the DID; using the
        // constant here would build the update against the wrong-network document, so
        // its proof would reference a DID the resolver never reconstructs. Byte-identical
        // on the default network (decode('...mutinynet...') === NETWORK).
        network: Identifier.decode(did).network,
      });
  const vm = doc.verificationMethod[0];
  const unsigned = Updater.construct(
    doc,
    [
      {
        op: 'add',
        path: '/service/-',
        value: {
          id: `${did}#beacon-${beaconSlug(beaconType)}`,
          type: beaconType,
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

/**
 * The hex canonical hash of a signed did:btcr2 update: JCS-canonicalize -> SHA-256
 * -> hex. This is the value a resolver requests as `NeedSignedUpdate.updateHash`,
 * the key the aggregator stores the update body under, and (as raw bytes) the
 * OP_RETURN payload of a singleton-beacon registration. Goes through the same
 * `@did-btcr2/common` helper the resolver and the service persistence use, so the
 * keys match with zero mismatch. Non-deterministic signing means this must be taken
 * over the EXACT submitted body (see participant `getSubmittedUpdate`).
 */
export function updateHashHex(update: object): string {
  return canonicalHash(update as Record<string, unknown>, { encoding: 'hex' });
}

/** The 32-byte canonical hash of a signed update (the OP_RETURN payload bytes). */
export function updateHashBytes(update: object): Uint8Array {
  return canonicalHashBytes(update as Record<string, unknown>);
}

/**
 * Convert a base64urlnopad hash (as carried in a CAS announcement value or an SMT
 * proof's `updateId`) to lowercase hex - the encoding the resolver and store use.
 */
export function base64UrlHashToHex(b64: string): string {
  return encode(decode(b64, 'base64urlnopad'), 'hex');
}

/**
 * A controller's genesis P2TR SingletonBeacon address on `network` (default the
 * app network). A KEY did:btcr2's deterministic document carries three
 * SingletonBeacons at the key's p2pkh / p2wpkh / p2tr addresses; the P2TR one is
 * the modern default and the target the resolve path exercises. Byte-identical to
 * `@did-btcr2/method`'s `BeaconUtils` `#initialP2TR` branch
 * (`p2tr(compressed.slice(1,33), undefined, network)`), but pure `@scure/btc-signer`
 * so it stays browser-clean (no method/`@web5/dids` import). This is the address a
 * controller funds and spends to publish their first update's registration signal.
 */
export function genesisP2trBeaconAddress(
  keys: SchnorrKeyPair,
  network: NetworkConfig = resolveNetwork(NETWORK),
): string {
  const xOnly = keys.publicKey.compressed.slice(1, 33);
  return p2tr(xOnly, undefined, network.scureNetwork).address;
}

/** A spendable UTXO at the controller's beacon address (esplora `AddressUtxo` subset). */
export interface RegistrationUtxo {
  txid: string;
  vout: number;
  /** Amount in satoshis. */
  value: number;
}

/** The built, signed singleton-beacon registration transaction, ready to broadcast. */
export interface RegistrationTx {
  /** Network-serialized signed transaction, hex (POST to esplora `/tx`). */
  rawHex: string;
  /** The transaction id. */
  txid: string;
  /** Fee paid, in satoshis. */
  fee: bigint;
  /** Change returned to the beacon address, in satoshis. */
  change: bigint;
}

/** Default fee for a 1-in / (change + OP_RETURN)-out P2TR registration tx (sats). */
export const REGISTRATION_FEE_SATS = 1000n;
/** P2TR dust threshold (sats); a change output below this is uneconomical. */
export const P2TR_DUST_SATS = 330n;
/** Minimum funding a beacon address needs to build a registration tx (fee + dust-safe change). */
export const MIN_REGISTRATION_FUNDING_SATS = REGISTRATION_FEE_SATS + P2TR_DUST_SATS;
/**
 * Hard cap on a registration tx fee (sats). The tx is ~150 vB, so this is well over
 * 100 sat/vB - beyond any sane priority rate for a one-output OP_RETURN announce.
 * A fee above it is a fat-fingered override that would burn the funding UTXO; on
 * mainnet that is real money, so the builder refuses instead of signing it away.
 */
export const MAX_REGISTRATION_FEE_SATS = 20_000n;

/**
 * Build and sign the controller's first-update singleton-beacon registration
 * transaction: a Taproot key-path spend of a funded UTXO at their genesis P2TR
 * beacon address, with a single `OP_RETURN <32-byte updateHash>` output announcing
 * the update, and change back to the same address.
 *
 * The OP_RETURN is the LAST output because the resolver's beacon-signal indexer
 * reads only a transaction's final `vout`; putting change last would hide the
 * signal. Signing is a BIP341 key-path spend with the controller's own key (tweaked
 * with an empty merkle root by `@scure/btc-signer`); the raw untweaked secret is
 * passed and the library does the tweak. Nothing here leaves the browser: the caller
 * broadcasts `rawHex` via the same-origin `/v1/tx/broadcast` proxy.
 *
 * @throws if the UTXO cannot cover the fee plus a dust-safe change output, or the
 * fee is non-positive or above {@link MAX_REGISTRATION_FEE_SATS} (mainnet burn guard).
 */
export function buildSingletonRegistrationTx(opts: {
  keys: SchnorrKeyPair;
  utxo: RegistrationUtxo;
  /** 32-byte canonical update hash (see {@link updateHashBytes}). */
  updateHash: Uint8Array;
  network?: NetworkConfig;
  /** Fee in sats; defaults to {@link REGISTRATION_FEE_SATS}. */
  fee?: bigint;
}): RegistrationTx {
  const network = opts.network ?? resolveNetwork(NETWORK);
  const fee = opts.fee ?? REGISTRATION_FEE_SATS;
  if (fee <= 0n) {
    throw new Error(`fee must be positive, got ${fee} sats (a zero-fee tx never relays)`);
  }
  if (fee > MAX_REGISTRATION_FEE_SATS) {
    throw new Error(
      `fee ${fee} sats exceeds the ${MAX_REGISTRATION_FEE_SATS}-sat registration cap; ` +
        'a ~150 vB registration tx never needs this much - refusing to burn the funding UTXO',
    );
  }
  const value = BigInt(opts.utxo.value);
  if (value < fee + P2TR_DUST_SATS) {
    throw new Error(
      `funding UTXO (${value} sats) is too small; fund the beacon address with at least ` +
        `${fee + P2TR_DUST_SATS} sats`,
    );
  }
  if (opts.updateHash.length !== 32) {
    throw new Error(`updateHash must be 32 bytes, got ${opts.updateHash.length}`);
  }
  const internalKey = opts.keys.publicKey.compressed.slice(1, 33);
  const pay = p2tr(internalKey, undefined, network.scureNetwork);
  const change = value - fee;

  const tx = new Transaction({ version: 2, allowUnknownOutputs: true });
  tx.addInput({
    txid: opts.utxo.txid,
    index: opts.utxo.vout,
    witnessUtxo: { amount: value, script: pay.script },
    // Required for @scure to take the key-path taproot branch and sighash.
    tapInternalKey: pay.tapInternalKey,
  });
  // Change FIRST, OP_RETURN LAST (the indexer reads the final vout).
  tx.addOutput({ script: pay.script, amount: change });
  tx.addOutput({ script: Script.encode(['RETURN', opts.updateHash]), amount: 0n });
  // Sign with the raw untweaked secret; @scure applies the BIP341 tweak internally.
  tx.sign(opts.keys.raw.secret!);
  tx.finalize();

  return { rawHex: bytesToHex(tx.extract()), txid: tx.id, fee, change };
}
