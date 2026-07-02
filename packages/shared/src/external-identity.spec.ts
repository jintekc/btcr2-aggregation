import {
  getAggregationCommunicationKey,
  Identifier,
  resolveBtcr2SenderPk,
  Resolver,
} from '@did-btcr2/method';
import { bytesToHex } from '@noble/hashes/utils';
import { describe, expect, it } from 'vitest';
import {
  buildSignedUpdate,
  createExternalIdentity,
  createIdentity,
  genesisP2trBeaconAddress,
  identitySecretHex,
  importExternalIdentity,
  isExternalIdentity,
} from './index.js';

/** Hex of a compressed pubkey, for byte-equality comparisons across the resolvers. */
function pk(key: { compressed: Uint8Array }): string {
  return bytesToHex(key.compressed);
}

describe('createExternalIdentity', () => {
  it('mints a did:btcr2 EXTERNAL (x1) DID committing to a self-verifying genesis', () => {
    const id = createExternalIdentity();
    expect(id.did.startsWith('did:btcr2:x1')).toBe(true);
    expect(id.genesisDocument).toBeDefined();
    expect(isExternalIdentity(id)).toBe(true);
    // A KEY identity, by contrast, carries no genesis.
    expect(isExternalIdentity(createIdentity())).toBe(false);
  });

  it('binds the genesis capabilityInvocation[0] to the identity keypair (comm key = signer)', () => {
    const id = createExternalIdentity();
    const doc = Resolver.external(Identifier.decode(id.did), id.genesisDocument!);
    // ADR 066 decision B: the aggregation communication key is capabilityInvocation[0].
    // It must equal the identity's own keypair (what it signs envelopes + updates with).
    expect(pk(getAggregationCommunicationKey(doc))).toBe(pk(id.keys.publicKey));
  });

  it('is trustless: the in-band genesis authenticates the DID with zero trust', () => {
    const id = createExternalIdentity();
    // With the correct genesis, the sender resolver returns the genesis-derived key...
    const resolved = resolveBtcr2SenderPk(id.did, { genesisDocument: id.genesisDocument });
    expect(resolved).toBeDefined();
    expect(pk(resolved!)).toBe(pk(id.keys.publicKey));
  });

  it('returns undefined for an x1 DID with no genesis (existing 1-arg callers unaffected)', () => {
    const id = createExternalIdentity();
    expect(resolveBtcr2SenderPk(id.did)).toBeUndefined();
  });

  it('rejects a genesis that does not hash to the DID (no second-preimage impersonation)', () => {
    const victim = createExternalIdentity();
    const attacker = createExternalIdentity();
    // Attacker supplies their own (valid) genesis against the victim's DID: it does
    // not hash to the victim DID, so resolution yields no key -> the opt-in is rejected.
    expect(resolveBtcr2SenderPk(victim.did, { genesisDocument: attacker.genesisDocument })).toBeUndefined();
  });

  it('declares a SingletonBeacon at the key genesis P2TR address (first-update path)', () => {
    const id = createExternalIdentity();
    const services = id.genesisDocument!.service as Array<{ type: string; serviceEndpoint: string }>;
    expect(services).toHaveLength(1);
    expect(services[0].type).toBe('SingletonBeacon');
    expect(services[0].serviceEndpoint).toBe(`bitcoin:${genesisP2trBeaconAddress(id.keys)}`);
  });
});

describe('importExternalIdentity', () => {
  it('re-derives the exact same x1 DID + genesis from the secret (deterministic)', () => {
    const original = createExternalIdentity();
    const reimported = importExternalIdentity(identitySecretHex(original));
    expect(reimported.did).toBe(original.did);
    expect(reimported.genesisDocument).toEqual(original.genesisDocument);
    expect(pk(reimported.keys.publicKey)).toBe(pk(original.keys.publicKey));
  });

  it('distinct secrets yield distinct x1 DIDs', () => {
    expect(createExternalIdentity().did).not.toBe(createExternalIdentity().did);
  });
});

describe('buildSignedUpdate for x1', () => {
  it('resolves via the genesis and appends the aggregate beacon service, signed', () => {
    const id = createExternalIdentity();
    const beaconAddress = 'tb1pqqqqp399et2xygdj5xreqhjjvcmzhxw4aywxecjdzew6hylgvsesf3hn0c';
    const update = buildSignedUpdate(id.did, id.keys, beaconAddress, 'CASBeacon', id.genesisDocument);
    // Structurally a signed BTCR2 update: a patch adding the CASBeacon + a proof.
    const u = update as { patch?: unknown; proof?: unknown; '@context'?: unknown };
    expect(u.proof).toBeDefined();
    const serialized = JSON.stringify(update);
    expect(serialized).toContain('CASBeacon');
    expect(serialized).toContain(`bitcoin:${beaconAddress}`);
    expect(serialized).toContain('#beacon-cas');
  });
});
