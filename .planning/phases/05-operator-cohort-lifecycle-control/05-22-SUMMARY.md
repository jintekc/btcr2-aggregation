---
phase: 05-operator-cohort-lifecycle-control
plan: 22
subsystem: web-operator-console-coverage
tags: [gap-closure, coverage, render, copy-pins, mutation-testing, mode-chip, kill-switch]
status: complete
requires:
  - "packages/web/tests/support/render.tsx: renderStatic, selectorFake, asRenderedText (05-21)"
  - "packages/web inside the root tsc -b, so a mistyped render fixture is a compile error (05-21)"
  - "OperatorState and ParticipantState exported as types (05-21)"
provides:
  - "MODE_LABEL exported from HealthStrip, so the strip's most consequential copy is assertable"
  - "TestPeerAction exported from CohortDetail, so the seat-exhausted disabled wiring is renderable"
  - "the mode-chip matrix: every served mode rendered and asserted in both directions"
  - "the nine-member test-peer copy family pinned with a long-dash guard"
  - "NO_SEATS_LEFT_REASON pinned as a literal on the web side, with no service-package import"
  - "DISMISS_BODY pinned by exact equality on all three sentences"
  - "DISMISS_READVERTISE_LINE pinned by exact equality, so the two constants stay distinguishable"
  - "the kill-switch mode guard rendered across all four service-mode states"
  - "LONG_DASH: the forbidden character spelled once as an escape, so the repo scan over this spec returns nothing"
  - "six new rows in the 05-UAT automation ledger (tests 6, 9, 11, 17)"
affects:
  - packages/web/src/components/operator/HealthStrip.tsx
  - packages/web/src/components/operator/CohortDetail.tsx
  - packages/web/tests/service-controls.spec.ts
  - .planning/phases/05-operator-cohort-lifecycle-control/05-UAT.md
tech-stack:
  added: []
  patterns:
    - "chipRendered: match a label as a COMPLETE chip (`>label</span>`), because `Live` is a substring of `Live (no broadcast)` and a plain toContain cannot assert the second does not also claim the first"
    - "exhaustive-by-construction matrix: `Record<ServiceMode, true>` keyed over the union, so a fourth mode is a type error rather than a silently missing row"
    - "LONG_DASH as an escaped constant, so a house-style guard no longer has to contain the character it forbids"
    - "two independent literal pins of one cross-package sentence, rather than an import that would couple the browser bundle to the server"
key-files:
  created: []
  modified:
    - packages/web/src/components/operator/HealthStrip.tsx
    - packages/web/src/components/operator/CohortDetail.tsx
    - packages/web/tests/service-controls.spec.ts
    - .planning/phases/05-operator-cohort-lifecycle-control/05-UAT.md
decisions:
  - "No sibling render spec was created. The plan allowed `service-controls-render.spec.tsx` IF installing the file-scoped fake would disturb existing real-store rows; the check was run before writing and came back clean, because every pre-existing row in this file calls a pure selector or reads an exported constant and not one touches a bound store hook. JSX is reached through `createElement`, which is what `lifecycle.spec.ts` already does in a `.ts` file."
  - "The mode matrix matches a label as a complete chip rather than by substring. `Live` is a substring of `Live (no broadcast)`, so the both-directions property the whole matrix rests on is unassertable with `toContain`."
  - "The forbidden long dash is now one escaped constant in this file and the two pre-existing guards were converted to it. The comparison is byte-identical, so no assertion changed meaning, and the acceptance criterion 05-21 had to record as unmeetable is now met for this file."
  - "DISMISS_READVERTISE_LINE gained its own exact pin HERE rather than by editing `operator-rows.spec.ts`, which is outside this plan's files_modified and therefore outside the wave guarantee."
metrics:
  duration: ~30m
  completed: 2026-07-30
---

# Phase 5 Plan 22: Pin the operator console's most consequential copy Summary

The mode chip, the kill switch's mode guard, the test-peer refusal and the dismissal promise all
fail the suite when their shipped source is mutated. Six mutation runs prove it; one contradicted
the audit's prediction and is recorded as observed rather than as predicted.

## Gap source

`.planning/phases/05-operator-cohort-lifecycle-control/05-AUDIT-2.md`. This plan closes **#25**
(entry 6, High), **#22 and #10** (entry 14, Medium), **#27** (entry 16, Medium) and **#20**
(entry 22, Low).

None is a live protocol bug. Each is a mutation that WOULD have shipped undetected, which is why
the proof that a coverage fix worked is that the mutation now fails.

## The file-split check, run before writing

The plan permitted a sibling `packages/web/tests/service-controls-render.spec.tsx` if installing the
file-scoped fake would disturb existing rows, and required the check "before writing, not after". It
was run first and came back clean: every one of the 24 pre-existing rows in
`packages/web/tests/service-controls.spec.ts` calls a pure selector (`serviceControlsView`,
`broadcastControlState`, `operatorLogState`) or reads an exported copy constant, and NOT ONE touches
a bound store hook. The `vi.mock` factories spread the actual modules, so `DISMISS_BODY` and every
other constant stays the shipped one; only `useOperator` and `useParticipant` are replaced. No
sibling file was created and `files_modified`'s `service-controls-render.spec.tsx` is unused.

That is the opposite of `terms-render.spec.tsx`, which 05-21 had to split off because `terms.spec.ts`
has 22 live `useParticipant` calls the fake could not serve. JSX is reached through `createElement`,
exactly as `lifecycle.spec.ts` already does inside a `.ts` spec.

## #25: the mode chip

`MODE_LABEL` is exported from `packages/web/src/components/operator/HealthStrip.tsx`. The map stays
where it was, beside the file's other chip labels, so every label on that row still has one home;
the diff on the source file is the export keyword and its docstring and nothing else.

The map is pinned by exact equality per label, and its key set is checked against a
`Record<ServiceMode, true>` keyed over the union rather than a hand-listed `ServiceMode[]`. That
distinction is load-bearing: an array literal is checked for MEMBERSHIP, never for completeness, so a
fourth mode added to the union would leave a hand-listed array typechecking while the matrix quietly
stopped being a matrix. The record makes a fourth mode a compile error.

Then the strip is RENDERED under each served mode. Every row asserts in both directions, the expected
label present and the other two absent, because a presence check alone passes a chip that rendered
every label at once. Absence is asserted through `chipRendered`, which matches a label as a COMPLETE
chip (`>label</span>`) rather than as a substring: `Live` is a substring of `Live (no broadcast)`, so
`expect(html).not.toContain('Live')` could never be true on the live-no-broadcast row, and the
both-directions property this whole block rests on would have been unassertable.

Two rows carry the product properties rather than the copy:

- **Pre-first-read.** With `health` undefined the strip renders `Checking mode` and none of the three
  mode labels. Presuming `Hermetic` on a service that has not answered would tell the operator it
  does not touch the chain while it may be broadcasting real Bitcoin.
- **Live plus kill switch engaged (D-14).** Three assertions in one row: the live label present, the
  hermetic label absent, and `BROADCAST_OFF_CHIP` present. No single one of the three catches a
  mutation that makes the mode chip read the kill switch, and the row says so in a comment.

The anti-vacuity control was written and run FIRST, before any row asserting an absence, and observed
passing in isolation (`vitest -t`, 1 passed / 24 skipped) before the rest of the block existed.

## #22 and #10: the test-peer surface

`TestPeerAction` is exported from `CohortDetail.tsx`. It already took pure props and held only its
own confirm-open state, so exporting it is one keyword; its docstring says why.

**The family has NINE members, not eight.** The plan and the audit both say eight. Counting the block
between the copy set's docstring and `NO_SEATS_LEFT_REASON`: five plain strings
(`ADD_TEST_PEERS_LABEL`, `ADD_TEST_PEERS_BODY`, `ADD_TEST_PEERS_CANCEL_LABEL`, `ADD_TEST_PEERS_BUSY`,
`NO_SEATS_LEFT_REASON`) and FOUR interpolating helpers (`addTestPeersHelp`, `addTestPeersHeading`,
`addTestPeersConfirmLabel`, `liveTestPeersLine`). All nine are pinned and all nine pass the long-dash
guard, which is strictly stronger than what was asked.

`NO_SEATS_LEFT_REASON` is pinned as a literal with a comment stating the contract in words: this is
the sentence an operator reads BEFORE clicking, and the service's own 409 refusal is the sentence
they would read if they clicked anyway, and UI-SPEC E11 requires them to be one string rather than
two that can drift. The service-side counterpart and both specs that pin it are NAMED, not imported.
`grep -cE "^\s*(import|from|require).*(packages/service|@btcr2-aggregation/service)"` over the spec
returns **0**; the five textual matches are all inside that comment.

The component is then rendered at zero and at a positive remaining count. Each row asserts both
directions, so the two rows are each other's anti-vacuity control: one asserts exactly what the other
denies. `disabled` is read off the ATTRIBUTE and never the class list, because the shared `Button`
base carries `disabled:cursor-not-allowed disabled:opacity-40` on every render, so a plain substring
check for "disabled" would be true no matter what the binding says.

The seat count is a PROP, so no store fixture was needed for the fact under test. The component's
three incidental store reads are served by the file-scoped fake as `undefined`, which is the real
unseeded posture: no in-flight marker and no error paragraph.

## #27: the kill switch's mode guard

`broadcastControlState`'s four pure-selector rows are untouched and stay. They are load-bearing about
the RULE. What was missing is proof the COMPONENT consults it, so `ServiceControls` is rendered across
all four service-mode states.

The engaged row gets two assertions rather than one: the one-way line present AND the control label
absent. A disabled-but-present control would satisfy a presence check on the line alone, and the
shipped decision is that the control is GONE, not disabled.

The live-with-broadcast-available row was written and run FIRST and observed passing in isolation
(1 passed / 40 skipped). Without it the three absence rows would all have passed against a fixture
that never reached the renderer.

The audit proposed closing this in `e2e/browser-operator.ts` because no spec in this repo could
render a component. 05-21 changed that, so it closes in the unit gate; 05-27 still adds the
real-Chromium leg as a second and independent witness.

## #20: the dismissal promise

`DISMISS_BODY` is now pinned by exact equality across all three sentences. The two sentence-level
containments are KEPT beside it, because they name which facts are load-bearing in a way one long
string does not. A comment states what the two easily droppable phrases cost: without "and its
activity log" and " for this session" the confirm reads as if the record were permanently destroyed
SERVER side, when in fact it clears one console for one session.

`DISMISS_READVERTISE_LINE` gained its own exact pin, so the two constants stay distinguishable now
that the body is pinned whole.

## Mutation runs, as observed

Every mutation was applied to shipped source, run, observed, and reverted. `git diff` over each
source file after the round shows only the intended export keyword and docstring.

| # | Mutation | Predicted | OBSERVED |
|---|----------|-----------|----------|
| 1 | Relabel a mode: `live: 'Live'` to `live: 'Live broadcasting'` in `HealthStrip.tsx` | RED | **RED.** `carries exactly one label per ServiceMode, each pinned word for word` failed `expected 'Live broadcasting' to be 'Live'`. 1 failed, 32 passed. |
| 2 | Make the mode chip read the kill switch: `{mode ? (broadcastOff ? MODE_LABEL.hermetic : MODE_LABEL[mode]) : 'Checking mode'}` | RED on the live-plus-broadcast-off row | **RED, exactly that row.** `keeps the LIVE label and adds the broadcast-off chip once the kill switch engages` failed `expected false to be true`. 1 failed, 32 passed. |
| 3 | Delete `disabled={remaining === 0}` from the test-peer control | RED on the zero-seat row | **RED, exactly that row.** `renders the control DISABLED beside the refusal reason when no seats are left` failed `expected false to be true`. 1 failed, 39 passed. |
| 4 | Reword `NO_SEATS_LEFT_REASON` to `'No seats remain in this cohort.'` | RED on BOTH the literal pin and the zero-seat render row | **RED on the literal pin ONLY.** `expected 'No seats remain in this cohort.' to be 'This cohort has no seats left.'`. 1 failed, 39 passed. **This contradicts the plan's prediction** and is recorded rather than papered over. See below. |
| 4b | Follow-up, added because 4 contradicted its prediction: swap the ternary arms so the reason and the help line render on the wrong seat counts | not predicted | **RED on BOTH render rows.** `expected '<div class="space-y-2">...' to contain 'This cohort has no seats left.'` and `... to contain 'Adds 2 in-process test participants...'`. 2 failed, 38 passed. |
| 5 | Delete the mode half of the kill-switch guard: `{broadcast === 'available' && !confirmingBroadcast ? (` to `{!confirmingBroadcast ? (` | RED on the hermetic and live-no-broadcast rows | **RED on THREE rows**, the two predicted plus the engaged row, each `expected '<div class="rounded-xl border border-...' not to contain 'Disable broadcast'`. 3 failed, 42 passed. |
| 6 | Narrow `DISMISS_BODY`: delete "and its activity log" | RED | **RED.** `states the rung-1 dismissal copy, including that there is no undo`. 1 failed, 44 passed. |
| 6b | Narrow `DISMISS_BODY` the other way: delete " for this session" | RED | **RED.** Same row. 1 failed, 44 passed. |

### The contradicted prediction, and what was done about it

Mutation 4 rewords the shipped constant. The plan predicted both the literal pin and the zero-seat
RENDER row would go red; only the literal pin did. The reason is structural rather than a coverage
hole: the render row asserts `html` contains `asRenderedText(NO_SEATS_LEFT_REASON)`, so it follows
the constant wherever it goes. That is the correct division of labour, and it is why the plan asked
for BOTH a literal pin and a render:

- the literal pin is what catches a reword (mutation 4);
- the render row is what catches the component failing to show the sentence on the path that needs
  it (mutation 4b) or losing the disabled binding beside it (mutation 3).

Mutation 4b was added and run specifically to prove the render row is load-bearing about something,
rather than accepting a row whose only demonstrated failure mode is one another row already covers.
It goes red on both rows.

The alternative, retyping the sentence inside the render assertion, was rejected: it would put the
same string in two places in one file, which is the drift this pin exists to prevent.

## Deviations from Plan

**1. The test-peer copy family has nine members, not the eight the plan and the audit both counted.**
All nine are pinned and guarded. Pinning more than asked is strictly stronger, so nothing was
skipped; the count is recorded so the next reader of the audit does not go looking for a missing
constant.

**2. [Rule 2 - missing critical functionality] The forbidden long dash is now an escaped constant,
and the two pre-existing guards in this file were converted to it.** The plan's acceptance criterion
asks that a `grep -rlP '\x{2014}'` over this spec list no files. 05-21 had to record that criterion
as unmeetable, because a guard of the form `expect(s).not.toContain('<the character itself>')` must contain the character
it forbids, and every grep that looks reads that as a violation. Spelling it once as an escape and
comparing against the constant is byte-identical in behavior (no assertion changed meaning, nothing
was weakened) and makes the property honest: the scan over
`packages/web/tests/service-controls.spec.ts` now returns **0**, as it does over `HealthStrip.tsx`,
`CohortDetail.tsx` and `05-UAT.md`.

**3. `packages/web/tests/operator-rows.spec.ts` carries a comment that is now stale, and was NOT
edited.** Its `DISMISS_READVERTISE_LINE` row justifies using containment "in the shape of the shipped
`DISMISS_BODY` pin", which was true until this plan promoted `DISMISS_BODY` to exact equality. That
file is outside `files_modified`, and the plan's read-only regression rule says a spec edited outside
that field silently weakens the wave guarantee. Its assertions are still true and still green
(containment survives an exact pin elsewhere), so the correction is recorded here for whoever next
touches that file rather than made across the wave boundary.

## The UAT automation ledger

Six clauses were earned across four tests (6, 9, 11 and 17; test 17 earns two). NO test was removed
from `## Tests`, and the paragraph under the ledger now says why for each: test 6 still needs the
public paused notice and the narrow-width chip wrap, test 9 the live-cohort registration disclosure
that 05-26 closes, test 11 the expired-row fate read that 05-25 closes, and test 17 a real
`LIVE=1 BROADCAST=1` boot that no unit gate can stand up. `## Summary` counts are untouched; 05-27
reconciles them.

## Verification

| Check | Result |
|-------|--------|
| `pnpm test` | green, **63 files / 1090 tests** (05-21 left it at 63 / 1069, so +21 tests and no new file; no assertion deleted or loosened) |
| `pnpm vitest run packages/web/tests/service-controls.spec.ts` | green, 45 tests (baseline 24) |
| `pnpm lint` | green |
| `pnpm --filter @btcr2-aggregation/web build` | green |
| `git diff --stat pnpm-lock.yaml` | empty (T-05-22-SC: no package installed) |
| `git diff` on `HealthStrip.tsx` | one line, `const MODE_LABEL` to `export const MODE_LABEL`, plus its docstring |
| `git diff` on `CohortDetail.tsx` | one line, `function TestPeerAction` to `export function TestPeerAction`, plus its docstring |
| `grep -cE "^\s*(import\|from\|require).*(packages/service\|@btcr2-aggregation/service)"` over the spec | 0 |
| `grep -n "setState"` over the spec | 3 hits, all prose inside docstrings explaining why there is none; no render row is seeded that way |
| `grep -cP '\x{2014}'` over the spec, `HealthStrip.tsx`, `CohortDetail.tsx`, `05-UAT.md` | 0 in all four |
| `grep -c "renderStatic"` over the spec | 4 |

Per-task file counts: 24 (baseline) to 33 (task 1) to 40 (task 2) to 45 (task 3).

## Threat mitigations

| Threat ID | Disposition | How |
|-----------|-------------|-----|
| T-05-22-01 | mitigated | Every served mode is rendered and asserted in both directions, including the live-plus-kill-switch row; mutations 1 and 2 are RED. A hermetic claim cannot be painted onto a live service without a test noticing. |
| T-05-22-02 | mitigated | The controls card is rendered across all four mode states and the control is absent on three; mutation 5 is RED on three rows. |
| T-05-22-03 | mitigated | Exact equality on all three sentences of the dismissal body; mutations 6 and 6b are RED. |
| T-05-22-SC | mitigated | Zero packages installed; empty lockfile diff. |

## The honest limit, restated

A static render fires no events, runs no effects and performs no state transitions. The kill switch's
CONFIRM panel, the test-peer confirm and its live-cohort line are all behind a click and are not
rendered by any row here; their copy is pinned as constants, and the interaction that reveals them
stays with the playwright-core legs under `e2e/` (05-27 adds the operator one). What this plan
asserts is the wire between a served value and a rendered element, which is exactly where the audit
found the hole.

## Known Stubs

None.

## Self-Check: PASSED

Files verified present on disk: `packages/web/tests/service-controls.spec.ts`,
`packages/web/src/components/operator/HealthStrip.tsx`,
`packages/web/src/components/operator/CohortDetail.tsx`,
`.planning/phases/05-operator-cohort-lifecycle-control/05-UAT.md`.
Commits verified in `git log`: `ca7e9f6` (task 1), `29d6bc6` (task 2), `372a0a6` (task 3).
