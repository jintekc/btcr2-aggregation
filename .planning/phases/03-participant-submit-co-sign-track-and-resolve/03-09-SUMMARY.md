---
phase: 03-participant-submit-co-sign-track-and-resolve
plan: 09
subsystem: web (participant store + completion view)
tags: [mode-honesty, anchor-narration, gap-closure, PART-04, Truth-8]
requires:
  - 03-08 (StageTimeline state-driven final-row label + 'checking' selector member)
provides:
  - anchorSummaryState reserves 'anchored' for state === 'confirmed' only
  - deriveStage reserves the 'anchored' Stage for state === 'confirmed' only
  - CompletionSummary heading boolean reserves "Anchored" for state === 'confirmed' only
affects:
  - packages/web/src/stores/participant.ts
  - packages/web/src/components/cohort/CompletionSummary.tsx
  - StageTimeline.tsx (auto-corrects via the selector, no source edit)
tech-stack:
  added: []
  patterns:
    - Single pure render authority (deriveStage) + pure narration selector (anchorSummaryState)
key-files:
  created: []
  modified:
    - packages/web/src/stores/participant.ts
    - packages/web/src/stores/participant.spec.ts
    - packages/web/src/components/cohort/CompletionSummary.tsx
decisions:
  - "Reserve the 'anchored' value (and 'anchored' Stage) for state === 'confirmed' only in both pure selectors; route state === 'broadcast' into the existing honest 'broadcasting' narration / 'signed' Stage."
metrics:
  duration: 1 min
  completed: 2026-07-20
  tasks: 2
  files: 3
status: complete
---

# Phase 03 Plan 09: Anchor-Honesty Truth 8 Gap Closure Summary

Reserved the "anchored" narration for a confirmed (mined) beacon tx only, across both pure store selectors and the CompletionSummary heading boolean, so a broadcast-but-unconfirmed anchor is never narrated as "Anchored" while AnchorSubSteps shows "Confirmed: pending" - closing the last reachable Phase 3 mode-honesty contradiction (03-VERIFICATION.md Truth 8).

## What Was Built

The single `state === 'broadcast' -> anchored` conflation lived in three surfaces, all corrected to `state === 'confirmed'`:

- `anchorSummaryState(anchor)` (participant.ts): the 'anchored' branch narrowed from `confirmed || broadcast` to `confirmed` only; `state === 'broadcast'` now falls through to `return 'broadcasting';` alongside `state === 'none'`. This drives the StageTimeline final-row label and the CompletionSummary narration paragraph, both of which now read the honest "Broadcasting the beacon transaction..." copy for the broadcast window.
- `deriveStage(state)` (participant.ts): the complete-cohort 'anchored' Stage narrowed from `enabled && (confirmed || broadcast)` to `enabled && confirmed` only; a broadcast-but-unconfirmed complete cohort now returns the `'signed'` Stage, so the persistent "Your cohort · {stage}" chip and the timeline row position stay "Signed" while the tx is unconfirmed.
- CompletionSummary's `anchored` boolean: narrowed to `Boolean(anchor?.enabled && anchor.state === 'confirmed')`, so the completion-card heading reads "Anchored" only once the tx is mined.

`StageTimeline.tsx` needed no source edit: its final-row label already reads `anchorSummaryState(anchor) === 'anchored'` (03-08) and AnchorSubSteps already computes `confirmed = anchor.state === 'confirmed'`, so both auto-corrected via the selector fix. `shouldAutoResolve` was intentionally left untouched (still excludes 'broadcast'), so auto-resolve timing is unchanged and the accepted IN-03 never-confirms edge is preserved.

The spec was re-pinned to assert the honest values: the `anchorSummaryState` broadcast case now asserts `'broadcasting'`, the `deriveStage` broadcast case now asserts the `'signed'` Stage, and both confirmed cases still assert `'anchored'`. The contradiction is no longer encoded as tested behavior.

## Tasks Completed

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | Reserve 'anchored' for confirmed only in both store selectors + re-pin spec | f53c0da | participant.ts, participant.spec.ts |
| 2 | Align CompletionSummary heading boolean to confirmed-only | 3f8cc3d | CompletionSummary.tsx |

## Verification

- `pnpm test` passes: 364 tests, 27 files green (root `tsc -b && vitest run`), including the updated broadcast -> 'broadcasting' / 'signed' cases, the retained confirmed -> 'anchored' cases, and the unchanged `shouldAutoResolve({ ..., state: 'broadcast' }) -> false` regression guard.
- `pnpm --filter @btcr2-aggregation/web build` clean (tsc --noEmit + vite build, 693 modules), confirming the unchanged StageTimeline still type-checks against the corrected selector and the narrowed heading boolean.
- No em-dash character (U+2014) in any modified file: `grep -cP '\x{2014}'` returns 0 for participant.ts, participant.spec.ts, and CompletionSummary.tsx.

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check: PASSED

- Files modified exist: participant.ts, participant.spec.ts, CompletionSummary.tsx (all FOUND).
- Commits exist: f53c0da (FOUND), 3f8cc3d (FOUND).
