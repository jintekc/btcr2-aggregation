import { canonicalHash } from '@did-btcr2/common';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { getAggregationCommunicationKey, Identifier, Resolver, resolveBtcr2SenderPk } from '@did-btcr2/method';
import { bytesToHex } from '@noble/hashes/utils';
import { describe, expect, it } from 'vitest';
import {
  bakedExternalIdentityFromKeys,
  buildBakedExternalGenesis,
  buildExternalGenesis,
  buildSignedUpdate,
  classifyCohortFit,
  createExternalIdentity,
  genesisP2trBeaconAddress,
  hasBakedAggregateBeacon,
  identitySecretHex,
  importBakedExternalIdentity,
  isExternalIdentity,
  resolveNetwork,
} from './index.js';

/** A syntactically valid bech32m P2TR address to stand in for a cohort beacon. */
const COHORT_ADDR = 'tb1pqqqqp399et2xygdj5xreqhjjvcmzhxw4aywxecjdzew6hylgvsesf3hn0c';
const OTHER_ADDR = 'tb1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0';

describe('buildExternalGenesis via GenesisDocument.create (refactor parity)', () => {
  it('produces exactly the pre-refactor literal shape, so no existing x1 DID drifts', () => {
    const keys = SchnorrKeyPair.generate();
    const beaconAddress = genesisP2trBeaconAddress(keys);
    // The hand-rolled literal buildExternalGenesis returned before it was routed
    // through the library's GenesisDocument.create. Deep equality (and therefore
    // canonical-hash equality) pins the refactor as a zero-drift change: the same
    // key still mints the same x1 DID.
    const preRefactorLiteral = {
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
    const genesis = buildExternalGenesis(keys);
    expect(genesis).toEqual(preRefactorLiteral);
    expect(canonicalHash(genesis, { encoding: 'hex' })).toBe(
      canonicalHash(preRefactorLiteral, { encoding: 'hex' }),
    );
  });
});

describe('buildBakedExternalGenesis', () => {
  it('declares exactly one aggregate beacon service at the pre-known cohort address', () => {
    const keys = SchnorrKeyPair.generate();
    const genesis = buildBakedExternalGenesis(keys, COHORT_ADDR, 'CASBeacon');
    const services = genesis.service as Array<{ id: string; type: string; serviceEndpoint: string }>;
    expect(services).toHaveLength(1);
    expect(services[0]).toEqual({
      id: 'did:btcr2:_#beacon-cas',
      type: 'CASBeacon',
      serviceEndpoint: `bitcoin:${COHORT_ADDR}`,
    });
    // No SingletonBeacon: the whole point is first-update discovery at the
    // aggregate beacon; the singleton exit ramp arrives via the first update.
    expect(hasBakedAggregateBeacon(genesis)).toBe(true);
  });

  it('hasBakedAggregateBeacon is FALSE for a classic x1 genesis (singleton only)', () => {
    // The service stages only baked-shape geneses; a classic x1 genesis (which
    // maps its DID to a personal funding address) must never be auto-persisted.
    expect(hasBakedAggregateBeacon(buildExternalGenesis(SchnorrKeyPair.generate()))).toBe(false);
  });

  it('uses the #beacon-smt fragment and SMTBeacon type for an SMT cohort', () => {
    const keys = SchnorrKeyPair.generate();
    const services = buildBakedExternalGenesis(keys, COHORT_ADDR, 'SMTBeacon').service as Array<{
      id: string;
      type: string;
    }>;
    expect(services[0].id).toBe('did:btcr2:_#beacon-smt');
    expect(services[0].type).toBe('SMTBeacon');
  });
});

describe('bakedExternalIdentityFromKeys / importBakedExternalIdentity', () => {
  it('mints a deterministic x1 DID distinct from the classic x1 DID of the same key', () => {
    const keys = SchnorrKeyPair.generate();
    const baked = bakedExternalIdentityFromKeys(keys, COHORT_ADDR, 'CASBeacon');
    expect(baked.did.startsWith('did:btcr2:x1')).toBe(true);
    expect(isExternalIdentity(baked)).toBe(true);
    // Same secret, classic genesis: a DIFFERENT commitment, therefore a different
    // DID. One secret maps to multiple x1 DIDs; re-import needs address + type.
    const classic = createExternalIdentity();
    const bakedFromClassicKeys = bakedExternalIdentityFromKeys(classic.keys, COHORT_ADDR);
    expect(bakedFromClassicKeys.did).not.toBe(classic.did);
    // Re-import with the same (secret, address, type) re-derives the same DID.
    const reimported = importBakedExternalIdentity(identitySecretHex(baked), COHORT_ADDR, 'CASBeacon');
    expect(reimported.did).toBe(baked.did);
    expect(reimported.genesisDocument).toEqual(baked.genesisDocument);
    // A different baked address (or type) is a different DID.
    expect(importBakedExternalIdentity(identitySecretHex(baked), OTHER_ADDR, 'CASBeacon').did).not.toBe(baked.did);
    expect(importBakedExternalIdentity(identitySecretHex(baked), COHORT_ADDR, 'SMTBeacon').did).not.toBe(baked.did);
  });

  it('keeps capabilityInvocation[0] = the identity keypair (transport auth unchanged)', () => {
    const baked = bakedExternalIdentityFromKeys(SchnorrKeyPair.generate(), COHORT_ADDR);
    const doc = Resolver.external(Identifier.decode(baked.did), baked.genesisDocument!);
    expect(bytesToHex(getAggregationCommunicationKey(doc).compressed)).toBe(
      bytesToHex(baked.keys.publicKey.compressed),
    );
    // The in-band bootstrap path authenticates a baked genesis exactly like a classic one.
    const resolved = resolveBtcr2SenderPk(baked.did, { genesisDocument: baked.genesisDocument });
    expect(resolved).toBeDefined();
    expect(bytesToHex(resolved!.compressed)).toBe(bytesToHex(baked.keys.publicKey.compressed));
  });
});

describe('classifyCohortFit', () => {
  const keys = SchnorrKeyPair.generate();

  it("classifies a KEY identity (no genesis) as 'append'", () => {
    expect(classifyCohortFit(undefined, COHORT_ADDR, 'CASBeacon')).toBe('append');
  });

  it("classifies a classic x1 genesis (singleton only) as 'append'", () => {
    expect(classifyCohortFit(buildExternalGenesis(keys), COHORT_ADDR, 'CASBeacon')).toBe('append');
  });

  it("classifies a genesis baked for THIS cohort as 'exit-ramp'", () => {
    const genesis = buildBakedExternalGenesis(keys, COHORT_ADDR, 'CASBeacon');
    expect(classifyCohortFit(genesis, COHORT_ADDR, 'CASBeacon')).toBe('exit-ramp');
  });

  it("classifies a genesis baked for another ADDRESS as 'mismatch'", () => {
    const genesis = buildBakedExternalGenesis(keys, OTHER_ADDR, 'CASBeacon');
    expect(classifyCohortFit(genesis, COHORT_ADDR, 'CASBeacon')).toBe('mismatch');
  });

  it("classifies the other beacon TYPE at the SAME address as 'mismatch'", () => {
    // The beacon address does not commit to the beacon type: a CAS-baked identity
    // CAN be seated in an SMT cohort of the same roster. Submitting there would
    // strand the DID (the baked CASBeacon would read SMT-root signals forever),
    // so the fit must be mismatch even though the address matches.
    const genesis = buildBakedExternalGenesis(keys, COHORT_ADDR, 'CASBeacon');
    expect(classifyCohortFit(genesis, COHORT_ADDR, 'SMTBeacon')).toBe('mismatch');
  });
});

describe('buildSignedUpdate for a baked identity', () => {
  it('appends the #beacon-singleton exit ramp instead of duplicating the baked service', () => {
    const baked = bakedExternalIdentityFromKeys(SchnorrKeyPair.generate(), COHORT_ADDR, 'CASBeacon');
    const update = buildSignedUpdate(baked.did, baked.keys, COHORT_ADDR, 'CASBeacon', baked.genesisDocument);
    const patch = (update as { patch: Array<{ value: { id: string; type: string; serviceEndpoint: string } }> }).patch;
    expect(patch).toHaveLength(1);
    expect(patch[0].value.id).toBe(`${baked.did}#beacon-singleton`);
    expect(patch[0].value.type).toBe('SingletonBeacon');
    expect(patch[0].value.serviceEndpoint).toBe(`bitcoin:${genesisP2trBeaconAddress(baked.keys)}`);
    // The aggregate service is NOT re-appended (it is already in the genesis).
    expect(JSON.stringify(patch)).not.toContain('#beacon-cas');
  });

  it('throws on a mismatched cohort (direct-caller guard; participants decline instead)', () => {
    const baked = bakedExternalIdentityFromKeys(SchnorrKeyPair.generate(), OTHER_ADDR, 'CASBeacon');
    expect(() =>
      buildSignedUpdate(baked.did, baked.keys, COHORT_ADDR, 'CASBeacon', baked.genesisDocument),
    ).toThrow(/baked/i);
  });

  it('leaves the classic x1 append path byte-compatible (aggregate service appended)', () => {
    const classic = createExternalIdentity();
    const update = buildSignedUpdate(classic.did, classic.keys, COHORT_ADDR, 'CASBeacon', classic.genesisDocument);
    const patch = (update as { patch: Array<{ value: { id: string; type: string } }> }).patch;
    expect(patch[0].value.id).toBe(`${classic.did}#beacon-cas`);
    expect(patch[0].value.type).toBe('CASBeacon');
  });

  it('derives the exit-ramp singleton on the DID OWN network, not the build-time default', () => {
    // The k1 branch of buildSignedUpdate had exactly this bug once (M3f-NETCONFIG):
    // a wrong-network address strands the update. A baked identity minted on
    // regtest must append its #beacon-singleton at a regtest (bcrt1p) address that
    // matches genesisP2trBeaconAddress on regtest - never the default mutinynet.
    const regtest = resolveNetwork('regtest');
    const keys = SchnorrKeyPair.generate();
    const baked = bakedExternalIdentityFromKeys(keys, COHORT_ADDR, 'CASBeacon', regtest);
    const update = buildSignedUpdate(baked.did, baked.keys, COHORT_ADDR, 'CASBeacon', baked.genesisDocument);
    const endpoint = (update as { patch: Array<{ value: { serviceEndpoint: string } }> }).patch[0].value
      .serviceEndpoint;
    expect(endpoint).toBe(`bitcoin:${genesisP2trBeaconAddress(keys, regtest)}`);
    expect(endpoint).toMatch(/^bitcoin:bcrt1p/);
  });
});
