import { describe, expect, it, vi } from 'vitest';
import { DraftEditForm } from '../src/components/operator/DraftEditForm';
import { ONE_MINUTE_MS } from '../src/lib/cohort-form';
import { renderStatic } from './support/render';
import type { ReactNode } from 'react';
import type { OperatorCohortDTO } from '../src/lib/operator';
import type { OperatorState } from '../src/stores/operator';

/**
 * The draft edit form opens on the DRAFT'S OWN values, RENDERED (05-23, `05-AUDIT-2.md` entry 11,
 * defect #31, UI-SPEC E6/E7).
 *
 * Nothing in this repo ever rendered or read `DraftEditForm`, so replacing
 * `useState(msToMinutesText(draft.discoveryWindowMs))` with `useState('')` shipped green. The
 * consequence is not cosmetic: a saved five minute discovery window would display as an EMPTY
 * field, empty is exactly what "use this service's default" looks like (UI-SPEC E7 empty), and the
 * next save drops the key entirely through `windowKeys`. The operator's own setting would be
 * discarded by an edit that touched a different field.
 *
 * ## Why no `formFromDraft` helper was extracted
 *
 * `05-AUDIT-2.md` proposes lifting the seeding into `packages/web/src/lib/cohort-form.ts` as an
 * exported `formFromDraft`, mirroring the `formFromSnapshot` precedent pinned in
 * `packages/web/tests/settings.spec.ts`. That proposal existed only because no spec in this repo
 * could render a component; 05-21 removed the constraint. The reason for declining it has to be
 * stated narrowly, because the loose version is wrong: it is NOT that rendering works everywhere.
 * It is that THIS component's seeding travels by the `draft` PROP and is evaluated in `useState`
 * initializers, and a static render reaches both, so the render pins the ACTUAL shipped
 * expression. An extracted helper would pin a COPY of the rule and leave the component free to
 * stop calling it, which is the exact defect shape this whole round exists to close.
 *
 * ## Why this file fakes `../src/ui/primitives`, and what that fake does NOT touch
 *
 * The two timing fields live inside `AdvancedTiming`, which wraps them in the shared `Expander`.
 * `Expander` holds its own `useState(false)` and renders NO children while closed, and a static
 * render fires no click, so a plain render of `DraftEditForm` produces markup with no timing
 * fields in it at all. This was verified before the block was written, and the last row below
 * pins it against the REAL primitive through `vi.importActual` so the fake can never quietly
 * outlive its reason.
 *
 * The fake therefore replaces `Expander` and NOTHING else: `importOriginal` is spread, so `Input`,
 * `Select`, `Field`, `Badge`, `Card` and `Button` are all the shipped components, and the values
 * read back below are the ones `DraftEditForm` genuinely computed. It replaces the collapsible
 * CHROME, in the same way the store fake replaces the store CONTAINER and never the component's
 * own selectors. Open is also the state a human reaches with one click; what is faked away is a
 * click, not a rule.
 *
 * ## Why the store fixture is not a `setState`
 *
 * A static render takes `useSyncExternalStore`'s SERVER snapshot, which zustand implements as
 * `getInitialState()`, so a `setState` seed is invisible to it and `mode` would read `undefined`,
 * hiding the funding field entirely. See the trap section of `packages/web/tests/support/render.tsx`.
 */

const operatorFixture: { current: Partial<OperatorState> } = { current: {} };

vi.mock('../src/stores/operator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/stores/operator')>();
  const { selectorFake } = await import('./support/render');
  return { ...actual, useOperator: selectorFake(() => operatorFixture.current) };
});

vi.mock('../src/ui/primitives', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/ui/primitives')>();
  const react = await import('react');
  /** The shipped `Expander` with its one piece of local state, open, and nothing else changed. */
  const OpenExpander = ({ title, children }: { title: string; children: ReactNode }) =>
    react.createElement('div', { 'data-expander': title }, children);
  return { ...actual, Expander: OpenExpander };
});

function draft(over: Partial<OperatorCohortDTO> = {}): OperatorCohortDTO {
  return {
    draftId: 'd-1',
    beaconType: 'CASBeacon',
    network: 'signet',
    threshold: 3,
    capacity: 3,
    joined: 0,
    state: 'draft',
    // This service's own defaults at draft time, which the help lines name. Deliberately DIFFERENT
    // from any window a fixture below sets, so a seed that reached for the service default instead
    // of the draft's own value would show up as the wrong number rather than as a coincidence.
    defaultDiscoveryWindowMs: 30 * ONE_MINUTE_MS,
    defaultFundingWindowMs: 20 * ONE_MINUTE_MS,
    ...over,
  };
}

/** Render the edit form for `d`, on a service whose served mode is `mode`. */
function form(d: OperatorCohortDTO, mode: 'live' | 'hermetic' = 'live'): string {
  operatorFixture.current = {
    // The real unseeded posture: nothing saving, no server refusal on screen.
    editStatus: 'idle',
    health: { mode, esploraReachable: mode === 'live' ? true : 'n/a', paused: false },
  };
  return renderStatic(<DraftEditForm baseUrl="http://svc.example" draft={d} />);
}

/**
 * The `value` attribute of the input carrying `id`, or undefined when no such input rendered.
 *
 * Read as an ELEMENT rather than by searching the whole markup for `value="5"`, which would be
 * satisfied by any other field that happens to hold the same number.
 */
function inputValue(html: string, id: string): string | undefined {
  const el = new RegExp(`<input[^>]*id="${id}"[^>]*>`).exec(html);
  if (!el) {
    return undefined;
  }
  return /value="([^"]*)"/.exec(el[0])?.[1] ?? undefined;
}

/** The option React marked selected inside the select carrying `id` (its controlled value). */
function selectedOption(html: string, id: string): string | undefined {
  const el = new RegExp(`<select[^>]*id="${id}"[^>]*>([\\s\\S]*?)</select>`).exec(html);
  return el ? (/<option value="([^"]*)" selected="">/.exec(el[1])?.[1] ?? undefined) : undefined;
}

describe('DraftEditForm opens pre-filled from the draft it was handed (UI-SPEC E6, audit #31)', () => {
  it('shows a saved discovery and funding window as MINUTES, not as empty fields', () => {
    const html = form(draft({ discoveryWindowMs: 5 * ONE_MINUTE_MS, fundingWindowMs: 3 * ONE_MINUTE_MS }));
    // The defect in one line: an empty box here reads as "use this service's default", and the
    // next save would then drop the operator's own five minutes on the floor.
    expect(inputValue(html, 'edit-discovery-window')).toBe('5');
    expect(inputValue(html, 'edit-funding-window')).toBe('3');
    // Neither is the SERVICE default the same draft carries (30 and 20), so the seed is proven to
    // read the draft's own captured value rather than the service's current one.
    expect(inputValue(html, 'edit-discovery-window')).not.toBe('30');
    expect(inputValue(html, 'edit-funding-window')).not.toBe('20');
  });

  it('leaves a window the operator never set EMPTY, because empty is what "use the default" looks like', () => {
    // Not the same row written twice: this one asserts exactly what the row above denies, so the
    // two are each other's anti-vacuity control. Pre-filling the service default here would look
    // helpful and would in fact FREEZE the cohort's window at today's figure, turning a draft that
    // tracks the service default into one that no longer does.
    const html = form(draft());
    expect(inputValue(html, 'edit-discovery-window')).toBe('');
    expect(inputValue(html, 'edit-funding-window')).toBe('');
    // ...while the rest of the form still shows this draft's values, so the empties above are the
    // seeding rule at work and not a fixture that failed to reach the renderer.
    expect(inputValue(html, 'edit-size')).toBe('3');
  });

  it('seeds the beacon type, the size and the threshold from the draft too', () => {
    // The whole seeding block rather than one line of it: a mutation to any of the five
    // initializers has an assertion of its own to defeat.
    const html = form(draft({ beaconType: 'SMTBeacon', capacity: 4, threshold: 2 }));
    expect(selectedOption(html, 'edit-beacon-type')).toBe('SMTBeacon');
    expect(inputValue(html, 'edit-size')).toBe('4');
    expect(inputValue(html, 'edit-threshold')).toBe('2');
    // The draft's OWN network, read-only (D-10): the form must not offer to move a draft's chain.
    expect(html).toContain('signet');
  });

  it('offers no funding window at all on a service that never funds a beacon address', () => {
    // The shipped `mode === 'live'` guard in `AdvancedTiming`. It also proves the store fixture
    // reaches the NESTED component, not just the form: tuning how long a hermetic service waits
    // for funding would be a control over nothing.
    const html = form(draft({ fundingWindowMs: 3 * ONE_MINUTE_MS }), 'hermetic');
    expect(inputValue(html, 'edit-funding-window')).toBeUndefined();
    expect(inputValue(html, 'edit-discovery-window')).toBe('');
  });
});

describe('the reason this file fakes Expander, pinned against the REAL primitive', () => {
  it('the shipped Expander renders NO children until it is clicked open', async () => {
    // If this ever fails, the fake above has outlived its reason and must go. Taken through
    // `vi.importActual`, which bypasses this file's own mock, so it is the genuine component.
    const real = await vi.importActual<typeof import('../src/ui/primitives')>('../src/ui/primitives');
    const RealExpander = real.Expander;
    const html = renderStatic(
      <RealExpander title="Advanced timing">
        <p>CHILD-TEXT</p>
      </RealExpander>,
    );
    expect(html).not.toContain('CHILD-TEXT');
    // It renders its own header instead, with the affordance that would reveal the children.
    expect(html).toContain('Advanced timing');
    expect(html).toContain('Show');
  });
});
