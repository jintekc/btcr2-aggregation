---
phase: 03-participant-submit-co-sign-track-and-resolve
plan: 04
subsystem: web-participant-store
tags: [participant, submit-gate, anchor-tracking, resolve, stage-model, degraded-states]
status: complete
requires:
  - "03-01 (participant onSubmitGate + SubmittedUpdate + createUpdateProvider seam)"
  - "03-02 (public GET /v1/anchor/:cohortId + AnchorReadDTO)"
  - "03-03 (widened directory lists in-flight signing-phase rows)"
provides:
  - "deriveStage(state): Stage - the single D-01 render authority for the cohort page (03-05/03-06)"
  - "explicit-submit deferred (pendingSubmit + submitUpdate()) driving the submit window"
  - "epoch-guarded anchor poll (trackAnchor) + mode-honest auto-resolve"
  - "post-seat cohort-gone + unreachable degraded states (closes 02-09 WR-02)"
  - "roundTripOutcome / preSeatFitWarning / shouldAutoResolve / postSeatCohortGone pure helpers"
  - "startOver() identity wipe (D-10)"
affects:
  - "packages/web/src/stores/participant.ts (the single lifecycle owner)"
  - "packages/web/src/lib/types.ts (FLOW_STEPS/FlowStep removed)"
tech-stack:
  added: []
  patterns:
    - "Deferred submit via module-scope resolver (Pattern 1): held onProvideUpdate promise, serializable pendingSubmit projection"
    - "Stage as a derived value, not a second state machine (Pattern 3): deriveStage pure selector"
    - "Epoch-guarded async continuations (ipfsEpoch/directoryEpoch precedent) for the anchor + post-seat polls"
key-files:
  created:
    - packages/web/src/lib/anchor.ts
  modified:
    - packages/web/src/stores/participant.ts
    - packages/web/src/stores/participant.spec.ts
    - packages/web/src/lib/types.ts
  deleted:
    - packages/web/src/components/participant/FlowStepper.tsx
    - packages/web/src/components/participant/ParticipantView.tsx
decisions:
  - "Removing FLOW_STEPS (Task 2) directly broke the dead FlowStepper/ParticipantView files (unreachable from App); deleted them now as a Rule 3 blocking-fix to keep the web build green, pulling that slice of 03-05's stepper deletion forward. KeyGenPanel (not broken by the change) stays for 03-05."
  - "submitUpdate() closes the submit-window projection unconditionally (guarding the deferred resolve), so the state flag is always cleared on click and idempotency holds even if the module deferred is already null."
  - "trackAnchor fires an immediate read then the ~5s interval, so a hermetic (enabled:false) service resolves its mode and stops after one read without waiting a full cadence."
  - "Auto-resolve gating is a pure shouldAutoResolve(anchor); the resolver-lag retry is a bounded module-scope interval started ONLY when anchor.enabled (Finding 7)."
metrics:
  duration: 24 min
  completed: 2026-07-17
  tasks: 3
  files: 6
  tests_added: 34
  tests_total: 354
---

# Phase 3 Plan 04: Participant Store Stage Model, Submit, Track, and Resolve Summary

Restructured the single lifecycle-owner participant store into the D-01 stage model: an explicit-submit deferred driving the submit window, a pure `deriveStage` render authority, an epoch-guarded anchor poll over the new public read with mode-honest auto-resolve, and honest post-seat degraded states (unreachable / cohort-ended), all ADDED around the byte-untouched Phase-2 join-through-seat hardening. Renders nothing yet; the Wave 3 cohort page (03-05/03-06) consumes it.

## What Was Built

**Task 1 - Explicit-submit deferred + public anchor client (c4fd6b1)**
- `packages/web/src/lib/anchor.ts` (NEW): `fetchAnchor(baseUrl, cohortId): Promise<AnchorDTO>` (public, `credentials: 'omit'`, 8s timeout) + `AnchorDTO` mirroring the service `AnchorReadDTO`.
- Module-scope `pendingSubmit` deferred (built body + resolver, like `live`/`captured`) with a serializable `pendingSubmit: boolean` state projection; `join()` passes an opt-in `onSubmitGate` into `createParticipant` that stashes the already-built-once body and flips the window on.
- `submitUpdate()` resolves-then-nulls the deferred (idempotent); every teardown path (`teardownLive`, `leave`, `fail`, `cohort-complete`, re-join) clears it WITHOUT settling (Pitfall 2: never reject, never resolve-null).

**Task 2 - Pure render authority (3a84cab)**
- `deriveStage(state): Stage` - the single D-01 stage selector (waiting-for-seats -> seated -> submit-window -> co-signing -> signed/anchored -> resolved), no parallel enum stored (Pattern 3).
- `roundTripOutcome({beaconPresent, anchorEnabled}): RoundTrip` - the three honest outcomes (reflected / hermetic-genesis / not-reflected), mode bit dominates (Finding 7).
- `preSeatFitWarning(identity, pickedRow, network)` - warn-only on the two reliably pre-seat-computable cases (network mismatch; baked aggregate-beacon TYPE mismatch, Finding 6).
- Removed `FLOW_STEPS`/`FlowStep` from `lib/types.ts` (kept `StepKey`/`StepStatus` as the internal event substrate `deriveStage` reads); deleted the now-dead `FlowStepper.tsx` + `ParticipantView.tsx`.

**Task 3 - Anchor poll + degraded states + auto-resolve + startOver (ae22301)**
- `trackAnchor(baseUrl, cohortId)`: epoch-guarded post-sign anchor poll; freezes at `confirmed`/`failed` (D-22) and after one read on a hermetic service; raises `unreachable` (D-24) on consecutive failures without a terminal transition.
- `handlePostSeatSnapshot(rows)` + pure `postSeatCohortGone(rows, id)`: NEW post-seat cohort-gone predicate (absent from the directory entirely) that NEVER routes through `handleDirectorySnapshot` (Pitfall 6); lands the honest D-25 "didn't say why" fallback; a post-seat directory poll started at `cohort-ready` feeds it and counts fetch errors toward `unreachable` (closes 02-09 WR-02).
- Auto-resolve (D-28) via pure `shouldAutoResolve(anchor)`; the resolver-lag retry is a bounded interval started ONLY when `anchor.enabled` (Finding 7).
- `startOver()` (D-10): clears the round record AND erases the in-memory identity, tearing down every poll/deferred.

## Key Links

- `join() -> onSubmitGate -> pendingSubmit deferred -> submitUpdate() resolves it -> runner submits`
- `GET /v1/anchor/:cohortId (03-02) -> fetchAnchor -> epoch-guarded trackAnchor poll -> anchor state -> deriveStage`
- `cohort-complete -> trackAnchor -> shouldAutoResolve -> resolve() -> roundTripOutcome(findAppendedBeacon, anchor.enabled)`
- `cohort-ready -> post-seat directory poll -> handlePostSeatSnapshot -> postSeatCohortGone -> D-25 terminal`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] Deleted dead FlowStepper.tsx + ParticipantView.tsx**
- **Found during:** Task 2
- **Issue:** Task 2 requires removing `FLOW_STEPS`/`FlowStep` from `lib/types.ts`, but `FlowStepper.tsx` imports `FLOW_STEPS` and `ParticipantView.tsx` imports `FlowStepper`. Both are dead code (nothing outside `components/participant/` imports them; `App` renders `BrowseView`), but `tsc --noEmit` still typechecks them, so removing the export broke the web typecheck/build. The plan slates these for deletion in 03-05.
- **Fix:** Deleted the two files that reference the removed symbols so the web build stays green at this commit. `KeyGenPanel.tsx` was NOT broken by the change (it does not import `FLOW_STEPS`), so it and the BrowseView/CohortRow/App rewire + CohortPage creation stay in 03-05's scope. 03-05's acceptance ("FlowStepper/ParticipantView/KeyGenPanel deleted, nothing imports them") remains satisfiable - two of the three are already gone.
- **Files modified:** deleted `packages/web/src/components/participant/{FlowStepper,ParticipantView}.tsx`
- **Commit:** 3a84cab

**2. [Rule 1 - Correctness] submitUpdate() closes the window projection unconditionally**
- **Found during:** Task 1
- **Issue:** The initial `submitUpdate()` early-returned when the module-scope deferred was null, leaving the `pendingSubmit: boolean` state flag stuck true if only the projection had been set. This also made the store state and the deferred able to drift.
- **Fix:** `submitUpdate()` now always captures-and-nulls the deferred, always closes the `pendingSubmit` projection, and guards only the `resolve()` call. Idempotent and drift-free.
- **Files modified:** `packages/web/src/stores/participant.ts`
- **Commit:** c4fd6b1

## Known Stubs

None. This plan is store logic only (renders nothing); all new state fields initialise to honest empty values (`anchor: null`, `unreachable: false`, `pendingSubmit: false`) that the event handlers and polls populate. The pure selectors return real derivations. No placeholder UI or mock data.

## Verification

- `pnpm test`: 354 passed (was 320 baseline; +34 new: fetchAnchor, submit window, deriveStage, roundTripOutcome, preSeatFitWarning, postSeatCohortGone, handlePostSeatSnapshot, shouldAutoResolve, trackAnchor poll freeze/hermetic-stop/unreachable, startOver). All pre-existing Phase-2 join-lifecycle spec cases (grace / awaitingSeats / pickedCohortClosed) pass UNMODIFIED.
- `pnpm --filter @btcr2-aggregation/web build` (tsc --noEmit + vite build): clean (only the pre-existing chunk-size advisory).
- `eslint` on the changed web files: clean.
- e2e regressions (the store's join-through-seat path is unchanged from the runner's perspective): `e2e:browse`, `e2e:operator`, `e2e:kofn`, `e2e:fallback` all PASS.

## Prohibitions Honored

- No `pendingSubmit.resolve(` in any teardown block (clear-without-settling).
- Round-trip compares `findAppendedBeacon` + the anchor mode bit; the signed update is never rebuilt.
- The post-seat cohort-gone poll uses its own `postSeatCohortGone` predicate, never `handleDirectorySnapshot`.
- The frozen Phase-2 join-through-seat block (handleDirectorySnapshot, grace timer, awaitingSeats, directoryEpoch) is byte-untouched.
- No parallel stage enum stored; the stage is a pure derivation.
- No hardcoded network; derivation stays on the runtime network.
- No em-dash characters in any authored code, comment, or copy.

## Self-Check: PASSED

- Files created/modified/deleted all verified on disk.
- Commits c4fd6b1, 3a84cab, ae22301 all present in git history.
