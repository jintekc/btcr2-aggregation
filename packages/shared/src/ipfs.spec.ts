import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';
import { Identifier } from '@did-btcr2/method';
import { describe, expect, it } from 'vitest';
import {
  artifactHashHex,
  buildPublishPlan,
  buildSignedUpdate,
  canonicalArtifactBytes,
  cidFromHashHex,
  cidStringFromHashHex,
  createExternalIdentity,
  createIdentity,
  hashHexFromCidString,
  normalizeDigestHex,
} from './index.js';

// The hex -> CID mapping is identity on the digest (docs/M3b2-ipfs-cid-spike.md):
// CIDv1(raw 0x55, multihash(sha2-256 0x12, <digest>)) carries the on-chain hex
// verbatim. These vectors pin the construction so a codec/hasher regression (the
// spike's confirmed failure mode: json/dag-json/unixfs produce a DIFFERENT digest)
// can never ship silently.

/** The spike's empirically verified golden vector. */
const GOLDEN_HEX = '0f7bac401c7f249cd255bd68fe72bc9d769465d7785a09d1494fb142878af40f';
const GOLDEN_CID = 'bafkreiappoweahd7esonevn5nd7hfpe5o2kglv3ylie5cskpwfbipcxub4';

describe('cidFromHashHex', () => {
  it('reproduces the spike golden vector (raw 0x55, sha2-256, digest identity)', () => {
    const cid = cidFromHashHex(GOLDEN_HEX);
    expect(cid.toString()).toBe(GOLDEN_CID);
    expect(cid.version).toBe(1);
    expect(cid.code).toBe(0x55);
    expect(cid.multihash.code).toBe(0x12);
    expect(bytesToHex(cid.multihash.digest)).toBe(GOLDEN_HEX);
    expect(cidStringFromHashHex(GOLDEN_HEX.toUpperCase())).toBe(GOLDEN_CID);
  });

  it('round-trips through hashHexFromCidString', () => {
    expect(hashHexFromCidString(GOLDEN_CID)).toBe(GOLDEN_HEX);
  });

  it('rejects digests that are not exactly 32 hex-encoded bytes', () => {
    expect(() => cidFromHashHex('')).toThrow(/64-char hex/);
    expect(() => cidFromHashHex(GOLDEN_HEX.slice(0, 62))).toThrow(/64-char hex/);
    expect(() => cidFromHashHex(`${GOLDEN_HEX}ab`)).toThrow(/64-char hex/);
    expect(() => cidFromHashHex(`0x${GOLDEN_HEX}`)).toThrow(/64-char hex/);
    expect(() => cidFromHashHex('zz'.repeat(32))).toThrow(/64-char hex/);
    expect(normalizeDigestHex(GOLDEN_HEX.toUpperCase())).toBe(GOLDEN_HEX);
  });

  it('rejects a non-canonical CID shape on the inverse mapping', () => {
    // dag-pb CIDv0: right digest family, wrong codec/version for an artifact CID.
    expect(() => hashHexFromCidString('QmdfTbBqBPQ7VNxZEYEj14VmRuZBkqFbiwReogJgS1zR1n')).toThrow(
      /canonical artifact CID/,
    );
  });
});

describe('canonicalArtifactBytes / artifactHashHex', () => {
  it('hashes the exact JCS bytes (sha256(bytes) === canonical hash), keys sorted', () => {
    // Deliberately unsorted keys: JCS must reorder them; JSON.stringify would not.
    const artifact = { z: 1, a: { c: 3, b: 2 }, m: 'hi' };
    const bytes = canonicalArtifactBytes(artifact);
    expect(new TextDecoder().decode(bytes)).toBe('{"a":{"b":2,"c":3},"m":"hi","z":1}');
    const hex = artifactHashHex(artifact);
    expect(bytesToHex(sha256(bytes))).toBe(hex);
    expect(hex).toBe(GOLDEN_HEX);
  });
});

describe('buildPublishPlan', () => {
  const update = (identity = createIdentity()) =>
    buildSignedUpdate(identity.did, identity.keys, 'tb1pfixture', 'CASBeacon', identity.genesisDocument);

  it('always carries the signed update, with digest identity on every entry', () => {
    const plan = buildPublishPlan({ update: update() });
    expect(plan.map((p) => p.kind)).toEqual(['update']);
    for (const p of plan) {
      expect(bytesToHex(sha256(p.bytes))).toBe(p.hashHex);
      expect(hashHexFromCidString(p.cid)).toBe(p.hashHex);
    }
  });

  it('adds the CAS announcement and the x1 genesis when present', () => {
    const identity = createExternalIdentity();
    const casAnnouncement = { [identity.did]: 'u9Zt2mCkzc0kv9nQZsPvY6HgLmqI3nHnE9tS8yQxYQg' };
    const plan = buildPublishPlan({
      update: update(identity),
      casAnnouncement,
      genesisDocument: identity.genesisDocument,
    });
    expect(plan.map((p) => p.kind)).toEqual(['update', 'announcement', 'genesis']);
    for (const p of plan) {
      expect(bytesToHex(sha256(p.bytes))).toBe(p.hashHex);
      expect(hashHexFromCidString(p.cid)).toBe(p.hashHex);
    }
  });

  it("keys the genesis block by the DID's own commitment (Identifier.decode)", () => {
    const identity = createExternalIdentity();
    const plan = buildPublishPlan({ update: update(identity), genesisDocument: identity.genesisDocument });
    const genesis = plan.find((p) => p.kind === 'genesis')!;
    // The x1 DID is a hash commitment to its genesis; the decoded identifier's
    // genesisBytes IS that 32-byte canonical hash. Anyone holding only the DID can
    // therefore derive the genesis CID and fetch the document from any IPFS host.
    const commitment = bytesToHex(Identifier.decode(identity.did).genesisBytes);
    expect(genesis.hashHex).toBe(commitment);
    expect(genesis.cid).toBe(cidStringFromHashHex(commitment));
  });
});
