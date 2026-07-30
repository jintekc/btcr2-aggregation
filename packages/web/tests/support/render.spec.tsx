import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { create } from 'zustand';
import { asRenderedText, renderStatic, selectorFake } from './render';

/**
 * The render harness proves itself (05-21, `05-AUDIT-2.md` structural cause 1).
 *
 * This file installs NO store mock, and that is the point rather than an accident. The headline
 * row below is about zustand's SERVER snapshot, so it has to be taken against a store the test
 * itself creates: made in a file where the app's store is faked it would prove only that the fake
 * ignored `setState`, which is a vacuous pass in the exact shape this round exists to eliminate.
 *
 * The three properties every later render block in this round leans on are pinned here, where they
 * are defined, rather than re-derived per spec.
 */

describe('THE TRAP: a static render reads a zustand store getInitialState, not getState', () => {
  it('renders the state the store was CREATED with, and ignores every setState before it', () => {
    // `zustand/esm/react.mjs` lines 5 through 12 pass THREE arguments to useSyncExternalStore, and
    // the third (the SERVER snapshot) reads api.getInitialState(). renderToStaticMarkup always
    // takes the server snapshot, so a setState seed is INVISIBLE to a static render.
    const useCounter = create<{ n: number }>()(() => ({ n: 1 }));
    function Counter() {
      const n = useCounter((s) => s.n);
      return <span>{n}</span>;
    }

    expect(renderStatic(<Counter />)).toBe('<span>1</span>');

    useCounter.setState({ n: 42 });

    // The store genuinely changed...
    expect(useCounter.getState().n).toBe(42);
    // ...and the render did not see it. Four rows asserting an absence, seeded this way, would all
    // pass no matter what the component did. Hence the setState-seeding prohibition in
    // `packages/web/tests/support/render.tsx`.
    expect(renderStatic(<Counter />)).toBe('<span>1</span>');
  });
});

describe('renderStatic evaluates useState initializers', () => {
  it('renders the value a lazy initializer produced, so a seeded form opens assertably', () => {
    // This is the property a seeding assertion over a form (05-22 / #31) depends on: the opening
    // value of a controlled field comes from the initializer, and a static render runs it.
    function Seeded() {
      const [value] = useState(() => 'seeded-from-the-initializer');
      return <p>{value}</p>;
    }
    expect(renderStatic(<Seeded />)).toContain('seeded-from-the-initializer');
  });
});

describe('selectorFake is faithful to the caller own selector', () => {
  it('applies the component selector to the fixture, and getState reads the same fixture', () => {
    const holder = { current: { mode: 'live', label: 'Live' } };
    const fake = selectorFake(() => holder.current);
    // The component's selector still executes: the fake replaces the CONTAINER, never the read.
    expect(fake((s) => s.mode)).toBe('live');
    expect(fake.getState().label).toBe('Live');
  });

  it('reads the fixture LAZILY, so a per-row reassignment is visible to the next render', () => {
    // Without laziness every row in a describe block would render whatever the first row seeded,
    // and a two-fixture anti-vacuity control could never fail.
    const holder = { current: { mode: 'hermetic' } };
    const fake = selectorFake(() => holder.current);
    expect(fake((s) => s.mode)).toBe('hermetic');
    holder.current = { mode: 'live' };
    expect(fake((s) => s.mode)).toBe('live');
    expect(fake.getState().mode).toBe('live');
  });
});

describe('asRenderedText puts shipped copy in the form markup actually carries', () => {
  it('escapes through React itself rather than through a second escaping table', () => {
    // Shipped copy is full of apostrophes ("this cohort's beacon transaction"), and React escapes
    // them, so a raw toContain against markup fails for a reason that has nothing to do with the
    // behavior under test.
    expect(asRenderedText("cohort's")).toBe('cohort&#x27;s');
    expect(asRenderedText('plain text')).toBe('plain text');
  });
});
