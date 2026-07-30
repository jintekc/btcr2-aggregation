import { describe, expect, it, vi } from 'vitest';
import { TERMS_COPY, TermsStep } from '../src/components/browse/TermsStep';
import { renderStatic } from './support/render';
import type { ParticipantState } from '../src/stores/participant';

/**
 * The participation-terms empty-state guard, RENDERED (05-21, `05-AUDIT-2.md` entry 21, SVC-05).
 *
 * Deleting `if (!termsStepVisible(termsText)) return null;` from `TermsStep` shipped undetected:
 * the existing containment block in `packages/web/tests/terms.spec.ts` greps for dangerous props,
 * link targets and class names, but never for the guard, and no test rendered the component. The
 * consequence is a service that set no terms showing an empty scroll box above an "I accept these
 * terms." checkbox, which is a legal-looking prompt to accept nothing at all.
 *
 * ## Why this is a NEW file rather than a block in `terms.spec.ts`
 *
 * Not a fallback: the required shape. `vi.mock` is file-scoped and hoisted, so a file that
 * installs the participant-store fake has no access to the genuine singleton, and `terms.spec.ts`
 * has 22 live `useParticipant` calls in its store-gate block that the fake cannot serve. Moving
 * the fake in there would break rows this round is forbidden from weakening. The two files sit
 * side by side: one drives the real store, one renders.
 *
 * ## Why the fixture is not a `setState`
 *
 * A static render takes `useSyncExternalStore`'s SERVER snapshot, which zustand implements as
 * `getInitialState()`, so a `setState` seed is INVISIBLE to it. Seeded that way, all four negative
 * rows below would pass against an unseeded store no matter what the component did: four vacuous
 * greens in exactly the shape this round exists to eliminate. See the trap section of
 * `packages/web/tests/support/render.tsx` and its demonstration in `render.spec.tsx`.
 *
 * The POPULATED row is therefore written first and watched pass before any negative row is added.
 * Until something renders, an assertion that nothing renders proves nothing.
 */

const TERMS = 'Be excellent to each other.\nParty on.';

const participantFixture: { current: Partial<ParticipantState> } = { current: {} };

vi.mock('../src/stores/participant', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/stores/participant')>();
  const { selectorFake } = await import('./support/render');
  return { ...actual, useParticipant: selectorFake(() => participantFixture.current) };
});

/** Seed the fixture and render the step with the join checkbox unticked. */
function step(termsText: string | null | undefined): string {
  participantFixture.current = {
    termsText,
    termsAcceptance: null,
    termsAccepting: false,
    termsError: null,
  };
  return renderStatic(<TermsStep checked={false} onCheckedChange={() => {}} />);
}

describe('TermsStep renders the document a service DID set (the anti-vacuity control)', () => {
  it('renders the operator body text, the acceptance checkbox and the honest limit', () => {
    const html = step(TERMS);
    // Proof that the fixture reaches the renderer at all. Every absence row below is worthless
    // until this passes.
    expect(html).toContain('Party on.');
    expect(html).toContain(TERMS_COPY.title);
    expect(html).toMatch(/<input[^>]*type="checkbox"/);
    expect(html).toContain(TERMS_COPY.checkbox);
  });
});

describe('a service that set NO terms renders NO terms step at all (SVC-05, UI-SPEC E15)', () => {
  it('renders nothing when the service never set terms', () => {
    expect(step(undefined)).toBe('');
  });

  it('renders nothing for an explicit null', () => {
    expect(step(null)).toBe('');
  });

  it('renders nothing for an empty string', () => {
    expect(step('')).toBe('');
  });

  it('renders nothing for a whitespace-only body, which is not a document anyone can agree to', () => {
    // Folded in deliberately by the shipped predicate: a body of spaces would otherwise produce an
    // empty scroll box with an acceptance checkbox under it.
    expect(step('\n\t   \n')).toBe('');
    // No placeholder either: not an empty card, not a "this service has no terms" line.
    expect(step('   ')).not.toContain(TERMS_COPY.checkbox);
  });
});
