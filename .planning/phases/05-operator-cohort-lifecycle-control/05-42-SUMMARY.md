---
phase: 05-operator-cohort-lifecycle-control
plan: 42
subsystem: ui
tags: [zustand, react, session-identity, operator-console, vitest]

requires:
  - phase: 05-operator-cohort-lifecycle-control
    provides: "the askingRound / stillAsking / expireIfStillAsking trio and the fifteen gated call sites 05-40 swept, plus the ABA test harness in packages/web/tests/operator.spec.ts"
  - phase: 05-operator-cohort-lifecycle-control
    provides: "the one-list session-ending reset (IN-11) and the parity row that measures it"
provides:
  - "every gated action verb in the operator store honoring the session that asked on EVERY branch that writes, not only on the 401 branch"
  - "the drill-down landing in advertise decided by the session round, re-read on the far side of the post-success list re-read"
  - "zero status-as-identity comparisons in packages/web/src/stores/operator.ts outside askingRound's own body"
  - "an enumeration row that counts the gated capture sites in the source, so a sixteenth cannot be added silently"
  - "gatedSliceReset(), a factory minting fresh containers on every session end"
affects: [operator-console, session-identity, future-gap-rounds]

actuals:
  tokens: 11174
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "one round comparison per gated verb, placed below the unauthorized branch, covering every branch that writes including catch blocks"
    - "re-read the comparison rather than caching it across a second await that can itself end the session"
    - "source-walk enumeration rows: split the shipped source on the capture statement, count the sites, require a comparison after each"
    - "reference comparison, never value comparison, when the property under test is instance identity"

key-files:
  created: []
  modified:
    - packages/web/src/stores/operator.ts
    - packages/web/tests/operator.spec.ts

key-decisions:
  - "The guard sits BELOW the unauthorized branch at all eleven verbs, never above it: a 401 is session-scoped and must be acted on by whichever call discovers it, which is the ordering the four gated reads already use and record."
  - "advertise's drill-down landing re-reads the comparison AFTER the post-success list re-read rather than caching a boolean across it, because that refresh can itself answer 401 and end the session."
  - "saveDraftEdit's unauthorized check moved ahead of its result.ok check. Behavior-preserving (a result carrying the unauthorized member is never ok) and it puts the one shared expiry path where every other gated verb keeps it."
  - "The enumeration is checked by a source-walk row rather than asserted in prose, because the round-7 finding was that a reader could not tell a deliberate exemption from a missed site."
  - "GATED_SLICE_RESET became a factory rather than being deep-frozen: a factory keeps the one-list property IN-11 bought with no dev-only branch and no behavior difference between builds."

patterns-established:
  - "Branch-level coverage: when a rule is stated over a call site, the coverage owed is one row per BRANCH of that call site, not one row per call site."
  - "Every inverted ABA row ships with a same-session control in the same block, so a guard placed too broadly fails rather than satisfying every inverted row at once."

requirements-completed: [SVC-04]

coverage:
  - id: D1
    description: "Every branch of advertise and readvertise honors the session that asked: an ok, refused, declined or unreachable answer from an ended session writes nothing into the session that replaced it."
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#advertise discards an OK answer issued by an ENDED session rather than navigating the NEW one"
        status: pass
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#advertise discards a REFUSED (409) answer issued by an ENDED session"
        status: pass
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#advertise discards an UNREACHABLE answer issued by an ENDED session"
        status: pass
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#advertise discards a DECLINED answer issued by an ENDED session"
        status: pass
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#readvertise discards an OK answer issued by an ENDED session"
        status: pass
    human_judgment: false
  - id: D2
    description: "The guard narrows WHOSE answer counts and never WHETHER an answer counts: the same answers still write for the session that asked, and a 401 aimed at the live session still expires it."
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#advertise STILL confirms and lands the drill-down when the OK answers the LIVE session"
        status: pass
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#advertise STILL renders the service reason when the 409 answers the LIVE session"
        status: pass
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#advertise STILL expires the session for a 401 that answers the LIVE session"
        status: pass
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#cancelCohort STILL expires the session when the 401 answers the session that is live right now"
        status: pass
    human_judgment: false
  - id: D3
    description: "The nine remaining gated action verbs (advertising toggle, saveDraftEdit, discard, exportCohort, cancelCohort, finalizeCohort, addTestPeers, disableBroadcast, dismissEnded) each honor the asking session on every branch that writes."
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#the advertising toggle discards an OK answer issued by an ENDED session"
        status: pass
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#saveDraftEdit discards an OK answer issued by an ENDED session"
        status: pass
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#cancelCohort discards an UNREACHABLE answer issued by an ENDED session"
        status: pass
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#finalizeCohort discards a REFUSED (409) answer issued by an ENDED session"
        status: pass
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#follows every capture with a comparison against the captured round, before the next capture"
        status: pass
    human_judgment: false
  - id: D4
    description: "The store holds no status-as-identity comparison outside askingRound, and the fifteen gated capture sites are counted in the source so a sixteenth cannot be added silently."
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#holds exactly ONE status-as-identity comparison, and it is inside askingRound"
        status: pass
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#captures the asking session at exactly the stated number of gated call sites"
        status: pass
    human_judgment: false
  - id: D5
    description: "Every session end hands the next session fresh containers rather than one shared set (IN-18)."
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#hands each session end its OWN containers, so one reset can never reach another (review IN-18)"
        status: pass
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#hands an EXPIRY and a SIGN-OUT containers of their own too (review IN-18)"
        status: pass
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#clears the SAME fields whether a session ended by expiry or by deliberate sign-out"
        status: pass
    human_judgment: false
  - id: D6
    description: "In a real browser, an operator whose session expired while an Advertise was in flight, who signs straight back in, stays on the cohort they were looking at and sees no confirmation for an action this session never took."
    requirement: SVC-04
    verification: []
    human_judgment: true
    rationale: "A cross-session browser walk with real timing. The store contract is pinned hermetically above; whether the rendered console behaves this way to a human belongs to the owner's 05-UAT.md walk, not to a vitest row."

duration: 15 min
completed: 2026-08-04
status: complete
---

# Phase 05 Plan 42: Session identity on every branch, and fresh containers per session end

**Eleven gated action verbs now discard a dead session's success, refusal and transport answers instead of writing them into the console that replaced it, the drill-down landing is decided by the session round rather than the auth status, and a session end mints its own containers.**

## Performance

- **Duration:** 15 min
- **Started:** 2026-08-04T16:58:30Z
- **Completed:** 2026-08-04T17:13:22Z
- **Tasks:** 3
- **Files modified:** 2

## Accomplishments

- All eleven gated action verbs (`runAdvertisingToggle` covering pause and resume, `saveDraftEdit`, `advertise`, `readvertise`, `discard`, `exportCohort`, `cancelCohort`, `finalizeCohort`, `addTestPeers`, `disableBroadcast`, `dismissEnded`) carry one round comparison directly below their `unauthorized` branch, covering the `ok`, `refused`, `declined`, `unreachable` and `catch` branches that previously wrote unconditionally.
- The D-13 drill-down landing in `advertise` no longer compares the auth status. It re-reads the round comparison on the far side of the post-success list re-read, which is what closes the reviewer's reproduced navigation and keeps the property the old status check was buying.
- `grep -c "auth === 'logged-in'"` over the store now prints `1`, and that occurrence is inside `askingRound`'s body: the file holds no status-as-identity comparison anywhere else.
- An enumeration row reads the shipped source and asserts fifteen gated capture sites, each followed by a comparison against the captured round, so a sixteenth site added without one fails there rather than being taken on trust.
- `GATED_SLICE_RESET` became `gatedSliceReset()`, so `signOut` and `expireSession` each spread a freshly built object with freshly built nested containers.

## Task Commits

1. **Task 1: advertise and readvertise, the verb the reviewer reproduced** - `bcd78f6` (fix)
2. **Task 2: the nine remaining verbs plus the source enumeration** - `95309b6` (fix)
3. **Task 3: fresh containers per session end** - `fd84382` (refactor)

## Files Created/Modified

- `packages/web/src/stores/operator.ts` - eleven early-return guards, one replaced comparison at the drill-down landing, one branch reorder in `saveDraftEdit`, one guarded `catch`, the reset constant turned into a factory, and the trio docstring extended to state the rule at branch granularity.
- `packages/web/tests/operator.spec.ts` - nine inverted ABA rows, eight same-session controls, one expiry-inside-the-refresh row, three source pins and two fresh-instance rows.

## Decisions Made

- **The guard sits below the `unauthorized` branch, never above it.** A 401 is session-scoped and must be acted on by whichever call discovers it, so its own comparison stays inside `expireIfStillAsking`. This is the ordering `refreshCohorts` already records at `:1110-1123`, and adopting it verbatim is what keeps the one shared expiry path (D-16) byte-unchanged.
- **`advertise`'s landing re-reads the comparison instead of caching a boolean.** `await get().refreshCohorts(baseUrl)` sits between the confirmation and the landing, and that refresh can itself answer 401 and end the session, so a value captured on the near side is stale by the time the landing decides. `saveSettings` can cache its own because no await intervenes between its branches; `advertise` cannot, and caching would have reintroduced the same bug class in a new place.
- **`saveDraftEdit`'s `unauthorized` check moved ahead of its `result.ok` check.** Behavior-preserving, because a result carrying the `unauthorized` member is never `ok`, and it puts the shared expiry path where every other gated verb keeps it so the guard can sit directly under it.
- **The enumeration is a source-walk row rather than a docstring claim.** The round-7 finding was that a reader could not distinguish a deliberate exemption from a missed site; a row that counts is the only thing that makes the distinction checkable. It uses the convention `participant-fate.spec.ts` already established for reading a shipped source file.
- **The comparison token the enumeration row searches for is spelled with its lowercase initial deliberately**, so `expireIfStillAsking(get, askedInRound)` does not match it. A verb guarding only its 401 branch therefore fails the row, which is exactly the state this plan found.
- **The reset became a factory rather than a deep-frozen constant.** A factory keeps the one-list property IN-11 bought with no development-only branch and no behavior difference between builds.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Stale symbol reference in the `liveSessionRound` docstring**
- **Found during:** Task 3 (the reset factory)
- **Issue:** `OperatorState.liveSessionRound`'s docstring named `GATED_SLICE_RESET`, a symbol that no longer exists after the constant became a function, so the cross-reference pointed at nothing.
- **Fix:** Updated the reference to `gatedSliceReset`.
- **Files modified:** `packages/web/src/stores/operator.ts`
- **Verification:** `grep -n "GATED_SLICE_RESET"` over the store returns nothing; `tsc --noEmit` clean.
- **Committed in:** `fd84382` (Task 3 commit)

**2. [Rule 3 - Blocking] Two inverted rows staged the list read and clobbered their own fixture**
- **Found during:** Task 1 (the first GREEN run)
- **Issue:** The advertise and readvertise inverted rows staged `/v1/operator/cohorts`, so session B's own `signIn` consumed it and overwrote `SESSION_B_SLICE` with an empty served list, failing `expectSessionBUntouched` for a reason that had nothing to do with the property under test. This is precisely what the ABA harness docstring warns about.
- **Fix:** Left the list read unstaged in both inverted rows, with a comment recording why; a guarded verb never reaches its own re-read, which is part of what the rows prove. The two same-session controls keep the staged list, because no `signIn` runs in those.
- **Files modified:** `packages/web/tests/operator.spec.ts`
- **Verification:** Both rows pass, and both go RED again under the Task 1 mutation.
- **Committed in:** `bcd78f6` (Task 1 commit)

**3. [Rule 2 - Missing Critical] The two verbs whose guarded branch is followed by a re-read needed a served list to fail by assertion**
- **Found during:** Task 2 (the advertising toggle and `saveDraftEdit` rows)
- **Issue:** With the list read unstaged, a store that skipped the guard would hang on `refreshCohorts` and the row would fail by TIMEOUT rather than by assertion, which reads as a broken test rather than as the defect. A row that cannot state what went wrong is a row a future reader deletes.
- **Fix:** Added `stubActionCountingListReads`, which answers every list read with session B's own slice (so `expectSessionBUntouched` stays honest either way) and COUNTS those reads. The count is the assertion that a guarded verb never reached its own re-read, which no copy assertion can prove on its own.
- **Files modified:** `packages/web/tests/operator.spec.ts`
- **Verification:** Both rows fail by assertion under the shipped defect (`expected 'Advertising paused.' to be undefined`, `expected undefined to be 'draft-b'`), never by timeout.
- **Committed in:** `95309b6` (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (1 bug, 1 blocking, 1 missing critical)
**Impact on plan:** All three were mechanical corrections inside the plan's own scope. No scope creep, no new field, no new surface, no route.

## Mutation checks, with the observed output

The plan required each change to be proven load-bearing by reverting it and observing the named rows red. All three were run.

**Task 1: the comparison removed from `advertise` alone.**

```
Tests  4 failed | 103 passed (107)
FAIL > advertise discards an OK answer issued by an ENDED session rather than navigating the NEW one
FAIL > advertise discards a REFUSED (409) answer issued by an ENDED session
FAIL > advertise discards an UNREACHABLE answer issued by an ENDED session
FAIL > advertise discards a DECLINED answer issued by an ENDED session
```

Exactly the four new advertise rows. Every shipped advertise row stayed green (the WR-12 block's 401, 409, 404, unreachable and success rows, and the drill-down landing row), and the readvertise inverted row stayed green, which is what makes the rows per-site rather than satisfied in bulk. Restored:

```
Tests  107 passed (107)
```

**Task 2: the comparison removed from `cancelCohort` alone.**

```
Tests  2 failed | 116 passed (118)
FAIL > cancelCohort discards an UNREACHABLE answer issued by an ENDED session
FAIL > follows every capture with a comparison against the captured round, before the next capture
  AssertionError: expected [ 7 ] to deeply equal []
```

That verb's own row plus the enumeration row, which named segment 7 (`cancelCohort`) and nothing else. Every other verb's rows stayed green. The enumeration row's earlier RED against the shipped tree named all nine unguarded verbs at once (`[ 0, 2, 5, 6, 7, 8, 9, 10, 11 ]`), which is `runAdvertisingToggle`, `saveDraftEdit`, `discard`, `exportCohort`, `cancelCohort`, `finalizeCohort`, `addTestPeers`, `disableBroadcast` and `dismissEnded`. Restored:

```
Tests  118 passed (118)
```

**Task 3: the factory returning one shared module-scope object.**

```
Tests  2 failed | 118 passed (120)
FAIL > hands each session end its OWN containers, so one reset can never reach another (review IN-18)
FAIL > hands an EXPIRY and a SIGN-OUT containers of their own too (review IN-18)
```

And the parity row run alone under the same mutation:

```
Tests  1 passed | 119 skipped (120)
```

That is the finding's whole point recorded as an observation: the shipped parity row compares two states with `toEqual`, a VALUE comparison, so it passes identically whether the two resets share containers or not. The property was invisible to the suite by construction, which is why the new rows assert by reference. Restored:

```
Tests  120 passed (120)
```

## Verification

| Check | Result |
|---|---|
| `pnpm test` | 68 files, **1371 tests**, green (round baseline: 68 files / 1348 tests, so +23 and nothing lowered) |
| `pnpm lint` | green |
| `pnpm --filter @btcr2-aggregation/web build` | green |
| `pnpm --filter @btcr2-aggregation/web exec tsc --noEmit` | clean |
| `pnpm vitest run packages/web/tests/operator.spec.ts` | 120 passed (was 97) |
| `grep -c "auth === 'logged-in'" packages/web/src/stores/operator.ts` | `1`, inside `askingRound` |
| `git diff --stat packages/service` | empty |
| `git diff --stat pnpm-lock.yaml` | empty |
| `grep -rlP '\x{2014}'` over both touched files | no files |
| Shipped copy constants | `ADVERTISED_OK`, `READVERTISED_OK`, `ADVERTISE_FAILED`, `READVERTISE_FAILED`, `ACTION_FAILED`, `actionFailedWith`, `DISCARD_FAILED`, `EXPORT_FAILED`, `PAUSED_OK`, `RESUMED_OK`, `SESSION_EXPIRED`, `UNREACHABLE` all byte-identical |

`pnpm e2e:gate` was deliberately not run here. It runs once for the round at the end of 05-44, which is the only plan touching `packages/service`, and 05-44 is serialized after this plan so it covers these web changes. The reasoning is recorded in 05-44 rather than skipped silently.

## Prohibitions held

- No shipped copy changed, no store field added, no rendered surface, component or route added.
- Nothing on the wire: no session round, no session identifier, no abort controller, no request cancellation. The guard makes a late answer harmless rather than preventing it, which is what both shipped precedents do.
- No test deleted or loosened, and no assertion edited in any shipped row. The one reshape the plan allowed (correcting a comment that described the retired status comparison) was not needed: no shipped row's comment described it.
- The retired status-as-identity token is not spelled inside any comment in `packages/web/src/stores/operator.ts`, so the enumeration row's count is not defeated by prose.
- `probe`, `signIn`, `sessionProbe` and `CreateDraftResult` are untouched. WR-14, WR-15 and IN-15 belong to 05-43.
- `.planning/REQUIREMENTS.md` untouched; no claim made against the 16 pending human items in `05-UAT.md`.
- No package added.

## Issues Encountered

None beyond the three deviations recorded above, each resolved inside its own task.

## Known Stubs

None. This plan added guards to shipped branches and turned one shipped constant into a function; nothing was placeholdered.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Ready for **05-43**, which is serialized after this plan and has a genuine file dependency on it: both amend methods in `packages/web/src/stores/operator.ts` and both add rows to `packages/web/tests/operator.spec.ts`. 05-43 closes WR-14 (`submitDraft` as the enumerated sixteenth gated call site, which will require raising `CAPTURE_SITES` in the enumeration row from 15 to 16, a deliberate decision the row exists to force), WR-15 (the 5xx probe narrating an expiry that never happened) and IN-15.

One note for 05-43's executor: the enumeration row in `packages/web/tests/operator.spec.ts` states `CAPTURE_SITES = 15` and asserts a comparison after every capture. Adding `submitDraft`'s capture will turn that row red until the figure is updated, which is the intended behavior and not a regression.

---
*Phase: 05-operator-cohort-lifecycle-control*
*Completed: 2026-08-04*

## Self-Check: PASSED

- `packages/web/src/stores/operator.ts` present on disk (modified, not created).
- `packages/web/tests/operator.spec.ts` present on disk (modified, not created).
- Commits verified present: `bcd78f6`, `95309b6`, `fd84382`.
- All task `<acceptance_criteria>` re-run and passing; plan-level `<verification>` commands re-run and recorded in the Verification table above.
