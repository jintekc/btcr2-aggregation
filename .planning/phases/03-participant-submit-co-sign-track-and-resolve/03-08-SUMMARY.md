---
phase: 03-participant-submit-co-sign-track-and-resolve
plan: 08
subsystem: ui
tags: [react, zustand, anchor-narration, mode-honesty, participant]

# Dependency graph
requires:
  - phase: 03-participant-submit-co-sign-track-and-resolve
    provides: "anchorSummaryState four-way selector, CompletionSummary Signed-line, StageTimeline anchor sub-steps (03-07 WR-01 closure)"
provides:
  - "anchorSummaryState five-member selector with a neutral 'checking' pre-first-read state"
  - "StageTimeline final-row label gated on anchorSummaryState(anchor) === 'anchored' (not the enabled bit)"
  - "CompletionSummary neutral checking-window copy (Signed-line + resolve round-trip placeholder)"
affects: [phase-3-verification, phase-3-secure, phase-6-ci]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Single pure selector (anchorSummaryState) drives every anchor-narration surface (timeline header, completion Signed-line, resolve placeholder) so they cannot contradict one another"
    - "Null (pre-first-read) is a distinct neutral state, mirroring SubmitPanel's enabled === undefined 'checking' handling, never collapsed into a confirmed read"

key-files:
  created: []
  modified:
    - packages/web/src/stores/participant.ts
    - packages/web/src/stores/participant.spec.ts
    - packages/web/src/components/cohort/StageTimeline.tsx
    - packages/web/src/components/cohort/CompletionSummary.tsx

key-decisions:
  - "Added a leading 'checking' member to anchorSummaryState (returned for a null anchor before the !enabled hermetic check) instead of overloading 'hermetic', so the pre-first-read window is honestly neutral"
  - "shouldAutoResolve intentionally unchanged: it already returns false for null, so the checking window never auto-resolves (regression guard retained)"
  - "StageTimeline liveAnchor retained ONLY for the showSubSteps gate; the final-row LABEL is now state-driven so sub-steps still render for any enabled service while the header stays honest"

patterns-established:
  - "Anchor narration single-source-of-truth: every completion-view surface reads the same anchorSummaryState value at every render, so timeline header / sub-steps / Signed-line always agree"

requirements-completed: [PART-04]

coverage:
  - id: D1
    description: "anchorSummaryState returns a neutral 'checking' state for the pre-first-read (null) anchor, distinct from a confirmed no-broadcast 'hermetic' read"
    requirement: "PART-04"
    verification:
      - kind: unit
        ref: "packages/web/src/stores/participant.spec.ts#anchorSummaryState is checking before the first read"
        status: pass
      - kind: unit
        ref: "packages/web/src/stores/participant.spec.ts#anchorSummaryState is hermetic on a no-broadcast service"
        status: pass
    human_judgment: false
  - id: D2
    description: "Auto-resolve behavior is unchanged for the checking window: shouldAutoResolve(null) stays false"
    requirement: "PART-04"
    verification:
      - kind: unit
        ref: "packages/web/src/stores/participant.spec.ts#shouldAutoResolve is false before the first anchor read"
        status: pass
    human_judgment: false
  - id: D3
    description: "StageTimeline final-row header reads 'Anchored' only when anchorSummaryState(anchor) === 'anchored'; broadcasting / failed / checking keep 'Signed', matching the anchor sub-steps and the CompletionSummary in the same view"
    requirement: "PART-04"
    verification:
      - kind: automated_ui
        ref: "pnpm --filter @btcr2-aggregation/web build (tsc --noEmit + vite build)"
        status: pass
    human_judgment: true
    rationale: "The label-vs-sub-steps-vs-CompletionSummary internal consistency across broadcasting / failed / anchored / checking windows is a real-browser visual behavior (03-08 must_haves backstop truth); typecheck proves it compiles but a human must confirm the three surfaces never contradict in a live render."
  - id: D4
    description: "CompletionSummary renders neutral confirming copy (Signed-line + resolve round-trip placeholder) during the pre-first-read window; the no-broadcast copy renders only for a confirmed hermetic read"
    requirement: "PART-04"
    verification:
      - kind: automated_ui
        ref: "pnpm --filter @btcr2-aggregation/web build (tsc --noEmit + vite build)"
        status: pass
    human_judgment: true
    rationale: "The brief pre-first-read render window on a live-configured service is timing-dependent and not asserted by an existing test; a human must confirm the neutral copy shows (and the no-broadcast copy does not) during that window in a real browser."

# Metrics
duration: 5min
completed: 2026-07-19
status: complete
---

# Phase 3 Plan 08: Anchor-Narration Consistency (Truth 7 Gap Closure) Summary

**One honest anchor state across the whole completion view: a new neutral 'checking' selector member plus a state-driven StageTimeline header so the timeline label, the anchor sub-steps, and the CompletionSummary Signed-line never contradict one another.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-07-19T10:27:00Z
- **Completed:** 2026-07-19T10:30:00Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments
- Defect B (store): `anchorSummaryState` gained a leading `'checking'` member returned for a null anchor before the `!anchor?.enabled` hermetic check, so the pre-first-read window is no longer collapsed into a confirmed no-broadcast read. `shouldAutoResolve(null)` stays false (regression guard retained).
- Defect A (StageTimeline): the final-row label now reads "Anchored" only when `anchorSummaryState(anchor) === 'anchored'`, so a broadcasting or failed live service (and the checking window) keeps the honest "Signed" header while still rendering its Signed/Broadcast/Confirmed sub-steps.
- Defect B (CompletionSummary): a distinct `checking` Signed-line branch renders neutral "Confirming this service's broadcast mode." copy, and the resolve round-trip genesis-document placeholder is now gated on a confirmed `hermetic` read, so the no-broadcast copy renders only for a real `enabled:false` read.

## Task Commits

Each task was committed atomically:

1. **Task 1: Neutral 'checking' pre-first-read anchor state (store)** - `49c9dbd` (feat)
2. **Task 2: StageTimeline final-row label driven by anchorSummaryState** - `30d41c1` (fix)
3. **Task 3: Honest checking-window copy in CompletionSummary** - `510d40a` (fix)

## Files Created/Modified
- `packages/web/src/stores/participant.ts` - `anchorSummaryState` return union extended to five members with a leading `checking` guard for null; JSDoc updated with the new state and 03-VERIFICATION.md Truth 7 / WR-01 provenance.
- `packages/web/src/stores/participant.spec.ts` - `anchorSummaryState(null)` now expects `'checking'`; the `enabled:false` read still expects `'hermetic'`; `shouldAutoResolve(null) -> false` retained.
- `packages/web/src/components/cohort/StageTimeline.tsx` - value import of `anchorSummaryState`; final-row label gated on `summary === 'anchored'`; `liveAnchor` retained only for the `showSubSteps` gate.
- `packages/web/src/components/cohort/CompletionSummary.tsx` - explicit `checking` Signed-line branch; round-trip genesis-document line gated on `anchorNarration === 'hermetic'`.

## Decisions Made
- Added `'checking'` as a new leading union member rather than reworking existing branches, keeping the four existing states (`anchored`/`broadcasting`/`broadcast-failed`/`hermetic`) byte-for-byte in behavior.
- Left `shouldAutoResolve` untouched: it already short-circuits on null, so the checking window cannot trigger a premature resolve. Its existing null-to-false unit case is the guard.
- Kept `liveAnchor` (the enabled bit) only for the sub-steps gate so broadcasting/failed services still expand their anchor sub-steps, while the header label became state-driven.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 3 Truth 7 (03-VERIFICATION.md) narration-consistency gap is closed at the source. Ready for re-verification (`/gsd-verify-work 3`) which should re-check Truth 7 plus the deferred visual checks, then `/gsd-secure-phase 3`.
- The two `human_judgment: true` coverage deliverables (D3, D4) are timing/visual-dependent render windows; the backstop `must_haves` truth calls for a real-browser confirmation on a live-configured service.

## Self-Check: PASSED
- Commits exist: `49c9dbd`, `30d41c1`, `510d40a` all present in `git log`.
- `pnpm test` passes (27 files, 364 tests).
- `pnpm --filter @btcr2-aggregation/web build` clean (tsc --noEmit + vite build).
- No em-dash (U+2014) in participant.ts, StageTimeline.tsx, or CompletionSummary.tsx (grep returns 0).

---
*Phase: 03-participant-submit-co-sign-track-and-resolve*
*Completed: 2026-07-19*
