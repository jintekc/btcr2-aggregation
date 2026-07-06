import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NETWORK,
  NETWORKS,
  resolveNetwork,
  toNetworkConfigDTO,
  type NetworkName,
} from './networks.js';
import {
  buildSignedUpdate,
  createIdentity,
  genesisP2trBeaconAddress,
  importExternalIdentity,
  importIdentity,
} from './index.js';

// A fixed secret so identity derivation is deterministic across networks (the point of
// the network-parameterized constructors is that the SAME key yields a DIFFERENT DID /
// address per chain).
const SECRET = '11'.repeat(32);
const ALL_NETWORKS = Object.keys(NETWORKS) as NetworkName[];

describe('network registry contract', () => {
  it('pins the public default network (both server and browser consume this)', () => {
    expect(DEFAULT_NETWORK).toBe('mutinynet');
  });
});

describe('toNetworkConfigDTO', () => {
  it('serializes exactly {network,label,isMainnet} and nothing derivable', () => {
    const dto = toNetworkConfigDTO(resolveNetwork('signet'));
    expect(Object.keys(dto).sort()).toEqual(['isMainnet', 'label', 'network']);
    expect(dto).toEqual({ network: 'signet', label: 'Signet', isMainnet: false });
  });

  it('survives a JSON round-trip with no function/host leakage', () => {
    for (const name of ALL_NETWORKS) {
      const dto = toNetworkConfigDTO(resolveNetwork(name));
      const wire = JSON.parse(JSON.stringify(dto)) as Record<string, unknown>;
      // The function (explorerTxUrl) and host are dropped: the wire form is complete.
      expect(wire).toEqual(dto);
      expect(wire.explorerTxUrl).toBeUndefined();
      expect(wire.esploraHost).toBeUndefined();
    }
  });

  it('round-trips back to the full config via resolveNetwork(name)', () => {
    for (const name of ALL_NETWORKS) {
      const config = resolveNetwork(name);
      const dto = toNetworkConfigDTO(config);
      const rebuilt = resolveNetwork(dto.network);
      // The client reconstructs the full (function-bearing) config from the name alone.
      expect(rebuilt.name).toBe(config.name);
      expect(rebuilt.scureNetwork).toBe(config.scureNetwork);
      expect(rebuilt.isMainnet).toBe(config.isMainnet);
    }
  });
});

describe('network-parameterized identity minting', () => {
  it('defaults to the app network, matching an explicit DEFAULT_NETWORK', () => {
    expect(importIdentity(SECRET).did).toBe(importIdentity(SECRET, resolveNetwork(DEFAULT_NETWORK)).did);
  });

  it('makes the DID network-dependent for the same key (KEY / k1)', () => {
    const onMutiny = importIdentity(SECRET, resolveNetwork('mutinynet')).did;
    const onRegtest = importIdentity(SECRET, resolveNetwork('regtest')).did;
    const onMainnet = importIdentity(SECRET, resolveNetwork('bitcoin')).did;
    expect(onMutiny).not.toBe(onRegtest);
    expect(onMutiny).not.toBe(onMainnet);
    expect(onRegtest).not.toBe(onMainnet);
  });

  it('derives the genesis beacon address on the requested network', () => {
    const keys = importIdentity(SECRET).keys;
    // Test networks share the tb1p HRP; regtest is bcrt1p; mainnet is bc1p.
    expect(genesisP2trBeaconAddress(keys, resolveNetwork('mutinynet'))).toMatch(/^tb1p/);
    expect(genesisP2trBeaconAddress(keys, resolveNetwork('regtest'))).toMatch(/^bcrt1p/);
    expect(genesisP2trBeaconAddress(keys, resolveNetwork('bitcoin'))).toMatch(/^bc1p/);
  });

  it('makes the x1 DID and its genesis beacon network-dependent (EXTERNAL)', () => {
    const onMutiny = importExternalIdentity(SECRET, resolveNetwork('mutinynet'));
    const onRegtest = importExternalIdentity(SECRET, resolveNetwork('regtest'));
    expect(onMutiny.did).not.toBe(onRegtest.did);
    // The genesis SingletonBeacon endpoint carries the network-specific P2TR address.
    const endpointOf = (id: typeof onMutiny) =>
      (id.genesisDocument!.service as Array<{ serviceEndpoint: string }>)[0].serviceEndpoint;
    expect(endpointOf(onMutiny)).toMatch(/^bitcoin:tb1p/);
    expect(endpointOf(onRegtest)).toMatch(/^bitcoin:bcrt1p/);
  });

  it('builds a k1 update against the DID\'s own network, not the build-time default', () => {
    // Regression: buildSignedUpdate reconstructs the k1 deterministic document from the
    // DID's decoded network. A regtest DID's update must reference the regtest DID (its
    // proof verificationMethod and patch service id), NOT the same key's mutinynet DID.
    // With the old `network: NETWORK` constant, a non-default-network update was signed
    // against a document the resolver never reconstructs (proof references the wrong DID).
    const regtest = importIdentity(SECRET, resolveNetwork('regtest'));
    const mutiny = importIdentity(SECRET, resolveNetwork('mutinynet'));
    const addr = genesisP2trBeaconAddress(regtest.keys, resolveNetwork('regtest'));
    const update = buildSignedUpdate(regtest.did, regtest.keys, addr) as {
      proof: { verificationMethod: string };
      patch: Array<{ value: { id: string } }>;
    };
    expect(update.proof.verificationMethod.startsWith(regtest.did)).toBe(true);
    expect(update.proof.verificationMethod).not.toContain(mutiny.did);
    expect(update.patch[0].value.id.startsWith(regtest.did)).toBe(true);
  });

  it('is deterministic: same secret + network re-derives the same identity', () => {
    expect(importExternalIdentity(SECRET, resolveNetwork('regtest')).did).toBe(
      importExternalIdentity(SECRET, resolveNetwork('regtest')).did,
    );
    // createIdentity generates a fresh key, so two calls MUST differ (sanity guard the
    // fixed-secret determinism above is not a tautology).
    expect(createIdentity().did).not.toBe(createIdentity().did);
  });
});
