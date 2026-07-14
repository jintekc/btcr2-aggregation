---
phase: 02-participant-discovery-browse-and-pick-join
plan: 03
subsystem: web
tags: [participant, zustand, store, join-lifecycle, browse-and-pick, directory-poll]

requires:
  - phase: 02-participant-discovery-browse-and-pick-join
    provides: "plan 01's CreateParticipantOptions.cohortId (picked-cohort filter) + the public DirectoryCohortDTO / fetchDirectory shipped in Phase 1"
provides:
  - "participant store join(baseUrl, cohortId): threads the picked cohortId into createParticipant so only the chosen cohort is joined (PART-02, D-14)"
  - "reactive seated/joinClosed/pickedCohortId state; seated flips true ONLY on cohort-ready (the definitive seat, D-11)"
  - "exported pure predicate pickedCohortClosed(rows, pickedId) + store method handleDirectorySnapshot(rows) encoding the D-06/D-12 filled-or-closed transition"
  - "a bounded ~5s join-time directory poll replacing the removed JOIN_WATCHDOG_MS no-advert timer; a directory fetch error is ignored so unreachable never reads as closed"
  - "leave() resets the browse-and-pick lifecycle fields and clears the poll (D-07/D-15/D-16)"
affects: [02-04-pick-and-join, participant-store, JoinIdentityStep, BrowseView]

tech-stack:
  added: []
  patterns:
    - "Directory-authoritative join outcome: the public /v1/directory poll drives the negative (filled/closed), cohort-ready drives the positive (seated); no fixed timer, no protocol accept/reject signal exists"
    - "cohort-ready (not cohort-joined) is the seat authority: cohort-joined = opt-in SENT, seated flips only on cohort-ready"
    - "Fetch-error-is-not-closed: handleDirectorySnapshot runs only on a SUCCESSFUL poll; a poll error is swallowed so an unreachable service is a distinct state from a closed cohort"

key-files:
  created: []
  modified:
    - packages/web/src/stores/participant.ts
    - packages/web/src/stores/participant.spec.ts
    - packages/web/src/components/participant/KeyGenPanel.tsx

key-decisions:
  - "handleDirectorySnapshot reuses the existing fail() terminal path and adds joinClosed:true, so the filled/closed case shares the same teardown/step-fail machinery as any other failure while remaining a distinct, labelled cause."
  - "The join-time poll imports the EXISTING public fetchDirectory (credentials:'omit') from lib/operator, not plan 02's lib/directory, keeping plan 03 independent of the same-wave plan 02 and never sending the operator session cookie from the participant flow (T-02-05)."
  - "The orphaned KeyGenPanel standalone Join/Retry buttons were disabled (Rule 3 blocking auto-fix): the retired context-free entry cannot satisfy the now-required cohortId; browse-and-pick supplies it and plan 04 extracts the identity-acquisition portion into JoinIdentityStep."

requirements-completed: [PART-02]

coverage:
  - id: D1
    description: "pickedCohortClosed is Advertised-only: false when the picked cohort is present and Advertised, true when it is absent or has advanced past Advertised (membership locked)"
    requirement: "PART-02"
    verification:
      - kind: unit
        ref: "packages/web/src/stores/participant.spec.ts#pickedCohortClosed"
        status: pass
    human_judgment: false
  - id: D2
    description: "handleDirectorySnapshot resolves the join deterministically: a picked cohort that leaves the Advertised set before seating yields status failed + joinClosed true + a filled-or-closed message; once seated it is a no-op; a still-Advertised snapshot stays live"
    requirement: "PART-02"
    verification:
      - kind: unit
        ref: "packages/web/src/stores/participant.spec.ts#handleDirectorySnapshot"
        status: pass
    human_judgment: false
  - id: D3
    description: "join(baseUrl, cohortId) threads the picked cohortId into createParticipant, seated flips only on cohort-ready, the JOIN_WATCHDOG_MS timer is fully removed, and the join-time directory poll drives the outcome"
    requirement: "PART-02"
    verification:
      - kind: unit
        ref: "grep: JOIN_WATCHDOG_MS==0, joinWatchdog==0, join(baseUrl, cohortId) present, seated flip in cohort-ready handler; tsc --noEmit clean"
        status: pass
    human_judgment: false

duration: 12min
completed: 2026-07-14
status: complete
---

# Phase 2 Plan 03: Store join lifecycle for browse-and-pick Summary

**Rewired the browser participant store's join lifecycle to browse-and-pick: `join(baseUrl, cohortId)` threads the picked cohort into `createParticipant`, `cohort-ready` (not `cohort-joined`) is the definitive `seated` signal, and the vague `JOIN_WATCHDOG_MS` no-advert timer is replaced by a bounded ~5s `/v1/directory` poll that deterministically transitions to a distinct filled-or-closed state when the picked cohort leaves the Advertised set, while a directory fetch error is ignored so an unreachable service never masquerades as closed.**

## Performance

- **Duration:** 12 min (spanned one transient API-server interruption; RED commit and partial GREEN survived, resumed from on-disk state)
- **Started:** 2026-07-14T16:29Z (approx)
- **Completed:** 2026-07-14T16:41Z (approx)
- **Tasks:** 1 (TDD: RED test -> GREEN implementation)
- **Files modified:** 3

## Accomplishments
- `join(baseUrl, cohortId)`: the store now takes the picked `cohortId`, resets `seated`/`joinClosed`, sets `pickedCohortId`, and calls `createParticipant({ identity, baseUrl, cohortId })` so the runner opts into the chosen cohort alone (PART-02, D-14).
- `cohort-ready` is the sole place `seated` flips true (D-11); `cohort-joined` is documented and treated as "opted in, waiting to fill" and never sets `seated` (RESEARCH Pitfall 3).
- Removed `JOIN_WATCHDOG_MS`, the `joinWatchdog` timer, and `clearWatchdog` entirely; added a bounded `setInterval(~5000ms)` join-time poll of the public `fetchDirectory` that calls `handleDirectorySnapshot` on success and swallows the error on failure (D-06/D-12). Added the exported pure `pickedCohortClosed(rows, pickedId)` (Advertised-only) and the `handleDirectorySnapshot(rows)` store method that drives the filled-or-closed terminal state (`status:'failed'`, `joinClosed:true`, "That cohort just filled or closed. Pick another from the directory.") and tears the runner down; it is a no-op once seated.
- `leave()` now resets `seated`/`joinClosed`/`pickedCohortId` and clears the poll; the reactive fields default false/false/null in the initial state, `adopt()`, and `leave()` (D-07/D-15/D-16, no new seat-release protocol).
- Extended the store spec with a hermetic browse-and-pick describe block (pickedCohortClosed present/absent/past-Advertised; the closed transition; the seated no-op; the still-Advertised stays-live case).

## Task Commits

1. **Task 1 (RED): failing store spec** - `d980628` (test)
2. **Task 1 (GREEN): join(baseUrl, cohortId) + cohort-ready seat + directory-driven outcome** - `fbd800c` (feat)

_TDD task produced a test commit then a feat commit; no refactor commit was needed._

## Files Created/Modified
- `packages/web/src/stores/participant.ts` - `join(baseUrl, cohortId)` signature + `createParticipant({...cohortId})`; new `seated`/`joinClosed`/`pickedCohortId` fields (interface + initial + adopt/join/leave resets); `seated:true` in the cohort-ready handler; removed the watchdog constant/timer/clear + the "joins EVERY advert" stale comment; added `pickedCohortClosed` (exported) + `handleDirectorySnapshot` (store method) + the ~5s directory poll; imports `fetchDirectory` + `DirectoryCohortDTO` from `../lib/operator`.
- `packages/web/src/stores/participant.spec.ts` - added the browse-and-pick outcome describe block (6 new cases), importing `pickedCohortClosed` and `DirectoryCohortDTO`.
- `packages/web/src/components/participant/KeyGenPanel.tsx` - disabled the orphaned standalone Join/Retry buttons and dropped the now-unused `join` selector (see Deviations, Rule 3).

## Decisions Made
- **Reuse `fail()` for the closed transition.** `handleDirectorySnapshot` sets `joinClosed:true` then calls the existing `fail(message)`, so the filled/closed case shares the teardown + active-step-fail machinery while carrying a distinct, labelled cause and message.
- **Import the existing public `fetchDirectory` from `lib/operator`** (not plan 02's `lib/directory`) so plan 03 stays independent of the same-wave plan 02; it is `credentials:'omit'`, so the participant join flow never sends the operator session cookie (T-02-05).
- **`pickedCohortClosed` is Advertised-only** (`!rows.some(r => r.cohortId === pickedId && r.phase === 'Advertised')`), matching the RESEARCH Finding 3 semantic that a cohort accepts new members only while Advertised (it locks at threshold the instant it leaves).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Orphaned KeyGenPanel broke tsc under the required two-arg `join`**
- **Found during:** Task 1 (GREEN)
- **Issue:** The plan scoped edits to `participant.ts` + `participant.spec.ts`, but changing `join` to the required `join(baseUrl, cohortId)` broke the two context-free `join(baseUrl)` calls in the now-orphaned `KeyGenPanel.tsx` (unrendered since plan 02's App.tsx restructure, but still compiled by the web `tsc --noEmit` over `include: ["src"]`). The plan's own acceptance criterion requires `tsc --noEmit` to exit 0.
- **Fix:** Disabled the two legacy standalone Join/Retry buttons and removed the unused `join` selector, with a comment that the context-free entry is retired (browse-and-pick now supplies the cohortId; plan 04 extracts the identity-acquisition portion into `JoinIdentityStep`). `KeyGenPanel`/`ParticipantView` remain on disk as the reference plan 04 reads. No runtime impact: both files are unrendered dead code.
- **Files modified:** packages/web/src/components/participant/KeyGenPanel.tsx
- **Verification:** `pnpm --filter @btcr2-aggregation/web exec tsc --noEmit` exits 0; eslint clean on the file.
- **Committed in:** `fbd800c` (part of the GREEN task commit)

---

**Total deviations:** 1 auto-fixed (1 blocking). **Impact:** Minimal and within the intended direction; the disabled buttons live in dead code plan 04 refactors, and the shipped store behavior is exactly as the plan specified. No scope creep.

## Issues Encountered
- **Transient API-server interruption mid-GREEN.** A server error cut the session off while replacing the watchdog arm; the RED commit (`d980628`) and the partial `participant.ts` edits survived on disk. Resumed by re-reading the current file, finishing the watchdog removal + `handleDirectorySnapshot` + poll wiring, and verifying `tsc --noEmit` clean + the 9-test spec green. No work lost.
- **Single most-recent advert slot (carried from 02-01/02-02).** Unchanged here: the join-time poll and outcome use `/v1/directory` (the HTTP source of truth over all live cohorts), which is unaffected by the SSE advert slot. Plan 04's post-pick UX should still tolerate the advert-republish latency for a non-latest picked cohort when the runner opts in.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The store is now the single browse-and-pick lifecycle owner: `join(baseUrl, cohortId)` / `leave()` / `seated` / `joinClosed` / `pickedCohortId` / the deterministic filled-or-closed message are all ready for plan 04 to wire onto `CohortRow`'s Join affordance + the inline `JoinIdentityStep` + the seated confirmation + the reused tail (D-11).
- Plan 04 supplies the picked cohortId from the directory row and reads `seated`/`joinClosed` for the confirmation / retry-to-browse UX.
- No blockers.

## Self-Check: PASSED

- Modified files exist on disk: `packages/web/src/stores/participant.ts`, `packages/web/src/stores/participant.spec.ts`, `packages/web/src/components/participant/KeyGenPanel.tsx`, and this SUMMARY.
- Task commits exist: `d980628` (test/RED), `fbd800c` (feat/GREEN).
- Plan verification re-run green: `pnpm vitest run packages/web/src/stores/participant.spec.ts` (9 pass), `pnpm --filter @btcr2-aggregation/web exec tsc --noEmit` exit 0, eslint clean on the three touched files.
- Acceptance greps: `JOIN_WATCHDOG_MS`==0, `joinWatchdog`==0, `handleDirectorySnapshot`>=1, `pickedCohortClosed`>=1, `seated`>=1, `fetchDirectory`>=1, `join(baseUrl, cohortId)` present, `seated:true` only in the cohort-ready handler.

---
*Phase: 02-participant-discovery-browse-and-pick-join*
*Completed: 2026-07-14*
