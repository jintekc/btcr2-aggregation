/**
 * The participation-terms acceptance record: a FROZEN proof format (SVC-05, D-19).
 *
 * When an operator sets participation terms, joining through this web app requires the
 * participant to accept them, and that acceptance is recorded as a DID-signed artifact. This
 * module owns the record's shape, its canonical bytes, and its two hashes. It is deliberately
 * tiny and dependency-light because THREE separate surfaces build or read the identical bytes
 * and must never disagree about them:
 *
 * - `packages/web/src/stores/participant.ts` builds the record and signs its canonical hash with
 *   the participant's own key, in the browser.
 * - `packages/service/src/hono-adapter.ts` (`POST /v1/terms/acceptance`) rebuilds the same
 *   canonical bytes to verify that signature, and stores the record under
 *   {@link termsAcceptanceHashHex}.
 * - `packages/service/src/store.ts` serves it back by that hash through the existing
 *   hash-addressed public read.
 *
 * ## Why this file says "frozen"
 *
 * The moment a real participant signs an acceptance, this shape stops being an implementation
 * detail and becomes a proof format someone may rely on. Adding, removing, or renaming a field
 * afterwards either invalidates every stored signature (the canonical bytes move) or, worse,
 * quietly changes what an already-stored acceptance asserts. So the field set is pinned by
 * KEY-SET EQUALITY in `packages/shared/tests/tos.spec.ts` against {@link TERMS_ACCEPTANCE_FIELDS},
 * in the same spirit as the frozen public DTOs and the frozen phase sets in `./phases.js`.
 * Changing it is a deliberate, versioned act, not a refactor.
 *
 * ## The two rules that make this a proof rather than theatre
 *
 * 1. **The record binds the terms HASH, never the terms text.** `termsHash` is the sha256 of the
 *    exact document the participant was shown. An operator who edits their terms afterwards
 *    therefore cannot retroactively change what an old acceptance means: the old record still
 *    names the old hash, and the new terms simply do not match it.
 * 2. **There is exactly ONE canonicalization in this codebase.** {@link termsAcceptanceBytes}
 *    runs the same JCS canonicalization the app's canonical update hash uses (`canonicalize` /
 *    `canonicalHashBytes` from `@did-btcr2/common`, the pipeline behind `updateHashHex` and
 *    `updateHashBytes` in `./index.js`). No second serializer is introduced here, because two
 *    canonicalizations in one codebase is precisely how proof formats silently diverge: the
 *    browser signs one byte string and the service verifies another, and the failure surfaces
 *    as an unexplainable invalid signature months later.
 *
 * ## What this module deliberately does NOT do
 *
 * It does not sign, verify, or store anything. The participant's private key stays in the
 * browser and the verification key is resolved from the DID server-side, so both of those
 * belong to their own sides of the wire; this module only defines the bytes they agree on.
 */

import { canonicalHash, canonicalize } from '@did-btcr2/common';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

/**
 * The JSON-LD context URI this app already stamps on its resolution sidecar and on the artifacts
 * it stores (`packages/web/src/lib/sidecar.ts`, `packages/service/src/store.ts`). Reused verbatim
 * rather than minting a second URI for this record: an acceptance is one more btcr2 artifact, not
 * a new vocabulary.
 */
export const BTCR2_CONTEXT = 'https://btcr2.dev/context/v1';

/**
 * The record's type discriminator. Present so a stored blob names what it is without reference to
 * the route that produced it, and so a signature over these bytes is domain-separated from every
 * other object this app signs (an update body, a genesis document): a signature made over an
 * acceptance can never be replayed as a signature over something else.
 */
export const TERMS_ACCEPTANCE_TYPE = 'ParticipationTermsAcceptance';

/**
 * The FROZEN field set. Exported so the spec can pin it by key-set equality and so the
 * per-field hash-sensitivity rows are driven from one list rather than a re-typed copy. Order is
 * irrelevant to the canonical bytes (JCS sorts keys); this array is the membership contract.
 */
export const TERMS_ACCEPTANCE_FIELDS = [
  '@context',
  'type',
  'serviceDid',
  'cohortId',
  'termsHash',
  'participantDid',
  'acceptedAt',
] as const;

/**
 * A participant's signed-in-the-browser agreement to one service's participation terms.
 *
 * Every field is a string, so the record canonicalizes and travels as plain JSON with no
 * encoding decisions to get wrong. The shape is FROZEN (see the module docstring).
 */
export interface TermsAcceptance {
  /** {@link BTCR2_CONTEXT}. */
  '@context': string;
  /** {@link TERMS_ACCEPTANCE_TYPE}. */
  type: string;
  /**
   * The DID of the service whose terms these are. Present so an acceptance made to one service
   * cannot be replayed to a different service that happens to publish identical terms text.
   */
  serviceDid: string;
  /** The cohort the participant was joining when they accepted. */
  cohortId: string;
  /**
   * {@link termsHashHex} of the EXACT terms text the participant was shown. The whole binding
   * rule lives in this one field: a later terms edit leaves this hash, and therefore this
   * record's meaning, untouched.
   */
  termsHash: string;
  /** The accepting participant's DID. The signature must verify against this DID's key. */
  participantDid: string;
  /** ISO 8601 (`toISOString`) instant at which the participant accepted. */
  acceptedAt: string;
}

/** The inputs a caller supplies; the context, the type, and (optionally) the time are filled in. */
export interface TermsAcceptanceInput {
  serviceDid: string;
  cohortId: string;
  termsHash: string;
  participantDid: string;
  /** Defaults to now. Supplied explicitly by specs so a record can be rebuilt byte-identically. */
  acceptedAt?: string;
}

/**
 * The hex sha256 of the exact terms text a participant was shown.
 *
 * Taken over the UTF-8 bytes of the string with NO normalization of any kind: no trimming, no
 * whitespace collapsing, no case folding. Two bodies that differ by a trailing newline are
 * different documents to a person being asked to agree to them, so they are different documents
 * here too. The service compares a submitted `termsHash` against this function applied to its own
 * CURRENT terms text, which is what makes "these are the terms you actually saw" checkable rather
 * than assumed.
 */
export function termsHashHex(termsText: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(termsText)));
}

/**
 * Build the canonical acceptance record from its caller-supplied parts.
 *
 * Deterministic given identical inputs (including `acceptedAt`), which is what lets the browser
 * and the service arrive independently at the same bytes.
 */
export function buildTermsAcceptance(input: TermsAcceptanceInput): TermsAcceptance {
  return {
    '@context': BTCR2_CONTEXT,
    type: TERMS_ACCEPTANCE_TYPE,
    serviceDid: input.serviceDid,
    cohortId: input.cohortId,
    termsHash: input.termsHash,
    participantDid: input.participantDid,
    acceptedAt: input.acceptedAt ?? new Date().toISOString(),
  };
}

/**
 * The record's canonical bytes: JCS-canonicalized JSON, UTF-8 encoded.
 *
 * The SAME canonicalization the app's canonical update hash uses (`canonicalize` from
 * `@did-btcr2/common`, the first stage of the `updateHashHex` / `updateHashBytes` pipeline in
 * `./index.js`). Exposed as bytes rather than a string so the callers that hash or sign it never
 * have to make their own encoding decision.
 */
export function termsAcceptanceBytes(acceptance: TermsAcceptance): Uint8Array {
  return new TextEncoder().encode(canonicalize(acceptance as unknown as Record<string, unknown>));
}

/**
 * The record's canonical hash, hex.
 *
 * Two jobs in one value. It is the 32 bytes the participant's key signs (see
 * {@link termsAcceptanceSigningBytes}), and it is the store key the verified artifact is written
 * under, exactly like every other content-addressed artifact this service holds. Same
 * canonicalize -> sha256 -> hex pipeline as `updateHashHex`.
 */
export function termsAcceptanceHashHex(acceptance: TermsAcceptance): string {
  return canonicalHash(acceptance as unknown as Record<string, unknown>, { encoding: 'hex' });
}

/**
 * The exact 32 bytes a participant's key signs, and the exact 32 bytes the service verifies
 * against.
 *
 * The canonical HASH rather than the canonical JSON, mirroring how this app already signs a
 * did:btcr2 update (the OP_RETURN payload is `updateHashBytes`, not the update body). A fixed
 * 32-byte signing input also means an unbounded terms document can never grow the signing
 * operation, and the record's `@context` + `type` fields keep it domain-separated from anything
 * else this key signs.
 */
export function termsAcceptanceSigningBytes(acceptance: TermsAcceptance): Uint8Array {
  return sha256(termsAcceptanceBytes(acceptance));
}
