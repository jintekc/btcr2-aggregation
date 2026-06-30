import { canonicalHash, decode, encode } from '@did-btcr2/common';
import { Resolver } from '@did-btcr2/method';
import { describe, expect, it } from 'vitest';
import { exportSidecar, MemoryArtifactStore } from './store.js';
import { persistCohortArtifacts, type PersistableCohort } from './persist.js';

// Deterministic, hermetic coverage of the persist keying: synthetic cohort-shaped
// data (no chain, no live cohort) exercised through the exact `@did-btcr2/common`
// hashing the resolver uses, then round-tripped through the real
// `Resolver.sidecarData`. The live-cohort proof lives in e2e/persist-cohort.ts.

const DID_A = 'did:btcr2:k1qexampleparticipantone';
const DID_B = 'did:btcr2:k1qexampleparticipanttwo';
const DID_C = 'did:btcr2:k1qexampleparticipantthree';

/** hex canonical hash - the resolver's updateMap/casMap key and store key. */
const hex = (obj: Record<string, unknown>): string => canonicalHash(obj, { encoding: 'hex' });
/** base64urlnopad canonical hash - the cohort's CAS map / SMT updateId encoding. */
const b64 = (obj: Record<string, unknown>): string =>
  canonicalHash(obj, { encoding: 'base64urlnopad' });
/** Re-encode a base64urlnopad hash as hex (the cohort -> store encoding bridge). */
const hexOfB64 = (s: string): string => encode(decode(s, 'base64urlnopad'), 'hex');

/** A structurally-valid signed did:btcr2 update; `seed` makes each one distinct. */
function makeUpdate(slug: 'cas' | 'smt', seed: string): Record<string, unknown> {
  return {
    '@context': ['https://w3id.org/security/v2', 'https://w3id.org/json-ld-patch/v1'],
    patch: [
      {
        op: 'add',
        path: '/service/-',
        value: {
          id: `did:btcr2:${seed}#beacon-${slug}`,
          type: slug === 'cas' ? 'CASBeacon' : 'SMTBeacon',
          serviceEndpoint: `bitcoin:tb1pexample${seed}`,
        },
      },
    ],
    sourceHash: `z6Mksource${seed}`,
    targetHash: `z6Mktarget${seed}`,
    targetVersionId: 2,
    proof: {
      type: 'DataIntegrityProof',
      cryptosuite: 'bip340-jcs-2025',
      verificationMethod: `did:btcr2:${seed}#0`,
      proofPurpose: 'assertionMethod',
      proofValue: `zsig${seed}`,
    },
  };
}

// One shared SMT root (all per-DID proofs in a cohort carry the same `id`), plus
// fixed valid 43-char base64urlnopad blobs for the proof's other fields.
const SMT_ROOT_B64 = 'TgdAhWK-24tgzgXB3s_jrRa3IjCWfeAfZAt-Rym0n84';
const NONCE_B64 = 'zzdAhWK-24tgzgXB3s_jrRa3IjCWfeAfZAt-Rym0abc';
const COLLAPSED_B64 = 'v_________________________________________8';
const SIBLING_B64 = 'QQdAhWK-24tgzgXB3s_jrRa3IjCWfeAfZAt-Rym0n01';

interface Proof {
  id: string;
  nonce: string;
  updateId?: string;
  collapsed: string;
  hashes: string[];
}

/** An SMT inclusion proof binding this DID's update via `updateId`. */
function inclusionProof(update: Record<string, unknown>): Proof {
  return { id: SMT_ROOT_B64, nonce: NONCE_B64, updateId: b64(update), collapsed: COLLAPSED_B64, hashes: [SIBLING_B64] };
}

describe('persistCohortArtifacts - CAS cohort', () => {
  const updateA = makeUpdate('cas', 'aaa');
  const updateB = makeUpdate('cas', 'bbb');
  const casAnnouncement: Record<string, string> = { [DID_A]: b64(updateA), [DID_B]: b64(updateB) };
  const cohort: PersistableCohort = {
    pendingUpdates: new Map([
      [DID_A, updateA],
      [DID_B, updateB],
    ]),
    casAnnouncement,
  };

  it('persists each signed update under its hex canonical hash (the resolver updateMap key)', async () => {
    const store = new MemoryArtifactStore();
    const summary = await persistCohortArtifacts(store, cohort);
    expect(summary).toEqual({ updates: 2, announcements: 1, proofs: 0, skippedProofs: 0 });

    const updateKeys = (await store.entries('update')).map(([k]) => k).sort();
    expect(updateKeys).toEqual([hex(updateA), hex(updateB)].sort());
    expect(await store.get('update', hex(updateA))).toEqual(updateA);
    expect(await store.get('update', hex(updateB))).toEqual(updateB);
  });

  it('persists the CAS announcement under its hex canonical hash (the resolver casMap key)', async () => {
    const store = new MemoryArtifactStore();
    await persistCohortArtifacts(store, cohort);
    expect(await store.has('announcement', hex(casAnnouncement))).toBe(true);
    expect(await store.get('announcement', hex(casAnnouncement))).toEqual(casAnnouncement);
  });

  it("keys each update body the same way the CAS map's base64url hash decodes to hex", async () => {
    // The store update key (hex canonical hash) must equal the announcement's
    // base64url update hash decoded to hex: the encoding bridge the resolver crosses.
    expect(hex(updateA)).toBe(hexOfB64(casAnnouncement[DID_A]));
    expect(hex(updateB)).toBe(hexOfB64(casAnnouncement[DID_B]));
  });

  it('round-trips exportSidecar -> Resolver.sidecarData with matching keys', async () => {
    const store = new MemoryArtifactStore();
    await persistCohortArtifacts(store, cohort);

    const data = Resolver.sidecarData(await exportSidecar(store));
    expect([...data.updateMap.keys()].sort()).toEqual([hex(updateA), hex(updateB)].sort());
    expect([...data.casMap.keys()]).toEqual([hex(casAnnouncement)]);
    expect(data.smtMap.size).toBe(0);
  });
});

describe('persistCohortArtifacts - SMT cohort', () => {
  const updateA = makeUpdate('smt', 'aaa');
  const updateB = makeUpdate('smt', 'bbb');
  const proofA = inclusionProof(updateA);
  const proofB = inclusionProof(updateB);
  const cohort: PersistableCohort = {
    pendingUpdates: new Map([
      [DID_A, updateA],
      [DID_B, updateB],
    ]),
    smtProofs: new Map([
      [DID_A, proofA],
      [DID_B, proofB],
    ]),
  };

  it('persists each proof under that DID\'s hex update hash (== that DID\'s update key)', async () => {
    const store = new MemoryArtifactStore();
    const summary = await persistCohortArtifacts(store, cohort);
    expect(summary).toEqual({ updates: 2, announcements: 0, proofs: 2, skippedProofs: 0 });

    const proofKeys = (await store.entries('proof')).map(([k]) => k).sort();
    // Per-DID proof key == per-DID update body key == updateId-decoded-to-hex.
    expect(proofKeys).toEqual([hex(updateA), hex(updateB)].sort());
    expect(proofKeys).toEqual([hexOfB64(proofA.updateId!), hexOfB64(proofB.updateId!)].sort());
    expect(await store.get('proof', hex(updateA))).toEqual(proofA);
  });

  it('collapses to ONE root-keyed smtMap entry on sidecarData (why the store keys per-DID)', async () => {
    const store = new MemoryArtifactStore();
    await persistCohortArtifacts(store, cohort);

    const data = Resolver.sidecarData(await exportSidecar(store));
    // Both proofs share one root, so the resolver's root-keyed smtMap holds one
    // entry - exactly why a flat root-keyed STORE would lose a proof and we key
    // per-DID instead. SMT resolution is per-DID: resolve X with X's own proof.
    expect(data.smtMap.size).toBe(1);
    expect([...data.smtMap.keys()]).toEqual([hexOfB64(SMT_ROOT_B64)]);
    expect([...data.updateMap.keys()].sort()).toEqual([hex(updateA), hex(updateB)].sort());
    expect(data.casMap.size).toBe(0);
  });
});

describe('persistCohortArtifacts - edge cases', () => {
  it('skips (and counts) a non-inclusion proof that carries no updateId', async () => {
    const updateA = makeUpdate('smt', 'aaa');
    const proofA = inclusionProof(updateA);
    // A cooperative decliner: a proof with no updateId, not content-addressable by
    // update hash. It must be skipped, not silently break the whole persist.
    const decliner: Proof = { id: SMT_ROOT_B64, nonce: NONCE_B64, collapsed: COLLAPSED_B64, hashes: [SIBLING_B64] };
    const cohort: PersistableCohort = {
      pendingUpdates: new Map([[DID_A, updateA]]),
      smtProofs: new Map([
        [DID_A, proofA],
        [DID_C, decliner],
      ]),
    };

    const store = new MemoryArtifactStore();
    const summary = await persistCohortArtifacts(store, cohort);
    expect(summary).toEqual({ updates: 1, announcements: 0, proofs: 1, skippedProofs: 1 });
    expect(await store.entries('proof')).toHaveLength(1);
    expect(await store.has('proof', hex(updateA))).toBe(true);
  });

  it('persists nothing for an empty cohort and exports a bare sidecar', async () => {
    const store = new MemoryArtifactStore();
    const summary = await persistCohortArtifacts(store, { pendingUpdates: new Map() });
    expect(summary).toEqual({ updates: 0, announcements: 0, proofs: 0, skippedProofs: 0 });

    const sidecar = await exportSidecar(store);
    expect(sidecar).toEqual({ '@context': 'https://btcr2.dev/context/v1' });
    const data = Resolver.sidecarData(sidecar);
    expect(data.updateMap.size).toBe(0);
    expect(data.casMap.size).toBe(0);
    expect(data.smtMap.size).toBe(0);
  });

  it('is idempotent: re-persisting overwrites identical keys with identical values', async () => {
    const updateA = makeUpdate('cas', 'aaa');
    const cohort: PersistableCohort = {
      pendingUpdates: new Map([[DID_A, updateA]]),
      casAnnouncement: { [DID_A]: b64(updateA) },
    };
    const store = new MemoryArtifactStore();
    await persistCohortArtifacts(store, cohort);
    await persistCohortArtifacts(store, cohort);
    expect(await store.entries('update')).toHaveLength(1);
    expect(await store.entries('announcement')).toHaveLength(1);
    expect(await store.get('update', hex(updateA))).toEqual(updateA);
  });
});
