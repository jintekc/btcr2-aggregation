---
phase: 05-operator-cohort-lifecycle-control
plan: 23
subsystem: web-operator-console-coverage
tags: [gap-closure, coverage, render, copy-pins, mutation-testing, chip-labels, drain-mode, draft-edit]
status: complete
requires:
  - "packages/web/tests/support/render.tsx: renderStatic, selectorFake, asRenderedText (05-21)"
  - "packages/web inside the root tsc -b, so a mistyped render fixture is a compile error (05-21, re-verified here)"
  - "OperatorState exported as a type (05-21)"
provides:
  - "an exact per-chip label table, typed Record<ChipKey, string> so a new chip with no expected label is a compile error"
  - "an independent anchor-wording guard on the two unconfirmed chips and the in-flight one, plus the positive assertion on anchored that keeps it from being a blanket ban"
  - "CohortRow exported, so both advertise call sites are reachable by a static render"
  - "the drain-mode matrix: draft and expired rows rendered paused and running, asserted in both directions"
  - "proof that pause gates advertising ONLY, so a whole-row disable cannot pass as a fix"
  - "the four cohort-form shape errors pinned as retyped literals, with the server-side counterparts named and not imported"
  - "DraftEditForm rendered on a windowed and an unwindowed draft, with the field values read back out of the markup"
  - "an Expander fake that is pinned against the real primitive, so it cannot outlive its reason"
  - "LONG_DASH / EN_DASH adopted as escaped constants in two more specs"
  - "five new rows in the 05-UAT automation ledger (tests 2, 6, 12)"
  - "a dated correction in 05-20-SUMMARY.md: only label DISTINCTNESS shipped, never the labels"
affects:
  - packages/web/src/components/operator/OperatorCohortList.tsx
  - packages/web/tests/operator-rows.spec.ts
  - packages/web/tests/operator-rows-render.spec.tsx
  - packages/web/tests/cohort-form.spec.ts
  - packages/web/tests/cohort-form-render.spec.tsx
  - .planning/phases/05-operator-cohort-lifecycle-control/05-20-SUMMARY.md
  - .planning/phases/05-operator-cohort-lifecycle-control/05-UAT.md
tech-stack:
  added: []
  patterns:
    - "Record<ChipKey, string> expected-label table: a new chip with no expected label is a COMPILE error, which an array of pairs could never be"
    - "two independent checks over one string (exact pin plus a semantic ban), each proven to fail alone, so a relabel has to defeat both"
    - "a scoped primitive fake: replace ONE presentational wrapper via importOriginal spread, then pin the real one through vi.importActual in the same file"
    - "buttonTag: read the disabled ATTRIBUTE off the matched element, never the class list, because the shared Button base carries disabled:* utilities on every render"
    - "populated and unset fixtures as each other's anti-vacuity control, with a mutation run in each direction to prove neither row is the other written twice"
key-files:
  created:
    - packages/web/tests/operator-rows-render.spec.tsx
    - packages/web/tests/cohort-form-render.spec.tsx
  modified:
    - packages/web/src/components/operator/OperatorCohortList.tsx
    - packages/web/tests/operator-rows.spec.ts
    - packages/web/tests/cohort-form.spec.ts
    - .planning/phases/05-operator-cohort-lifecycle-control/05-20-SUMMARY.md
    - .planning/phases/05-operator-cohort-lifecycle-control/05-UAT.md
decisions:
  - "The DraftEditForm render block went into a sibling `cohort-form-render.spec.tsx` even though the split was NOT forced by existing rows. `cohort-form.spec.ts` has zero store and zero primitives usage, so 05-22's check came back clean; the sibling was chosen because this block installs TWO module fakes, one of them over the SHARED ui/primitives module, and confining that heavier hammer to a file whose only job is rendering keeps the 26 pure rows running against genuinely unmocked modules."
  - "The two timing fields are NOT reachable by a plain static render: they live inside `Expander`, which holds its own `useState(false)` and renders no children while closed. Verified empirically before the block was written. Rather than abandon the render, the file fakes `Expander` OPEN and nothing else, and pins the real primitive's closed behavior in the same file through `vi.importActual` so the fake cannot outlive its reason."
  - "No `formFromDraft` helper was extracted, and the reason is narrow rather than broad: THIS component's seeding travels by the `draft` PROP and is evaluated in `useState` initializers, both of which a static render reaches, so the render pins the ACTUAL shipped expression. An extracted helper would pin a copy of the rule and leave the component free to stop calling it."
  - "The rule rows in `cohort-form.spec.ts` that compare `validateCohortForm(...)` against the imported constants were KEPT rather than replaced. They are about WHICH error a bad shape produces and they correctly follow a reword; the new block is about what the sentences SAY. Same division of labour 05-22 recorded for NO_SEATS_LEFT_REASON."
  - "The expected-label table is typed `Record<ChipKey, string>` rather than hand-listed, so a twelfth chip is a compile error. The runtime iteration over CHIP_KEYS is kept beside it because it produces a failure naming the chip."
metrics:
  duration: ~50m
  completed: 2026-07-30
---

# Phase 5 Plan 23: Stop a chip claiming Bitcoin, a paused service offering a doomed button, and a saved window vanishing Summary

No chip can be relabelled, no advertise control can lose its drain-mode guard, and no draft edit
form can stop seeding from its own draft, without the suite failing. Six mutation runs prove it,
each observed and recorded, including one whose result changed the method for task 3.

## Gap source

`.planning/phases/05-operator-cohort-lifecycle-control/05-AUDIT-2.md`. This plan closes **#17 and
#23** (entry 15, Medium, marked warn), **#31** (entry 11, Medium), **#30** (entry 17, Medium) and
the WEB half of **#1** (entry 20, Low). The server half of #1 is 05-26's.

None is a live protocol bug. Each is a mutation that WOULD have shipped undetected, which is why
the proof that a coverage fix worked is that the mutation now fails.

## #17 and #23: what a chip SAYS

`packages/web/tests/operator-rows.spec.ts` already asserted that the eleven chip labels form a set
of the right size, that none is empty and that none carries a long dash. Every one of those is a
real property and not one of them is about words. `ChipPresentation.label` is a plain `string`, so
the type checker had nothing to add. Relabelling `co-signed` from `Signed` to
`Anchored (co-signed)` keeps the set distinct, keeps the tone neutral, keeps the dot still, and
ships green.

Eleven exact labels now sit in an `EXPECTED_LABEL` table of RETYPED literals, typed as
`Record<ChipKey, string>`. That typing is load-bearing rather than tidy: a twelfth chip added to
`CHIP_PRESENTATION` becomes a COMPILE error here, where an array of pairs would be checked for
membership only and would let a new chip ship with no expected label. The runtime iteration over
`CHIP_KEYS` is kept beside it because it fails naming the chip, and a length equality guards the
loop itself (an empty `CHIP_KEYS` would satisfy every assertion inside it).

Beside that sits a SECOND, independent check: the two unconfirmed terminal chips and the in-flight
one carry no anchor wording, case-insensitively. A chip that says a cohort anchored is a claim about
Bitcoin, and none of those three is reached with anything confirmed on chain. The `anchored` chip
carries the POSITIVE assertion, which is what stops the guard degenerating into a blanket ban on the
word: the ban is about who may make the claim, not about the vocabulary.

The existing tone, pulse, distinctness, truthiness and long-dash rows are unchanged and still pass.
Distinctness stays because the shipped comment on the `co-signed` entry explains that its label was
chosen to sit far from the live `Co-signing` one so a scanned list cannot read them as the same
state, and that reasoning deserves a test of its own.

## #1 residual: the drain-mode advertise guards

`CohortRow` is exported from `OperatorCohortList.tsx`. The diff on that file is the `export` keyword
and a docstring paragraph saying why, citing `05-AUDIT-2.md` entry 20; nothing else about the row
changed.

The block lives in a new `packages/web/tests/operator-rows-render.spec.tsx`, because `vi.mock` is
file-scoped and hoisted and `operator-rows.spec.ts` reads `DISMISS_READVERTISE_LINE` from the same
store module and must keep the real `../src/lib/operator-rows` for its chip rows.
`grep -c "vi.mock" packages/web/tests/operator-rows.spec.ts` returns **0**.

`CohortRow` reads eleven store fields, the paused bit among them, so the block seeds through the
selector-faithful fake with the holder typed `Partial<OperatorState>`. It could not have used
`setState`: a static render reads `getInitialState()`, where `health` is `undefined`, so BOTH paused
rows would have rendered an enabled control and the mutation below would have stayed green.

Four rows, both call sites, both directions:

| Row | Fixture | Asserted |
|-----|---------|----------|
| draft, running | `paused: false` | advertise ENABLED, no reason span |
| draft, paused | `paused: true` | advertise DISABLED, reason rendered |
| expired, running | `paused: false` | re-advertise ENABLED, no reason span |
| expired, paused | `paused: true` | re-advertise DISABLED, reason rendered |

Plus the row that keeps this matrix from certifying a regression as a fix: on a PAUSED draft row,
`Edit draft` and `Discard draft` are asserted to stay ENABLED. Pause is drain mode, not a kill
switch (D-06), and 05-04's whole argument was that the narrowness has to be asserted rather than
assumed. A change that disabled the entire action group while draining would satisfy every other
assertion in the block.

`disabled` is read off the ATTRIBUTE of the matched `<button>` element, never off the class list:
the shared `Button` base carries `disabled:cursor-not-allowed disabled:opacity-40` on every render,
so a substring check for "disabled" is true no matter what the binding says (the 05-22 lesson).

## #30: the shape-error copy

Four retyped literal pins for `SIZE_ERROR`, `THRESHOLD_ERROR`, `DISCOVERY_WINDOW_ERROR` and
`FUNDING_WINDOW_ERROR`, with the contract stated in words: this client refuses a bad cohort shape
with the SAME sentence the service would, byte for byte, so an operator who trips the rule locally
and one who trips it on the wire read one sentence rather than two that drift.

The server-side halves are NAMED, not imported (`packages/service/src/operator-cohorts.spec.ts` and
`packages/service/tests/runtime-settings.spec.ts`): `packages/web` does not depend on
`packages/service` and must not start. Two independent retyped literals are what makes byte-identity
real on both sides; a shared import would prove only that one string equals itself. All four strings
were checked against `packages/service/src/operator-cohorts.ts` and are byte-identical today.

The pre-existing rule rows were KEPT. They assert WHICH error a bad shape produces, correctly follow
a reword, and are not self-comparisons of copy. The new block asserts what the sentences say. Same
division of labour 05-22 had to work out for `NO_SEATS_LEFT_REASON`.

## #31: the draft edit form's seeding, and the one thing the plan did not know

**The plan's method did not survive contact, and the correction is the interesting part of this
plan.** Task 3 asked for `DraftEditForm` to be rendered and its timing field values read back from
the markup. The two timing fields live inside `AdvancedTiming`, which wraps them in the shared
`Expander`, and `Expander` holds its own `useState(false)` and renders NO children while closed. A
static render fires no click. Verified empirically before the block was written:

```
EXPANDER: <div class="rounded-lg border border-edge bg-surface-2"><button type="button" class="...">
          <span>Advanced timing</span><span>Show</span></button></div>
```

The child never appears. So a plain render of `DraftEditForm` produces markup with no timing fields
in it at all, and the plan's populated and unset rows would both have been unwritable.

Three options were considered and two rejected:

1. **A source-containment pin** on the two `useState` lines. Real, and it would catch the audit's
   exact mutation, but it is the pre-05-21 idiom this round exists to move past, and it cannot
   distinguish the populated case from the unset one: the plan's independence mutation would have
   had no second row to stay green on.
2. **`Expander` gaining a `defaultOpen` prop.** Rejected outright: `primitives.tsx` is not in
   `files_modified`, and changing a shipped component to make it testable when the fact under test
   is reachable another way is exactly the churn the plan's prohibitions forbid.
3. **Fake `Expander` OPEN, and nothing else.** Chosen.

The fake spreads `importOriginal`, so `Input`, `Select`, `Field`, `Badge`, `Card` and `Button` are
all the shipped components and the values read back are the ones `DraftEditForm` genuinely computed
in its own initializers. It replaces the collapsible CHROME in the same way the store fake replaces
the store CONTAINER and never the component's selectors. What is faked away is a click, not a rule.
And the file carries a row that renders the REAL `Expander` through `vi.importActual`, asserting it
hides its children until opened, so the fake can never quietly outlive its reason. If that row ever
fails, the fake must go.

With that, the block asserts what the plan asked for:

- **Populated:** a draft carrying a 5 min discovery window and a 3 min funding window renders
  `value="5"` and `value="3"`, and the fixture's SERVICE defaults are deliberately different
  numbers (30 and 20) with a row asserting the fields are not those, so a seed that reached for the
  service default shows up as the wrong number rather than as a coincidence.
- **Unset:** a draft carrying no windows renders both as `value=""`, while `edit-size` still shows
  its own value, so the empties are the seeding rule at work and not a fixture that failed to
  arrive. Pre-filling the default here would look helpful and would in fact FREEZE the cohort's
  window at today's figure.
- **The other three seeds:** beacon type (read off the option React marked selected), size and
  threshold, plus the read-only network badge.
- **Bonus, and a second use of the store fixture:** on a `hermetic` service the funding field does
  not render at all, which is the shipped `mode === 'live'` guard and proves the fixture reaches the
  NESTED component rather than only the form.

**No `formFromDraft` was extracted.** `grep -c formFromDraft packages/web/src/lib/cohort-form.ts`
returns **0**. The reason has to be stated narrowly, because the loose version is wrong: it is not
that rendering works everywhere (the `Expander` finding above is proof it does not). It is that THIS
component's seeding travels by the `draft` PROP and is evaluated in `useState` initializers, both of
which a static render reaches, so the render pins the ACTUAL shipped expression. An extracted helper
would pin a copy of the rule and leave the component free to stop calling it, which is the defect
shape this whole round exists to close.

## Mutation runs, as observed

Every mutation was applied to shipped source, run, observed and reverted. `git diff` over
`operator-rows.ts`, `cohort-form.ts` and `DraftEditForm.tsx` after the round is EMPTY; the only
source diff in this plan is `CohortRow`'s `export` keyword and its docstring.

| # | Mutation | Predicted | OBSERVED |
|---|----------|-----------|----------|
| 1 | Relabel `co-signed` from `Signed` to `Anchored (co-signed)` | RED on the exact pin AND the anchor guard | **RED on both.** `expected 'Anchored (co-signed)' to be 'Signed'` and `expected 'Anchored (co-signed)' not to match /anchor/i`. 2 failed, 27 passed. |
| 2 | Relabel it to `Co-sign complete`, merely different but honest | RED on the exact pin ONLY, anchor guard green | **Exactly that.** `expected 'Co-sign complete' to be 'Signed'`. 1 failed, 28 passed. The two checks are independent rather than one written twice. |
| 3 | Delete the paused half of the DRAFT row binding: `disabled={isAdvertising \|\| advertisingPaused}` to `disabled={isAdvertising}` | RED on the paused draft row, green on the expired one | **Exactly that.** `disables the DRAFT row advertise control and renders the reason beside it` failed `expected false to be true`. 1 failed, 4 passed. The two call sites are covered independently. |
| 4 | Reword `THRESHOLD_ERROR` to drop "a whole number" | RED on the new copy pin | **RED, copy pin only.** The rule row followed the constant, as designed. 1 failed, 25 passed. |
| 5 | Replace the discovery seed with `useState('')`, the audit's exact mutation | RED on the populated row, green on the unset one | **Exactly that.** `expected '' to be '5'`. 1 failed, 4 passed. |
| 5b | Follow-up, the opposite direction: seed the SERVICE default when the draft has none (`draft.discoveryWindowMs ?? draft.defaultDiscoveryWindowMs`) | not predicted by the plan | **RED on the unset row and the hermetic row, green on the populated one.** `expected '30' to be ''`, twice. This is what proves the unset row is load-bearing about something the populated row cannot cover, in the shape of 05-22's mutation 4b. |

## Deviations from Plan

**1. The `DraftEditForm` render needed an `Expander` fake, which the plan did not anticipate.**
Documented in full above. The plan allowed for the form's "three incidental store reads" needing the
store fake; the collapsible wrapper was the actual obstacle. The chosen fix is scoped to one
presentational component, is pinned against the real one in the same file, and leaves every value
under test computed by shipped code.

**2. The render block went into `cohort-form-render.spec.tsx`, so the plan's artifact note that
`packages/web/tests/cohort-form.spec.ts` should contain `renderStatic` is not met.** The plan's
action text explicitly branches on this ("in `cohort-form-render.spec.tsx` if it needs the fake"),
and it needs two. 05-22's check was run first and came back CLEAN: `cohort-form.spec.ts` has zero
store usage and zero primitives usage, so the split was not FORCED. It was chosen because one of the
two fakes is over the shared `ui/primitives` module, and confining that to a render-only file keeps
the 26 pure rows in `cohort-form.spec.ts` running against genuinely unmocked modules. Recorded
rather than glossed, since the round's rule is that a grouping change gets a stated reason.

**3. [Rule 2 - missing critical functionality] The forbidden dashes became escaped constants in two
more specs.** The plan's acceptance criterion asks that `grep -rlP '\x{2014}'` over
`operator-rows.spec.ts` and `cohort-form.spec.ts` list no files, and both carried guards written as
`not.toMatch(/<the character>/)`, which must contain what they forbid. Converted to `LONG_DASH` and
`EN_DASH` escaped constants, byte-identical in behavior, exactly as 05-22 did for
`service-controls.spec.ts`. The scan over all five touched files now returns nothing.

**4. The anti-vacuity rows were authored in the same write as the rest of their blocks, not before
them.** Stated precisely because the plan asked for them to be written FIRST. Each is FIRST IN FILE
ORDER within its block, and the `operator-rows-render.spec.tsx` control was run and observed passing
IN ISOLATION (`vitest -t`, 1 passed / 4 skipped) before any paused row was ever run. For
`cohort-form-render.spec.tsx` the populated and unset rows are each other's control and mutations 5
and 5b prove each fails without the other, which is a stronger demonstration than authoring order.

**5. The stale comment 05-22 recorded in `operator-rows.spec.ts` was fixed, as the plan directed.**
Its `DISMISS_READVERTISE_LINE` row no longer claims to be "in the shape of the shipped
`DISMISS_BODY` pin" (05-22 promoted that to exact equality); it now records that both constants are
pinned word for word in `service-controls.spec.ts` and that these two containments stay here because
they name which two facts are load-bearing.

## The 05-20 correction

`05-20-SUMMARY.md` gains a dated correction note under `## Residual exposure of the presentation
pins`, amending "its values are asserted" and `05-20-PLAN.md:33`'s stronger "the tone, pulse AND
label of every chip are ASSERTED, not eyeballed". What actually shipped: tone and pulse per chip by
exact equality, and labels only as a distinct SET plus truthiness and a long-dash guard. The
original text is left as written and the note is the correction, per the plan's instruction to amend
in place rather than rewrite. `05-20-PLAN.md:257`'s narrower "the labels are pinned distinct" was
accurate and is noted as such.

## The UAT automation ledger

Five clauses across three tests (2 earns three, 6 and 12 one each). NO test was removed from
`## Tests`, and the paragraph beneath the ledger now says why for each new one: test 2 still needs
the over-ceiling refusal that 05-26 closes plus the `Cancel edit` clause, which is behind a click;
test 6 still needs the public paused notice and the narrow-width chip wrap; test 12 still carries an
owner JUDGMENT ("confirm the new wording reads as honest rather than as a regression") that no
assertion can make for them, which 05-27 narrows rather than removes. `## Summary` counts are
untouched; 05-27 reconciles them.

## Verification

| Check | Result |
|-------|--------|
| `pnpm test` | green, **65 files / 1106 tests** (05-22 left it at 63 / 1090, so +2 files and +16 tests; no assertion deleted or loosened) |
| `pnpm vitest run packages/web/tests/operator-rows.spec.ts` | green, 29 (baseline 26) |
| `pnpm vitest run packages/web/tests/operator-rows-render.spec.tsx` | green, 5 (new) |
| `pnpm vitest run packages/web/tests/cohort-form.spec.ts` | green, 26 (baseline 23) |
| `pnpm vitest run packages/web/tests/cohort-form-render.spec.tsx` | green, 5 (new) |
| `pnpm typecheck` | green |
| `pnpm lint` | green |
| `pnpm --filter @btcr2-aggregation/web build` | green |
| `git diff --stat pnpm-lock.yaml` | empty (T-05-23-SC: no package installed) |
| `git diff` on `operator-rows.ts`, `cohort-form.ts`, `DraftEditForm.tsx` | EMPTY: every mutation reverted, no shipped label, error string or seeding expression changed |
| `git diff` on `OperatorCohortList.tsx` | one line, `function CohortRow` to `export function CohortRow`, plus its docstring paragraph |
| `grep -c "vi.mock" packages/web/tests/operator-rows.spec.ts` | 0 |
| `grep -c formFromDraft packages/web/src/lib/cohort-form.ts` | 0 |
| `grep -rlP '\x{2014}'` over both specs, both render specs, `OperatorCohortList.tsx` and `05-UAT.md` | no files |

**Verified rather than assumed:** the root `tsc -b` genuinely typechecks `packages/web/tests`, and
therefore the typed fixture holders are a `pnpm test` failure rather than a comment. Confirmed by
temporarily adding `notAField: 1` to the operator fixture in `cohort-form-render.spec.tsx`:
`pnpm typecheck` failed with `TS2353: 'notAField' does not exist in type 'Partial<OperatorState>'`,
and passed again on revert. Separately, the four cohort-form error strings were read out of
`packages/service/src/operator-cohorts.ts` and confirmed byte-identical to the web constants before
the literals were retyped.

Also verified untouched: 05-19's four pinned shapes in `OperatorCohortList.tsx` (the guarded
`DISMISS_READVERTISE_LINE` conditional, the verbatim `dismissDropsReadvertise(cohort)` call, the
`ConfirmPanel` element and the discard-draft confirm after it). The docstring added to `CohortRow`
names no pinned constant, and 05-19's source-read rows all pass.

## Threat mitigations

| Threat ID | Disposition | How |
|-----------|-------------|-----|
| T-05-23-01 | mitigated | Every chip label pinned by exact equality, plus an independent anchor-wording guard on the three chips that must never make the claim and a positive assertion on the one that may. Mutations 1 and 2 are RED, and 2 proves the two checks are independent. |
| T-05-23-02 | mitigated | Both advertise call sites rendered paused and running and asserted in both directions, plus the row proving the row's other controls stay enabled. Mutation 3 is RED on exactly the mutated call site. |
| T-05-23-03 | mitigated | `DraftEditForm` rendered on a windowed and an unwindowed draft with the field values read back from markup. Mutations 5 and 5b are RED in opposite directions, so neither row is the other written twice. |
| T-05-23-SC | mitigated | Zero packages installed; empty lockfile diff. |

## The honest limits, restated

1. **A static render fires no events and runs no effects.** `Cancel edit`, `Save changes`, the
   advertise click itself, the discard confirm and the dismissal panel are all behind interactions
   and are not exercised here. Their copy is pinned as constants; the interaction belongs to the
   real-Chromium playwright-core legs under `e2e/` (05-27 adds the operator one).
2. **The `Expander` fake means the timing fields are asserted in their OPEN state**, which is the
   state a human reaches with one click rather than one this suite invented. The real primitive's
   closed behavior is pinned in the same file. What is NOT proven here is that a human can open it,
   which is a click and therefore a browser-leg property.
3. **Byte-identity with the server's refusal copy is two independent literals, not a shared
   constant.** Two specs in two packages must both be edited for a reword to ship, which is the
   strongest form available without coupling the browser bundle to the server package. Nothing
   compares the two at runtime.

## Known Stubs

None. No placeholder values, no unwired data sources, no skipped tests, and no unrun `<verify>`
chain in this plan.

## Threat Flags

None. This plan adds no network endpoint, no auth path, no file access pattern and no schema change
at a trust boundary.

## Commits

| Task | Commit | What |
|------|--------|------|
| 1 | `f65ed76` | `test(05-23): pin every chip label word for word and guard the anchor claim` |
| 2 | `8a4df04` | `test(05-23): render both advertise call sites paused and running` |
| 3 | `ffd6d53` | `test(05-23): pin the shape-error copy and render the draft edit form's seeding` |

## Self-Check: PASSED

Files verified present on disk: `packages/web/tests/operator-rows.spec.ts`,
`packages/web/tests/operator-rows-render.spec.tsx`, `packages/web/tests/cohort-form.spec.ts`,
`packages/web/tests/cohort-form-render.spec.tsx`,
`packages/web/src/components/operator/OperatorCohortList.tsx`,
`.planning/phases/05-operator-cohort-lifecycle-control/05-20-SUMMARY.md`,
`.planning/phases/05-operator-cohort-lifecycle-control/05-UAT.md`.
Commits verified in `git log`: `f65ed76`, `8a4df04`, `ffd6d53`.
