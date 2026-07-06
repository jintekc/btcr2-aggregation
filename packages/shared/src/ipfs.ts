import { canonicalHash, canonicalize } from '@did-btcr2/common';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { CID } from 'multiformats/cid';
import * as raw from 'multiformats/codecs/raw';
import * as Digest from 'multiformats/hashes/digest';

/**
 * On-chain-hash <-> IPFS-CID mapping plus the participant's publish plan.
 *
 * Every did:btcr2 aggregation artifact key is `sha256(JCS-canonicalize(artifact))`
 * carried as a bare 32-byte digest (hex on-chain / in the store). The IPFS raw
 * codec (0x55) is a byte-identity transform, so `CIDv1(raw, multihash(sha2-256,
 * digest))` addresses the canonical JSON bytes with a multihash digest that is
 * byte-identical to the on-chain hex: anyone holding only the on-chain hash can
 * derive the CID with zero network calls, and a block fetched by that CID is
 * self-verifying against the on-chain commitment. Spiked and verified in
 * docs/M3b2-ipfs-cid-spike.md; the JSON/dag-json codecs re-serialize via
 * `JSON.stringify` (wrong bytes) and unixfs wraps in dag-pb (wrong primitive), so
 * raw + the exact canonical bytes is the only correct construction.
 *
 * Pure `multiformats` + `@did-btcr2/common` + `@noble/hashes`: browser-clean (no
 * `node:` imports; never import `multiformats/hashes/sha2`, which pulls
 * `node:crypto`), so the mapping works identically in the service and the SPA.
 */

/** sha2-256 multihash code. */
const SHA2_256_CODE = 0x12;

const HASH_HEX_64 = /^[0-9a-f]{64}$/;

/** Normalize a 32-byte digest to lowercase hex, throwing on any other shape. */
export function normalizeDigestHex(hashHex: string): string {
  const lower = hashHex.toLowerCase();
  if (!HASH_HEX_64.test(lower)) {
    throw new Error(`expected a 64-char hex sha256 digest, got "${hashHex}"`);
  }
  return lower;
}

/**
 * The canonical CIDv1 for an artifact's on-chain/store hex digest. Identity on
 * the digest: no hashing happens here, the existing 32-byte digest is wrapped in
 * a sha2-256 multihash under the raw (0x55) codec. `cid.multihash.digest` is
 * byte-identical to `hashHex`.
 */
export function cidFromHashHex(hashHex: string): CID {
  const digest = hexToBytes(normalizeDigestHex(hashHex));
  return CID.create(1, raw.code, Digest.create(SHA2_256_CODE, digest));
}

/** The base32 CIDv1 string for an artifact hex digest (starts `bafkrei`). */
export function cidStringFromHashHex(hashHex: string): string {
  return cidFromHashHex(hashHex).toString();
}

/**
 * Inverse mapping: extract the on-chain hex digest from a canonical artifact CID.
 * Throws when the CID is not the canonical shape (CIDv1, raw codec, sha2-256,
 * 32-byte digest), because any other shape cannot equal an on-chain commitment.
 */
export function hashHexFromCidString(cid: string): string {
  const parsed = CID.parse(cid);
  if (parsed.version !== 1 || parsed.code !== raw.code) {
    throw new Error(`not a canonical artifact CID (want CIDv1 raw 0x55): ${cid}`);
  }
  if (parsed.multihash.code !== SHA2_256_CODE || parsed.multihash.digest.length !== 32) {
    throw new Error(`not a canonical artifact CID (want sha2-256/32): ${cid}`);
  }
  return bytesToHex(parsed.multihash.digest);
}

/**
 * The exact bytes did:btcr2 hashed for an artifact: the UTF-8 encoding of its
 * RFC 8785 (JCS) canonical JSON, via the same `@did-btcr2/common` canonicalize
 * the resolver and the store keys use. These are the ONLY bytes that may be
 * stored under the artifact's CID: a re-stringified or pretty-printed copy has a
 * different digest and yields a dead CID.
 */
export function canonicalArtifactBytes(artifact: object): Uint8Array {
  return new TextEncoder().encode(canonicalize(artifact as Record<string, unknown>));
}

/**
 * The hex canonical hash of any aggregation artifact (JCS -> SHA-256 -> hex).
 * Equals `sha256(canonicalArtifactBytes(artifact))`: the store key, the resolver's
 * need hash, and (wrapped by {@link cidFromHashHex}) the artifact's CID digest.
 * For an x1 genesis document this is also the DID's own commitment
 * (`Identifier.decode(did).genesisBytes`).
 */
export function artifactHashHex(artifact: object): string {
  return canonicalHash(artifact as Record<string, unknown>, { encoding: 'hex' });
}

/**
 * The artifact kinds a controller can publish to IPFS with digest identity. SMT
 * proofs are deliberately NOT publishable: the resolver requests a proof by the
 * cohort's shared SMT ROOT hash, not by the proof's own content hash, so no CID
 * derivable from on-chain data can address a proof block. An SMT controller's
 * proof travels in the sidecar (the default hand-off) instead.
 */
export type PublishableArtifactKind = 'update' | 'announcement' | 'genesis';

/** One block of the controller's IPFS publish plan. */
export interface PublishableArtifact {
  kind: PublishableArtifactKind;
  /** Human label for UI rows and logs. */
  label: string;
  /** Hex sha256 digest: the store key / on-chain commitment. */
  hashHex: string;
  /** The canonical CIDv1 (base32) addressing {@link bytes}. */
  cid: string;
  /** The exact JCS bytes the digest commits to (the block payload, verbatim). */
  bytes: Uint8Array;
}

/**
 * Build the controller's IPFS publish plan from their own captured artifacts
 * (the same inputs as the sidecar). Always includes the signed update body; adds
 * the CAS announcement map (CAS cohorts) and the genesis document (EXTERNAL/x1
 * controllers, whose DID is only a hash commitment to it) when present. Each
 * entry carries the exact canonical bytes plus the derived digest/CID, so
 * `sha256(bytes) === hashHex === cid.multihash.digest` by construction.
 */
export function buildPublishPlan(input: {
  update: object;
  casAnnouncement?: Record<string, string>;
  genesisDocument?: Record<string, unknown>;
}): PublishableArtifact[] {
  const entry = (kind: PublishableArtifactKind, label: string, artifact: object): PublishableArtifact => {
    const hashHex = artifactHashHex(artifact);
    return { kind, label, hashHex, cid: cidStringFromHashHex(hashHex), bytes: canonicalArtifactBytes(artifact) };
  };
  const plan: PublishableArtifact[] = [entry('update', 'signed update', input.update)];
  if (input.casAnnouncement) {
    plan.push(entry('announcement', 'CAS announcement', input.casAnnouncement));
  }
  if (input.genesisDocument) {
    plan.push(entry('genesis', 'genesis document', input.genesisDocument));
  }
  return plan;
}
