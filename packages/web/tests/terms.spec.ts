import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BTCR2_CONTEXT,
  TERMS_ACCEPTANCE_FIELDS,
  TERMS_ACCEPTANCE_TYPE,
  buildTermsAcceptance,
  createExternalIdentity,
  createIdentity,
  resolveNetwork,
  termsAcceptanceSigningBytes,
  termsHashHex,
} from '@btcr2-aggregation/shared';
import {
  TERMS_ACCEPTANCE_FAILED,
  buildTermsEnvelope,
  termsAcceptedFor,
  useParticipant,
} from '../src/stores/participant';
import { TERMS_COPY, acceptedAtLine, termsStepVisible } from '../src/components/browse/TermsStep';

/**
 * The participation-terms join step (SVC-05, D-19, UI-SPEC E15).
 *
 * Four properties carry this feature and all four are asserted here rather than described.
 *
 * 1. **Absent means absent.** With no terms set the step renders NOTHING: not an empty card, not
 *    a "no terms" placeholder. The render predicate is pure and pinned, including the
 *    whitespace-only case, because a body of spaces is not a document anyone can agree to.
 * 2. **The browser signs the SAME bytes the service verifies.** The envelope builder is compared
 *    against the shared builder's output for identical inputs, and the signature is verified
 *    against the participant's own public key over the shared signing bytes. If those two ever
 *    drift, every acceptance this app makes becomes unverifiable, and the failure would surface
 *    as an unexplainable refusal rather than as a broken build.
 * 3. **The terms body is never markup.** Asserted by reading the component source and walking it
 *    for every dangerous HTML prop, plus the presence of the scroll cap and the wrap rule. A
 *    source assertion rather than a DOM one on purpose: the property being defended is that the
 *    dangerous prop does not EXIST in the file, which no rendered snapshot can prove.
 * 4. **A failed acceptance stops the join.** Driven through the real store: `join` refuses when
 *    terms are set and no acceptance is recorded FOR THAT COHORT, so a component bug cannot seat
 *    a participant whose acceptance was never stored.
 *
 * Node env, no DOM: everything asserted here is either pure, source-level, or a store action.
 */

// A no-op participant, so the ungated-join row below can prove the gate did not fire without
// opening a real SSE transport at a port nobody is listening on (the seats spec's pattern).
vi.mock('@btcr2-aggregation/participant', async () => {
  const { EventEmitter } = await import('node:events');
  return {
    createParticipant: () => ({ runner: new EventEmitter(), start: async () => {}, stop: () => {} }),
  };
});

const NET = resolveNetwork('signet');
const TERMS = 'Be excellent to each other.\nParty on.';
const COHORT = 'cohort-abc-123';

/** The component source, read once for the escaping/containment assertions. */
const TERMS_STEP_SRC = readFileSync(
  fileURLToPath(new URL('../src/components/browse/TermsStep.tsx', import.meta.url)),
  'utf8',
);

describe('termsStepVisible: no terms means no step at all (UI-SPEC E15 empty)', () => {
  it('is false for absent, null, empty, and whitespace-only terms', () => {
    expect(termsStepVisible(undefined)).toBe(false);
    expect(termsStepVisible(null)).toBe(false);
    expect(termsStepVisible('')).toBe(false);
    expect(termsStepVisible('   ')).toBe(false);
    expect(termsStepVisible('\n\t  \n')).toBe(false);
  });

  it('is true for any real terms body, including one that is only punctuation', () => {
    expect(termsStepVisible(TERMS)).toBe(true);
    expect(termsStepVisible('.')).toBe(true);
    expect(termsStepVisible('  padded but real  ')).toBe(true);
  });
});

describe('the bytes signed in the browser are the bytes the service verifies', () => {
  it('produces the SAME record the shared builder produces for identical inputs', () => {
    const identity = createIdentity(NET);
    const acceptedAt = '2026-07-29T12:00:00.000Z';
    const envelope = buildTermsEnvelope({
      identity,
      serviceDid: 'did:btcr2:k1qservice',
      cohortId: COHORT,
      termsText: TERMS,
      acceptedAt,
    });
    // Built independently through the SHARED builder, the one the service also uses.
    expect(envelope.acceptance).toEqual(
      buildTermsAcceptance({
        serviceDid: 'did:btcr2:k1qservice',
        cohortId: COHORT,
        termsHash: termsHashHex(TERMS),
        participantDid: identity.did,
        acceptedAt,
      }),
    );
    expect(envelope.acceptance['@context']).toBe(BTCR2_CONTEXT);
    expect(envelope.acceptance.type).toBe(TERMS_ACCEPTANCE_TYPE);
    expect(Object.keys(envelope.acceptance).sort()).toEqual([...TERMS_ACCEPTANCE_FIELDS].sort());
  });

  it('signs the shared signing bytes with the participant own key, verifiably', () => {
    const identity = createIdentity(NET);
    const envelope = buildTermsEnvelope({
      identity,
      serviceDid: 'did:btcr2:k1qservice',
      cohortId: COHORT,
      termsText: TERMS,
    });
    const signature = Uint8Array.from(
      (envelope.signature.match(/../g) ?? []).map((b) => parseInt(b, 16)),
    );
    expect(signature).toHaveLength(64);
    // Verified the way the service verifies it: over the SHARED signing bytes, schnorr, against
    // this participant's own public key.
    expect(
      identity.keys.publicKey.verify(
        signature,
        termsAcceptanceSigningBytes(envelope.acceptance as never),
        { scheme: 'schnorr' },
      ),
    ).toBe(true);
  });

  it('carries an x1 genesis document in-band, and omits the key entirely for a k1 identity', () => {
    const external = createExternalIdentity(NET);
    const key = createIdentity(NET);
    const args = { serviceDid: 'did:btcr2:k1qservice', cohortId: COHORT, termsText: TERMS };
    expect(buildTermsEnvelope({ ...args, identity: external }).genesisDocument).toEqual(
      external.genesisDocument,
    );
    // Absent, not undefined-valued: a k1 DID decodes to its key, so there is nothing to carry.
    expect('genesisDocument' in buildTermsEnvelope({ ...args, identity: key })).toBe(false);
  });

  it('names the terms HASH, never the terms text, so the text never travels', () => {
    const identity = createIdentity(NET);
    const envelope = buildTermsEnvelope({
      identity,
      serviceDid: 'did:btcr2:k1qservice',
      cohortId: COHORT,
      termsText: TERMS,
    });
    expect(envelope.acceptance.termsHash).toBe(termsHashHex(TERMS));
    expect(JSON.stringify(envelope)).not.toContain('Party on');
  });
});

describe('the terms body renders as escaped text inside a scrolling container (T-05-13-03)', () => {
  it('uses no dangerous HTML prop of any kind', () => {
    for (const prop of ['dangerouslySetInnerHTML', 'innerHTML', 'outerHTML', 'insertAdjacentHTML']) {
      expect(TERMS_STEP_SRC, `${prop} must not appear in the terms step`).not.toContain(prop);
    }
  });

  it('never renders the operator text as a link target', () => {
    // No anchor, and no href built from anything: operator-supplied text that becomes a URL is
    // the same class of defect as operator-supplied text that becomes markup.
    expect(TERMS_STEP_SRC).not.toMatch(/<a\b/);
    expect(TERMS_STEP_SRC).not.toContain('href');
  });

  it('caps the terms container height, scrolls it, and wraps unbroken tokens', () => {
    expect(TERMS_STEP_SRC).toContain('max-h-64');
    expect(TERMS_STEP_SRC).toContain('overflow-auto');
    expect(TERMS_STEP_SRC).toContain('break-words');
    // The operator's own line breaks survive, which is what makes a paragraphed document
    // readable rather than one run-on block.
    expect(TERMS_STEP_SRC).toContain('whitespace-pre-wrap');
  });

  it('renders the terms as a plain React text child of the capped container', () => {
    expect(TERMS_STEP_SRC).toContain('>{termsText}<');
  });
});

describe('the authored copy matches the UI-SPEC string set', () => {
  it('pins every string on the step', () => {
    expect(TERMS_COPY.title).toBe('Participation terms');
    expect(TERMS_COPY.checkbox).toBe('I accept these terms.');
    expect(TERMS_COPY.signatureDisclosure).toBe(
      'Accepting signs a short record with your DID so this service can show that you agreed. The signing happens in this browser and your private key never leaves it.',
    );
    expect(TERMS_COPY.joinDisabledReason).toBe('Accept the terms to join.');
    expect(TERMS_COPY.copyFieldLabel).toBe('acceptance record');
    expect(TERMS_COPY.honestLimit).toBe(
      'These terms are enforced in this web app. A client that speaks the protocol directly can join without this step.',
    );
    expect(TERMS_ACCEPTANCE_FAILED).toBe(
      "Your acceptance couldn't be recorded, so this join stopped. Try again.",
    );
  });

  it('states the app-level limit rather than claiming protocol enforcement', () => {
    // The one sentence that must never be softened: the protocol carries no acceptance message
    // type, so a headless client joins without this step.
    expect(TERMS_COPY.honestLimit).toContain('can join without this step');
    expect(TERMS_COPY.honestLimit).toContain('enforced in this web app');
  });

  it('renders an acceptance time, falling back to the raw value rather than "Invalid Date"', () => {
    expect(acceptedAtLine('2026-07-29T12:00:00.000Z')).toMatch(/^Accepted at .+\.$/);
    expect(acceptedAtLine('not a date')).toBe('Accepted at not a date.');
  });
});

describe('termsAcceptedFor: an acceptance is for ONE cohort', () => {
  it('is false for null, and for an acceptance made for a different cohort', () => {
    expect(termsAcceptedFor(null, COHORT)).toBe(false);
    expect(termsAcceptedFor({ cohortId: 'cohort-other' }, COHORT)).toBe(false);
    expect(termsAcceptedFor({ cohortId: COHORT }, COHORT)).toBe(true);
  });
});

describe('the store gate: a participant is never seated with an unrecorded acceptance', () => {
  beforeEach(() => {
    useParticipant.setState({
      identity: createIdentity(NET),
      did: 'did:btcr2:k1qparticipant',
      serviceDid: 'did:btcr2:k1qservice',
      termsText: TERMS,
      termsAcceptance: null,
      termsAccepting: false,
      termsError: null,
      // A REAL member of `ParticipantStatus`, and the one the store actually holds once an
      // identity exists. This seed used to read `'idle'`, which the union has never contained: it
      // wrote a value the store can never hold, so the two assertions that read it back could
      // only ever compare one impossible value against another. Surfaced by 05-21 putting
      // `packages/web/tests` inside `tsc -b` for the first time (05-AUDIT-2.md cause 2).
      status: 'ready',
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('refuses the join outright when terms are set and nothing is recorded', async () => {
    await useParticipant.getState().join('http://localhost', COHORT);
    // The refusal the comment always described, now actually asserted: the gate runs BEFORE any
    // teardown or runner construction, so the status never advances to 'connecting' and is left
    // exactly where the seed put it.
    expect(useParticipant.getState().status).not.toBe('connecting');
    expect(useParticipant.getState().status).toBe('ready');
    expect(useParticipant.getState().termsError).toBe(TERMS_ACCEPTANCE_FAILED);
  });

  it('refuses the join when the recorded acceptance is for a DIFFERENT cohort', async () => {
    useParticipant.setState({
      termsAcceptance: { cohortId: 'cohort-elsewhere', hash: 'ab'.repeat(32), acceptedAt: 'x' },
    });
    await useParticipant.getState().join('http://localhost', COHORT);
    expect(useParticipant.getState().status).not.toBe('connecting');
    expect(useParticipant.getState().status).toBe('ready');
  });

  it('records an acceptance and returns true when the service stores it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ hash: 'ab'.repeat(32) }), { status: 200 })),
    );
    const ok = await useParticipant.getState().acceptTerms('http://localhost', COHORT);
    expect(ok).toBe(true);
    expect(useParticipant.getState().termsAcceptance).toMatchObject({
      cohortId: COHORT,
      hash: 'ab'.repeat(32),
    });
    expect(useParticipant.getState().termsError).toBeNull();
    expect(useParticipant.getState().termsAccepting).toBe(false);
  });

  it('leaves the documented failure line and NO acceptance when the service refuses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'acceptance refused' }), { status: 400 })),
    );
    const ok = await useParticipant.getState().acceptTerms('http://localhost', COHORT);
    expect(ok).toBe(false);
    expect(useParticipant.getState().termsAcceptance).toBeNull();
    expect(useParticipant.getState().termsError).toBe(TERMS_ACCEPTANCE_FAILED);
    expect(useParticipant.getState().termsAccepting).toBe(false);
  });

  it('posts ONLY the record, its signature and the genesis: never the private key', async () => {
    // Typed as the thing it stands in for, so the recorded call tuple is `fetch`'s own and
    // `calls[0][1]` is genuinely a `RequestInit`. Untyped, the inferred tuple is EMPTY, index 1
    // does not exist on it, and the old `as RequestInit` conversion was papering over that rather
    // than typing it (surfaced by 05-21 putting `packages/web/tests` inside `tsc -b`).
    const spy = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ hash: 'cd'.repeat(32) }), { status: 200 }),
    );
    vi.stubGlobal('fetch', spy);
    await useParticipant.getState().acceptTerms('http://localhost', COHORT);
    const sent = String(spy.mock.calls[0]?.[1]?.body);
    const body: unknown = JSON.parse(sent);
    expect(Object.keys(body as Record<string, unknown>).sort()).toEqual(['acceptance', 'signature']);
    // The strongest form of the custody claim: the actual secret does not appear anywhere in
    // the serialized request.
    const secretHex = Buffer.from(
      useParticipant.getState().identity!.keys.secretKey.bytes,
    ).toString('hex');
    expect(sent).not.toContain(secretHex);
  });

  it('does not gate a service that set NO terms: the join path is unchanged', async () => {
    useParticipant.setState({ termsText: null, termsAcceptance: null });
    // With no acceptance recorded at all, the join still proceeds and picks the cohort: that is
    // what proves the gate is inert on a service that asked for nothing, so every existing
    // participant flow is byte-unchanged.
    await useParticipant.getState().join('http://localhost', COHORT);
    expect(useParticipant.getState().pickedCohortId).toBe(COHORT);
    expect(useParticipant.getState().termsError).toBeNull();
    useParticipant.getState().leave();
  });
});
