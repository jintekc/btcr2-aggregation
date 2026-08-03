---
phase: 05-operator-cohort-lifecycle-control
plan: 39
subsystem: web
tags: [operator-console, session-identity, gap-closure, cr-03, wr-11, in-11]
status: complete
requires:
  - "05-36 (the session-identity guards that compare sessionRound, and the docstring whose rule this plan makes true)"
  - "05-34 (sessionRound itself, the identity every guard in this file leans on)"
provides:
  - "GATED_SLICE_RESET: the one list both session-ending paths clear, spread by signOut and expireSession"
  - "liveSessionRound: the stored fact a concurrent probe cannot erase, set by every session start and cleared by both ends"
  - "a probe whose three non-live outcomes route through the one end-of-session operation"
  - "a parity row that fails when a field is added to one ending path and missed by the other"
  - "a seeded-shape pin, so a test seed that forgets the live-session field fails rather than disarming a guard"
affects:
  - packages/web/src/stores/operator.ts
  - packages/web/tests/operator.spec.ts
tech-stack:
  added: []
  patterns:
    - "two implementations of ONE act get one shared definition plus a parity row that excludes the deliberate differences BY NAME, so the next added field cannot diverge quietly"
    - "a concurrency condition that has to be captured before its own function's first statement belongs on a stored fact, not on a status"
    - "a state-clearing fix is pinned by driving the shipped paths into a populated state, then asserting the clear field by field, with one anti-vacuity control beside each clearing row"
key-files:
  created: []
  modified:
    - packages/web/src/stores/operator.ts
    - packages/web/tests/operator.spec.ts
decisions:
  - "Ending an operator session is ONE act with ONE implementation: GATED_SLICE_RESET holds the whole gated slice and is spread by both signOut and expireSession, while auth, sessionRound and error stay OUT of it because those three differ between the two paths deliberately and folding them in would force every caller to override them immediately after spreading."
  - "The probe's session-boundary decision moved from a pre-await auth snapshot to the stored liveSessionRound fact, read at LANDING time. Dedupe was the review's other option and was declined: it removes the second probe but leaves the decision on a status, so a deliberate signOut landing mid-probe would still be narrated to the operator as an expiry they did not cause."
  - "signIn's non-200 branches clear liveSessionRound alongside the status they already set. They are reachable only from the login screen, where nothing is live, so this is agreement between the status and the stored fact rather than a session change; without it the two disagree in exactly the state a test can construct and a guard would then read a live session where the status says none."
  - "signIn gets NO gated-slice clear, declined deliberately (see Deliberately not done)."
  - "The three setState seed helpers (resetStore, seedEmptySlice, seedLive) seed liveSessionRound consistently with the auth they seed, and a seeded-shape row compares that shape against what a real signIn produces, so the footgun the stored fact introduces is one the suite notices."
metrics:
  duration: 15 min
  completed: 2026-08-03
actuals:
  tokens: 44800
  tasks: 3
  commits: 3
---

# Phase 05 Plan 39: One Session-Ending Act Summary

Ending an operator session is now one act with one implementation and one clear list, the probe that discovers an idle expiry on a tab switch calls it, a transport fault clears without claiming an expiry, and two overlapping probes cross one session boundary between them.

## What Was Built

### Task 1: two ending paths, one clear list (IN-11) - `c17bf46`

`packages/web/src/stores/operator.ts` gained one module-scope `GATED_SLICE_RESET` holding every field a session-ending path clears (35 fields, the whole gated slice), spread by both `signOut` and `expireSession`, each of which then sets only its own three: the auth status, its own next round, and its own copy (undefined for a deliberate sign-out, the session-expired line for an expiry).

The five fields `expireSession` was missing came with it: `createStatus`, `formError`, `advertiseStatus`, `advertisingId` and `advertiseMessage`. A failed advertise message raised under one session can no longer render on the next session's create form.

Every explanatory paragraph `signOut` held inline moved onto the constant's docstring rather than being dropped, because the reasoning (the served mode is a claim about a boot that may be gone, an unsaved edit belongs to the session that opened it, the operator log is session-scoped server-side too, the settings snapshot is what the console shell's read latch keys on) is now true of both paths.

Three rows landed: the parity row comparing the WHOLE state after each ending path with `auth`, `sessionRound` and `error` excluded BY NAME; a row driving a real advertise confirmation and a real create-form 400 through the shipped paths and asserting both are gone after an expiry; and a row starting a real in-flight advertise and asserting the marker pair is gone too.

### Task 2: the probe decides from a stored fact (WR-11) - `76ef289`

`OperatorState` gained `liveSessionRound`: the round of the session currently live, `undefined` when none is. It is set beside every round bump that STARTS a session (`signIn`'s 200 branch and `probe`'s session-starts branch) and cleared by `GATED_SLICE_RESET`, so both paths that END one drop it with everything else.

`probe`'s `wasLive` pre-await capture and its trap comment are gone. The condition now reads the stored fact at landing time, so a second probe entering while the first is in flight cannot conclude that no session was live merely because the first probe's own opening statement set `auth` to `checking`.

The `sessionRound` docstring's transition paragraph now names the fact the transition is decided from and cites review WR-11 beside the existing IN-07 citation.

Five rows landed: two overlapping probes on a live session take no round and stay signed in; a list read in flight across two overlapping probes still writes everything a live-session read writes; two overlapping probes on a console holding no session move the round exactly once; a deliberate sign-out landing mid-probe shows the sign-out state rather than the expiry copy; and the seeded-shape pin.

### Task 3: a probe that discovers a session has ended ends it (CR-03) - `dfd2957`

`probe`'s three non-live outcomes now route through the one end-of-session operation whenever a live session is recorded:

- no live session and one WAS recorded: `expireSession()`, so the round is retired and the whole gated slice goes with it.
- the fail-closed 404: the same path, and THEN the disabled status with no error, so the notice a service without an operator password owes the operator survives, but only after the slice has gone.
- a transport fault: the same path, and THEN the logged-out status with the unreachable copy, so a fault never claims an expiry it cannot prove and equally never hands a live session's slice to whoever signs in next.

Where no live session is recorded the branch is unchanged: it sets the status and nothing else. Its comment now states BOTH cases (the session that never existed and the one that just ended) and cites review CR-03.

Eight rows landed, every one of them driving the SHIPPED paths into a populated state first (a settled list read, an open drill-down holding a served document, a settings snapshot, all asserted non-empty before the act): the clearing row asserting eleven fields by name plus the view and the round; the latch row computing the console shell's own `auth === 'logged-in' && settings === undefined` condition after the next sign-in; the transport-fault row asserting the clear AND the copy; the fail-closed row asserting the clear AND the notice; three anti-vacuity controls (a confirming probe clears nothing and keeps the round, a probe finding no session on a console holding none ends nothing, a returning session still takes a fresh round); and the overlapping-probe row asserting the round moves exactly once.

## Mutation Evidence (all three reverted and restored)

**Task 1, the plan's literal mutation (delete one field from the shared reset), and a correction.** Deleting `health` from `GATED_SLICE_RESET` did NOT turn the parity row red, and the reason is structural rather than a defect in the row: with one shared list a deletion applies to BOTH paths symmetrically, so the two states still agree. What it did turn red was the shipped health row:

```
FAIL > operator store health (served broadcast mode, D-17/D-43) > clears the stored mode on a session expiry so the next session re-reads it
AssertionError: expected { mode: 'live', …(2) } to be undefined
      Tests  1 failed | 64 passed (65)
```

So the plan's expectation was corrected rather than skipped: the property the parity row buys is DIVERGENCE, and the faithful mutation is the future edit it exists to catch. Moving `advertiseMessage` out of the shared list and into `signOut` alone (exactly the shape of the defect being closed) turned it red naming that field:

```
FAIL > operator store session-ending parity (review IN-11) > clears the SAME fields whether a session ended by expiry or by deliberate sign-out
-   "advertiseMessage": undefined,
+   "advertiseMessage": "Advertised.",
      Tests  2 failed | 63 passed (65)
```

Both mutations were reverted; the file returned to 65 passed.

**Task 2, restoring the pre-await status snapshot as the bump condition.** The three overlapping-probe rows red, every single-probe row (including both shipped IN-07 rows) green:

```
FAIL > crosses ONE session boundary when two probes OVERLAP on a live session (review WR-11)
AssertionError: expected 26 to be 25
FAIL > lets a list read started before TWO overlapping probes still write when it lands (review WR-11)
AssertionError: expected [] to deeply equal [ { draftId: 'draft-1', …(6) } ]
FAIL > takes EXACTLY one round when two overlapping probes find a session on a console holding none
AssertionError: expected 29 to be 28
      Tests  3 failed | 67 passed (70)
```

Restored: 70 passed.

**Task 3, reverting the non-live branches to a status-only set.** The clearing rows and the latch row red, every anti-vacuity row green:

```
FAIL > ends the session it discovers has ended, clearing the whole gated slice
AssertionError: expected [ { draftId: 'draft-1', …(6) } ] to deeply equal []
FAIL > leaves the console shell free to re-read settings for the NEXT session (the latch)
AssertionError: expected false to be true
FAIL > clears the slice on a transport FAULT without ever claiming an expiry
FAIL > clears the slice on the fail-closed answer AND keeps the disabled notice
FAIL > still gives a RETURNING session a fresh round after a probe ended the previous one
FAIL > ends the session EXACTLY once when two overlapping probes both discover it has ended
      Tests  6 failed | 72 passed (78)
```

Restored: 78 passed.

## Verification

| Gate | Result |
|------|--------|
| `pnpm test` | 68 files, **1320 tests**, green (baseline for this round: 68 files / 1304 tests, so +16 rows and nothing removed) |
| `pnpm lint` | green |
| `pnpm --filter @btcr2-aggregation/web build` | green |
| `packages/web/tests/operator.spec.ts` | 62 rows before, 78 after; every shipped row unedited and green |
| `git diff --stat packages/service` | empty |
| `git diff --stat pnpm-lock.yaml` | empty |
| `OperatorConsole.tsx`, `App.tsx`, `main.tsx` | unedited |
| em-dash scan over both touched files | none |

`pnpm e2e:gate` was NOT run by this plan, and the reasoning is stated rather than the step skipped silently: this plan touches only `packages/web/src/stores/operator.ts` and its spec, no e2e leg exercises the browser store, and the round runs the gate once at the end of 05-41, which is the only plan in the round that edits `packages/service` (including two boot-warning strings a booting service actually emits).

## Deviations from Plan

**1. [Rule 1 - Corrected plan expectation] The task 1 mutation as written does not turn the parity row red.**
- **Found during:** Task 1, running the mutation the plan specifies.
- **Issue:** The plan says deleting one field from the shared reset must turn the parity row red naming that field. With ONE shared list a deletion applies to both ending paths symmetrically, so the two captured states still agree and the parity row stays green (the shipped health row goes red instead).
- **Fix:** Ran the plan's literal mutation, recorded its real output, and then ran the mutation that actually exercises the property the parity row buys: reintroducing the divergence by moving one field out of the shared list into `signOut` alone. That turned the parity row red naming `advertiseMessage`. Both outputs are quoted above.
- **Files modified:** none (both mutations reverted).
- **Commit:** evidence recorded here; the restored tree is `c17bf46`.

**2. [Rule 3 - Blocking] `signIn`'s non-200 branches had to clear `liveSessionRound`.**
- **Found during:** Task 2.
- **Issue:** With the seed helpers corrected as the plan mandates, the shipped row `takes no round where no session becomes live` stages a failed sign-in on a console seeded live, which under the shipped `signIn` leaves `auth: 'logged-out'` beside a still-set `liveSessionRound`. Task 3's routing would then read that as a live session and end it, turning a shipped row red. That row must stay green with no assertion edited.
- **Fix:** The three non-200 branches and the catch branch now set `liveSessionRound: undefined` beside the status they already set. They are reachable only from the login screen, where nothing is live, so this is agreement between the status and the stored fact rather than a session change. The plan's `signIn is unedited apart from task 2's live-session field` criterion is satisfied: this IS that field.
- **Files modified:** `packages/web/src/stores/operator.ts`
- **Commit:** `76ef289`

**3. [Rule 3 - Blocking] The parity row's field exclusion was rewritten to satisfy the repo lint config.**
- **Found during:** Task 3's gate.
- **Issue:** `const { auth, sessionRound, error, ...rest } = state` tripped `@typescript-eslint/no-unused-vars` three times under this repo's flat config.
- **Fix:** The exclusion is now a copy plus a `delete` over a named, `keyof OperatorState`-checked list, which keeps the exclude-BY-NAME property intact (a misspelled name is a compile error, an added field still shows up as a difference).
- **Files modified:** `packages/web/tests/operator.spec.ts`
- **Commit:** `dfd2957`

## Deliberately Not Done

`signIn` gets no gated-slice clear. The review offers it as defence in depth and this plan declines it on the record: the CR-03 latch row asserts that a live session holds no settings snapshot after a probe-discovered expiry, and a clear inside `signIn` would satisfy that row whether or not `probe` clears anything, making this round's critical evidence vacuous. After this plan every path that ends a session clears, so no path can leave state for `signIn` to inherit.

The action verbs keep their unguarded 401 shape and `advertise` / `readvertise` keep their generic copy until 05-40 (review IN-09, WR-12). `lastUpdated` is not split (review WR-05) even though this plan clears it on a new path. `OperatorConsole.tsx`, `App.tsx` and `main.tsx` are unedited. Review WR-03, WR-04, IN-01 and IN-02, the earlier carried findings (the verdict cache never cleared, `tx-client.ts`'s missing timeout, the unbounded `verdictCache` singleton, the `/cas` prototype-pollution 500, the test-peer seat cap) and the deferred advert-slot-on-fill item all stay recorded and out of scope. `.planning/REQUIREMENTS.md` is untouched. The 16 pending human items in `05-UAT.md` are the owner's walk, not build work.

## Known Stubs

None. No placeholder value, no unwired surface, and no skipped or `todo` row was added.

## Backstop Left for a Human

One `must_haves` truth is marked `verification: backstop` and remains for the owner's browser pass: signing in on the operator tab, switching to the participant tab until the operator session expires server-side, switching back, and signing in again should show a console holding none of the previous session's cohorts, health chip, operator log, drill-down document or settings values, with the create form on defaults this session read for itself. The store-level evidence for each part of that walk is pinned above.

## Self-Check: PASSED

- `packages/web/src/stores/operator.ts` FOUND, contains `GATED_SLICE_RESET` and `liveSessionRound`.
- `packages/web/tests/operator.spec.ts` FOUND, contains `liveSessionRound`, 78 rows green.
- `c17bf46` FOUND, `76ef289` FOUND, `dfd2957` FOUND.
