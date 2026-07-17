---
phase: 03-participant-submit-co-sign-track-and-resolve
plan: 01
subsystem: participant
tags: [participant, aggregation, onProvideUpdate, submit-gate, bip340, musig2, vitest]

# Dependency graph
requires:
  - phase: 02-participant-discovery-and-join
    provides: browse-and-pick participant (matchesPickedCohort, createParticipant, getSubmittedUpdate, getDeclineReason)
provides:
  - "SubmitGateInfo type (cohortId, beaconAddress, beaconType, update) carrying the pre-built signed body"
  - "additive-optional onSubmitGate on CreateParticipantOptions (opt-in explicit-submit gate, D-12)"
  - "exported createUpdateProvider seam: decline-first, build-once, opt-in-gate-then-submit"
affects: [03-04 participant store, 03-05 submit-and-co-sign UI slice, participant]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Opt-in deferred callback: onProvideUpdate builds the signed body once then awaits an optional app-supplied gate before recording/returning it; absent the gate, byte-identical auto-submit"
    - "Testable seam extraction: internal runner callback logic exported as createUpdateProvider so its contract is unit-testable without a runner, transport, or network"

key-files:
  created: []
  modified:
    - packages/participant/src/index.ts
    - packages/participant/src/index.spec.ts

key-decisions:
  - "onSubmitGate is strictly opt-in: absent = byte-identical auto-submit (headless peers, FILLERS, capstones unchanged, D-16); present = build-once, await the gate, submit the exact previewed body (D-12)"
  - "Extract onProvideUpdate into an exported createUpdateProvider seam so the build-once / gate / decline contract is hermetically testable (the runner cannot be stimulated purely)"
  - "The mismatch decline (return null, cooperative non-inclusion) runs BEFORE the gate is ever offered, so a baked-mismatch identity never reaches a submit window (D-15/D-19)"

patterns-established:
  - "Explicit-submit gate: the previewed body IS the submitted body (identity equality); never rebuild a BIP340-signed update (hash drift breaks the D-29 resolve round-trip)"
  - "onProvideUpdate never throws on the gate path; the only non-submit outcome is an explicit null decline (a throw would stall the whole n-of-n cohort, Finding 1)"

requirements-completed: [PART-03]

coverage:
  - id: D1
    description: "Opt-in onSubmitGate on createParticipant: gate present builds the update once, defers the submit until the gate resolves, and submits the exact previewed body (identity-equal)"
    requirement: "PART-03"
    verification:
      - kind: unit
        ref: "packages/participant/src/index.spec.ts#with onSubmitGate: builds the body once, defers the submit until the gate resolves, and the previewed body is the submitted body"
        status: pass
    human_judgment: false
  - id: D2
    description: "Absent onSubmitGate, the participant auto-submits with no external signal awaited (byte-identical to prior behavior); regression-proven by the five hermetic e2e capstones"
    requirement: "PART-03"
    verification:
      - kind: unit
        ref: "packages/participant/src/index.spec.ts#without onSubmitGate: auto-submits without awaiting any external signal (byte-identical to today)"
        status: pass
      - kind: e2e
        ref: "pnpm e2e && pnpm e2e:browse && pnpm e2e:operator && pnpm e2e:kofn && pnpm e2e:fallback"
        status: pass
    human_judgment: false
  - id: D3
    description: "A baked-mismatch identity declines (cooperative non-inclusion) BEFORE the gate is offered; the gate callback is never invoked and the decline reason is recorded"
    requirement: "PART-03"
    verification:
      - kind: unit
        ref: "packages/participant/src/index.spec.ts#declines a baked mismatch BEFORE ever offering the gate (cooperative non-inclusion, D-15/D-19)"
        status: pass
    human_judgment: false

# Metrics
duration: 9min
completed: 2026-07-17
status: complete
---

# Phase 3 Plan 01: Opt-in Explicit-Submit Gate Summary

**An additive-optional `onSubmitGate` on `createParticipant` that turns the auto-submit into a user-consented submit without a library change: it builds the signed did:btcr2 update exactly once, awaits the user's decision, then submits that exact body - while every headless caller stays byte-for-byte on auto-submit.**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-07-17T15:00Z
- **Completed:** 2026-07-17T15:07Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Added `SubmitGateInfo` (exported) carrying `{ cohortId, beaconAddress, beaconType, update }` - the pre-built, pre-signed body a UI can preview.
- Added the additive-optional `onSubmitGate?: (info: SubmitGateInfo) => Promise<void>` field to `CreateParticipantOptions`; absent, auto-submit is byte-identical (D-16); present, `onProvideUpdate` builds once, hands the body to the gate, awaits it, then records and submits the exact same object (D-12).
- Extracted the update-provision logic into an exported `createUpdateProvider` seam (decline-first, build-once, opt-in-gate-then-submit) so the contract is unit-testable without a runner, transport, or network. The runner delegates through a thin inline wrapper that preserves the library's callback typing.
- Proved the three contract points hermetically: previewed body is identity-equal to the submitted body (build-once), opt-out keeps auto-submit, and a baked mismatch declines (cooperative non-inclusion) before the gate is ever offered.
- Regression gate green: 305 unit tests plus all five hermetic e2e capstones (`e2e`, `e2e:browse`, `e2e:operator`, `e2e:kofn`, `e2e:fallback`) pass, confirming the opt-in change breaks no headless caller.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add the opt-in onSubmitGate to createParticipant (build-once, gate, then submit)** - `fe5ffcf` (feat)
2. **Task 2: Spec the gate (previewed body == submitted body, opt-out preserves auto-submit, decline runs first)** - `b18545a` (test)

_Note: this is a TDD-tagged plan; the plan splits implementation (Task 1) from the behavioral specs (Task 2), so each is a single atomic commit rather than a RED/GREEN pair._

## Files Created/Modified

- `packages/participant/src/index.ts` - Added `SubmitGateInfo` interface and `onSubmitGate` option; added exported `UpdateProviderContext` + `createUpdateProvider` seam (decline-first, build-once, opt-in-gate-then-submit); runner now delegates `onProvideUpdate` to the seam.
- `packages/participant/src/index.spec.ts` - Added `describe('createParticipant explicit submit gate (createUpdateProvider)')` with three hermetic cases: gate-present build-once + defer + identity equality, gate-absent auto-submit, and decline-before-gate.

## Decisions Made

- **onSubmitGate is strictly opt-in.** Making it the default would have changed every headless caller (Pitfall 1); the omitted-gate path is byte-identical auto-submit.
- **Extract createUpdateProvider as a testable seam.** The runner hides `onProvideUpdate` and cannot be stimulated purely (no network), so the plan explicitly authorized extracting a tiny seam. The seam is created in Task 1 (index.ts) because Task 2 may only touch the spec; behavior is identical to the prior inline callback.
- **Decline runs before the gate.** A baked-mismatch identity returns null (cooperative non-inclusion) before any submit window is offered, and the callback never throws (a throw would stall the whole n-of-n cohort, Finding 1).

## Deviations from Plan

None - plan executed exactly as written. The `createUpdateProvider` seam is the plan's own sanctioned "tiny testable seam" (Task 2 guidance), placed in Task 1's file so the spec can import it; behavior for existing callers is unchanged (byte-identical, proven by the untouched 302-test baseline plus the five e2e capstones).

## Issues Encountered

None. Typecheck (`tsc -b`) and the full vitest suite stayed green throughout; the delegating inline wrapper preserved the library's `onProvideUpdate` callback typing with no friction.

## User Setup Required

None - no external service configuration required. Zero-install plan (no new packages).

## Next Phase Readiness

- The PART-03 mechanism is ready for the Wave 2/3 consumers: the 03-04 participant store drives `onSubmitGate` (resolving it on the user's "Submit my DID update" click) and reads the exact submitted body via `getSubmittedUpdate` for the resolve round-trip; the 03-05 UI slice renders it.
- Teardown responsibility is explicitly the store's (03-04): on stop it must drop a never-resolved deferred without settling it, since this layer never rejects the gate.
- No blockers introduced. The opt-in design keeps the existing headless regression gate fully green.

---
*Phase: 03-participant-submit-co-sign-track-and-resolve*
*Completed: 2026-07-17*
