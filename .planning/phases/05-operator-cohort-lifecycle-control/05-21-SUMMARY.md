---
phase: 05-operator-cohort-lifecycle-control
plan: 21
subsystem: web-test-infrastructure
tags: [gap-closure, coverage, render-harness, typecheck, confirm-gate, terms, mutation-testing]
status: complete
requires:
  - "packages/web dependency on react-dom (already present; the harness adds no package)"
  - "packages/web/src/lib/lifecycle.ts: cancelAvailability, cancelRung, cohortShortId"
  - "packages/web/src/components/browse/TermsStep.tsx: termsStepVisible"
provides:
  - "packages/web/tests/support/render.tsx: renderStatic, selectorFake, asRenderedText, and the documented getInitialState trap"
  - "packages/web inside the root tsc -b, so pnpm test typechecks src AND tests"
  - "CancelConfirm exported, making the rung branch reachable by a static render"
  - "the cancel copy family exported from LifecycleActions, with an em-dash guard"
  - "OperatorState and ParticipantState exported as types, so a render fixture is a typed partial"
  - "the '## Retired: covered by automation' ledger in 05-UAT.md, with its rule stated"
affects:
  - tsconfig.json
  - packages/web/tsconfig.json
  - packages/web/src/components/operator/LifecycleActions.tsx
  - packages/web/src/stores/operator.ts
  - packages/web/src/stores/participant.ts
  - packages/web/tests/lifecycle.spec.ts
  - packages/web/tests/terms.spec.ts
tech-stack:
  added: []
  patterns:
    - "static render over react-dom/server's renderToStaticMarkup in the EXISTING vitest node environment, adding zero packages and no vitest config"
    - "selector-faithful store fake: vi.mock + importOriginal replacing ONLY the bound hook, so the component's own selectors still execute against a typed partial fixture"
    - "async vi.mock factory closing over a plain mutable holder, resolving both the original module and the helper by dynamic import (the factory is hoisted above imports)"
    - "anti-vacuity control: one row per render block proves a DIFFERENT fixture produces DIFFERENT output"
    - "copy asserted through asRenderedText, which escapes via React itself rather than a second escaping table"
key-files:
  created:
    - packages/web/tests/support/render.tsx
    - packages/web/tests/support/render.spec.tsx
    - packages/web/tests/terms-render.spec.tsx
  modified:
    - tsconfig.json
    - packages/web/tsconfig.json
    - packages/web/src/components/operator/LifecycleActions.tsx
    - packages/web/src/stores/operator.ts
    - packages/web/src/stores/participant.ts
    - packages/web/tests/lifecycle.spec.ts
    - packages/web/tests/terms.spec.ts
    - .planning/phases/05-operator-cohort-lifecycle-control/05-19-SUMMARY.md
    - .planning/phases/05-operator-cohort-lifecycle-control/05-UAT.md
decisions:
  - "A static render over react-dom/server was taken instead of jsdom or happy-dom. It adds zero packages (so no package-legitimacy checkpoint arises and the lockfile diff is empty), changes nothing about test discovery, and reaches every render-gated defect in the audit, all of which are INITIAL-render facts."
  - "setState seeding for a render is forbidden outright. zustand's useSyncExternalStore server snapshot reads getInitialState(), so a setState seed is invisible to a static render and would make every absence assertion vacuous. Verified directly: a store created at 1 and set to 42 renders 1."
  - "The render block for TermsStep went into a NEW sibling file rather than into terms.spec.ts, because vi.mock is file-scoped and terms.spec.ts has 22 live useParticipant calls the fake cannot serve."
  - "The 'status: idle' seed in terms.spec.ts was replaced with a real union member and its assertions made STRONGER (status must not have advanced to connecting), not removed."
  - "The type-to-confirm INSTRUCTION is asserted structurally (its label/input pair plus the short id) rather than by retyping the sentence, because that sentence is interpolated JSX in primitives.tsx and is not an exported constant."
metrics:
  duration: ~35m
  completed: 2026-07-30
---

# Phase 5 Plan 21: Make the web package testable at all Summary

`packages/web` is now typechecked by `pnpm test` and rendered by it, and the first three defects that fact makes catchable are closed: the funded-cancel type-to-confirm gate at its call site, the post-broadcast cancel suppression that has no server-side backstop, and the terms empty-state guard.

## Gap source

`.planning/phases/05-operator-cohort-lifecycle-control/05-AUDIT-2.md`. This plan closes **#15 and
#21** (entry 1, High, marked warn), **#8** (entry 2, High) and **#7** (entry 21, Low), and both of
the audit's two structural causes.

No confirmed defect here is a live protocol bug. Each is a mutation that WOULD have shipped
undetected, which is why the proof that a coverage fix worked is that the mutation now fails.

## What changed

### Structural cause 2: the web package was outside every type gate

The root `tsconfig.json` referenced shared, service, participant and e2e only, so `pnpm test`
(`tsc -b && vitest run`) never typechecked `packages/web`. Worse, `packages/web/tsconfig.json` had
`include: ["src"]`, so `packages/web/tests` was typechecked by NOTHING in the repo, not even
`pnpm --filter @btcr2-aggregation/web build`. Fourteen spec files sat outside every type gate.

`packages/web/tsconfig.json` gains `composite: true` and includes `tests`; the root references
`packages/web` LAST, because the web package resolves `@btcr2-aggregation/shared` and
`@btcr2-aggregation/participant` through workspace symlinks to their BUILT declaration files, so
those projects must build first. TypeScript 5.9 accepted `composite` alongside `noEmit` and
`allowImportingTsExtensions`, as the plan predicted, so nothing is emitted but a tsbuildinfo the
root `clean` script already removes. `pnpm clean && pnpm test` was run from a genuinely clean tree
and is green, which is what proves the reference ORDER resolves.

Widening the include surfaced exactly the five errors the plan predicted, at the four predicted
positions, and each is fixed on its merits:

| Position | Error | Fix |
|----------|-------|-----|
| `terms.spec.ts:231` | TS2322, `status: 'idle'` not assignable to `ParticipantStatus` | Seeded `'ready'`, a real member. Both assertions that read it back now assert the refusal the comment always described: the status must NOT have advanced to `connecting`, and is left where the seed put it. |
| `terms.spec.ts:285,:292` | TS2352 on two `as RequestInit` conversions, TS2493 on two tuple indexes | The `vi.fn` is typed as `vi.fn<typeof fetch>`, so its recorded call tuple is `fetch`'s own and `calls[0][1]` is genuinely a `RequestInit`. Both conversions deleted, not silenced. |

No `any`, no `@ts-expect-error`, no new non-null assertion, no file excluded from the include. The
`status` assertions are strictly stronger than before: the old ones compared one impossible value
against another.

### Structural cause 1: not one React component was ever rendered by a test

`packages/web/tests/support/render.tsx` exports `renderStatic` over `react-dom/server`'s
`renderToStaticMarkup`, plus `selectorFake` and `asRenderedText`. `react-dom` is already a
dependency of `packages/web`, so **`git diff --stat pnpm-lock.yaml` is empty**: no jsdom, no
happy-dom, no `@testing-library`, no `react-test-renderer`, and therefore no package-legitimacy
checkpoint. No `vitest.config.*` or `vitest.workspace.*` exists anywhere, so discovery for every
pre-existing test is byte-unchanged.

Its docstring is load-bearing and carries all of: the audit citation, what a static render does and
does not do (no events, no effects, no state transitions), the `getInitialState` trap with its
source location, the two legitimate seeding modes, the rule that the fake replaces the store
CONTAINER and never the component's own selectors, the concrete hoisting recipe, the typed-fixture
rule, the file-scoped nature of `vi.mock`, the anti-vacuity rule, where interaction proof lives
instead, and what a DOM environment would add if it is ever worth its cost.

### The trap, demonstrated rather than asserted

`packages/web/tests/support/render.spec.tsx` installs NO store mock
(`grep -c "vi.mock"` returns **0**). Its headline row creates a store with `create`, renders a
component reading it, calls `setState`, and observes:

```
expect(renderStatic(<Counter />)).toBe('<span>1</span>');   // before
useCounter.setState({ n: 42 });
expect(useCounter.getState().n).toBe(42);                    // the store really changed
expect(renderStatic(<Counter />)).toBe('<span>1</span>');   // the render did not see it
```

That row has to live where no fake can absorb the `setState` for it: made in a file where the app's
store is faked, it would prove only that the fake ignored `setState`, which is a vacuous pass in the
exact shape this round exists to eliminate. The same file pins that `useState` initializers DO run
during a static render (the property `#31` will depend on), that `selectorFake` applies the caller's
own selector and reads its fixture lazily, and that `asRenderedText` escapes through React itself.

### #8: the post-broadcast cancel suppression, rendered

There is no server-side post-broadcast guard: `operator-cohorts.ts` checks only that the cohort is
advertised and then calls `runner.stopCohort`, and the route adds an id-shape check. This JSX is the
only barrier there is. `packages/web/tests/lifecycle.spec.ts` now renders `LifecycleActions` under
two fixtures: a detail whose anchor carries a txid renders the post-broadcast sentence and NO cancel
label, and a live unbroadcast detail renders the cancel label and NO post-broadcast sentence. The
pair is that block's anti-vacuity control, since the two fixtures must produce different markup.

`grep -c "setState" packages/web/tests/lifecycle.spec.ts` returns **0**, as required: this file's
bound hooks ARE the fake, which exposes no `setState` at all.

### #15 and #21: the funded-cancel gate, pinned at its CALL SITE

`CancelConfirm` is exported. It already took pure props, held no state and subscribed to no store,
so exporting it costs one keyword and makes the rung branch reachable by a static render, which
cannot click. Its docstring says why.

Each rung asserts TWO independent facts, and the pair is the point: the gate's presence and the
short id are what an operator SEES, while the confirm button's disabled state is what actually stops
the destructive act. Asserting only the first would pass a gate that armed nothing; asserting only
the second would pass a gate that told the operator nothing to type. The disabled read is taken off
the ATTRIBUTE, never the class list, because the shared `Button` base carries
`disabled:cursor-not-allowed disabled:opacity-40` on every render.

All three rung-4 funding states (`funded`, `awaiting-confirmation`, `dead-end`) render the gate and a
disabled confirm; rung 3 renders neither and stays armed. The recovery-key disclosure is asserted in
both of its forms. The short id comes from `cohortShortId` and every sentence from the exported copy
constants, so nothing is retyped.

`grep -c 'typeToConfirm' packages/web/src/components/operator/LifecycleActions.tsx` returns exactly
**1**, and a spec row asserts that count, so the gate provably cannot appear at both rungs.

### #7: the terms empty-state guard, rendered

`packages/web/tests/terms-render.spec.tsx` is a NEW file, and that is the required shape rather than
a fallback: `vi.mock` is file-scoped and hoisted, and `terms.spec.ts` has 22 live `useParticipant`
calls the fake cannot serve, so installing the fake there would break rows this round is forbidden
from weakening. `grep -c "vi.mock" packages/web/tests/terms.spec.ts` returns **0**.

The POPULATED row was written first and observed passing IN ISOLATION (`vitest -t "anti-vacuity"`,
1 passed, 4 skipped) before any negative row was run. That ordering is the whole discipline: until
something renders, an assertion that nothing renders proves nothing.

## Mutation runs, as observed

Every mutation below was applied to shipped source, run, observed, and reverted. Every prediction
the audit made was borne out; none had to be recorded as contradicted.

| # | Mutation | Predicted | OBSERVED |
|---|----------|-----------|----------|
| 1 | Swap the broadcast arm in `LifecycleActions.tsx` (`availability === 'broadcast'` to `!== 'broadcast'`) | RED post-fix | **RED, both rows.** `expected '<div class="rounded-xl border border-…' to contain 'This cohort&#x27;s beacon transaction…'` and `… to contain 'Cancel cohort'`. 2 failed, 33 passed. |
| 2 | Misspell a fixture key (`detail` to `detials` in `lifecycle.spec.ts`) | fails at typecheck | **RED at `tsc -b`, before vitest started.** `packages/web/tests/lifecycle.spec.ts(350,33): error TS2353: Object literal may only specify known properties, and 'detials' does not exist in type 'Partial<OperatorState>'.` |
| 3 | A plain deliberate type error in a web test file (`const x: string = 42` in `terms.spec.ts`) | fails at typecheck | **RED at `tsc -b`, before vitest started.** `packages/web/tests/terms.spec.ts(57,7): error TS2322: Type 'number' is not assignable to type 'string'.` |
| 4 | **Audit "Needs a mutation run" item 2, first leg (#21):** insert `typeToConfirm={short}` into the rung-3 `ConfirmPanel` | GREEN pre-fix; RED post-fix | **RED.** `keeps the ordinary cancel at low friction: no typed id, and the confirm is already armed` failed `expected true to be false`. 1 failed, 40 passed. |
| 5 | **Same item, inverted (#15):** delete `typeToConfirm={short}` from the rung-4 `ConfirmPanel` | GREEN pre-fix; RED post-fix | **RED on all three funding states.** `asks for the typed cohort id and starts DISARMED for a funded / awaiting-confirmation / dead-end cohort`, each `expected false to be true`. 3 failed, 38 passed. |
| 6 | Delete the early-return guard from `TermsStep` | RED | **RED on all four empty-state rows**, each `expected '<div class="space-y-3"><h2 class="tex…' to be ''`. 4 failed, 1 passed. |

The unguarded `TermsStep` output was captured rather than left as a bare red, because the failure
mode is the point:

```html
<div class="space-y-3"><h2 ...>Participation terms</h2>
  <div class="max-h-64 overflow-auto rounded-lg border border-edge bg-canvas px-3 py-2">
    <p class="whitespace-pre-wrap break-words text-sm text-muted"></p>
  </div>
  <label ...><input type="checkbox" .../><span>I accept these terms.</span></label>
  ...
</div>
```

An empty scroll box above a live acceptance checkbox: the legal-looking prompt to accept nothing
that the guard exists to prevent.

`pnpm e2e:browser:operator` was run ONCE at the end, against the post-fix tree, and PASSED (real
headless Chromium, full sign-in to drill-down loop). It was not run per mutation, as the plan
directed.

## The phase record, corrected

`05-19-SUMMARY.md` claimed, both in its `provides` list and in its Task 3 narrative, that the shipped
type-to-confirm gate's assertions were load-bearing. A dated correction was appended IN PLACE rather
than rewriting the claim, so the record shows both what was claimed and what was found: 05-19 pinned
the CALLEE (`typeToConfirmMatches` and the arming expression in `ui/primitives.tsx`) and never the
call site, so deleting the prop from the funded-cancel panel would have shipped undetected.

## The UAT automation ledger

`05-UAT.md` gains `## Retired: covered by automation`, above `## Summary`, with its rule stated once
for the whole round: a plan appends one row per CLAUSE it covers, and moves a test out of `## Tests`
only when EVERY clause has a row; 05-27 reconciles the ledger and rewrites the `## Summary` counts in
one final pass.

Four rows were earned (three clauses of test 4, one of test 8). NO test was removed from `## Tests`:
test 4 still needs the 401 shared-session-expiry clause that 05-24 closes, and test 8 still needs the
long-body-at-a-narrow-viewport clause, which is a genuine visual judgment.

## Deviations from Plan

**1. [Rule 3 - Blocking] The harness docstring terminated its own block comment.** A pnpm path glob
written as `zustand@5.0.14_*/node_modules/...` contains `*/`, which ends a block comment. esbuild
failed the transform with `Expected ";" but found "React"`. Rewritten as `zustand@5.0.14_...`.
Found during Task 1, fixed inline. Commit `fc902ec`.

**2. [Rule 3 - Blocking] `pnpm lint` rejected the named-but-unused `fetch` parameters.** The plan's
prescribed fix for the TS2493 errors was to give the `vi.fn` an explicit parameter list. That
typechecks, but this repo's flat `typescript-eslint` config sets no `argsIgnorePattern`, so
`_input` and `_init` failed `@typescript-eslint/no-unused-vars`. Typing the spy as
`vi.fn<typeof fetch>` instead reaches the same tuple typing with no parameters to leave unused, and
is closer to the intent ("the mock's call tuple should be `fetch`'s"). Commit `fc902ec`.

**3. [Rule 3 - Blocking] The `CancelConfirm` docstring broke its own acceptance criterion.** The
criterion requires `grep -c 'typeToConfirm' LifecycleActions.tsx` to return exactly 1. The docstring
this plan adds originally mentioned both `typeToConfirm` and `typeToConfirmMatches` (the latter
CONTAINS the former as a substring), pushing the count to 3. The docstring now names the prop in
prose and links the predicate by file reference, and says why. Commit `faec536`.

### Two acceptance criteria that could not be met as literally written

Recorded rather than quietly satisfied.

1. **`grep -rlP '\x{2014}' packages/web/tests ...` cannot list no files, and could not before this
   plan either.** Five pre-existing specs (`settings`, `service-controls`, `cohort-form`,
   `operator-rows`, `psbt`) contain the em-dash character INSIDE the regex literal of their
   `not.toMatch(...)` em-dash guards, and
   the guard this plan adds over the cancel copy family is the sixth. A guard containing the
   character it forbids is the opposite of a violation. The property actually verified is the one
   that matters: no em-dash appears in any AUTHORED string or prose in any file this plan touched.
   `grep -nP` over `lifecycle.spec.ts` returns exactly one line, the guard itself; the scan over
   `LifecycleActions.tsx`, `TermsStep.tsx`, `terms-render.spec.tsx`, `render.tsx`,
   `render.spec.tsx`, `05-UAT.md` and `05-19-SUMMARY.md` returns nothing.

2. **The type-to-confirm INSTRUCTION is asserted structurally, not by its sentence.** The plan asks
   for the copy to be derived from exported constants rather than retyped, but that sentence is
   interpolated JSX inside `ConfirmPanel` (`Type <Mono>{typeToConfirm}</Mono> to confirm.`) and
   cannot be one constant. Rather than retype it, the assertion reads the rendered gate's identity:
   the `for="confirm-type-to-confirm"` label, the `id="confirm-type-to-confirm"` input, and the
   short id derived from `cohortShortId`. That is strictly stronger than a text match, since it
   asserts the INPUT exists, and it is what mutation 5 breaks.

## Verification

| Check | Result |
|-------|--------|
| `pnpm test` | green, **63 files / 1069 tests** (baseline 61 / 1049, so +2 files and +20 tests; no assertion deleted or loosened) |
| `pnpm clean && pnpm test` from a clean tree | green (proves the root reference order resolves the workspace declaration files) |
| `pnpm lint` | green |
| `pnpm --filter @btcr2-aggregation/web build` | green |
| `pnpm e2e:gate` | green (13 legs; re-run because this plan changes the root `tsconfig.json` and every e2e script begins with `tsc -b`) |
| `pnpm e2e:browser:operator` | PASSED (real headless Chromium) |
| `git diff --stat pnpm-lock.yaml` | empty (T-05-21-SC: no package installed) |
| `find . -name 'vitest.config.*' -o -name 'vitest.workspace.*'` (excluding node_modules) | nothing |
| `grep -c "vi.mock" packages/web/tests/support/render.spec.tsx` | 0 |
| `grep -c "vi.mock" packages/web/tests/terms.spec.ts` | 0 |
| `grep -c "setState" packages/web/tests/lifecycle.spec.ts` | 0 |
| `grep -c "typeToConfirm" packages/web/src/components/operator/LifecycleActions.tsx` | 1 |

Per-task counts: 1049 (baseline) to 1057 (task 1) to 1064 (task 2) to 1069 (task 3).

## Threat mitigations

| Threat ID | Disposition | How |
|-----------|-------------|-----|
| T-05-21-01 | mitigated | The rung-4 gate is pinned at its CALL SITE against rendered output; mutation 5 is RED. |
| T-05-21-02 | mitigated | The broadcast arm is pinned against rendered output; mutation 1 is RED. There is still no server-side guard, so this render remains the only barrier, and it is now not silently removable. |
| T-05-21-03 | mitigated | Four empty-state rows prove no acceptance checkbox renders for an absent, null, empty or whitespace-only body; mutation 6 is RED. |
| T-05-21-SC | mitigated | Zero packages installed; empty lockfile diff. |

## The honest limit, restated

A static render fires no events, runs no effects, performs no state transitions, and reads a store's
initial state rather than its current one. Clicking `Cancel cohort` and watching the panel arm stays
with the playwright-core browser legs under `e2e/`. What this round asserts is the wire between the
predicate and the pixel, which is exactly where `05-AUDIT-2.md` found the hole; it does not assert
interaction, and the harness docstring says so rather than leaving a reader to infer it.

## Known Stubs

None.

## Self-Check: PASSED

Files verified present on disk: `packages/web/tests/support/render.tsx`,
`packages/web/tests/support/render.spec.tsx`, `packages/web/tests/terms-render.spec.tsx`.
Commits verified in `git log`: `fc902ec` (task 1), `faec536` (task 2), `c27db48` (task 3).
