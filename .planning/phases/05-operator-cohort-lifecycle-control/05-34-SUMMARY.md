---
phase: 05-operator-cohort-lifecycle-control
plan: 34
subsystem: ui
tags: [zustand, operator-console, session, race-condition, guard, react]

requires:
  - phase: 05-operator-cohort-lifecycle-control
    provides: "the round guard 05-32 added to refreshCohorts, and the cohort-identity guard 05-28 added to pollDetail as its shipped precedent"
provides:
  - "sessionRound, a monotonic client-side identifier for one operator session, bumped at every path that makes a session live and every path that ends one"
  - "refreshCohorts comparing a session IDENTITY rather than an auth STATUS, closing the ABA sequence (logged-in to logged-out to logged-in)"
  - "the ABA regression rows no existing row covered, for both ways a session can end"
  - "one coverage row per bump site plus the negative row pinning where no round is taken"
  - "a guard comment that claims exactly what the code does"
affects: [05-35, phase-06]

actuals:
  tokens: 5100
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "A guard discards an answer by comparing what the answer is ABOUT, and a status is not an identity"
    - "When a guard's subject is a state the system can RETURN to, the missing test is the one that returns to it"
    - "A comment that states an invariant is a claim, and it needs a row the same way the code does"

key-files:
  created: []
  modified:
    - packages/web/src/stores/operator.ts
    - packages/web/tests/operator.spec.ts

key-decisions:
  - "The captured value is `number | undefined` (the round when a session is live, undefined when none is), so the pre-await half keeps refusing an answer to a question nobody asked without a second flag. The status check is RETAINED alongside the round check: the round closes ABA, the status refuses an answer landing into a signed-out console."
  - "Both START bumps and both END bumps are wired, and the mutation runs proved they are REDUNDANT with respect to the ABA rows rather than each independently necessary: removing the sign-in bump alone leaves every ABA row green, because the expiry and sign-out bumps already moved the round. A per-path RED needed BOTH that path's start and end bump removed. Recorded as observed rather than as the plan predicted."
  - "The bump sites were confirmed by enumeration, not by taking the plan's list: `logged-in` is assigned in exactly two places (`probe` on a live result, `signIn` on a 200) and the gated slice is cleared in exactly two (`signOut`, `expireSession`, the latter being the single path every 401 in the store routes through). There is no fifth branch."
  - "`probe`'s single `set({ auth: state })` was split into a live branch and a non-live branch rather than bumping unconditionally, so `logged-out` and `disabled` take no round: a round retired by a probe no session ever held would be a number that identifies nothing."
  - "`stubListQueue` gained a login-POST special case on the same reasoning its logout case already carried; the follow-up list read `signIn` fires is deliberately NOT special-cased, because it is a real read by the new session and must take a staged answer like any other."
  - "The pre-await row 05-32 already wrote covers the new capture shape unchanged, so no duplicate was added."

patterns-established:
  - "Session-identity guard: capture the round the asking session holds before the await, compare it after, alongside the status check"
  - "Coverage rows assert a value MOVED from one captured immediately before the action, never from a literal, so they pin the rule rather than an initial value"

requirements-completed: [SVC-04]

coverage:
  - id: D1
    description: "A list answer from a session that ENDED cannot repaint the session that replaced it, on the reproduced ABA sequence (slow read under A, fast 401 expiring A, sign back in as B, A's ok settles last)"
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#discards a list answer from a session that ENDED even though a NEW session is now signed in"
        status: pass
    human_judgment: false
  - id: D2
    description: "The same sequence leaves the new session with no freshness stamp it did not earn, so the health strip cannot caption another session's data as fresh"
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#leaves the new session with no freshness stamp it did not earn (the ABA sequence)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The sign-out half of ABA: a read started under session A, a sign-out, a sign back in, then A's ok settling, changes nothing at all"
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#discards a list answer that outlived a SIGN-OUT, once a new session has signed back in"
        status: pass
    human_judgment: false
  - id: D4
    description: "Every path that starts or ends a session retires its round, and no round is taken where no session becomes live"
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#starts a new session on a fresh round (the operator signs in)"
        status: pass
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#starts a returning session on a fresh round (a probe finds a live session)"
        status: pass
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#retires the round of the session an EXPIRY ended"
        status: pass
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#retires the round of the session a deliberate SIGN-OUT ended"
        status: pass
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#takes no round where no session becomes live (throttled, disabled and rejected sign-ins, and a probe that finds none)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The guard refuses only answers from a session that has ended: a same-session ok read still writes the full field set, and a new session's own unreachable read still raises the staleness banner"
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#still writes everything for a read issued BY the new session and landing under it"
        status: pass
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#still raises the staleness banner for a read the NEW session issued and could not complete"
        status: pass
    human_judgment: false
  - id: D6
    description: "In a real browser at the shipped 4000 ms poll against the 8000 ms client timeout, a session expiry followed by a password-manager sign-in inside that window leaves the console showing the new session's data only"
    requirement: SVC-04
    verification: []
    human_judgment: true
    rationale: "The plan states this as a backstop truth. It needs a person, a browser, a real service and a real session expiry; the hermetic rows drive the store directly and cannot observe what the rendered console shows."

duration: 7 min
completed: 2026-08-03
status: complete
---

# Phase 05 Plan 34: Session-identity guard on the operator list read Summary

**A monotonic `sessionRound` on the operator store, compared by identity in `refreshCohorts`, so a list answer from a session that ended can no longer repaint the session that replaced it (review WR-06).**

## Performance

- **Duration:** 7 min
- **Started:** 2026-08-03T18:39:56Z
- **Completed:** 2026-08-03T18:46:38Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- `refreshCohorts` now captures the round the asking session holds before its await and compares that round after it, alongside the retained status check. Round 4 supplied the guard's shape against the wrong subject (a status, which `logged-in` to `logged-out` to `logged-in` repeats); this plan changed the subject, not the shape.
- `sessionRound` is bumped at every path that makes a session live (`signIn` on a 200, `probe` on a `logged-in` result) and every path that ends one (`signOut`, `expireSession`).
- The ABA rows no existing row staged: an expiry followed by a sign back in, and the sign-out variant of the same sequence. Both assert the gated slice field by field, both assert `auth` is LOGGED IN (unlike every round-4 row, which ends signed out), and both assert `lastUpdated` stays unset.
- The guard's comment now claims exactly what the code does, and says why identity and not status, naming the ABA sequence in words.
- All seven rows 05-32 added are unedited and still green, which is the evidence this strengthened the guard's subject rather than replacing its behavior.

## Task Commits

1. **Task 1: the ABA sequence cannot repaint the session that replaced it** - `c29eed8` (fix)
2. **Task 2: every session start and end retires its round** - `c82355d` (test)

## Files Created/Modified

- `packages/web/src/stores/operator.ts` - the `sessionRound` field and its docstring, its initial value, four bump sites, and the identity comparison plus corrected comment in `refreshCohorts`.
- `packages/web/tests/operator.spec.ts` - ten new rows in the block 05-32 opened, a login-POST case on `stubListQueue`, and the `stageSignBackIn` staging helper parameterized over both ways a session can end.

## Mutation checks (both observed, both restored)

**Task 1 - revert the identity comparison to a status comparison.** Guard rewritten as
`if (askedInRound === undefined || get().auth !== 'logged-in')`:

```
× ... > discards a list answer from a session that ENDED even though a NEW session is now signed in 7ms
× ... > leaves the new session with no freshness stamp it did not earn (the ABA sequence) 1ms
  Tests  2 failed | 33 passed (35)
```

Exactly the two ABA rows RED, all seven round-4 rows and the same-session control green. Restored:
`Tests 35 passed (35)`.

**Task 2 - remove a bump site.** The plan predicted that removing ONE session-start bump would turn
that path's ABA row RED. It does not, and the honest observation is recorded rather than reshaped:

- Removing the `signIn` bump alone: **only the sign-in coverage row went RED** (`1 failed | 41 passed (42)`). Every ABA row stayed green, because the expiry and sign-out bumps had already moved the round before session B signed in.
- Removing the `signIn` bump AND the `expireSession` bump: the two EXPIRY ABA rows went RED while the SIGN-OUT ABA row stayed green (`4 failed | 38 passed (42)`, the other two failures being the two coverage rows for the removed sites).
- Removing the `signIn` bump AND the `signOut` bump: the mirror image, the SIGN-OUT ABA row RED while both expiry ABA rows stayed green (`3 failed | 39 passed (42)`).

So the start bumps and the end bumps are REDUNDANT with respect to the ABA sequence: either family
alone closes it, which is why no single removal reddens an ABA row. What the runs do prove is that
each PATH is independently covered (killing the expiry path leaves the sign-out path green and vice
versa) and that each bump SITE is pinned by its own coverage row. All bumps restored:
`Tests 42 passed (42)`.

## Decisions Made

- The captured value is `number | undefined` rather than a round plus a separate boolean: undefined already means "no live session asked", which is what the pre-await half exists to refuse.
- The status check is retained alongside the round check. They refuse different things: the round refuses an answer that outlived its session, the status refuses an answer landing into a signed-out console.
- The bump sites were enumerated from the source rather than taken from the plan. `auth: 'logged-in'` is assigned in exactly two places, and the gated slice is cleared in exactly two; every 401 in the store routes through the single `expireSession`, so one bump site covers all ten of its call sites. No fifth branch exists.
- `probe`'s single `set` was split so `logged-out` and `disabled` take no round.
- `stubListQueue` answers the login POST like the logout POST, and deliberately does NOT special-case the follow-up list read `signIn` fires: that read is a real read by the new session. Every ABA row stages it and leaves it in flight, so the assertions speak only about session A's answer.

## Deviations from Plan

**1. [Rule 1 - Bug] The plan's Task 2 mutation expectation was factually wrong**
- **Found during:** Task 2 (mutation run)
- **Issue:** The plan asserted that removing one session-start bump would turn "that path's ABA row" RED, "which proves each bump site is independently load-bearing rather than covered by a neighbor". It is covered by a neighbor: with the end bumps in place, the round has already moved by the time session B signs in.
- **Fix:** Ran the mutation as written, recorded the actual output, then ran two further mutations that DO produce a per-path RED (start bump plus that path's end bump), and recorded all three. Nothing in the source or the tests was changed to make the prediction come true.
- **Files modified:** none (documentation of an observation)
- **Verification:** three mutation runs quoted above; final suite green at 42 rows.
- **Committed in:** documented here, not in a code commit.

---

**Total deviations:** 1 (a plan-stated expectation corrected against observation)
**Impact on plan:** None on the shipped behavior. The redundancy is a property of the fix being belt-and-braces, which the plan itself argued for on separate grounds ("a round identifies exactly one session, live or ended"). Recording it matters because a future reader deleting one bump family would find every ABA row still green.

## Issues Encountered

None.

## Verification

- `pnpm test`: **68 files, 1257 tests, green**. Baseline for the round was 68 files / 1234 tests (round 4); 05-33 took it to 1247, and this plan's ten rows take it to 1257. No file count change (both files already existed), no row lowered, loosened or deleted.
- `pnpm lint`: green.
- `pnpm --filter @btcr2-aggregation/web build`: green.
- `pnpm e2e:gate`: **not run by this plan**, deliberately and not silently. This plan touches `packages/web/src/stores` and `packages/web/tests` only, no service code and no route, and no e2e leg drives the browser store (the two browser legs are local-only playwright capstones outside the gate). 05-35 runs the gate once for the round.
- `git diff --stat packages/service`: empty. No route, no DTO, no served body changed; nothing about the session round is on the wire.
- `git diff --stat pnpm-lock.yaml`: empty. No package added.
- `grep -rlP '\x{2014}'` over both modified files: no files listed.
- `grep -c sessionRound packages/web/src/stores/operator.ts`: 8 (the declaration, the initial value, four bumps, the capture and the comparison), against the plan's floor of 7.

## Prohibitions held

- The 401 branch is unedited and still precedes the guard; the accepted `expireSession`-after-sign-out exposure (T-05-34-04) is unchanged from round 4.
- `pollDetail` is untouched. Its narrower ABA exposure (a stale answer about cohort X landing after a re-sign-in that reopens cohort X) stays recorded as accepted threat T-05-34-05 and carried, not silently fixed and not silently dropped.
- `submitDraft`, `runAdvertisingToggle`, the settings actions and the export action are untouched.
- `lastUpdated`'s two freshness facts are not split (review WR-05), even though this plan edits adjacent lines.
- No abort controller and no request cancellation was added; the guard makes the answer harmless rather than preventing it.
- `LifecycleActions` (WR-04), `validateDraft` (WR-03), `numericKnob` (IN-01), `parseWindow` (IN-02), the verdict cache, `tx-client.ts`'s missing timeout, the `/cas` prototype-pollution 500 and the test-peer seat cap are all untouched.
- No row seeds a render through `useOperator.setState`; every new row drives the store directly.
- No claim is made about any of the 16 pending human items in `05-UAT.md`, and no work was done on the deferred advert-slot-on-fill item.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Round 5 plan 3 of 3 (`05-35`) is next; it runs `pnpm e2e:gate` once for the round.
- Carried into the next round or phase: `pollDetail`'s narrower ABA exposure, and the WR-03/WR-04/WR-05/IN-01/IN-02 findings that stay out of scope by owner decision.

## Self-Check: PASSED

- `packages/web/src/stores/operator.ts` exists and contains `sessionRound` at 8 sites (verified by grep).
- `packages/web/tests/operator.spec.ts` exists and holds 42 passing rows (verified by a full file run).
- `c29eed8` and `c82355d` both present in `git log`.

---
*Phase: 05-operator-cohort-lifecycle-control*
*Completed: 2026-08-03*
