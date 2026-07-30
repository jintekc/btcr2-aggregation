import { describe, expect, it } from 'vitest';
import { hexToBytes } from '@noble/hashes/utils';
import {
  BTCR2_CONTEXT,
  TERMS_ACCEPTANCE_FIELDS,
  TERMS_ACCEPTANCE_TYPE,
  buildTermsAcceptance,
  termsAcceptanceBytes,
  termsAcceptanceHashHex,
  termsAcceptanceSigningBytes,
  termsHashHex,
  type TermsAcceptance,
} from '../src/tos.js';

/**
 * The FROZEN participation-terms acceptance record (SVC-05, D-19).
 *
 * This is the one spec in the repo whose job is to make a format hard to change. Once a real
 * participant has signed an acceptance, the record shape is a proof format someone may rely on:
 * a field added, removed, or renamed after that point either invalidates every stored signature
 * or silently changes what an old acceptance means. So the field set is pinned by KEY-SET
 * EQUALITY rather than by presence checks, because a presence check passes happily while an
 * eighth field quietly joins the record.
 *
 * Three properties carry the weight:
 *
 * 1. **Determinism.** Two builds from identical inputs produce byte-identical canonical bytes
 *    and the same hash, so the browser and the service can independently arrive at the same
 *    signing input.
 * 2. **Sensitivity.** Changing ANY single field changes the hash. Asserted field by field over
 *    the frozen key set (driven from {@link TERMS_ACCEPTANCE_FIELDS}, so a new field cannot be
 *    added without also being covered here).
 * 3. **Terms binding.** {@link termsHashHex} is taken over the exact terms text, so an
 *    acceptance names the document it was shown rather than whatever the operator's terms say
 *    later.
 */

const TERMS = 'Be excellent to each other. Party on.';

const BASE = {
  serviceDid: 'did:btcr2:k1qqpqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqservice',
  cohortId: 'cohort-abc-123',
  termsHash: termsHashHex(TERMS),
  participantDid: 'did:btcr2:k1qqpqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqparticipant',
  acceptedAt: '2026-07-29T12:00:00.000Z',
};

describe('termsHashHex: the acceptance binds the terms HASH, never the terms text', () => {
  it('is a 64-char lowercase hex sha256 of the exact text', () => {
    const hash = termsHashHex(TERMS);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable across repeated calls with the identical string', () => {
    expect(termsHashHex(TERMS)).toBe(termsHashHex(`${TERMS}`));
  });

  it('changes for ANY difference in the text, including whitespace', () => {
    // Whitespace matters because whitespace is part of the document a participant read. Two
    // terms bodies that differ only in a trailing newline are different documents to a reader
    // being asked to agree, so they must be different documents to the hash as well.
    expect(termsHashHex(TERMS)).not.toBe(termsHashHex(`${TERMS} `));
    expect(termsHashHex(TERMS)).not.toBe(termsHashHex(TERMS.replace('. ', '.\n')));
    expect(termsHashHex('')).not.toBe(termsHashHex(' '));
  });

  it('hashes the UTF-8 bytes, so a non-ASCII terms body is not mangled', () => {
    expect(termsHashHex('Sé excelente.')).toMatch(/^[0-9a-f]{64}$/);
    expect(termsHashHex('Sé excelente.')).not.toBe(termsHashHex('Se excelente.'));
  });
});

describe('buildTermsAcceptance: the FROZEN record shape', () => {
  it('carries exactly the frozen field set, asserted by key-set equality', () => {
    const record = buildTermsAcceptance(BASE);
    // Key-set EQUALITY, not a presence check: an accidental eighth field must fail here
    // rather than silently change what a stored acceptance means.
    expect(Object.keys(record).sort()).toEqual([...TERMS_ACCEPTANCE_FIELDS].sort());
  });

  it('names itself: the shared context URI and the acceptance type discriminator', () => {
    const record = buildTermsAcceptance(BASE);
    expect(record['@context']).toBe(BTCR2_CONTEXT);
    expect(record.type).toBe(TERMS_ACCEPTANCE_TYPE);
    // The context is the one this app already uses for its resolution sidecar and its stored
    // artifacts, NOT a new URI minted for this record.
    expect(BTCR2_CONTEXT).toBe('https://btcr2.dev/context/v1');
  });

  it('copies the caller-supplied fields verbatim', () => {
    const record = buildTermsAcceptance(BASE);
    expect(record.serviceDid).toBe(BASE.serviceDid);
    expect(record.cohortId).toBe(BASE.cohortId);
    expect(record.termsHash).toBe(BASE.termsHash);
    expect(record.participantDid).toBe(BASE.participantDid);
    expect(record.acceptedAt).toBe(BASE.acceptedAt);
  });

  it('stamps an ISO 8601 acceptedAt when the caller supplies none', () => {
    const record = buildTermsAcceptance({
      serviceDid: BASE.serviceDid,
      cohortId: BASE.cohortId,
      termsHash: BASE.termsHash,
      participantDid: BASE.participantDid,
    });
    expect(record.acceptedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

describe('the canonical bytes and hash of an acceptance', () => {
  it('are byte-identical across repeated builds from identical inputs', () => {
    const a = termsAcceptanceBytes(buildTermsAcceptance(BASE));
    const b = termsAcceptanceBytes(buildTermsAcceptance(BASE));
    expect(a).toEqual(b);
    expect(termsAcceptanceHashHex(buildTermsAcceptance(BASE))).toBe(
      termsAcceptanceHashHex(buildTermsAcceptance(BASE)),
    );
  });

  it('are insensitive to the ORDER the fields were written in (JCS canonicalization)', () => {
    // The browser and the service build this record in different code; only canonicalization
    // makes their bytes agree. Asserted by reversing the key insertion order.
    const record = buildTermsAcceptance(BASE);
    const reordered = Object.fromEntries(
      Object.entries(record).reverse(),
    ) as unknown as TermsAcceptance;
    expect(termsAcceptanceBytes(reordered)).toEqual(termsAcceptanceBytes(record));
    expect(termsAcceptanceHashHex(reordered)).toBe(termsAcceptanceHashHex(record));
  });

  it('is a 32-byte hash surfaced as 64 lowercase hex characters', () => {
    expect(termsAcceptanceHashHex(buildTermsAcceptance(BASE))).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when ANY single field changes, field by field over the frozen set', () => {
    const base = buildTermsAcceptance(BASE);
    const baseHash = termsAcceptanceHashHex(base);
    // Driven from the frozen field list, so a field added to the record without being
    // considered here fails this row rather than going uncovered.
    for (const field of TERMS_ACCEPTANCE_FIELDS) {
      const mutated = { ...base, [field]: `${base[field]}-changed` } as TermsAcceptance;
      expect(termsAcceptanceHashHex(mutated), `changing ${field} must change the hash`).not.toBe(
        baseHash,
      );
    }
  });
});

/**
 * KNOWN-ANSWER vectors (05-AUDIT-2.md entry 7, defect #6).
 *
 * Every other assertion in this file, and every one in `packages/service/src/hono-adapter.ts`'s
 * spec and `packages/web/tests/terms.spec.ts`, is shape-only (`/^[0-9a-f]{64}$/`) or
 * self-consistent (this function compared against itself). That is the one shape of assertion that
 * cannot fail when the function changes: swap `sha256` for any other 32-byte digest in
 * `@noble/hashes` and all of them stay green, because both sides of every comparison move together.
 *
 * The consequence is not internal. This record is a FROZEN proof format (SVC-05, D-19): a third
 * party handed a stored acceptance is expected to verify it with STANDARD SHA-256. A digest swap
 * would leave this repo entirely self-consistent while making every stored acceptance unverifiable
 * by anyone outside it, and the break would surface as an unexplainable mismatch long afterwards.
 *
 * So the expected values below are external constants, not derived from anything in this codebase.
 * The empty string and `abc` are the published SHA-256 test vectors; the non-ASCII line was taken
 * from GNU coreutils `sha256sum` over its UTF-8 bytes, an implementation with no relationship to
 * this one. Pinning a non-ASCII body pins the ENCODING step as well as the digest: a swap to
 * latin1 or UTF-16 would leave the ASCII vectors green.
 */
describe('termsHashHex answers the STANDARD SHA-256, verifiable outside this codebase (audit #6)', () => {
  it('matches the published SHA-256 of the empty string', () => {
    expect(termsHashHex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('matches the published SHA-256 of "abc"', () => {
    expect(termsHashHex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('matches the external SHA-256 of a NON-ASCII body, so the UTF-8 step is pinned too', () => {
    // `sha256sum` over the same 14 UTF-8 bytes. An encoding change alone reddens this row while
    // leaving the two ASCII rows above untouched.
    expect(termsHashHex('Sé excelente.')).toBe(
      '0244e5b9ccf5c78602f521eb396812c316b0cee9e167bd966c15e5752a00bc55',
    );
  });
});

describe('termsAcceptanceSigningBytes IS the canonical record hash, not a second derivation', () => {
  it('equals the raw bytes of termsAcceptanceHashHex, decoded from its hex', () => {
    const record = buildTermsAcceptance(BASE);
    // Two values that agree today are not the same value. The browser signs these bytes and the
    // service verifies against them, while the SAME hash is the store key the verified artifact is
    // written under; if the signing input ever stopped being that hash, a stored acceptance would
    // be filed under a key its own signature does not cover.
    expect(termsAcceptanceSigningBytes(record)).toEqual(hexToBytes(termsAcceptanceHashHex(record)));
    expect(termsAcceptanceSigningBytes(record)).toHaveLength(32);
  });

  it('is domain-separated: the signing bytes are never the plain hash of the terms text', () => {
    const record = buildTermsAcceptance(BASE);
    // The record's own `@context` and `type` are inside the canonical bytes, so an acceptance
    // signature can never be replayed as a signature over the terms document itself.
    expect(termsAcceptanceSigningBytes(record)).not.toEqual(hexToBytes(BASE.termsHash));
  });
});
