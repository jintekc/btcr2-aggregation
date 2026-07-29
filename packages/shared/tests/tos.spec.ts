import { describe, expect, it } from 'vitest';
import {
  BTCR2_CONTEXT,
  TERMS_ACCEPTANCE_FIELDS,
  TERMS_ACCEPTANCE_TYPE,
  buildTermsAcceptance,
  termsAcceptanceBytes,
  termsAcceptanceHashHex,
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
    const { acceptedAt: _drop, ...withoutTime } = BASE;
    const record = buildTermsAcceptance(withoutTime);
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
