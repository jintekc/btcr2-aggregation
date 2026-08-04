---
phase: 05-operator-cohort-lifecycle-control
plan: 43
subsystem: ui
tags: [zustand, react, session-identity, operator-console, vitest]

requires:
  - phase: 05-operator-cohort-lifecycle-control
    provides: "05-42's every-branch round guards at the eleven gated action verbs, gatedSliceReset(), and the source-walk enumeration row that states the gated capture count"
  - phase: 05-operator-cohort-lifecycle-control
    provides: "the askingRound / stillAsking / expireIfStillAsking trio and the ABA test harness in packages/web/tests/operator.spec.ts"
provides:
  - "cohort creation as the enumerated sixteenth gated call site, taking the one honest re-login path on a 401"
  - "a probe answer vocabulary that tells a service which refused the cookie from a service that could not answer"
  - "probeUnreachable(), the one no-expiry-claim path shared by the unreachable answer and the probe's catch"
  - "a probe session-START branch that starts a session only when no boundary was crossed since it asked"
  - "a trio docstring whose stated exemption matches the exemption the store actually takes"
affects: [operator-console, session-identity, future-gap-rounds]

actuals:
  tokens: 9400
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "widen the CLIENT function's answer vocabulary rather than special-casing the store: a distinction collapsed at the client function cannot be recovered downstream"
    - "leave the consuming enum (OperatorAuthStatus) un-widened on purpose, so tsc enforces that every new member is mapped explicitly"
    - "one shared helper for a no-claim path, because two copies of it is two places for a claim to creep back in"
    - "capture a round directly off the store where the helper's own precondition (a live session) is the thing being guarded against"

key-files:
  created: []
  modified:
    - packages/web/src/lib/operator.ts
    - packages/web/src/stores/operator.ts
    - packages/web/tests/operator.spec.ts

key-decisions:
  - "CreateDraftResult gained the unauthorized member and createDraft checks 401 before the 201 branch, mirroring updateDraft's ordering; the UpdateDraftResult docstring sentence claiming create did not need it was corrected in the same change."
  - "SessionState gained 'unreachable' while OperatorAuthStatus deliberately did NOT, so the compiler forced the store to map the new answer rather than passing it through as a rendered auth posture."
  - "The gated slice is still cleared on an unreachable probe, deliberately and on the record (T-05-43-04). What changed is only the CLAIM made about why."
  - "probe captures its round directly off the store rather than through askingRound, because that helper answers undefined unless a session is live and the guarded branch is precisely the one that runs when none is."
  - "The trio docstring now names all sixteen sites explicitly, because an enumeration that omits a site is worse than no enumeration: a reader cannot tell the omission from a decision."

patterns-established:
  - "When a plan gives an existing branch new power, re-read the inputs that branch has always accepted as if they were new (the WR-15 lesson)."
  - "A written enumeration is a testable claim, so the round that raises one raises the counting row rather than editing prose."

requirements-completed: [SVC-04]

coverage:
  - id: D1
    description: "A 401 on cohort creation takes the one honest re-login path and never renders the service's authentication denial in the create form's validation slot (WR-14)."
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#submitDraft routes a 401 create through the ONE honest re-login path, never the form error slot"
        status: pass
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#submitDraft discards a 401 issued by an ENDED session"
        status: pass
    human_judgment: false
  - id: D2
    description: "The create form still renders the service's own 400 validation copy verbatim and still completes a successful create, so the 401 fix narrowed nothing else."
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#submitDraft STILL renders the service's own 400 message in the create form slot"
        status: pass
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#submitDraft STILL clears the form and re-reads the list when the create succeeds"
        status: pass
    human_judgment: false
  - id: D3
    description: "The enumeration counts sixteen gated capture sites in the shipped source, each followed by a comparison, so a seventeenth cannot be added silently."
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#captures the asking session at exactly the stated number of gated call sites"
        status: pass
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#follows every capture with a comparison against the captured round, before the next capture"
        status: pass
    human_judgment: false
  - id: D4
    description: "sessionProbe tells a 401 apart from a 5xx: 200 is live, 404 is disabled, 401 is refused, and every other status is unreachable."
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#returns \"logged-out\" on 401, the ONE answer that proves the service refused the cookie"
        status: pass
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#returns \"unreachable\" on 500, 502 and 503, which prove nothing about the session"
        status: pass
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#returns \"disabled\" on 404 (the fail-closed boot answer, D-07)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Only a 401 ends an operator session: a 502 probe on a live console leaves the unreachable copy and makes no expiry claim, while a 401 probe still expires with the session-expired copy (WR-15)."
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#makes NO expiry claim when the probe answers 502, on a console holding a live session"
        status: pass
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#ends NOTHING and takes NO round when a 500 probe lands on a console holding no session"
        status: pass
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#ends the session it discovers has ended, clearing the whole gated slice"
        status: pass
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#clears the slice on a transport FAULT without ever claiming an expiry"
        status: pass
    human_judgment: false
  - id: D6
    description: "A probe answer landing after a session boundary cannot re-establish a session the service already refused, while a boundary-free probe still starts one (IN-15)."
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#starts NO session when a probe answers LIVE after a 401 already ended the one it asked in (review IN-15)"
        status: pass
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#still gives a RETURNING session a fresh round after a probe ended the previous one"
        status: pass
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#takes EXACTLY one round when two overlapping probes find a session on a console holding none"
        status: pass
    human_judgment: false
  - id: D7
    description: "In a real browser, an operator whose session expired while the New cohort form was open sees the login screen with the session-ended copy on submit rather than a red validation line, and an operator whose service returns a 502 for one poll sees the unreachable line."
    requirement: SVC-04
    verification: []
    human_judgment: true
    rationale: "A rendered cross-session browser walk with real proxy timing. The store and client contracts are pinned hermetically above; whether the console reads this way to a human belongs to the owner's 05-UAT.md walk, not to a vitest row."

duration: 9 min
completed: 2026-08-04
status: complete
---

# Phase 05 Plan 43: A 401 is the only answer that ends an operator session

**Cohort creation became the enumerated sixteenth gated call site instead of rendering the service's own authentication denial as form validation, the session probe learned to tell a service that refused the cookie from a service that could not answer, and a probe answer can no longer re-establish a session the service already refused.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-08-04T13:20:31Z
- **Completed:** 2026-08-04T13:29:47Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments

- `CreateDraftResult` carries the `unauthorized` member `UpdateDraftResult` always had, `createDraft` checks 401 ahead of the 201 branch, and `submitDraft` routes it through the one shared expiry path with the round guard over its remaining branches and its `catch`. The service's `operator authentication required` string can no longer reach the slot that otherwise holds `Cohort size must be at least 1 signer.`
- The trio and `sessionRound` docstrings now state sixteen sites and name every one of them, and 05-42's counting row was raised from fifteen to sixteen by strengthening the expected figure, never by relaxing the assertion.
- `SessionState` gained `unreachable` and `sessionProbe` maps 401 apart from every other unexpected status. `OperatorAuthStatus` deliberately did not gain a member, so `tsc` refused to compile until the store mapped the new answer explicitly.
- `probeUnreachable()` holds the one no-expiry-claim path, called by the probe's new `unreachable` answer and by its existing `catch`. A 502 from a reverse proxy now leaves the unreachable line instead of narrating an expiry the service never claimed.
- `probe` captures its round before the await, read directly off the store, and starts a session only when no boundary was crossed since it asked. The trio docstring's exception paragraph now states what remains exempt and what carries its own capture.

## Task Commits

1. **Task 1: cohort creation as the sixteenth gated call site (WR-14)** - `14f235b` (fix)
2. **Task 2: only a 401 ends a session; a 5xx probe freezes (WR-15)** - `f337ee9` (fix)
3. **Task 3: a probe cannot re-establish an ended session (IN-15)** - `f36a3cc` (fix)

## Files Created/Modified

- `packages/web/src/lib/operator.ts` - the third `CreateDraftResult` member and `createDraft`'s 401 branch, the corrected `UpdateDraftResult` docstring, the widened `SessionState` and the four-case `sessionProbe` mapping.
- `packages/web/src/stores/operator.ts` - `submitDraft` rebuilt on the `saveDraftEdit` shape, the new module-scope `probeUnreachable` helper, `probe`'s unreachable branch and its own round capture and start-branch guard, plus the three docstring corrections (trio enumeration, trio exception paragraph, `sessionRound` figure).
- `packages/web/tests/operator.spec.ts` - a `sessionProbe` per-status block beside the shipped `fetchCohortDetail` block, four create rows in the gated-action block with a create-versus-list stub, two probe status rows, the phantom-session row, and the raised capture count.

## Decisions Made

- **The 401 is checked before the 201 branch in `createDraft`**, matching `updateDraft`'s ordering rather than inventing one. A 401 body is not a validation body, and checking status before shape is what keeps that true.
- **The `UpdateDraftResult` docstring was corrected in the same change that made it false.** This phase has spent three rounds on facts stated in more than one place drifting apart; the sentence now gives the one reason both results carry the member.
- **`SessionState` was widened rather than the store special-casing the status.** The store cannot recover a distinction the client function already collapsed, so any repair inside `probe` would have been guessing. `fetchCohortDetail` is the shipped precedent one file away.
- **`OperatorAuthStatus` deliberately did NOT gain `unreachable`.** The widened state belongs to the probe's answer vocabulary, not to the console's rendered posture, and leaving the consuming enum alone is what made the compiler the first enumeration proof.
- **`probeUnreachable` takes `set` and `get` as a module-scope helper**, following the `runAdvertisingToggle` precedent, rather than the two statements being copied into both callers. Two copies of a no-expiry-claim path is two places for an expiry claim to creep back in, and WR-15 is what one such divergence cost.
- **`probe` reads `sessionRound` directly rather than calling `askingRound`.** The helper answers `undefined` unless a session is live, and the guarded branch is exactly the one that runs when none is, so routing through it would have produced an always-undefined capture and a guard that never fires. The comment says so, because the next reader will otherwise try to make this consistent with the other sixteen sites.

## Deviations from Plan

None - plan executed exactly as written.

## Mutation checks, with the observed output

Each change was proven load-bearing by reverting it, observing the named rows RED, and restoring.

**Task 1: the `unauthorized` branch dropped from `submitDraft`.**

```
FAIL > submitDraft routes a 401 create through the ONE honest re-login path, never the form error slot
      Tests  1 failed | 123 passed (124)
```

One row rather than two, and the reason is worth recording rather than glossing: the ABA row (`submitDraft discards a 401 issued by an ENDED session`) stayed GREEN under this mutation, because the round guard added in the same task independently discards a dead session's answer before it can write. That is the two-layer property working as designed, not a weak row: the same-session row is what proves the expiry happens at all, and the ABA row is what proves it is scoped. The 400 control stayed green throughout, which is the half that proves the fix did not route every non-201 to the expiry path. Restored:

```
      Tests  124 passed (124)
```

Before the fix, the same rows had failed with the harm stated literally:

```
- Expected: undefined
+ Received: "operator authentication required"
```

**Task 2: the unexpected statuses mapped back to the logged-out value.**

```
FAIL > sessionProbe status contract (review WR-15) > returns "unreachable" on 500, 502 and 503, which prove nothing about the session
FAIL > operator store probe-discovered session end (review CR-03) > makes NO expiry claim when the probe answers 502, on a console holding a live session
      Tests  2 failed | 128 passed (130)
```

The shipped 401 expiry row stayed green under the mutation, which is the anti-vacuity control that makes the distinction observable rather than the whole branch simply being disabled. The RED against the shipped tree, before any fix, reproduced the review's finding word for word:

```
AssertionError: expected 'Your operator session ended. Sign in …' to contain 'Could not reach the service'
Expected: "Could not reach the service"
Received: "Your operator session ended. Sign in again to keep monitoring. Monitoring rebuilds from this service's state after you sign in."
```

Restored:

```
      Tests  130 passed (130)
```

**Task 3: the comparison removed from `probe`'s session-START branch.**

```
FAIL > starts NO session when a probe answers LIVE after a 401 already ended the one it asked in (review IN-15)
      Tests  1 failed | 130 passed (131)
```

and the named control run alone under the same mutation:

```
✓ still gives a RETURNING session a fresh round after a probe ended the previous one
      Tests  1 passed | 130 skipped (131)
```

which is what proves the guard sits on the branch that needed it rather than on the branch that must keep starting sessions. Restored:

```
      Tests  131 passed (131)
```

## The compiler as the enumeration proof

The plan asked whether the web typecheck failed first on the widened union, before the store's branch was added. It did, and this is the whole reason `OperatorAuthStatus` was left alone:

```
src/stores/operator.ts(1069,15): error TS2322: Type '"logged-out" | "disabled" | "unreachable"' is not assignable to type 'OperatorAuthStatus | undefined'.
  Type '"unreachable"' is not assignable to type 'OperatorAuthStatus | undefined'.
```

Adding the branch cleared it. Had the console's auth posture been widened alongside the probe's vocabulary, the new member would have flowed straight through to a rendered status with nothing to catch it.

## Shipped probe rows: which branch each exercises, checked before Task 3 was written

The plan required these to be run and attributed rather than assumed. All were green before Task 3 and all are green after it, with no assertion edited.

| Shipped row | Branch it exercises | After Task 3 |
|---|---|---|
| `crosses ONE session boundary when two probes OVERLAP on a live session` | the CONFIRMING branch (second probe sees a live stored fact) | pass |
| `lets a list read started before TWO overlapping probes still write when it lands` | the confirming branch plus `refreshCohorts`'s own round guard | pass |
| `takes EXACTLY one round when two overlapping probes find a session on a console holding none` | the session-START branch, twice, on a console that crossed no boundary | pass |
| `narrates a deliberate SIGN-OUT landing mid-probe as a sign-out, never as an expiry` | the no-live-session `else` branch, deciding from the cleared stored fact | pass |
| `still gives a RETURNING session a fresh round after a probe ended the previous one` | the session-ended branch, then a session-START on a fresh capture | pass |
| `ends the session EXACTLY once when two overlapping probes both discover it has ended` | the session-ended branch, twice, guarded by the stored fact | pass |
| `keeps the round when a probe merely CONFIRMS the session already signed in (IN-07)` | the confirming branch, which must not take a round | pass |

The start branch's new guard is placed so that only the phantom case is refused: the third row above stages two probes on a console holding no session, both capture the same round, the first starts a session and the second falls into the confirming branch, so exactly one round is taken.

## Verification

| Check | Result |
|---|---|
| `pnpm test` | 68 files, **1382 tests**, green (round baseline 68 files / 1348 tests; 05-42 left 1371, so +11 and nothing lowered) |
| `pnpm lint` | green |
| `pnpm --filter @btcr2-aggregation/web build` | green |
| `pnpm --filter @btcr2-aggregation/web exec tsc --noEmit` | clean (after failing first on the widened union, quoted above) |
| `pnpm vitest run packages/web/tests/operator.spec.ts` | 131 passed (was 120) |
| `git diff --stat packages/service` | empty |
| `git diff --stat pnpm-lock.yaml` | empty |
| `grep -rlP '\x{2014}'` over all three touched files | no files |
| Shipped copy constants | `SESSION_EXPIRED`, `UNREACHABLE`, the create form's generic fallback and the disabled-console notice all byte-identical |

`pnpm e2e:gate` is deliberately not run here. It runs once for the round at the end of 05-44, which is serialized after this plan and therefore covers these web changes.

## Prohibitions held

- No status other than 401 can end an operator session: a 5xx, a 503 and a thrown fetch all reach `probeUnreachable`, pinned by a row per status.
- The fail-closed expiry is unweakened in all three directions: a 401 create still ends the session that asked, a 401 probe still expires with the session-expired copy, and a boundary-free probe still starts a session with a fresh round. Each has an anti-vacuity control beside it.
- No shipped copy changed. No `unreachable` member was added to `OperatorAuthStatus`. No store field was added, no rendered surface, component or route.
- Nothing on the wire: no session round, no live-session round, no session identifier, no abort controller, no request cancellation.
- No test deleted or loosened, and no shipped assertion edited. The two allowed reshapes were both taken as reshapes: 05-42's capture count rose from 15 to 16 by raising the expected figure, and the `UpdateDraftResult` docstring sentence this change made false was corrected in the same change.
- No row seeds a render through `useOperator.setState` and then asserts on it; every row drives the store or the client function directly.
- 05-42's guards, retired status comparison and `gatedSliceReset` were consumed, not revisited.
- WR-03, WR-04, WR-05, IN-01, IN-02, the endpoint verdict cache, `tx-client.ts`'s timeout, the `verdictCache` singleton, the `/cas` prototype-pollution 500, the test-peer seat cap and seat reclaim are all untouched.
- `.planning/REQUIREMENTS.md` untouched; no claim made against the 16 pending human items in `05-UAT.md`. No package added.

## Issues Encountered

One shaping problem, solved inside the task rather than as a deviation: the create call and the gated list read share the URL `/v1/operator/cohorts` and differ only in method, so the block's shipped fragment-routing stub would have handed the staged create answer to session B's own sign-in read as well, expiring the session the ABA row exists to prove survives. The create rows therefore use their own stub that routes on method and counts list reads, following the convention `stubActionCountingListReads` established in 05-42.

## Known Stubs

None. This plan added one result member, one union member, one branch per defect and one extracted helper; nothing was placeholdered.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Ready for **05-44**, the last plan of the eighth gap round, which closes IN-17 (the `operatorSurfaceMounted` fail-closed bit) and IN-16 (the `docs/DEPLOY.md:358` split) and runs `pnpm e2e:gate` once for the round. It is the only plan in the round touching `packages/service`, and it is serialized after this one, so its gate run covers these web changes.

All seven round-7 findings assigned to 05-42 and 05-43 are now closed at code level: WR-13 and IN-18 in 05-42, WR-14, WR-15 and IN-15 here. IN-16 and IN-17 remain for 05-44.

---
*Phase: 05-operator-cohort-lifecycle-control*
*Completed: 2026-08-04*

## Self-Check: PASSED

- `packages/web/src/lib/operator.ts` present on disk (modified, not created).
- `packages/web/src/stores/operator.ts` present on disk (modified, not created).
- `packages/web/tests/operator.spec.ts` present on disk (modified, not created).
- Commits verified present: `14f235b`, `f337ee9`, `f36a3cc`.
- All task `<acceptance_criteria>` re-run and passing; plan-level `<verification>` commands re-run and recorded in the Verification table above.
