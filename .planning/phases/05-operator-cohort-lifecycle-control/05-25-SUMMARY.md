---
phase: 05-operator-cohort-lifecycle-control
plan: 25
subsystem: operator-cohort-service-surface
tags: [gap-closure, coverage, mutation-testing, draft-edit, timing-windows, refusal-copy, cohort-fate]
status: complete
requires:
  - "packages/service/src/operator-cohorts.ts: the update verb's window assembly, and forgetTerminal's canceled-only carry (05-19)"
  - "packages/service/src/hono-adapter.ts: the PATCH route and its 404 body"
  - "packages/service/tests/cohort-fate.spec.ts: the fateApp harness and the anonymousFate reader (05-10, 05-19)"
provides:
  - "packages/service/tests/draft-edit.spec.ts: the first test that ever completes a successful window edit, both windows, both directions"
  - "the three draft refusals asserted as a FAMILY, so a refusal that started describing cohort state is caught as a divergence"
  - "packages/service/tests/cohort-fate.spec.ts: the first dismissal of a record that EXPIRED rather than one that was canceled"
  - "a corrected docstring on the web client's updateDraft, which claimed a 404 falls back to the generic message"
  - "a dated correction in 05-19-SUMMARY.md about the untested non-canceled leg of the dismissal carry"
  - "three new rows in the 05-UAT automation ledger (tests 2 and 11), and a clause-by-clause retirement check on test 11 recorded as PARTIAL"
affects:
  - packages/service/tests/draft-edit.spec.ts
  - packages/service/tests/cohort-fate.spec.ts
  - packages/service/src/operator-cohorts.spec.ts
  - packages/web/src/lib/operator.ts
  - .planning/phases/05-operator-cohort-lifecycle-control/05-19-SUMMARY.md
  - .planning/phases/05-operator-cohort-lifecycle-control/05-UAT.md
tech-stack:
  added: []
  patterns:
    - "a clearing row paired with its positive twin, because a clearing assertion alone passes just as happily against code that never writes the value at all"
    - "reading a mutated fact back TWICE, from the verb's own return value and from the served route, so a response assembled separately from the stored state fails one of the two"
    - "asserting the ABSENCE of a key (`'x' in dto` is false) beside its undefined-ness, because the wire shape is additive and an explicit undefined is a different promise"
    - "comparing sibling refusals to EACH OTHER rather than each to its own literal, so a refusal that grew a state hint is a divergence rather than a row somebody updates"
    - "putting the control leg in the SAME describe as the leg under test, so a scope-widening mutation must be observed as an asymmetry rather than as two separate runs"
decisions:
  - "The clearing rows were driven on a service that HAS a window default of its own, so 'cleared' is proven to mean 'falls back to this service's default' rather than 'has no window'. Both halves are asserted in the same row: the explicit key is absent AND the default key is still served."
  - "A fifth row moves exactly ONE of the two windows. A merge refactor and a key-swap refactor both survive a per-window pair; only a row that clears one while keeping the other shows the two keys are assembled independently."
  - "A second, unplanned mutation was run for the refusal family. The audit's rename reddens the body row and the cross-comparison but NOT the advertised-id row, because a uniform rename keeps the refusals identical to each other. A state-describing mutation was run to prove that row load-bearing on its own terms."
  - "The expired record is reached with `runner.stopCohort`, not `runner.stop()`. Both file the expired fate, but stopCohort leaves the runner alive so `forgetTerminal`'s still-in-flight phase guard is genuinely consulted against a live session rather than a dead one."
  - "The canceled control row was written into the NEW block rather than cited from the shipped row above it, because the widened-carry mutation is only meaningful as an asymmetry and the two legs have to be observable in one run."
  - "UAT test 11 is NOT retired. Three of four clauses have rows; the fourth is covered on the service side only, and the console-side store action is invoked by no test in the repo. `packages/web/tests/operator.spec.ts` is not in this plan's files_modified, so the pin was left to its owner rather than guessed at."
metrics:
  duration: ~40m
  completed: 2026-07-30
---

# Phase 5 Plan 25: Clearing a window really clears it, a refusal stays opaque, and a lapse is never a cancel Summary

Three server-side transitions that no test had ever completed now run under test: a successful
window edit, the unknown-draft refusal's body, and the dismissal of a record that expired rather
than one that was canceled. Four mutation runs prove it, one of which was added because the audit's
own mutation left a new row unproven.

## Gap source

`.planning/phases/05-operator-cohort-lifecycle-control/05-AUDIT-2.md`. This plan closes **#29**
(entry 10, Medium), **#32** (entry 23, Low) and **#19** (entry 8, Medium, marked warn).

None is a live protocol bug. Each is a mutation that WOULD have shipped undetected, so the proof
that a coverage fix worked is that the mutation now fails.

## #29: the assembly nothing ever reached

`updateDraft` rebuilds a draft's explicit windows with a four-way conditional spread. Every existing
edit row in the repo passes no window key at all, and the one row that does supply one
(`discovery-window.spec.ts`, the over-ceiling refusal) throws inside `validateDraft` before the
assembly runs. So the assembly was unexecuted source, and the audit's merge/preserve refactor would
have shipped green while silently keeping a window the operator had just cleared.

The consequence is a broken promise rather than a crash. The console tells the operator that an
empty timing field means "use this service's default"; clearing the field would not have made that
true, and the cohort would have gone out with a discovery or funding window the operator believed
they had removed.

Six rows in `packages/service/tests/draft-edit.spec.ts`:

| Row | Drives | Asserted |
|-----|--------|----------|
| clear discovery | create with 10 min, update with the key omitted | key ABSENT on the DTO and on the served list, AND the service's own 20-min default still carried |
| set discovery | create with none, update with 7 min | present on the DTO and on the served list |
| clear funding | create with 6 min, update with the key omitted | key ABSENT both ways, AND the 12-min default still carried |
| set funding | create with none, update with 4 min | present both ways |
| move one, keep the other | create with both, update supplying only funding | discovery gone, funding intact |
| no window at all | a pure shape edit | the WHOLE DTO by deep equality, and the served row equal to it |

Three things about the shape are load-bearing rather than tidy.

**The positive twin is not decoration.** A clearing row on its own passes just as happily against an
assembly that never writes an explicit window in the first place. The setting row is what proves the
clearing row is measuring a real transition.

**Each fact is read back twice**, from the update verb's own return value AND from the gated
`GET /v1/operator/cohorts`. A response DTO assembled separately from the stored draft would satisfy
one and not the other, which is exactly the failure mode the audit's closing test asks about.

**"Cleared" is asserted to mean "falls back to the service default", not "has no window".** The
clearing rows run against a service seeded with a default of its own, so the row asserts the
explicit key is gone AND `defaultDiscoveryWindowMs` is still served beside it. Absence is asserted
as absence (`'discoveryWindowMs' in dto` is false), not merely as undefined, because the wire shape
is additive and an explicit undefined would be a different promise to the console.

The shipped assembly is **byte-unchanged**. The plan's rule was to prove the current behavior and
then prove a refactor of it would be caught, and `git diff packages/service/src/operator-cohorts.ts`
is empty. No validation rule was relaxed to reach the assembly: the rows supply valid window values
against an app with no cohort TTL, so the ceiling never fires.

## #32: the refusal string that reaches the operator verbatim

`hono-adapter.ts` answers a PATCH on a non-draft id with `{ error: 'unknown draft' }`, and
`packages/web/src/lib/operator.ts` parses that body and renders the server's own sentence. The
existing row asserted the status and nothing else, so a rename would have changed what an operator
reads with the gate still green.

The row was promoted to deep equality and mirrored onto the discard and advertise 404s in
`packages/service/src/operator-cohorts.spec.ts`, which emit the same body. Then two rows the audit
did not ask for, and they are the ones that matter:

- **The three refusals are compared to EACH OTHER**, status included. Asserting each body against
  its own literal does not catch the interesting regression: a change that made one of the three
  describe the cohort's actual state would still pass its own updated row while turning a uniform
  refusal into a state oracle. Only the cross-comparison sees it.
- **An ADVERTISED id is driven through the PATCH route** and its refusal asserted byte-identical to
  the one an id the service never issued earns. That is the sharpest case for the family property:
  the service knows exactly what that id is, and must still say nothing about it.

### The client docstring, corrected but not the code

The JSDoc on `updateDraft` claimed a 404 "falls back to the generic message". It does not. The
client falls back only when the body fails to parse as JSON carrying an `error` string, so the 404
renders `unknown draft` verbatim and the 413 is the case that genuinely falls through. The docstring
now says what the code does, in those terms.

**The code was deliberately left alone, and the copy question is flagged rather than resolved.**
Whether `unknown draft` is the right sentence for an operator staring at a stale edit form, on an id
that may well be a cohort they just advertised, is a copy decision and this round pins what ships
rather than redesigning it. It is recorded in `05-UAT.md` for 05-27's batched copy read. The
uniformity is now protected either way: any reword has to keep all three refusals identical.

## #19: dismissing a lapse must not manufacture an accusation

05-19 built the `dismissedCanceled` carry correctly and scoped it correctly, to the canceled fate
only. What it did not do is test the other side of that scope. All three of its dismissal rows
CANCEL before they dismiss, so `record.fate === 'canceled'` was only ever entered on its true side,
and widening it to `record.fate` would have shipped green.

The consequence is not a lost bit but an invented one. `GET /v1/cohort-fate/:id` is the one fact a
seated participant can learn out of band, and the participant console turns a true into "The
operator canceled this cohort." A widened carry would have told every anonymous participant of a
cohort that merely ran out of time that the operator ended it deliberately, against a named
operator, the moment the operator tidied the row away. That is the exact inversion of the honesty
D-02 and ADR 0017 exist to protect.

Four rows in `packages/service/tests/cohort-fate.spec.ts`:

| Row | Setup | Asserted |
|-----|-------|----------|
| the leg nothing drove | advertise, `runner.stopCohort` (no intent), settle, DELETE through the gated route | the operator list says `expired` before the dismissal, the row is gone after it, and the anonymous fate still reads `{ canceled: false }` |
| the control | advertise, `cancelCohort`, settle, DELETE | the list says `canceled`, and the fate still reads `{ canceled: true }` |
| the isolation | advertise, stop, settle, NO dismissal | `{ canceled: false }` |
| the non-oracle | dismissed expiry | byte-identical to an id this service never issued, status included |

**The expired record is reached by expiry, not by a cancel.** `runner.stopCohort` declares no
intent, so `settleCompletion` files `expired`; `cancelCohort` declares the intent first, which is
precisely the shortcut that made the existing three rows blind here. `stopCohort` was chosen over
the audit's suggested whole-runner `stop()` because it leaves the runner alive, so `forgetTerminal`'s
still-in-flight phase guard is consulted against a live session rather than a dead one.

**The control row lives in the same block on purpose.** A widened carry is only meaningful as an
asymmetry: the mutation that breaks the expired rows has to be observed leaving the canceled one
green, which is what says the carry is scoped rather than broken. Citing the shipped row twenty
lines above would have split that observation across two runs.

## Mutation runs, as observed

Every mutation was applied to shipped source, run, observed and reverted. `git diff` over
`packages/service/src/operator-cohorts.ts` and `packages/service/src/hono-adapter.ts` after the
round is EMPTY. This plan changes no shipped behavior at all; its only non-test source edit is a
docstring.

| # | Mutation | Predicted | OBSERVED |
|---|----------|-----------|----------|
| 1 | **The audit's "Needs a mutation run" item 3:** in `updateDraft`, replace the conditional-spread assembly with `explicit: { ...drafts.get(draftId)!.windows.explicit, ...(discoveryWindowMs !== undefined ? ... ) }` | `pnpm lint` green; both clearing rows RED | **`pnpm lint` GREEN**, exactly as the audit predicted (both destructured variables stay used, and the non-null assertion is not flagged by this config). `pnpm test`: **3 failed / 1128 passed of 1131**. RED on `CLEARS a discovery window` (`expected 600000 to be undefined`), `CLEARS a funding window` (`expected 360000 to be undefined`) and `clears ONE window while leaving the other` (`expected 600000 to be undefined`). **Every one of the 1128 survivors is a pre-existing row**, which is the demonstration that on the pre-fix tree this mutation was fully green. |
| 2a | **The audit's rename:** `'unknown draft'` on the PATCH 404 becomes `'that draft is no longer editable'` | the new rows RED | **2 failed / 61 passed of 63.** RED on `404s a non-draft id with the exact opaque body` and on `answers the same 404 body for edit, discard and advertise`. The advertised-id row stayed GREEN, correctly: a uniform rename keeps the two PATCH refusals identical to each other, so that row cannot see it. Not a contradiction of the audit, which named only the body row, but it left a new row unproven. |
| 2b | **Added, to prove the advertised-id row is not vacuous:** the PATCH 404 becomes `known ? 'that cohort is past editing' : 'unknown draft'`, where `known` is a `listCohorts()` membership test | not predicted by the plan | **RED on exactly the advertised-id row**, `expected { status: 404, ...(1) } to deeply equal { status: 404, ...(1) }`. 1 failed / 62 passed. The body row and the cross-comparison stayed GREEN, because both drive an unknown id. This is the state-oracle regression the family pin exists for, isolated to the single row that exists for it. |
| 3 | Widen the carry: `record.fate === 'canceled'` becomes `record.fate` | the expired row RED, the canceled row green | **Exactly that asymmetry.** `does NOT carry an EXPIRED fate` failed `expected { canceled: true } to deeply equal { canceled: false }`, and `answers a dismissed EXPIRED id byte-identically` failed on the status-and-body pair. The canceled control and the undismissed-expiry row both stayed GREEN. Full suite: **2 failed / 1135 passed of 1137**, so nothing else in the repo saw it. |

## The UAT automation ledger

Three rows: one on test 2 (a timing field the operator CLEARS round-trips as empty, which is the
save-path half of a clause 05-23 covered on the form side), and two on test 11 (the canceled fate
survives a dismissal; an expiry does not start reading as canceled).

**Test 11 was checked clause by clause for full retirement and is NOT retired.** Three of its four
clauses have rows: the canceled-fate survival, the expired-fate non-invention, and 05-22's pin on
the confirmation body's disclosure of what a dismissal costs. The fourth, "the row disappears and
stays gone, including after a refresh", is covered on the SERVICE side only: `forgetTerminal` plus
`monitor.dismissEnded` are proven to clear both ended-record sources, so a refresh cannot bring the
record back from the source of truth. What is not covered is the CONSOLE side.
`grep -rn dismissEnded packages/web/tests` finds nothing, so the store action at
`packages/web/src/stores/operator.ts:1144` is invoked by no test at all, and its deliberate design
choice (re-read from the service rather than splice the row out locally, which is what makes the row
stay gone rather than merely look gone) is unexercised, as are its 401 and unreachable branches.
`packages/web/tests/operator.spec.ts` is not in this plan's `files_modified` and no other plan in
this round claims it, so the pin was left to its owner with the recommended shape named in the
ledger rather than guessed at.

The 05-25 copy question about the operator-facing 404 wording is recorded in the same section for
05-27. `## Summary` counts are untouched; 05-27 reconciles them.

## Deviations from Plan

**1. A fourth mutation was added.** The plan asked for three. The audit's rename (2a) reddens the
body row and the cross-comparison but leaves the advertised-id row green, and this round's rule is
that a mutation staying green means an assertion is not load-bearing until proven otherwise. Mutation
2b was run against exactly that row and is documented above. Same reasoning 05-24 used when its
mutation 1 left one refusal row unproven.

**2. The expired record is reached with `runner.stopCohort`, not the audit's `runner.stop()`.** Both
file an `expired` fate with no intent declared, so both satisfy the prohibition against cancelling
first. `stopCohort` was preferred because it leaves the runner alive, so the dismissal's
still-in-flight phase guard runs against a live session; the audit's `stop()` would have consulted a
dead one. The file's own shipped row at `answers FALSE for a cohort that ended on its own` uses
`stop()`, so both paths are now exercised somewhere in the file.

**3. `grep -rlP '\x{2014}' packages/service/tests` lists one file and could not have listed none.**
`test-peers.spec.ts` contains the character inside the regex literal of its own em-dash guard,
committed in 05-09. It is not a file this plan touched. The scan over `draft-edit.spec.ts`,
`cohort-fate.spec.ts`, `operator-cohorts.spec.ts`, `operator.ts`, `05-UAT.md` and `05-19-SUMMARY.md`
returns nothing.

## Verification

| Check | Result |
|-------|--------|
| `pnpm test` | green, **66 files / 1137 tests** (05-24 left it at 66 / 1125, so +12 tests and no new file; no assertion deleted or loosened) |
| `pnpm vitest run packages/service/tests/draft-edit.spec.ts` | green, 31 (baseline 23) |
| `pnpm vitest run packages/service/tests/cohort-fate.spec.ts` | green, 15 (baseline 11) |
| `pnpm vitest run packages/service/src/operator-cohorts.spec.ts` | green, 32 (baseline 32: two rows promoted, none added) |
| `pnpm vitest run packages/service/tests/discovery-window.spec.ts` | green, 20, and the file is UNCHANGED (read-only regression) |
| `pnpm typecheck` (`tsc -b`, the first half of `pnpm test`) | green |
| `pnpm lint` | green |
| `pnpm --filter @btcr2-aggregation/web build` | green |
| `pnpm e2e:gate` | **PASSED**, all 13 hermetic legs, exit 0. Run because this plan transiently mutated `operator-cohorts.ts` and `hono-adapter.ts` and edits a legacy co-located service spec; `git status` was confirmed clean of every mutation first |
| `git diff --stat pnpm-lock.yaml` | empty (T-05-25-SC: no package installed) |
| `git diff` on `operator-cohorts.ts` and `hono-adapter.ts` | EMPTY: every mutation reverted |
| `git diff` on `packages/web/src/lib/operator.ts` | docstring only, no code |
| `grep -rlP '\x{2014}'` over every file this plan touched | nothing |

Per-task suite counts: 1125 (baseline) to 1131 (task 1) to 1133 (task 2) to 1137 (task 3).

## Threat mitigations

| Threat ID | Disposition | How |
|-----------|-------------|-----|
| T-05-25-01 | mitigated | The expired leg is exercised end to end and the answer asserted byte-identical to a never-existed cohort, with a canceled control proving the carry still discriminates. Mutation 3 is RED on the expired rows and GREEN on the canceled one. |
| T-05-25-02 | mitigated | Both windows are driven both directions, read back from the verb and from the served route, with an independence row. Mutation 1 is RED on all three clearing rows and was green on every pre-existing row. |
| T-05-25-03 | mitigated | All three 404 bodies asserted by deep equality, compared to each other, and driven on a known-but-not-editable id. Mutations 2a and 2b are RED. |
| T-05-25-SC | mitigated | Zero packages installed; empty lockfile diff. |

## The honest limits, restated

1. **Nothing here renders.** These are service-side facts and served DTOs. That the console displays
   the cleared field as empty is 05-23's `cohort-form-render.spec.tsx` work; that the console renders
   the 404 sentence at all is asserted nowhere, only that the client function returns it.
2. **The refusal family is pinned across three routes, not across every refusal in the app.** The
   re-advertise 404 (`unknown expired cohort`) and the cancel 404 (`unknown cohort`) are deliberately
   different strings for different resources and were left out of the comparison rather than folded
   in, because forcing them to match would be a copy decision this round does not own.
3. **The expired-dismissal rows prove the SERVICE never converts a lapse into a cancel.** They do not
   prove the participant console renders the honest fallback in that case; that is 05-24's
   `participant-fate.spec.ts` work, at the other end of the same wire.

## Known Stubs

None. No placeholder values, no unwired data sources, no skipped tests, and no unrun `<verify>` chain
in this plan.

## Threat Flags

None. This plan adds no network endpoint, no auth path, no file access pattern and no schema change
at a trust boundary. Its only non-test source edit is a docstring.

## Commits

| Task | Commit | What |
|------|--------|------|
| 1 | `483ae9c` | `test(05-25): drive a successful window edit, so clearing a timing window really clears it` |
| 2 | `fb5d4a6` | `test(05-25): pin the refusal string that reaches the operator's console verbatim` |
| 3 | `ff53559` | `test(05-25): dismiss an EXPIRED cohort and prove the fate read still says not canceled` |

## Self-Check: PASSED

Files verified present on disk: `packages/service/tests/draft-edit.spec.ts`,
`packages/service/tests/cohort-fate.spec.ts`, `packages/service/src/operator-cohorts.spec.ts`,
`packages/web/src/lib/operator.ts`,
`.planning/phases/05-operator-cohort-lifecycle-control/05-19-SUMMARY.md`,
`.planning/phases/05-operator-cohort-lifecycle-control/05-UAT.md`.
Commits verified in `git log`: `483ae9c`, `fb5d4a6`, `ff53559`.
