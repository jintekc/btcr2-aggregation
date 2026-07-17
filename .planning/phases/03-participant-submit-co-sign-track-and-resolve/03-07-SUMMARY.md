---
phase: 03-participant-submit-co-sign-track-and-resolve
plan: 07
subsystem: web/participant-store
tags: [gap-closure, participant, completion-tail, race-condition, mode-honesty]
requires: [03-05, 03-06]
provides:
  - anchorSummaryState (pure mode-honest anchor narration selector)
  - postSeatGoneStreak consecutive-gone guard on handlePostSeatSnapshot
  - shouldAutoResolve fires on enabled+failed (failed broadcast reaches resolve)
  - four-way honest Signed-line copy in CompletionSummary
affects:
  - packages/web/src/stores/participant.ts
  - packages/web/src/components/cohort/CompletionSummary.tsx
tech-stack:
  added: []
  patterns:
    - "Consecutive-confirmation streak guard so a racing SSE wins a directory-drop race"
    - "Pure exported selector maps every anchor read to one honest narration state"
key-files:
  created: []
  modified:
    - packages/web/src/stores/participant.ts
    - packages/web/src/stores/participant.spec.ts
    - packages/web/src/components/cohort/CompletionSummary.tsx
decisions:
  - "POST_SEAT_GONE_CONFIRMATIONS = 2: one gone read is ambiguous (completion may be racing on the SSE channel), so require a second consecutive gone read before declaring the cohort dead (CR-01)."
  - "shouldAutoResolve fires on enabled+failed too: a terminally failed live broadcast still reaches a resolve outcome (not-reflected/retry) rather than freezing the participant (WR-01/D-28)."
  - "anchorSummaryState is a four-way pure selector (anchored/broadcasting/broadcast-failed/hermetic); the 'no-broadcast service' copy appears only in the hermetic branch (WR-01/D-07)."
metrics:
  duration: 3 min
  completed: 2026-07-17
status: complete
---

# Phase 3 Plan 07: Participant Completion Tail Gap Closure Summary

Closed the two review-confirmed correctness/honesty gaps in the Phase 3 participant completion tail: CR-01 (a single post-seat directory-gone read false-failing a genuine success) and WR-01 (the completion summary claiming a live service does not broadcast when its beacon tx was merely pending or failed), with a consecutive-gone streak guard, a new pure `anchorSummaryState` selector, a failed-broadcast auto-resolve path, a four-way honest Signed-line branch, and unit tests pinning all of it.

## What Was Built

### Task 1: Race-free post-seat completion guard (CR-01)
- Added module-scope `postSeatGoneStreak` counter and `POST_SEAT_GONE_CONFIRMATIONS` (= 2) next to `postSeatFailures`.
- `handlePostSeatSnapshot` now increments the streak on a directory-gone read and only calls `fail("The cohort ended and this service didn't say why.")` once the streak reaches the threshold. A single gone read returns without failing (an info log notes a completion may still be arriving), so a racing `cohort-complete` SSE tears the poll down (`teardownLive -> clearPostSeatPoll`, which resets the streak and bumps `postSeatEpoch`) and wins the directory-drop race. A present read resets the streak.
- `clearPostSeatPoll` resets `postSeatGoneStreak = 0` so each round and each completion teardown starts clean.

### Task 2: Mode-honest anchor selector + failed broadcast reaches resolve (WR-01, store)
- Added exported pure `anchorSummaryState(anchor): 'anchored' | 'broadcasting' | 'broadcast-failed' | 'hermetic'`, replacing the two-way anchored-or-hermetic collapse. `hermetic` only when `!enabled`; `anchored` on enabled+broadcast/confirmed; `broadcast-failed` on enabled+failed; `broadcasting` otherwise (enabled+none).
- `shouldAutoResolve` now returns true on enabled+`failed` as well as enabled+`confirmed`, so a terminally failed live broadcast still reaches a resolve outcome instead of freezing (the existing `trackAnchor` freeze logic already freezes on failed and evaluates auto-resolve before the freeze, so resolve fires exactly once).

### Task 3: Four-way honest Signed-line copy in CompletionSummary (WR-01, UI)
- Imported `anchorSummaryState` (extension-less web-package style) and replaced the two-way Signed-line paragraph branch with a four-way branch keyed on its return: distinct honest copy for `broadcasting` and `broadcast-failed`, unchanged copy for `anchored` and `hermetic`. The "no-broadcast service" copy appears only in the hermetic branch. The heading, k-of-n fallback block, non-inclusion block, and round-trip block are unchanged.

## Verification Results
- `pnpm test`: 364 passed (27 files) - up from 357, with the 7 new/changed store tests green (streak tests, `anchorSummaryState` describe, `shouldAutoResolve` failed case) and no regressions.
- `pnpm --filter @btcr2-aggregation/web build`: clean (tsc --noEmit + vite build), confirming the `anchorSummaryState` import and branch typecheck.
- Em-dash scan (U+2014) across all three modified files: 0 in each.
- Plans 03-01..03-06 and their SUMMARYs untouched.

## Deviations from Plan
None - plan executed exactly as written.

## Known Stubs
None.

## Threat Flags
None. This gap closure edits only client-side store logic and completion copy; it adds no route, no mutating/control surface, no auth surface, and no new dependency, so no new trust boundary is crossed. The plan's threat register (T-03-07-01 mitigate; T-03-07-02/03/SC accept) is satisfied: the bounded `POST_SEAT_GONE_CONFIRMATIONS` streak is pinned by the Task 1 unit tests, and no new unbounded loop or package install was introduced.

## Backstop / Deferred
- Must-have truth 5 (in a real browser on a live-configured service, the on-screen Signed-line copy narrates broadcasting and failed-broadcast states honestly and matches the StageTimeline anchor sub-steps) is a `backstop` verification: proven at the unit level here (the `anchorSummaryState` selector drives both the Signed-line branch and the timeline relabel), but the live-browser visual confirmation remains a human check carried with the phase's other deferred visual checks.

## Self-Check: PASSED
- Files: 03-07-SUMMARY.md, participant.ts, CompletionSummary.tsx all present.
- Commits: 18ea0b4, 0b560bc, a063fb6 all in git history.
