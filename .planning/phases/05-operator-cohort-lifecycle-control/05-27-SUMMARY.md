---
phase: 05-operator-cohort-lifecycle-control
plan: 27
subsystem: browser-witness-and-uat-reconciliation
tags: [gap-closure, coverage, mutation-testing, browser-e2e, copy-pin, cookie-hardening, uat-reconciliation]
status: complete
requires:
  - "e2e/browser-operator.ts: the hermetic operator capstone, its sign-in sequence and its count-of-zero absence idiom"
  - "packages/web/src/components/operator/ServiceControls.tsx: the kill switch's mode guard on the shipped bundle"
  - "packages/service/src/index.ts and operator-auth.ts: the cookie-secure boot default and the attribute it sets"
  - "packages/web/tests/support/render.tsx: the selector-faithful store fake and its hoisting recipe (05-21)"
  - "the 05-UAT automation ledger as written by 05-21 through 05-26"
provides:
  - "e2e/browser-operator.ts: a real-Chromium absence check for the one-way broadcast control, and the console heading pinned by exact text beside the control that actually proves sign-in"
  - "packages/service/tests/operator-auth-secure.spec.ts: the first exercise of the session cookie's Secure attribute, on, off and defaulted"
  - "packages/web/src/components/cohort/CompletionSummary.tsx: reflectedRoundTripSentence, the honest-success sentence extracted so it can be pinned"
  - "packages/web/tests/completion-summary.spec.ts: the positive pin, the one-definition one-call-site count, and three rendered outcome rows"
  - ".planning/todos/pending/2026-07-30-live-regtest-browser-leg-for-the-reflected-outcome.md: the live leg #28 needs, FILED with its exact shape"
  - "05-UAT.md reconciled: 18 items to 16, two retired, thirteen narrowed, 23 new ledger rows, the residue grouped by kind of human input"
  - "two corrected citations in 05-UAT-PROCEDURES.md that named a heading as the observable proof of sign-in"
affects:
  - e2e/browser-operator.ts
  - packages/service/tests/operator-auth-secure.spec.ts
  - packages/web/src/components/cohort/CompletionSummary.tsx
  - packages/web/tests/completion-summary.spec.ts
  - .planning/todos/pending/2026-07-30-live-regtest-browser-leg-for-the-reflected-outcome.md
  - .planning/phases/05-operator-cohort-lifecycle-control/deferred-items.md
  - .planning/phases/05-operator-cohort-lifecycle-control/05-UAT-PROCEDURES.md
  - .planning/phases/05-operator-cohort-lifecycle-control/05-UAT.md
tech-stack:
  added: []
  patterns:
    - "diffing the rendered markup before and after a structural extraction, through a throwaway spec deleted afterwards, so byte-identity is measured rather than reasoned about"
    - "pairing a positive unit pin with an existing negative browser assertion, so neither direction of a copy change can drift alone"
    - "asserting a boot DEFAULT by passing the option nowhere, beside the on and off rows that pass it explicitly"
    - "citing a UAT clause with an explicit LIMIT when automation covers the decision but not the rendered words, and narrowing the test to the remainder rather than retiring it"
    - "grouping a manual test list by the KIND of human input each item needs, so automatable-but-unautomated work cannot hide inside the judgment count"
decisions:
  - "The audit's premise for #27 was CONTRADICTED and the contradiction is recorded in the shipped comment. 05-22's rendered ServiceControls matrix DOES redden on the component's mode-guard deletion (3 rows). The browser leg was kept and reframed as a second witness at the bundle level rather than as the only one, and the e2e comment was rewritten to say so before the commit."
  - "The console heading mutation is the row that carries defect #3 on its own: renaming it reddens the browser leg and leaves all 345 web unit rows green."
  - "Neither heading string was changed. Whether the signed-in console deserves its own heading is recorded as a copy question in the reconciled 05-UAT.md, alongside 05-25's `unknown draft` question, for the owner's batched read."
  - "The reflected-sentence extraction was proven byte-identical by rendering the component before and after through a throwaway spec and diffing the markup, in both the with-version and without-version cases. Reasoning about JSX whitespace collapse was not treated as sufficient."
  - "A third rendered row (a live anchor with the beacon not yet in the document) was added beyond the plan's list, because without it a mutation making the reflected arm the DEFAULT would satisfy both planned render rows."
  - "The Secure-cookie block boots a real `createService` on an ephemeral port rather than composing `loginHandler` directly, because the rule spans two files and a handler-level test proves only the second half. A third row was added for the unset case, which is what a self-host actually inherits."
  - "Test 18 is RETIRED as un-runnable rather than kept as a stated backstop: the settle race is no more drivable by a human with a mouse than by a script, and its two checkable clauses have resolved rows."
  - "A `no Close button anywhere` absence check was NOT added to the browser leg, though the file is in files_modified and the check would be one line. It is outside task 1's behavior list, and adding it after task 1 was committed would have been unrun scope. It is named as a cheap follow-up in the narrowed test 3."
metrics:
  duration: ~70m
  completed: 2026-07-30
---

# Phase 5 Plan 27: A browser witness, a positive pin, and the manual list reconciled Summary

Three defects and one adjacent hardening row, then the round's single reconciliation pass. The
manual UAT list went from 18 items to 16, two retired outright and thirteen narrowed, with 23 new
ledger rows and every citation in the whole ledger resolved against the tree first.

Four mutation runs, all observed, all reverted. One of them contradicted the audit's prediction and
the contradiction is recorded in the shipped comment rather than in this file alone.
`git diff` over `packages/service/src` and `packages/shared/src` is EMPTY; the only shipped-source
change in the plan is a structural extraction whose rendered markup was measured byte-identical.

## Gap source

`.planning/phases/05-operator-cohort-lifecycle-control/05-AUDIT-2.md`. This plan closes **#27's
browser leg** (entry 16, Medium), **#28** (entry 19, Medium, not phase 5) and **#3** (entry 24, Low,
not phase 5), plus the higher-value adjacent gap entry 24 names.

**The Secure-attribute rows are labelled ADJACENT.** They are not one of the 24 confirmed defects.
The audit raises the attribute beside the heading it was actually reporting, and it is included
because it is cheap, it is real, and it is the attribute that keeps the operator session off
plaintext. Labelling it here keeps the round's defect count honest.

## #27: the same guard, seen from the bundle, and a prediction that did not hold

The plan expected the browser leg to be the ONLY thing that sees the component's mode guard, on the
grounds that 05-22 tested the pure `broadcastControlState` selector. That was measured and it is
wrong: 05-22 also added a RENDERED matrix over `ServiceControls`, and deleting
`broadcast === 'available' &&` reddens three of its rows.

The check was kept and reframed rather than dropped, and the comment in `e2e/browser-operator.ts`
was rewritten before the commit to say what is actually true: the unit matrix renders the component
with a faked store, this leg drives the BUILT bundle with the real store against the service's own
served mode, so the two fail for different reasons. It is a second witness, not the only one, and
the file now says so in those words rather than repeating the audit's premise.

## #3: the heading that could never have been the proof

`05-UAT-PROCEDURES.md` cited `OperatorConsole.tsx:130` twice as the observable proof of sign-in.
`LoginPanel.tsx:25` renders the byte-identical `Operator console` string, so that heading is
present on both sides of the sign-in boundary and has never discriminated between them.

Both citations now name the `New cohort` control, which the signed-in console renders and nothing
else does, with one sentence recording why the heading could not have served. The procedure
document is otherwise unrestructured, and **neither component string was changed**:
`git diff packages/web/src/components/operator/OperatorConsole.tsx packages/web/src/components/operator/LoginPanel.tsx`
is empty. Whether the signed-in console deserves a heading of its own is recorded as a copy question
for the owner, not answered here.

The heading itself is now pinned by exact text in the browser leg, beside (never instead of) the
existing wait on the signed-in-only control, with the comment that makes the row honest: it is a
copy pin, and the control is the proof.

## The adjacent row: an attribute defaulted on and asserted nowhere

`secure: cookieSecure` reaches the wire from `operator-auth.ts` and gets its value from
`cookieSecure: opts.operatorCookieSecure ?? true` in `index.ts`. All fourteen call sites that build
an operator auth config pass `false`, because they drive plain HTTP, and the one existing cookie
assertion checks `HttpOnly`, `SameSite=Strict` and `Path=/` and stops there.

Three rows in `packages/service/tests/operator-auth-secure.spec.ts`, each booting a real service on
an ephemeral port and reading a real login response:

| Row | Boot | Asserted |
|-----|------|----------|
| on | `operatorCookieSecure: true` | `Secure` present, beside the three attributes already covered |
| off | `operatorCookieSecure: false` | `Secure` ABSENT, `HttpOnly` and `SameSite` unchanged, so exactly one attribute moves between the pair |
| default | the option passed nowhere | `Secure` present, which is what a self-host inherits |

The default row was added beyond the plan's two, because every other test in the repo passes the
option explicitly and a flipped default would have been invisible to all of them.

## #28: the honest half of a guarded pair

`e2e/browser-participant-cohort.ts` FAILS if `Your update is reflected` appears on a structurally
hermetic run. That is the dishonest direction and it was guarded. The honest direction had nothing:
renaming the sentence or deleting its arm made that leg MORE green, so the repo's only automated
opinion about this copy rewarded its disappearance. A live participant whose update really landed
would then have read the warn-toned "not found in the resolved document yet" box as a failure.

The sentence is now built by an exported `reflectedRoundTripSentence(version?)` with one call site,
and `packages/web/tests/completion-summary.spec.ts` carries six rows: the copy pinned with and
without the version clause, the one-definition/one-call-site count, a check that no second copy of
the words survives anywhere in the component, the rendered reflected arm, the hermetic-genesis
contrast arm, and a third outcome row.

**The extraction changed no words, and that was measured.** A throwaway spec rendered the component
before and after the change and the markup was diffed: byte-identical in both the with-version and
the without-version case. The throwaway spec was deleted. Reasoning about JSX whitespace collapse
would have been the wrong kind of confidence for a claim about shipped copy.

**`e2e/browser-participant-cohort.ts` is untouched**, and is not in `files_modified`. Its negative
assertion is the other half of the pair.

### The live leg is FILED, not built

`.planning/todos/pending/2026-07-30-live-regtest-browser-leg-for-the-reflected-outcome.md` names
what is actually needed: a Chromium page bolted onto the Polar/regtest `e2e/live-uat.ts` harness, a
new opt-in `package.json` e2e script entry outside `e2e:gate`, and the assertion in both directions.
It states the reason no existing harness can reach the arm: every browser harness here is hermetic
by construction, so with no chain there is no beacon signal to discover and `roundTripOutcome` can
never return `reflected`. The todo says FILED. It is not built, not started, and not scheduled. A
matching row is in the phase's `deferred-items.md` so it is visible from the phase record.

## Mutation runs, as observed

Every mutation was applied to shipped source, run, observed and reverted.

| # | Mutation | Predicted | OBSERVED |
|---|----------|-----------|----------|
| 1 | **Plan task 1:** delete the mode half of the kill-switch guard in `ServiceControls.tsx` (`broadcast === 'available' &&`) | the browser leg's absence check RED; 05-22's matrix green | **The browser leg RED**, on exactly the new check: `the one-way "Disable broadcast" control rendered 1 time(s) on a HERMETIC boot`. **The second half of the prediction was WRONG**: `packages/web/tests/service-controls.spec.ts` went **3 failed / 42 passed of 45**, reddening `offers NOTHING to stand down on a hermetic service`, `offers NOTHING on a live service that was never going to broadcast` and `REPLACES the control with the one-way line once the switch is already engaged`. 05-22 rendered the component, not only the selector. The comment in the e2e file was rewritten to state this before committing. |
| 2 | **Added:** rename the console heading to `Operator dashboard` | not predicted by the plan | **The browser leg RED**, on exactly `the signed-in console did not render its "Operator console" heading`. `pnpm vitest run packages/web/tests`: **19 files / 345 tests, all PASSED**. This is defect #3 in one observation: the heading is invisible to every unit row in the web package, and this leg is the only thing in the repo that sees it. |
| 3 | **Plan task 1:** `cookieSecure: opts.operatorCookieSecure ?? true` becomes `cookieSecure: false` in `index.ts` | the ON row RED | **2 failed / 1 passed of 3.** RED on the ON row and the DEFAULT row; the OFF row stayed green, correctly. Across the whole service package: **2 failed / 617 passed of 619**, so no pre-existing row anywhere sees the boot default change. |
| 4 | **Plan task 1:** `secure: cookieSecure` becomes `secure: true` in `operator-auth.ts` | the OFF row RED | **1 failed / 21 passed of 22** over the new file plus the shipped `operator-auth.spec.ts`. RED on exactly the OFF row. The shipped cookie row stayed GREEN, which is the audit's claim confirmed: it asserts three attributes and not this one. |
| 5 | **Plan task 2:** delete the `roundTrip === 'reflected'` arm from `CompletionSummary.tsx` | the call-site count and the render row RED | **2 failed / 4 passed of 6.** RED on `is defined once and called once` and on `renders the honest-success copy...`. Across the web package: **2 failed / 349 passed of 351**, so nothing pre-existing sees it. |
| 6 | **Added, on the same mutation:** run the hermetic participant browser leg | not predicted by the plan | **BROWSER CAPSTONE PASSED.** The audit's premise reproduced exactly: with the honest-success arm deleted, the one leg in the repo that mentions this copy is entirely happy. Run because mutation 5 proves the new rows load-bearing and says nothing about the claim that motivated them. |

Six runs, two of them added beyond the plan's list. Mutation 1's second half is the round's first
outright CONTRADICTION of an audit prediction, and it changed shipped comment text rather than only
this summary.

## The UAT reconciliation

Done in one pass, in the order the plan set.

### First: every citation resolved

All 46 citations written by 05-21 through 05-26 were checked against the tree by opening the cited
file and confirming the named block. **45 resolved. One had drifted and was corrected; none had to
be deleted.**

The drift: 05-26 cited the service-side all-or-nothing row as
`"applies NOTHING when any field in the patch is invalid"`. The block exists but is named
`createRuntimeSettings: applySettings is all-or-nothing (UI-SPEC E8 partial)` with the row
`applies NO field when any supplied field is invalid, and returns the first message`. The ledger row
now names both and is marked `05-26, corrected 05-27`.

(Two more looked unresolved on a first mechanical pass and were false alarms: the citations contain
apostrophes that the source escapes as `\'`. Both were confirmed present.)

### Second: the clause-by-clause walk, and 23 new rows

Two tests retired with every clause cited: **test 1** and **test 18**.

Thirteen NARROWED, each keeping the clause that still needs a person and contributing its removed
clauses to the ledger: 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 17. Three unchanged: 13, 14, 16.

Most of the 23 new rows are PRE-EXISTING coverage checked before claiming, in 05-26's manner: the
Closed-stage block, the rung heading pins, the `directoryNotice` state selection, the restart and
quiesce lines, the settings caption formats, the `changed` semantics, the acceptance-retention note,
the terms containment block, the sighash refusal, the kill-switch funding asymmetry, and the
settled-cancel 404 with its idempotence twin. Three rows are this plan's own work (the browser
sign-in row, the hermetic kill-switch absence row, and the corrected all-or-nothing citation).

**Where automation covers a decision but not the rendered words, the row carries an explicit
LIMIT** and the test is narrowed rather than retired. Two examples: `directoryNotice` proves the
paused notice's four-state selection and fails closed, but the rendered bodies of the two empty
states and the notice's position on the page are uncovered; the terms containment block proves the
capping and wrapping classes ship, but not that anything actually fits at a narrow viewport.

### Fourth: test 18's disposition, decided

**Retired as un-runnable, with the backstop recorded.** 05-01 classified it a backstop because the
settle race cannot be reliably driven from a harness. The reason is that it is a race at the instant
a signing round completes, and that is not more drivable by a human with a mouse. Leaving it in a
list of procedures somebody can follow was a claim the list could not support. Its two checkable
clauses have rows (the settled-cancel 404 is byte-identical to an unknown id's, and the fold refuses
a second ended record); what remains genuinely unverified is the instantaneous interleaving, and the
idempotence row is named as the assertion that would have to have regressed if it ever fires.

### Fifth and sixth: counts, the schema note, and the provenance paragraph

`## Summary` is rewritten from the list: **total 16, pending 16, passed 0, retired 2.** The previous
counts recorded `passed: 0` while test 1 carried `result: pass`; that inconsistency is resolved by
test 1's retirement, with its pass preserved in the ledger.

The note about plans 05-08 through 05-14 using a drifted coverage schema is RETAINED and now says in
as many words that this round did not fix it: the round closed coverage holes in the tree, not
schema drift in plan artifacts.

A provenance paragraph opens the Tests section: the list was reduced after a triage found 17 of 18
human-only claims automatable, nothing was deleted, and the original numbering is preserved because
the ledger, the summaries and `05-UAT-CHECKLIST.md` all cite by number.

### The residue, and where it differs from the brief

Grouped by the KIND of human input:

| Group | Items | What it needs |
|-------|-------|---------------|
| Judgment | 3, 12 | a decision only the owner can make |
| Eyes | 5, 7, 8, 13 | one batched visual pass at a real viewport |
| Copy | 9, plus two questions with no procedure | one batched read |
| Hands | 2, 4, 6, 10, 11 | clauses behind a click that no harness reaches yet |
| Environment | 14, 15, 16, 17 | a real chain, a real wallet, a real third-party host, a clean machine |

The brief expected roughly four owner decisions, one batched copy read and one wallet pass, plus the
chain and host legs. **The honest result differs and the difference is recorded in the file itself.**
Owner decisions are two, not four, plus one embedded in test 17's live boot: of the four the brief
listed, the viewport pass is eyes rather than a decision, and the broadcast stand-down cost cannot
be judged outside the boot it sits inside. The copy read and the wallet pass are as predicted. The
environment group is four rather than three, because the runbook walkthrough needs a clean machine
and belongs with them.

**The fifth group is the one the brief did not predict.** `Hands` is five items that are neither
judgment nor environment: concrete facts a machine could assert, unasserted because the render
harness this round added is a static server render with no events, so nothing behind a click is
reachable from it. Counting them as judgment would have overstated how much of this list genuinely
needs a person, which is the exact error the round exists to correct. No count was adjusted to hit
a target.

## Deviations from Plan

**1. Mutation 1's prediction was contradicted, and the shipped comment was corrected.** The plan
(and the audit) assumed 05-22 covered only the pure selector. Measured, its rendered matrix reddens
on the same mutation. The e2e comment was rewritten to describe the leg as a second witness at the
bundle level before the task was committed, so the tree does not carry a false claim.

**2. Two mutations were added.** The heading rename (mutation 2), because the plan named only the
kill-switch mutation and defect #3's own row would otherwise have been unproven; and the hermetic
participant browser run under the deleted-arm mutation (mutation 6), because mutation 5 says nothing
about the claim that motivated the work.

**3. A third Secure-cookie row and a third render row were added.** The unset-boot row, because
every other test passes the option explicitly and a flipped default would be invisible; and the
live-anchor-without-beacon render row, because without it a mutation making the reflected arm the
DEFAULT would satisfy both planned render rows.

**4. A throwaway spec was created and deleted to measure the extraction.** `packages/web/tests/zz-baseline-render.spec.ts`
existed for two runs, dumping the rendered markup before and after the extraction for a byte diff. It
was removed; `git status` is clean of it.

**5. The `no Close button anywhere` check was NOT added to the browser leg.** `e2e/browser-operator.ts`
is in `files_modified` and the check would be one line beside the kill-switch one, which would have
let test 3 narrow to pure judgment. It was left out because it is not in task 1's behavior list and
task 1 was already committed; adding it afterwards would have been unrun scope in a round whose rule
is that every new assertion gets its own observed mutation. It is named as a cheap follow-up inside
the narrowed test 3, so the owner sees the option rather than the omission.

## Verification

| Check | Result |
|-------|--------|
| `pnpm test` | green, **68 files / 1169 tests**. Round baseline was 1049; 05-26 left it at 67 / 1160 (66 files plus this plan's two new files). +9 tests here, no assertion deleted or loosened |
| `pnpm vitest run packages/service/tests/operator-auth-secure.spec.ts` | green, 3 (new file) |
| `pnpm vitest run packages/web/tests/completion-summary.spec.ts` | green, 6 (new file) |
| `pnpm lint` | green |
| `pnpm typecheck` (`tsc -b`, the first half of `pnpm test`) | green |
| `pnpm --filter @btcr2-aggregation/web build` | green |
| `pnpm e2e:gate` | **PASSED, exit 0**, all 13 hermetic legs. Run because this plan transiently mutated `index.ts`, `operator-auth.ts`, `ServiceControls.tsx`, `OperatorConsole.tsx` and `CompletionSummary.tsx`; `git diff` was confirmed clean of every mutation first |
| `pnpm e2e:browser:operator` | **PASSED**, clean, with both new checkpoints logged (`[ok] operator sign-in`, `[ok] kill switch`) |
| `pnpm e2e:browser:participant` | **PASSED**, clean (read-only regression: the file is unchanged, and it exercises the extracted sentence's component on the built bundle) |
| `git diff packages/web/src/components/operator/OperatorConsole.tsx packages/web/src/components/operator/LoginPanel.tsx` | **EMPTY**: neither heading string changed |
| `git diff e2e/browser-participant-cohort.ts` | **EMPTY**: the negative assertion is untouched |
| `git diff packages/service/src packages/shared/src` | **EMPTY**: every mutation reverted |
| `git diff --stat pnpm-lock.yaml` | empty (T-05-27-SC: no package installed) |
| every ledger citation resolved | 46 checked, 45 resolved, 1 corrected, 0 deleted; plus 30 new citations checked, 0 unresolved |
| `grep -rlP '\x{2014}'` over every file this plan touched | nothing |

Per-task suite counts: 1160 (baseline) to 1163 (task 1) to 1169 (task 2) to 1169 (task 3, documents
only).

## Must-have truths

| Truth | Status |
| --- | --- |
| A real Chromium page proves the one-way control is absent on a hermetic boot, giving 05-22's matrix an independent witness on the shipped bundle | met, with a correction: 05-22's matrix is a RENDERED matrix and reddens on the same mutation, so this is a second witness rather than the only one, and the shipped comment says so |
| The console heading is pinned, and its inability to discriminate is recorded rather than implied, with the UAT citation corrected | met (mutation 2 RED here, green across all 345 web unit rows; both citations now name the control) |
| The honest-success sentence has a positive hermetic pin | met (mutation 5 RED on the call-site count and the render row; mutation 6 shows the hermetic leg passing under the same mutation) |
| The live regtest browser leg is FILED with its exact shape, not described as done | met (the todo says FILED, names the harness, the script entry and the reason; `deferred-items.md` carries the matching row) |
| The operator session cookie is exercised with its Secure attribute on | met (three rows, mutations 3 and 4 RED in opposite directions) |
| `05-UAT.md` reconciled once from the ledger, with every retired clause cited and the residue honest | met (18 to 16, two retired, thirteen narrowed, 23 new rows, five groups by kind of input, the divergence from the brief recorded with its reason) |

## Prohibitions

| Prohibition | Held |
| --- | --- |
| MUST NOT delete a UAT test without a ledger row citing the automation that replaced each of its clauses | held: tests 1 and 18 are the only retirements, five rows and two rows respectively, each resolved against the tree |
| MUST NOT change the operator console heading or the login heading to make them discriminate | held: `git diff` on both components is empty; the question is recorded for the owner's copy read |
| MUST NOT weaken or remove the existing NEGATIVE assertion in the participant browser leg | held: `git diff e2e/browser-participant-cohort.ts` is empty, and the file is not in `files_modified` |
| MUST NOT claim the live regtest browser leg exists, is scheduled, or is partially built | held: the todo, the deferred-items row and this summary all say FILED |
| MUST NOT force the residue to a target count | held: the result is 2 judgment items, not 4, and carries a fifth group the brief did not predict; both differences are recorded with their reasons in `05-UAT.md` itself |
| No new packages, no new vitest config, no `any` / `@ts-expect-error` / non-null assertions | held: empty lockfile diff, no config file added, no suppression added |

## Threat mitigations

| Threat ID | Disposition | How |
|-----------|-------------|-----|
| T-05-27-01 | mitigated | The Secure attribute exercised on, off and defaulted, through a real boot. Mutation 3 reddens the on and default rows, mutation 4 the off row, and the shipped cookie assertion sees neither. |
| T-05-27-02 | mitigated | A real Chromium page on the built bundle asserts the control's absence on a hermetic boot. Mutation 1 reddens it. |
| T-05-27-03 | mitigated | A positive pin beside the existing negative hermetic assertion. Mutation 5 reddens the pin; mutation 6 shows the hermetic leg passing under the same change, which is why the pin was needed. |
| T-05-27-04 | mitigated | Every ledger citation resolved against the tree before any retirement; the one drifted citation corrected and recorded; no test retired on an uncited clause. |
| T-05-27-SC | mitigated | Zero packages installed; empty lockfile diff. |

## The honest limits, restated

1. **The reflected arm still has no live witness.** The pin closes a rename and a deletion. Whether
   a genuine live success reaches the arm is unknown and needs the filed leg.
2. **The browser leg's absence check is an absence check.** It would also pass if `ServiceControls`
   stopped rendering entirely. What protects against that is 05-22's rendered matrix and the rest of
   the console's coverage, not this row.
3. **The Secure rows prove the attribute reaches the wire from the boot option.** They say nothing
   about TLS actually terminating in front of the service, which is the deploy concern
   `docs/DEPLOY.md` owns.
4. **The reconciliation is a claim about coverage, not a claim of correctness.** A cited clause means
   an assertion exists and was resolved to a real block; where the assertion covers a decision rather
   than the rendered words, the row says so and the test was narrowed rather than retired.

## Known Stubs

None. No placeholder values, no unwired data sources, no skipped tests, and no unrun `<verify>`
chain in this plan. The one throwaway file created during execution
(`packages/web/tests/zz-baseline-render.spec.ts`, for the markup diff) was deleted and never
committed.

## Threat Flags

None. This plan adds no network endpoint, no auth path, no file access pattern and no schema change
at a trust boundary. Its only shipped-source change is a structural extraction with byte-identical
rendered output.

## Commits

| Task | Commit | What |
|------|--------|------|
| 1 | `a412b00` | `test(05-27): give the shipped bundle a browser witness for the one-way control` |
| 2 | `7897ae4` | `test(05-27): pin the honest-success sentence positively and file the live leg it needs` |
| 3 | `98e5de1` | `docs(05-27): reconcile 05-UAT.md down to what genuinely needs a person` |

## Self-Check: PASSED

Files verified present on disk: `e2e/browser-operator.ts`,
`packages/service/tests/operator-auth-secure.spec.ts`,
`packages/web/src/components/cohort/CompletionSummary.tsx`,
`packages/web/tests/completion-summary.spec.ts`,
`.planning/todos/pending/2026-07-30-live-regtest-browser-leg-for-the-reflected-outcome.md`,
`.planning/phases/05-operator-cohort-lifecycle-control/deferred-items.md`,
`.planning/phases/05-operator-cohort-lifecycle-control/05-UAT-PROCEDURES.md`,
`.planning/phases/05-operator-cohort-lifecycle-control/05-UAT.md`.
Commits verified in `git log`: `a412b00`, `7897ae4`, `98e5de1`.
