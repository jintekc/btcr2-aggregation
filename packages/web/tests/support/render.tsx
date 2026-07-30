import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * The web package's render harness (05-AUDIT-2.md, structural cause 1).
 *
 * ## Why this exists
 *
 * Until 05-21 not one React component in this repo was ever rendered by a test. Every web spec
 * exercised a pure predicate or an exported constant, so a prop that is never passed, a label that
 * is never asserted and a guard that is never rendered all shipped green. `05-AUDIT-2.md` counted
 * 24 such mutations. This module is the smallest thing that closes that class of hole.
 *
 * ## What it renders, and what it does NOT
 *
 * {@link renderStatic} returns the INITIAL markup of a component tree, through
 * `react-dom/server`'s `renderToStaticMarkup`. `useState` initializers DO run, which is what makes
 * a seeded form's opening values assertable. Nothing else does:
 *
 * - no events fire (no click, no change, no submit);
 * - no effects run (`useEffect` and `useLayoutEffect` are skipped by a server render);
 * - no state transitions occur, so a panel a click would reveal is never reached this way.
 *
 * Where a proof genuinely needs interaction, it goes one of two places. If the interaction merely
 * REVEALS a component, render that component directly: `LifecycleActions.tsx` exports
 * `CancelConfirm` for exactly that reason. Otherwise it belongs in the real-Chromium
 * playwright-core legs under `e2e/` (`e2e/browser-operator.ts` and its siblings), which drive a
 * genuine page with a genuine store.
 *
 * ## Why no DOM package was added
 *
 * `react-dom/server` runs in the EXISTING vitest `node` environment and `react-dom` is already a
 * dependency of `packages/web`, so this harness adds zero packages and leaves `pnpm-lock.yaml`
 * byte-identical. jsdom or happy-dom would each be a new, unaudited dependency, and this repo's
 * package-legitimacy rule would put a blocking human checkpoint in front of installing one. No
 * `vitest.config.*` or `vitest.workspace.*` is introduced either, so test discovery for every
 * existing spec is unchanged. What a DOM environment would ADD, if it is ever worth its cost, is
 * interaction and a live store: clicking `Cancel cohort` and watching the panel arm, rather than
 * rendering the panel the click reveals.
 *
 * ## THE TRAP: a static render reads a zustand store's INITIAL state
 *
 * This is the single most important rule in this file, because the obvious way to seed a render is
 * wrong and fails SILENTLY.
 *
 * `node_modules/.pnpm/zustand@5.0.14_.../node_modules/zustand/esm/react.mjs` lines 5 through 12
 * pass THREE arguments to `React.useSyncExternalStore`, and the third, the SERVER snapshot, reads
 * `api.getInitialState()`, not `api.getState()`. A static render always takes the server snapshot.
 * So a store seeded with `useOperator.setState(...)` or `useParticipant.setState(...)` renders the
 * state the store was CREATED with, and the seed is invisible.
 *
 * That produces VACUOUS GREENS in exactly the shape this round exists to eliminate: four rows
 * asserting that an empty terms body renders nothing would all pass against an unseeded store no
 * matter what the component does. `setState` seeding for a render is therefore forbidden outright.
 * The trap itself is demonstrated, against a store the test owns, in `render.spec.tsx` beside this
 * file.
 *
 * ## The two legitimate seeding modes
 *
 * 1. **Preferred: render the pure-prop component.** Where the branch under test lives in a
 *    component whose inputs are props, render that component directly. Nothing to get wrong.
 * 2. **Where the state is only reachable through a module-singleton store**, install a
 *    SELECTOR-FAITHFUL FAKE of the bound hook with `vi.mock` plus `importOriginal`, replacing ONLY
 *    the hook and keeping every other export of that module real (every copy constant included).
 *    {@link selectorFake} builds that stand-in.
 *
 * Mode 2 replaces the store CONTAINER, never the component's own selectors: each
 * `useOperator((s) => s.health?.mode)` in the component still executes, against the fixture. A
 * component that reads the wrong field, or stops reading one, still fails. That is what keeps the
 * fake from being a stub of the subject under test.
 *
 * ## The hoisting recipe, spelled out
 *
 * `vi.mock` factories are hoisted ABOVE the file's imports, so referencing `selectorFake` as an
 * ordinary import inside one raises "Cannot access before initialization". The recipe is an ASYNC
 * factory that resolves both the original module and this helper by dynamic import, closing only
 * over a plain mutable holder declared at module scope:
 *
 * ```ts
 * const operatorFixture: { current: Partial<OperatorState> } = { current: {} };
 *
 * vi.mock('../src/stores/operator', async (importOriginal) => {
 *   const actual = await importOriginal<typeof import('../src/stores/operator')>();
 *   const { selectorFake } = await import('./support/render');
 *   return { ...actual, useOperator: selectorFake(() => operatorFixture.current) };
 * });
 * ```
 *
 * The holder is safe to close over because the factory only CAPTURES it: the arrow reads
 * `operatorFixture.current` lazily, at render time, long after the module body has run. Reading it
 * lazily is also what makes a per-row assignment visible to the next render. `vi.hoisted` is an
 * acceptable alternative for the holder, but it cannot import, so the helper still arrives by
 * dynamic import.
 *
 * ## Two rules that follow from the recipe
 *
 * **The fixture must be TYPED**, as the store's own state made partial (`OperatorState` and
 * `ParticipantState` are exported for this). An untyped object literal turns a misspelled key into
 * an `undefined` that is indistinguishable from an unseeded store, which is the same silent
 * failure the trap section is about; a typed one turns it into a compile error that `pnpm test`
 * now catches, because 05-21 also put `packages/web/tests` inside the root `tsc -b`.
 *
 * **`vi.mock` is FILE-SCOPED and hoisted.** It cannot be confined to a describe block, so a file
 * that installs the fake has no access to the genuine store singleton for any purpose. A spec full
 * of real-store rows therefore gets a NEW sibling file for its render block rather than the fake
 * moving in: that is why `packages/web/tests/terms-render.spec.tsx` exists beside
 * `packages/web/tests/terms.spec.ts`, whose 22 live `useParticipant` calls the fake cannot serve.
 *
 * ## The anti-vacuity rule
 *
 * Every render describe block carries at least one row asserting that a DIFFERENT fixture produces
 * DIFFERENT output. A block whose rows all assert an absence proves nothing until one row proves
 * the fixture reaches the renderer at all.
 */

/** The initial static markup of `element`, with `useState` initializers evaluated. */
export function renderStatic(element: ReactElement): string {
  return renderToStaticMarkup(element);
}

/**
 * A stand-in for a zustand bound hook, faithful to the caller's own selector.
 *
 * `read` is called LAZILY, once per selector application, so a fixture reassigned between rows is
 * visible to the next render. `getState` reads the same fixture, so a component (or a test) that
 * reaches for the imperative accessor sees one consistent view.
 */
export interface StoreFake<S> {
  <T>(selector: (state: S) => T): T;
  getState(): S;
}

/** Build a {@link StoreFake} over a lazily-read fixture. See the module docstring for the recipe. */
export function selectorFake<S>(read: () => S): StoreFake<S> {
  const hook = <T,>(selector: (state: S) => T): T => selector(read());
  return Object.assign(hook, { getState: () => read() });
}

/**
 * A copy constant in the form it takes inside rendered markup.
 *
 * React escapes text children (`'` becomes `&#x27;`, `&` becomes `&amp;`, and so on), so an
 * assertion comparing raw shipped copy against markup fails on any apostrophe. Rather than
 * re-implement React's escaping table here, which would be a second rule that can drift from the
 * first, this renders the string THROUGH React and returns what came out.
 */
export function asRenderedText(copy: string): string {
  const wrapped = renderToStaticMarkup(createElement('span', null, copy));
  return wrapped.slice('<span>'.length, -'</span>'.length);
}
