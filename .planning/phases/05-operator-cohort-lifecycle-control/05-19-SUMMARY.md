---
phase: 05-operator-cohort-lifecycle-control
plan: 19
subsystem: operator-console
tags: [gap-closure, honesty, dismissal, cohort-fate, confirm-gate, coverage]
status: complete
requires:
  - "05-17: acceptance-ledger wiring in HonoAppOptions (dependency, untouched here)"
  - "packages/service/src/monitor.ts: dismissEnded, recordServiceAction, dismissedRecordText"
  - "packages/web/src/lib/lifecycle.ts: typeToConfirmMatches"
provides:
  - "OperatorCohorts.forgetTerminal: the second half of a dismissal, phase-guarded, carrying a canceled fate out before deleting"
  - "the bounded, id-only canceled-fate carry that keeps GET /v1/cohort-fate/:id answering after a dismissal"
  - "DELETE /v1/operator/ended/:id clearing BOTH ended-record sources, mounted on either source being wired"
  - "dismissDropsReadvertise: the render predicate for the dismissal cost disclosure"
  - "DISMISS_READVERTISE_LINE: the additive confirm sentence for rows that offer Re-advertise"
  - "ConfirmPanel arming through typeToConfirmMatches, so the rung-4 spec is load-bearing"
affects:
  - packages/service/src/operator-cohorts.ts
  - packages/service/src/hono-adapter.ts
  - packages/web/src/stores/operator.ts
  - packages/web/src/lib/operator-rows.ts
  - packages/web/src/components/operator/OperatorCohortList.tsx
  - packages/web/src/ui/primitives.tsx
tech-stack:
  added: []
  patterns:
    - "source-containment read (readFileSync + fileURLToPath) as the only rendering pin available in a package with no DOM harness"
    - "brace-and-angle-matched JSX element extraction with a self-guard (the tx-client.spec register() precedent)"
    - "before-and-after DELTA assertions over an append-only ring whose consecutive-duplicate guard makes absolute counts unsatisfiable"
key-files:
  created: []
  modified:
    - packages/service/src/operator-cohorts.ts
    - packages/service/src/hono-adapter.ts
    - packages/service/tests/lifecycle-routes.spec.ts
    - packages/service/tests/cohort-fate.spec.ts
    - packages/web/src/stores/operator.ts
    - packages/web/src/lib/operator-rows.ts
    - packages/web/src/components/operator/OperatorCohortList.tsx
    - packages/web/src/ui/primitives.tsx
    - packages/web/tests/lifecycle.spec.ts
    - packages/web/tests/operator-rows.spec.ts
    - packages/web/tests/service-controls.spec.ts
decisions:
  - "The canceled-fate carry is written ONLY in forgetTerminal, not in rememberTerminal's canceled branch, so every non-dismissal path stays byte-identical and readvertiseExpired is untouched."
  - "A fate-only stub left in the terminal map was rejected: readvertiseExpired would find a config-less record and try to advertise it."
  - "The dismiss route now mounts on EITHER source being wired, not on the monitor alone."
  - "The re-advertise cost is a separate exported constant, so DISMISS_BODY and its shipped content pin stay byte-identical and no UI-SPEC copy is re-approved."
  - "Defect 8 is a coverage and duplication defect, not a live bug: the two rules agree on every value the single call site can pass."
metrics:
  duration_min: 22
  completed: 2026-07-30
  tasks: 3
  files_changed: 11
---

# Phase 05 Plan 19: Make the Dismissal True and the Confirm Gate Load-Bearing Summary

A dismissal now clears both record sources the console's Ended group renders from while the anonymous cancel attribution keeps answering, the confirm states the one cost it newly carries on exactly the rows where that cost is real, and the rung-4 type-to-confirm gate that ships is the one its seven assertions test.

## What was built

### Task 1: both ended-record sources, and the fact that outlives the record

`OperatorCohorts.forgetTerminal(cohortId)` is the second half of a dismissal. It looks up the terminal record first (so an unknown, an evicted, and a still-live id all read not-found identically), then refuses on exactly the phases `monitor.dismissEnded` refuses on, reading the SAME shared `OPEN_PHASES` / `IN_FLIGHT_PHASES` sets rather than a local copy. The existing `@btcr2-aggregation/shared` import gained `IN_FLIGHT_PHASES` as its own member line; no local `new Set` of phase names was added, so the two halves of one dismissal cannot disagree about what "still in flight" means.

The load-bearing subtlety the audit did not name: the `terminal` map has TWO readers. `listCohorts` renders the operator row, and `cohortFate` is a single expression over the same map served ANONYMOUSLY by `GET /v1/cohort-fate/:id`. A plain delete would have closed an operator-console honesty defect by switching off the one bit of out-of-band honesty a canceled participant gets (D-02). So `forgetTerminal` carries a canceled fate into a closure-scoped, id-only `dismissedCanceled` set before deleting, bounded at `MAX_DISMISSED_CANCELED` (the same value as `MAX_TERMINAL`) with the same oldest-first eviction loop, and `cohortFate` reads that carry as a second disjunct in the same single boolean expression, still one key, still O(1).

The route now calls both halves, answers 200 when either removed a record, and keeps the same opaque 404 only when neither did. It appends the operator-actions entry itself only on the monitor-less half (`dismissEnded` records its own). Its mount condition moved from `if (monitor)` to `if (monitor || operatorCohorts)`: with two sources, a wiring with the cohort surface and no monitor would have left every terminal record permanently undismissable. `createService` always wires both, so that is theoretical today, and the condition now states what the route needs rather than what it needed when the monitor was its only source. The route's comment was corrected: only a SUCCESSFULLY anchored cohort is pruned from the operator list, which is what made the older single-source reasoning read as complete.

### Task 2: the disclosure, on exactly the rows where it costs something

For an expired row, `readvertiseExpired` is the only path that deletes a terminal record and it is the row's escape hatch, so a dismissal that also deletes it destroys the ability to re-advertise. `dismissDropsReadvertise(cohort?)` is a dependency-free predicate over the SAME served fact the Re-advertise control is gated on (`state === 'expired'`), so the control and the disclosure cannot disagree; a monitoring-only ended row passes `undefined` and reads false, because nothing was ever re-advertisable for it.

`DISMISS_READVERTISE_LINE` is a separate exported constant rendered as a second stacked paragraph inside the rung-1 `ConfirmPanel`'s `body` PROP. `DISMISS_BODY` is byte-identical, so its shipped content pin stays green and no fixed UI-SPEC copy was re-approved.

### Task 3: the gate that ships is the gate the spec tests

`ConfirmPanel` now computes `armed` through `typeToConfirmMatches` and the duplicated inline comparison is gone. Read the narrowing before reading this as a live bug: there was NO current misbehavior, because the single call site always passes an eight-character cohort-id prefix, on which the inline expression and the predicate agree. They diverge only on an empty or whitespace-only expected value, which is unreachable today. What was genuinely broken is that the shipped gate had zero coverage while a spec claimed to pin it, and that `05-02-PLAN.md` explicitly required the component to call the predicate. The seven existing assertions are unedited and now cover the code that renders.

> **CORRECTION, 2026-07-30 (05-21).** The claim above, and the `provides` line "ConfirmPanel arming through typeToConfirmMatches, so the rung-4 spec is load-bearing", both OVERSTATE what 05-19 delivered. `05-AUDIT-2.md` entry 1 (claims #15 and #21) found the overstatement and it is confirmed.
>
> What 05-19 actually pinned is the CALLEE: `typeToConfirmMatches` itself, and the single arming expression inside `packages/web/src/ui/primitives.tsx`. It never pinned the CALL SITE. Nothing in the repo asserted that `packages/web/src/components/operator/LifecycleActions.tsx` passes `typeToConfirm` to the rung-4 panel, or that it withholds it from the rung-3 one. Deleting the prop from the funded-cancel panel, so an operator arms a cancel that can strand real money on the first click, would have shipped green; so would adding it to the ordinary cancel, giving that panel friction it was designed not to have. The structural reason is that no React component in this repo was rendered by any test until 05-21, and `packages/web` was not typechecked by `pnpm test` at all.
>
> The call site is pinned in 05-21, against real rendered markup, and both mutations were run and observed RED. See `05-21-SUMMARY.md`. Left in place rather than rewritten, so the record shows both what was claimed and what was found.

## Red-before-green, as observed

Every red required by the plan was demonstrated and quoted.

**Against the shipped code (the genuine defect):**

1. Canceled dismissal row: the DELETE answered 200 and the row came back. The failure landed on the next assertion, `listCohorts().some(...)` reading `expected true to be false` at `lifecycle-routes.spec.ts:753`.
2. Terminal-record-only row: `expected 404 to be 200`. The route refused a cohort the console was still rendering.

**Against a deliberately incomplete `forgetTerminal` (guards on NEW code, whose only honest evidence is a demonstrated red):**

3. Still-live refusal row, against a guard-less `forgetTerminal`: `expected 200 to be 404`. The staged setup (cancel, settle so both records exist, then `setPhase(cohortId, 'SigningStarted')`) is what makes this reachable at all; an advertise-then-DELETE setup would have refused at the record lookup one layer earlier and certified a guard it never executed.
4. Post-dismissal fate row, against a carry-less `forgetTerminal`: `expected { canceled: false } to deeply equal { canceled: true }`. This is the row whose whole purpose is to catch a plain `terminal.delete`, and it does not go red against the shipped code (today's dismissal never touches the terminal record), so its red was produced on purpose.
5. The carry-bound row went red the same way for the same reason.

**Task 2, three source-read reds, each failing to a different mistake:**

6. Guard deleted (sentence renders unconditionally): the occurrence-in-guard assertion failed (`expected +0 to be 1` on the guarded-occurrence match), along with the call-count and placement assertions.
7. Argument changed to `undefined`: `expected ... to contain 'dismissDropsReadvertise(cohort)'`. Every other assertion in the block still passed, which is exactly why this one exists: the sentence would have rendered for NO row.
8. Expression hoisted out of the panel into the row body: only the placement assertion failed, `expected '<ConfirmPanel\n tone="neutral"...' to contain 'DISMISS_READVERTISE_LINE'`. The sentence still rendered on the row, just outside the confirmation the operator is reading.

**Task 3:**

9. Arming computation reverted to the inline duplicate: `expected ... to match /const armed =[^;]*typeToConfirmMatches.../` and `expected ... not to contain 'typed.trim() ==='`.

## Verification

| Gate | Result |
|---|---|
| `pnpm test` | 61 files, 1034 tests passed (was 1013) |
| `pnpm typecheck` (`tsc -b`) | clean |
| `pnpm lint` | clean |
| `pnpm --filter @btcr2-aggregation/web exec tsc --noEmit` | clean (no import cycle from the primitives-to-lifecycle import) |
| `pnpm --filter @btcr2-aggregation/web build` | built |
| `pnpm e2e:cancel` | PASSED, including the anonymous cohort-fate leg |
| `pnpm e2e:operator` | PASSED |
| `grep -rlP '\x{2014}' packages/service/src packages/web/src` | no files |

Acceptance greps, all as specified: `IN_FLIGHT_PHASES,` on its own import member line exactly once and 5 occurrences total in `operator-cohorts.ts` (was 2, both prose in comments with no import); `dismissedCanceled` 6 times; `forgetTerminal` 5 times in `operator-cohorts.ts` and 1 in `hono-adapter.ts`; `typeToConfirmMatches` 3 times in `primitives.tsx`.

`git diff` confirms the shipped rows stayed unedited: `packages/service/tests/cohort-fate.spec.ts` is a pure addition (79 insertions, 0 deletions), so the eviction row, the one-key row and the never-404 row are byte-identical and all still pass. `packages/service/tests/lifecycle-routes.spec.ts` has exactly ONE deletion, the required title narrowing of `leaves the public directory and the operator cohort list untouched by a dismissal`; every assertion in both shipped dismissal cases is byte-identical. `packages/web/tests/service-controls.spec.ts` has zero deletions.

## Bounds on what the assertions prove, restated rather than left to inference

**The operator-actions delta.** It proves the route's own append landed exactly once against a tail that did not already carry it. It is NOT claimed to catch a double append, and no assertion over this ring can: `recordServiceAction` drops a byte-identical consecutive append (`monitor.ts:954-958`), so a route that recorded twice in a row is byte-indistinguishable from one that recorded once. That suppression is the shipped, documented behavior of the one repudiation log this task exists to protect, so it was left intact rather than routed around: the route was NOT given a differently worded text, a direct ring push, or a new accessor to make a second append visible. `dismissedRecordText` is still the one text a dismissal records and `recordServiceAction`'s guard is unedited.

The same guard is why the terminal-record-only sub-case interleaves one distinct service action (a second cancel) before the DELETE. Its setup drives the state through `monitor.dismissEnded`, which appends its own byte-identical entry, so with nothing in between a CORRECT route append would be suppressed and the delta would read 0. That adjacency exists only in the setup: on the real app-side window-expiry path the monitor never held an ended record for the cohort at all, so nothing can precede the route's append. All of this is written in the test comments, because a later reader who deletes the interleave as noise makes the row fail against a correct implementation.

**Source-containment pins.** Source containment is the ONLY guard on any rendered result in this repo, and both source pins added here inherit its ceiling. A green source read is NOT a verified rendering.

- The confirm gate (Task 3): a weakening that KEEPS the predicate call and adds a disjunct (`typeToConfirmMatches(...) || typed.length > 0`) would still pass. What the pin genuinely catches is the arming computation moving back inline or away from the predicate, which is the regression that actually happened once.
- The disclosure line (Task 2): with the five assertions the pin now catches the four mistakes that matter (unconditional render, no predicate, constant argument, wrong placement), but it still cannot see the RENDERED result. A `ConfirmPanel` whose body prop was ignored, or CSS that hid the paragraph, would pass.

**The occurrence count, stated precisely.** The plan asks that `DISMISS_READVERTISE_LINE` occur exactly once in the component. Taken over the raw file that is unsatisfiable, because the named import is itself an occurrence. The assertion therefore counts over the source with import declarations stripped, so "exactly one" means "renders in exactly one place", which is the property the plan is after. The stripping is documented in the spec beside the constant it defines.

## Deferred and NOT closed by this plan

**The missing DOM test harness.** `packages/web` has no vitest config of its own, no jsdom or happy-dom, no testing-library, and no spec that renders a component. This round deliberately did not add it: it is a new test dependency plus a new vitest configuration in a workspace with a pnpm minimum-release-age gate and an existing allowlist, and it belongs in a phase that can absorb that blast radius. What stays unprotected, plainly: no automated test renders any component in this repo, so composed confirm panels at all four rungs, the funding card, the paused directory notice, the settings form's source captions, the terms step's overflow behavior, and every layout and wrapping property remain covered only by the human items in `05-UAT.md` and by browser e2e legs that do not drive the lifecycle controls at all. Phase 6 is the natural home for it but has not yet claimed it, so it needs raising deliberately.

**Two adjacent audit rows deliberately not folded in**, recorded so they are not read as closed. Both are UNVERIFIED in the audit's "Reported but not refuted" list and both live in files this plan edited, so a reader could reasonably assume otherwise.

- `finalizeAvailability` has no terminal case (`packages/web/src/lib/lifecycle.ts:121`, MEDIUM). An ended cohort whose drill-down is still reachable renders a disabled `Finalize now` captioned `Available once this cohort's signing round starts.`, on a cohort that already finished or was canceled. It needs a terminal branch plus copy no UI spec has authored, which is a copy decision rather than a defect closure.
- The advert-slot repair's `clear()` branch is unreachable by every test in the repo (`packages/service/src/operator-cohorts.ts`, MEDIUM). No unit spec ever passes `republishAdvert`, so `republisher.clear()` and its stale-advert consequence are unguarded. Closing it means building a republisher double and a new fixture for a path this round does not touch.

Both stay in `05-AUDIT.md` for triage.

## Deviations from Plan

None. The plan executed as written, including its three-red and five-assertion requirements. Two points worth naming as judgement calls made inside the plan's own latitude rather than as deviations:

- The occurrence-count assertion is taken over import-stripped source, for the reason recorded above.
- An extra row was added asserting the 404 body is the same opaque line (`{ error: 'unknown ended cohort' }`) for an id neither source knows, rather than editing the shipped `404s an unknown id` case to add the body check. That keeps the shipped case byte-identical while covering the non-oracle behavior list item.

## Known Stubs

None. Every surface this plan touched is wired end to end: `forgetTerminal` is called by the shipped route, the carry is read by the shipped `cohortFate`, the predicate is called by the shipped component with the row's own `cohort` binding, and the confirm gate arms through the shipped predicate. All are pinned by tests that were observed red first.

## Threat Flags

None. The dismissal gained no new reachable surface: it stays inside the gated block behind both prefix guards with its `:id` shape guard before any lookup, its 404 body is unchanged, and the carry it adds holds cohort ids only and can turn true no case that was not already true. No route was added, no auth posture moved, and no package was installed.

## Self-Check: PASSED

All modified files verified present on disk. All three task commits verified in `git log`:

- `1f610eb` fix(05-19): clear both ended-record sources on a dismissal, carrying the cancel fate out
- `3713a7e` feat(05-19): disclose the dismissal's full cost on the rows where it is real
- `b8a5e0f` fix(05-19): make the shipped type-to-confirm gate call the tested predicate

