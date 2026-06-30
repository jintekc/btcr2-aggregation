import { canonicalHash, decode, encode } from '@did-btcr2/common';
import type { ArtifactStore } from './store.js';

/**
 * A serialized SMT proof, reduced to the fields persistence reads. `id` is the
 * SMT root hash (base64urlnopad), shared by every proof in a cohort; `updateId`
 * is the base64urlnopad canonical hash of this member's signed update, present
 * for an inclusion leaf and absent for a cooperative non-inclusion (decliner).
 * Structurally compatible with `@did-btcr2/smt`'s `SerializedSMTProof`.
 */
interface PersistableProof {
  readonly id: string;
  readonly updateId?: string;
}

/**
 * The read-only view of a completed {@link import('@did-btcr2/aggregation').AggregationCohort}
 * that persistence harvests. A real `AggregationCohort` satisfies this shape (the
 * assignability is checked where `createService` passes one in), and so does a
 * synthetic object, which keeps the keying unit-testable with no chain.
 *
 * The artifacts live here, on the cohort accessor, NOT on the `signing-complete`
 * `AggregationResult`: a handler that reads only the result persists nothing and
 * resolution silently fails. This is the highest-risk gotcha M3 calls out.
 */
export interface PersistableCohort {
  /**
   * Per-member signed update bodies, keyed by DID. Despite the "pending" name,
   * these remain populated after the cohort completes; they are the
   * `NeedSignedUpdate` / `updateMap` artifacts, required for BOTH beacon types.
   */
  readonly pendingUpdates: ReadonlyMap<string, Record<string, unknown>>;
  /**
   * CAS Announcement map (DID -> base64urlnopad update hash). Present only for a
   * CAS cohort; its canonical hash is the on-chain `signalBytes`.
   */
  readonly casAnnouncement?: Readonly<Record<string, string>>;
  /**
   * Per-member SMT proofs, keyed by DID. Present only for an SMT cohort. Every
   * proof shares one root (`proof.id`); the per-DID `updateId` distinguishes them.
   */
  readonly smtProofs?: ReadonlyMap<string, PersistableProof>;
}

/** Tally of what {@link persistCohortArtifacts} wrote, for logging and assertions. */
export interface PersistSummary {
  /** Signed update bodies persisted (one per member; both beacon types). */
  updates: number;
  /** CAS announcement maps persisted (0 for SMT, 1 for CAS). */
  announcements: number;
  /** SMT inclusion proofs persisted, keyed by per-DID update hash. */
  proofs: number;
  /**
   * SMT proofs skipped because they carry no `updateId` (a cooperative
   * non-inclusion / decliner leaf): there is no per-DID update hash to
   * content-address them by. Decliners never occur in the fixture path; full
   * non-inclusion persistence is an M3d concern. Surfaced rather than silently
   * dropped so the count is observable.
   */
  skippedProofs: number;
}

/**
 * Persist a completed cohort's off-chain resolution artifacts into `store`, under
 * the exact hex keys a did:btcr2 resolver will request. Hashing and encoding go
 * through `@did-btcr2/common` (`canonicalHash` / `encode` / `decode`) - the same
 * functions {@link import('@did-btcr2/method').Resolver} uses - so the store keys
 * match the resolver's `updateMap` / `casMap` keys and its `NeedSignedUpdate` /
 * `NeedCASAnnouncement` / `NeedSMTProof` hashes with zero mismatch:
 *
 *   - Each signed update -> `update` namespace, keyed by
 *     `canonicalHash(update, { encoding: 'hex' })` (the resolver's `updateMap`
 *     key and `NeedSignedUpdate.updateHash`). Both beacon types.
 *   - The CAS announcement (CAS cohorts) -> `announcement` namespace, keyed by
 *     `canonicalHash(announcement, { encoding: 'hex' })`, which equals the hex of
 *     the on-chain `signalBytes` and the resolver's `casMap` key /
 *     `NeedCASAnnouncement.announcementHash`.
 *   - Each SMT proof (SMT cohorts) -> `proof` namespace, keyed by that DID's hex
 *     update hash `encode(decode(proof.updateId, 'base64urlnopad'), 'hex')`. Every
 *     proof in a cohort shares ONE root (`proof.id`), so a flat root-keyed store
 *     would collide and keep only one proof. SMT resolution is inherently per-DID
 *     (resolve DID X with X's own proof), and the per-DID update hash is unique
 *     and equals X's update-body key, so the per-DID resolve driver can fetch the
 *     right proof. A proof without `updateId` (decliner) is skipped and counted.
 *
 * Idempotent: re-persisting a cohort overwrites identical keys with identical
 * values. Returns a {@link PersistSummary} of what was written.
 */
export async function persistCohortArtifacts(
  store: ArtifactStore,
  cohort: PersistableCohort,
): Promise<PersistSummary> {
  const summary: PersistSummary = { updates: 0, announcements: 0, proofs: 0, skippedProofs: 0 };

  // 1. Per-member signed update bodies (both beacon types).
  for (const update of cohort.pendingUpdates.values()) {
    await store.put('update', canonicalHash(update, { encoding: 'hex' }), update);
    summary.updates += 1;
  }

  // 2. CAS announcement map (CAS cohorts only).
  if (cohort.casAnnouncement) {
    const key = canonicalHash(cohort.casAnnouncement, { encoding: 'hex' });
    await store.put('announcement', key, cohort.casAnnouncement);
    summary.announcements += 1;
  }

  // 3. SMT proofs (SMT cohorts only), keyed per-DID by hex update hash.
  if (cohort.smtProofs) {
    for (const proof of cohort.smtProofs.values()) {
      if (!proof.updateId) {
        summary.skippedProofs += 1;
        continue;
      }
      const key = encode(decode(proof.updateId, 'base64urlnopad'), 'hex');
      await store.put('proof', key, proof);
      summary.proofs += 1;
    }
  }

  return summary;
}
