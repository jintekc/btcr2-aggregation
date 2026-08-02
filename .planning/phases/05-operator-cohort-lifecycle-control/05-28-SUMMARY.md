---
phase: 05-operator-cohort-lifecycle-control
plan: 28
subsystem: ui
tags: [zustand, react, react-dom-server, operator-console, race-condition, svc-04]

# Dependency graph
requires:
  - phase: 05-operator-cohort-lifecycle-control
    provides: "the SVC-04 cancel and finalize ceremony ladder (05-02, 05-03), the drill-down poll (04-01), and the static render harness plus its selector-faithful store fake (05-21)"
provides:
  - "a post-await round guard in the operator store's drill-down poll, so an answer about one cohort can never be painted under another cohort's name"
  - "detailCohortId, the stored provenance of the served detail, cleared beside detail at all five sites"
  - "a defense-in-depth refusal in LifecycleActions: no lifecycle control renders unless the served detail is tied to the component's own cohortId prop"
  - "the concurrent two-cohort poll regression rows no existing test covered"
affects: [operator console drill-down, any future consumer of the shared operator detail slot, phase 6 lifecycle work]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "round guard: capture the id asked about before the await, apply the answer only if the store still holds that id (the shipped fetchCohortFate discipline, now in two stores)"
    - "paired provenance: an id describing a shared data slot is written and cleared in the same set call as the data"
    - "refusal over fallback: a component that cannot tie its data to its own subject renders nothing rather than guessing a safe default"

key-files:
  created: []
  modified:
    - packages/web/src/stores/operator.ts
    - packages/web/src/components/operator/LifecycleActions.tsx
    - packages/web/tests/operator.spec.ts
    - packages/web/tests/lifecycle.spec.ts

key-decisions:
  - "The 401 branch stays AHEAD of the round guard: a session expiry is session-scoped, true no matter which cohort asked, and deferring it would leave the operator working a dead session for another poll tick. Pinned by its own test row rather than left as an assumption (T-05-28-04, accepted)."
  - "The freshness flag moved BEHIND the guard with the document: detailStale is a fact about the cohort being watched, not about whichever request happened to fail (T-05-28-03)."
  - "The provenance is stored client-side, never added to the served CohortDetailDTO: which cohort was asked about is a fact the caller already holds, and putting it on the wire would add a second source of truth for a question the caller answered itself."
  - "LifecycleActions REFUSES rather than falls back, and the condition joins the component's EXISTING early return instead of a second guard beside it: one place decides there is nothing honest to render, and there is no safe default rung to guess."
  - "No request cancellation and no abort controller: the guard makes a late answer harmless rather than preventing it, matching the participant store, and an aborted request that lost the race would still have to be ignored."

patterns-established:
  - "Concurrency staging in a store spec: a per-cohort fetch stub reading the id out of the request URL plus one deferred per cohort, so settle ORDER is controlled without a timer."
  - "A rendered negative row asserts EMPTY markup rather than a missing label, so it cannot pass because a label moved."

requirements-completed: [SVC-04]

coverage:
  - id: D1
    description: "The drill-down poll discards a late answer about a cohort the operator has navigated away from, and records which cohort the served detail describes."
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#discards a LATE answer about a cohort the operator has already navigated away from"
        status: pass
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#leaves the non-race path unchanged, so the guard did not simply disable the poll"
        status: pass
    human_judgment: false
  - id: D2
    description: "A stale poll's unreachable answer cannot mark the currently open cohort's view stale."
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#does not mark the cohort in view stale when the STALE poll is the one that failed"
        status: pass
    human_judgment: false
  - id: D3
    description: "A stale poll's 401 still expires the session, because an expiry is not cohort-scoped."
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#STILL expires the session on a stale 401, because an expiry is not cohort-scoped"
        status: pass
    human_judgment: false
  - id: D4
    description: "Every site that clears the served detail clears its provenance with it (initial state, signOut, expireSession, openCohort, closeCohort)."
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#operator store detail provenance clearing (Gap 1)"
        status: pass
      - kind: other
        ref: "grep -c detailCohortId packages/web/src/stores/operator.ts == 7, with every 'detail: undefined' site paired in the same object literal"
        status: pass
    human_judgment: false
  - id: D5
    description: "LifecycleActions renders no lifecycle control at all when the served detail cannot be tied to its own cohortId prop, including the funded rung-4 path and an absent provenance."
    requirement: SVC-04
    verification:
      - kind: automated_ui
        ref: "packages/web/tests/lifecycle.spec.ts#LifecycleActions refuses a cohort it cannot tie the served data to (Gap 1, rendered)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Both guards are load-bearing: reverting either turns its rows red."
    verification:
      - kind: other
        ref: "mutation run 1: post-await re-check removed, 2 rows red; mutation run 2: provenance condition removed, 3 rows red (output quoted in this summary)"
        status: pass
    human_judgment: false
  - id: D7
    description: "The operator console's live behavior under a real navigation race in a real browser (an actual double-click through the console while a poll is in flight)."
    verification: []
    human_judgment: true
    rationale: "The guards are proven at the store and render layers, but no automated leg drives a genuine browser navigating between two cohorts mid-poll. The existing playwright-core operator capstone does not stage a race, and staging one deterministically in a real page was out of this gap plan's scope."

# Metrics
duration: 6 min
completed: 2026-08-02
status: complete
---

# Phase 05 Plan 28: Wrong-Cohort Ceremony Race Summary

**A post-await round guard plus a stored `detailCohortId` provenance, so the drill-down poll can no longer paint one cohort's answer under another's name and the cancel/finalize ceremony refuses to render for a cohort it cannot prove the data is about.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-08-02T15:56:39Z
- **Completed:** 2026-08-02T16:02:58Z
- **Tasks:** 2 (each run as RED, GREEN, then an explicit revert-the-fix mutation)
- **Files modified:** 4

## Accomplishments

- Closed Gap 1 of `05-VERIFICATION.md` (roadmap SC 1, requirement SVC-04, code review CR-1): the destructive-confirmation ceremony can no longer be armed from a different cohort's data.
- Added the round guard to `pollDetail`, replicating the shipped `fetchCohortFate` discipline from `stores/participant.ts` so the two stores read as one house rule rather than two inventions.
- Added `detailCohortId`, the provenance of the served detail, cleared beside `detail` at all five sites (initial state, `signOut`, `expireSession`, `openCohort`, `closeCohort`) and written in the same `set` call that writes the document.
- Added the second barrier: `LifecycleActions` extends its existing early return so no cancel or finalize control renders when the served detail's provenance does not equal its own `cohortId` prop.
- Added the concurrent two-cohort poll regression rows that no existing test covered, which is how this defect shipped through a 1169-test gate.
- Test total moved from the 1169 baseline to **1181** across the same 68 files, with nothing deleted and no assertion loosened.

## Task Commits

1. **Task 1 (RED): stage the concurrent drill-down poll race** - `a1ad737` (test)
2. **Task 1 (GREEN): the store round guard and the provenance field** - `114b6d1` (fix)
3. **Task 2 (RED): stage the lifecycle ceremony refusal** - `338a48a` (test)
4. **Task 2 (GREEN): the component refusal** - `9c78736` (fix)

## Files Created/Modified

- `packages/web/src/stores/operator.ts` - the `detailCohortId` state field with its rationale docstring, cleared at all five `detail: undefined` sites; `pollDetail` captures the asked-for id before the await, keeps the 401 branch ahead of the guard, re-reads `get().view` after the await, and writes the provenance beside the document.
- `packages/web/src/components/operator/LifecycleActions.tsx` - a per-field subscription to the provenance and the extended early return, with the reasoning folded into that guard's existing comment.
- `packages/web/tests/operator.spec.ts` - `OTHER_DETAIL` (a visibly different second cohort), the per-cohort deferred fetch stub, the four concurrency rows, and the four provenance-clearing rows.
- `packages/web/tests/lifecycle.spec.ts` - the rendered refusal block (anti-vacuity control plus three negative rows asserting empty markup), the provenance added to the existing rendered fixtures, and two house-style corrections described under Deviations.

## Mutation Evidence (both guards proven load-bearing)

**Mutation 1.** The post-await re-check removed from `pollDetail`:

```
 FAIL  packages/web/tests/operator.spec.ts > operator store pollDetail concurrency (Gap 1: an answer belongs to ONE cohort) > discards a LATE answer about a cohort the operator has already navigated away from
AssertionError: expected { exists: true, …(9) } to deeply equal { exists: true, …(9) }
 FAIL  packages/web/tests/operator.spec.ts > operator store pollDetail concurrency (Gap 1: an answer belongs to ONE cohort) > does not mark the cohort in view stale when the STALE poll is the one that failed
AssertionError: expected true to be false // Object.is equality
      Tests  2 failed | 23 passed (25)
```

Restored, then re-run: `Tests  25 passed (25)`.

Note the second failure is the freshness leak in its own right: without the guard, cohort A's failed request marks cohort B's successful view stale.

**Mutation 2.** The provenance condition removed from the `LifecycleActions` early return:

```
 FAIL  packages/web/tests/lifecycle.spec.ts > LifecycleActions refuses a cohort it cannot tie the served data to (Gap 1, rendered) > renders NOTHING when the served detail is an answer about a DIFFERENT cohort
AssertionError: expected '<div class="rounded-xl border border-…' to be '' // Object.is equality
 FAIL  packages/web/tests/lifecycle.spec.ts > LifecycleActions refuses a cohort it cannot tie the served data to (Gap 1, rendered) > renders NOTHING when the served detail carries no provenance at all
AssertionError: expected '<div class="rounded-xl border border-…' to be '' // Object.is equality
 FAIL  packages/web/tests/lifecycle.spec.ts > LifecycleActions refuses a cohort it cannot tie the served data to (Gap 1, rendered) > refuses the FUNDED rung-4 path the same way, so cheap friction never stands in for expensive
AssertionError: expected '<div class="rounded-xl border border-…' to be '' // Object.is equality
      Tests  3 failed | 43 passed (46)
```

Restored, then re-run: `Tests  46 passed (46)`.

The initial RED run of Task 1 is worth recording alongside these, because it shows which branch was ALREADY correct: eight rows failed, and the stale-401 row was not among them. The session-expiry branch was right before this plan touched it, and the plan's job there was to keep it right by pinning it, not to change it.

## Decisions Made

- **The 401 branch stays ahead of the guard.** A session expiry is session-scoped: it is true no matter which cohort asked, and deferring it to the next poll tick would leave the operator working a dead session for no reason. The obvious reading is that the guard should come first, so the ordering carries a comment stating why it does not, and a test row named for it.
- **The freshness flag moved behind the guard with the document.** Everything below the guard is a fact about ONE cohort. A stale request's failure marking the current cohort's view stale is a small lie in its own right (T-05-28-03).
- **The provenance is client-side.** The served `CohortDetailDTO` carries no id, and adding one would put a second source of truth on the wire for a question the caller already answered. `git diff --stat packages/service` is empty for this plan.
- **One guard, not two, in the component.** The condition joined the existing early return rather than sitting beside it, so there is one place that decides there is nothing honest to render.
- **Refusal, not fallback.** There is no safe default rung to guess, so the component renders nothing. The store guard stops the wrong data being painted; this stops the ceremony being armed if any future path ever paints it anyway.
- **No request cancellation.** Deliberately not done: the guard makes a late answer harmless rather than preventing it, matching `fetchCohortFate`, and avoids introducing an abortable-request lifecycle into a poll that has none. If cancellation is ever wanted it is an optimization on top of this guard, not a replacement, because an aborted request that lost the race still has to be ignored.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The `setState` acceptance grep could not pass without rewording a pre-existing docstring**

- **Found during:** Task 2 (acceptance verification)
- **Issue:** `grep -c "setState" packages/web/tests/lifecycle.spec.ts` returned 2, both hits pre-existing (verified identical at base commit `52ba50b`) and both inside the file's own docstring explaining that no such call exists. The criterion demanded 0. This is exactly the situation the 05-07 lesson already recorded: a source comment must not spell the name of the token a guard greps for, or the comment defeats the guard.
- **Fix:** Reworded the two prose mentions to describe zustand's imperative state setter rather than spell it, keeping every load-bearing sentence, and added a line saying why the token is described rather than spelled. The full spelling still lives in `packages/web/tests/support/render.tsx`, which is the harness docstring the rule belongs to.
- **Files modified:** `packages/web/tests/lifecycle.spec.ts`
- **Verification:** `grep -c setState packages/web/tests/lifecycle.spec.ts` returns 0; 46 rows still pass.
- **Committed in:** `9c78736`

**2. [Rule 3 - Blocking] The em-dash acceptance scan reported this file's own house-style guard**

- **Found during:** Task 2 (acceptance verification)
- **Issue:** `grep -rlP '\x{2014}' packages/web/tests/lifecycle.spec.ts` listed the file. The single hit was pre-existing (also present at `52ba50b`), inside the file's own guard `expect(copy).not.toMatch(/—/)`: a guard written with the literal character puts that character in the very file a repo-wide scan reads. 05-22 already fixed this exact shape in `packages/web/tests/service-controls.spec.ts`.
- **Fix:** Applied the same precedent: `const LONG_DASH = '—'` plus `expect(copy).not.toContain(LONG_DASH)`, and renamed the row from "em-dash" to "long dash". Behavior is identical; the guard now no longer contains the character it forbids.
- **Files modified:** `packages/web/tests/lifecycle.spec.ts`
- **Verification:** the four-file em-dash scan lists no files; the row still passes.
- **Committed in:** `9c78736`

---

**Total deviations:** 2 auto-fixed (both Rule 3 - blocking, both required to satisfy the plan's own acceptance criteria)
**Impact on plan:** Both are pre-existing house-style defects in a file this plan already had to touch, and both were fixed by applying a precedent already recorded in this repo. No assertion was deleted or loosened, no shipped behavior changed, and no scope was added.

## Prohibition Status

| Prohibition | Status | Evidence |
|---|---|---|
| MUST NOT add any package | held | `git diff --stat 52ba50b..HEAD -- pnpm-lock.yaml` is empty |
| MUST NOT change the service DTO, any operator route, or any served body | held | `git diff --stat 52ba50b..HEAD -- packages/service` is empty |
| MUST NOT weaken the D-03 ceremony ladder | held | `typeToConfirm` still occurs exactly once in `LifecycleActions.tsx`; every rung row in `lifecycle.spec.ts` is intact; the plan only ever refuses to render |
| MUST NOT drop the session-expiry branch behind the new guard | held | the 401 branch is ahead of the guard, pinned by its own row, which passed even in the pre-fix RED run |
| MUST NOT seed any render through the imperative setter | held | `grep -c setState packages/web/tests/lifecycle.spec.ts` returns 0; the render block seeds through the file's existing selector-faithful fake |
| MUST NOT leave a site that clears `detail` without clearing its provenance | held | all five sites paired in the same object literal; four of them driven by test rows |
| MUST NOT lower the test count or loosen an assertion | held | 68 files, 1181 tests (baseline 1169), nothing deleted |

## Issues Encountered

None. Both mutations behaved exactly as the plan predicted, and the pre-fix RED run confirmed the defect was live in both the document write and the freshness write.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Gap 1 of the third gap-closure round is closed. **05-29** (Gap 2, the `mismatch` verdict unreachable on the default network, PART-05) is next, followed by **05-30** (W3, a malformed settings seed wedging every save).
- The round-wide baseline for the next plan is **68 files, 1181 tests, green**, with `pnpm lint` and `pnpm --filter @btcr2-aggregation/web build` both clean.
- Deliberately left open, and recorded rather than fixed here: no automated leg drives a genuine browser navigating between two cohorts mid-poll, so the live behavior under a real race is the one deliverable this plan routes to human judgment (coverage D7). The remaining W4 review items and the 16 pending human items in `05-UAT.md` are untouched by design.

---
*Phase: 05-operator-cohort-lifecycle-control*
*Completed: 2026-08-02*

## Self-Check: PASSED

All four modified source/test files exist on disk, and all four task commits (`a1ad737`, `114b6d1`, `338a48a`, `9c78736`) are present in the repository history. This SUMMARY rides the plan-metadata commit that carries the file itself.
