---
phase: 05-operator-cohort-lifecycle-control
plan: 32
subsystem: ui
tags: [zustand, react, operator-console, concurrency, session, vitest]

requires:
  - phase: 05-operator-cohort-lifecycle-control
    provides: "05-28's `pollDetail` round guard, the shipped precedent this plan applies to the list read"
provides:
  - "A session round guard on `refreshCohorts`, so a list answer that outlived the session that asked it can no longer repaint the console's gated slice"
  - "Seven concurrent-read regression rows covering the expiry race, the sign-out race, the stale unreachable, the pre-await capture, and two anti-vacuity controls"
affects: [operator console, monitoring, session handling]

actuals:
  tokens: 7000
  tasks: 2
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Round guard keyed on the subject the read is a fact ABOUT (session for the list read, cohort for the detail read)"
    - "Deferred-per-call fetch stub so settle ORDER is the thing under test, never a property of the runner"

key-files:
  created: []
  modified:
    - packages/web/src/stores/operator.ts
    - packages/web/tests/operator.spec.ts

key-decisions:
  - "The 401 branch stays ahead of the guard: a guard may precede only a branch whose subject is narrower than its own, and here both are session-scoped, so keeping both read paths reading the same way costs nothing."
  - "The guard sits ahead of the unreachable branch as well as the ok write, because freshness is a fact about a list this session is watching."
  - "Both halves of the guard are kept (pre-await capture plus post-await re-check); each was proven load-bearing by an independent mutation."

patterns-established:
  - "When a guard is added to one async writer in a store, the rest of that store's async writers are the first place to look next."

requirements-completed: [SVC-04]

coverage:
  - id: D1
    description: "A list read that lands after its session ended is discarded whole: the cohort list, monitoring rows, metrics, health (the broadcast-mode chip), operator log and defaults stay as the expiry left them."
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#discards a list answer that outlived the session that asked it (fast 401, slow ok)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The freshness pair (`listStale`, `lastUpdated`) is not written by a dead session's answer, so the console never claims a stamp the current session did not earn."
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#leaves the freshness pair exactly as the expiry left it, so no dead session earns a stamp"
        status: pass
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#does not raise the staleness banner when the failed read belongs to a session that has ended"
        status: pass
    human_judgment: false
  - id: D3
    description: "An explicit sign-out is equally protected, and stays the CLEAN signed-out state rather than acquiring the session-expired banner."
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#discards a list answer that outlived an explicit sign-out, leaving the CLEAN signed-out state"
        status: pass
    human_judgment: false
  - id: D4
    description: "The pre-await capture rejects an answer to a question no live session asked, even when a new session has signed in by the time it lands."
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#writes nothing for an answer to a question no live session asked (the pre-await half)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The guard refuses only what it should: an ordinary live-session read still writes every field it always wrote, and a live-session unreachable read still raises the staleness banner."
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#still writes everything a live-session read always wrote, so the guard did not disable the poll"
        status: pass
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#still raises the staleness banner for a LIVE session read that could not reach the service"
        status: pass
    human_judgment: false

duration: 6 min
completed: 2026-08-03
status: complete
---

# Phase 05 Plan 32: Operator list-read session round guard Summary

**`refreshCohorts` now re-checks the session across its await, so an ordinary 4000 ms-poll / 8000 ms-timeout race can no longer repaint the operator console's gated slice (cohort list, metrics, operator log and the broadcast-mode chip) from an answer the previous session asked for.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-08-03T16:33:14Z
- **Completed:** 2026-08-03T16:39:09Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Closed `05-VERIFICATION.md` W5 / review WR-01: the list read is now a fact about the session that asked it, matching the rule 05-28 applied to `pollDetail` for the cohort.
- Both halves of the guard landed and were each proven load-bearing by an independent mutation: the pre-await capture rejects an answer no live session asked for, the post-await re-check rejects an answer that outlived the session that did.
- The guard sits ahead of the unreachable branch as well as the ok write, so a dead session's failed read cannot raise the staleness banner a sign-out just lowered.
- Seven regression rows added where none existed: the whole suite covered what each ANSWER means and never asked a second question while the first was in flight.
- The store's own documented promises became true: `signOut`'s "the next session must re-read it", `expireSession`'s full clear, and the `SESSION_EXPIRED` copy's "Monitoring rebuilds from this service's state after you sign in".

## Task Commits

1. **Task 1 (tracer, TDD RED): stage the list-read session race** - `23fe638` (test)
2. **Task 1 (TDD GREEN): the session round guard** - `e6f8ddb` (fix)
3. **Task 2: sign-out, stale-unreachable, pre-await and scope-control rows** - `b6a4991` (test)

No REFACTOR commit: the guard is one comparison and one local, with nothing to clean up.

## Files Created/Modified

- `packages/web/src/stores/operator.ts` - the session round guard in `refreshCohorts` (pre-await capture at the top, post-await re-check after the 401 branch and ahead of both the unreachable branch and the ok write), with the reason, the `pollDetail` precedent, and the why-the-401-branch-stays-first note commented in the file's density. +28 lines, no new export, no new store field.
- `packages/web/tests/operator.spec.ts` - a new sibling block beside the existing list-read block: `operator store refreshCohorts concurrency (W5: a list answer belongs to ONE session)`, 7 rows plus a deferred-per-call fetch stub that answers the logout POST separately so a `signOut` row cannot consume a staged list answer. +99 lines this task, +280 across the plan.

## Mutation Checks (observed output, both restored afterwards)

### Mutation 1 (Task 1): remove the post-await session check

Guard reduced to `if (!askedWhileLive) {`. Observed:

```
   × operator store refreshCohorts concurrency (W5: a list answer belongs to ONE session) > discards a list answer that outlived the session that asked it (fast 401, slow ok) 6ms
   × operator store refreshCohorts concurrency (W5: a list answer belongs to ONE session) > leaves the freshness pair exactly as the expiry left it, so no dead session earns a stamp 1ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
      Tests  2 failed | 26 passed (28)
```

with `AssertionError: expected [ { draftId: 'draft-1', ...(6) } ] to deeply equal []` and `AssertionError: expected 1785774915469 to be undefined`. Restored: `Tests  28 passed (28)`.

### Mutation 2 (Task 2): remove the pre-await capture alone, leaving the post-await check

Capture neutralized to `const askedWhileLive = true;`. Observed (verbose reporter, same block):

```
✓ ... > discards a list answer that outlived the session that asked it (fast 401, slow ok)
✓ ... > leaves the freshness pair exactly as the expiry left it, so no dead session earns a stamp
✓ ... > still writes everything a live-session read always wrote, so the guard did not disable the poll
✓ ... > discards a list answer that outlived an explicit sign-out, leaving the CLEAN signed-out state
✓ ... > does not raise the staleness banner when the failed read belongs to a session that has ended
× ... > writes nothing for an answer to a question no live session asked (the pre-await half)
✓ ... > still raises the staleness banner for a LIVE session read that could not reach the service
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
      Tests  1 failed | 31 passed (32)
```

The pre-await row RED while the Task 1 race row stayed green, which is the evidence the two halves cover different cases rather than one covering both. Restored: `Tests  32 passed (32)`.

### RED phase (before the guard existed)

```
   × ... > discards a list answer that outlived the session that asked it (fast 401, slow ok) 8ms
     → expected [ { draftId: 'draft-1', ...(6) } ] to deeply equal []
   × ... > leaves the freshness pair exactly as the expiry left it, so no dead session earns a stamp 1ms
     → expected 1785774872394 to be undefined
      Tests  2 failed | 26 passed (28)
```

The anti-vacuity control passed in the same RED run, confirming it does not depend on the guard.

## Gate

| Gate | Result |
|------|--------|
| `pnpm test` | green: **68 files, 1234 tests** (plan baseline 1215; post-05-31 round baseline 1227; +7 rows here) |
| `pnpm lint` | green (`eslint .`, no output) |
| `pnpm --filter @btcr2-aggregation/web build` | green (`built in 382ms`; only the pre-existing >500 kB chunk advisory) |
| `pnpm e2e:gate` | green, run once for the round (resolve, config, persist legs all PASSED) |
| `git diff --stat packages/service` | empty: no route, no DTO, no served body changed |
| `git diff --stat pnpm-lock.yaml` | empty: no package added |
| `grep -rlP '\x{2014}'` on both touched files | no files listed |
| Pre-existing row at `operator.spec.ts:392-399` | unedited and green (the evidence the 401 branch stayed where it is) |
| Test-file diff | 100% additive across the plan (`git diff -U0 \| grep -c '^-[^-]'` returned 0 for task 2; the only non-additive line in the plan is the `type OperatorCohortsDTO` import addition on line 2) |

## Decisions Made

- **The 401 branch stays ahead of the guard.** A guard may precede only a branch whose subject is narrower than its own. In `pollDetail` the guard is cohort-scoped and the branch session-scoped (wider), so the branch runs first; here both are session-scoped, so neither order changes what happens for the case that matters, and keeping the two read paths reading the same way is worth more than the swap. Commented in the file so a future reader does not "fix" it.
- **The guard is placed ahead of the unreachable branch, not only ahead of the ok write.** Freshness is a fact about a list this session is watching, so a dead session's failed read must not raise the banner a sign-out just lowered. Same scoping decision 05-28 made for `detailStale`.
- **Both halves kept.** The post-await check alone would let through an answer to a question asked while signed out but landing after a new sign-in; the pre-await capture alone would let through an answer that outlived its own session. Mutation 2 is the proof they are not redundant.
- **The pre-await row drives a sign-in DURING the flight** rather than simply leaving the store signed out, because a signed-out-throughout row would also pass against the post-await check alone and the mutation would have proven nothing.

## Deviations from Plan

None - plan executed exactly as written.

## Threat Model Outcome

| Threat ID | Disposition | Outcome |
|-----------|-------------|---------|
| T-05-32-01 (info disclosure: gated slice repopulated after sign-out) | mitigate | Closed by the guard; pinned by the expiry-race and sign-out-race rows. |
| T-05-32-02 (spoofing: stale broadcast-mode chip) | mitigate | Closed; `health` is asserted undefined after both races, not inferred from the cleared list. |
| T-05-32-03 (repudiation: freshness stamp / staleness banner) | mitigate | Closed by placing the guard ahead of the unreachable branch; two rows plus the live-unreachable scope control. |
| T-05-32-04 (EoP: 401 after an explicit sign-out still shows the expiry banner) | accept | Unchanged and deliberate, as planned. The sign-out row covers the ok-answer case; a late 401 still routes through `expireSession`, which repopulates nothing. Recorded, not silently left. |
| T-05-32-SC (npm install surface) | mitigate | No package added; `git diff --stat pnpm-lock.yaml` empty. |

## Known Stubs

None. No placeholder, no skipped test, no unrun `<verify>` in this plan.

## Deliberately Not Done (carried, not lost)

- No abort controller or request cancellation: the guard makes the answer harmless rather than preventing it, matching both shipped precedents.
- The other store actions that write after an await (`submitDraft`, `runAdvertisingToggle`, the settings actions, the export action) are in the same family and were NOT touched - the owner scoped this round to exactly three items. They are the first place a later round should look.
- Review WR-04 (`TestPeerAction` / `FundingStage`) and WR-05 (the two freshness facts on `lastUpdated`) stay out of scope.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- This is plan 2 of 2 in gap-closure round 4 and the last owner-approved item of the round. 05-31 (service-side string-seed bounds) and 05-32 (this plan) are both complete, so SVC-04's shared-ID completion gate can now be evaluated.
- Next: re-verify phase 5, then the 16 pending human items in `05-UAT.md`.

## Self-Check: PASSED

- `packages/web/src/stores/operator.ts` FOUND on disk; `packages/web/tests/operator.spec.ts` FOUND on disk.
- Commits `23fe638`, `e6f8ddb`, `b6a4991` all FOUND in `git log --oneline --all`.
- All Task 1 and Task 2 acceptance criteria re-run and passing (see the Gate table and the Mutation Checks section above).

---
*Phase: 05-operator-cohort-lifecycle-control*
*Completed: 2026-08-03*
