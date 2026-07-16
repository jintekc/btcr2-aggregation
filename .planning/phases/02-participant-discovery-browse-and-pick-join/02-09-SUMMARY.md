---
phase: 02-participant-discovery-browse-and-pick-join
plan: 09
subsystem: web/participant-store
tags: [gap-closure, G-02-2, PART-02, browser-store, join-lifecycle, wait-for-n]
gap_closure: true
gap_ids: [G-02-2]
requirements: [PART-02]
dependency_graph:
  requires: [02-05, 02-06, 02-08]
  provides: ["join-grace armed at observed departure (not opt-in)", "awaitingSeats truthful waiting surface"]
  affects: [participant-join-lifecycle]
tech_stack:
  added: []
  patterns: ["one-shot grace arming guarded by joinGraceLogged", "vitest fake timers for module-scope timer teardown"]
key_files:
  created: []
  modified:
    - packages/web/src/stores/participant.ts
    - packages/web/src/stores/participant.spec.ts
    - packages/web/src/components/browse/JoinIdentityStep.tsx
decisions:
  - "The 90s join-seat grace (JOIN_SEAT_GRACE_MS, unchanged) arms on the FIRST observed departure of the picked cohort from the Advertised set, not at opt-in, so an opted-in participant whose picked cohort is still Advertised is never falsely failed."
  - "cohort-joined records the opt-in only (optedIn/steps/log) and arms nothing; the directory poll owns arming the grace (one-shot via joinGraceLogged)."
  - "A new awaitingSeats { joined, capacity } | null store field captures the still-Advertised polled row counts and drives a truthful `Waiting for the cohort to fill ({joined}/{capacity} seats)` line; it resets in adopt/join/leave/cohort-ready/fail."
metrics:
  duration: 7min
  completed: 2026-07-16
status: complete
---

# Phase 2 Plan 09: Join-Grace Rearm for Wait-for-N (G-02-2) Summary

Moved the browser participant store's 90s join-seat grace timer so it arms at the first observed departure of the picked cohort from the Advertised set (in `handleDirectorySnapshot`) instead of at opt-in (in `cohort-joined`), and added an `awaitingSeats` field that renders a truthful `Waiting for the cohort to fill ({joined}/{capacity} seats)` line, closing UAT gap G-02-2 (a legitimately-filling cohort was being falsely failed at 90s under the wait-for-n model).

## What was built

**Task 1 (TDD, store logic):** In `packages/web/src/stores/participant.ts`:
- Added `awaitingSeats: { joined: number; capacity: number } | null` to `ParticipantState`, initialized `null`, and reset it to `null` in `adopt()`, the `join()` reset block, `leave()`, the `cohort-ready` handler, and `fail()`.
- Deleted the arm-at-opt-in `setTimeout` block from the `cohort-joined` handler; it now records `optedIn`/steps/log and arms nothing.
- In `handleDirectorySnapshot`: the still-Advertised early-return path now captures the picked Advertised row's `joined`/`capacity` into `awaitingSeats`; the opted-in-departure branch arms the bounded grace ONCE (guarded by the existing `joinGraceLogged` one-shot), with the same timer body and unchanged message.
- Rewrote the module-scope join-grace comment block, the `optedIn` JSDoc, and the `cohort-joined` inline comment to the observed-departure / wait-for-n semantics. `JOIN_SEAT_GRACE_MS = 90000` unchanged.
- Reworked `packages/web/src/stores/participant.spec.ts` RED-first with vitest fake timers + an `afterEach` `leave()` teardown so the module-scope timer never leaks: a still-Advertised opted-in participant captures `awaitingSeats` and is NOT failed past 90s; an observed departure arms the grace once and elapses to the filled-or-closed terminal; a seat during the grace is protected (CR-01); arm-once holds across repeated departure polls; the never-opted-in departure stays an immediate terminal; `leave()` resets `awaitingSeats`.

**Task 2 (join flow surface):** In `packages/web/src/components/browse/JoinIdentityStep.tsx`, added an `awaitingSeats` selector and rendered a faint-text `Waiting for the cohort to fill ({joined}/{capacity} seats)` line beneath the Join/Cancel row while joining, additive to the existing `Joining…` button state.

## How it was verified

- `pnpm vitest run packages/web/src/stores/participant.spec.ts`: 16 tests pass (3 confirmed RED on the pre-move source, then GREEN after).
- `pnpm test`: 302 unit tests pass (26 files).
- `pnpm lint`: clean. `pnpm --filter @btcr2-aggregation/web exec tsc --noEmit`: exit 0. `pnpm --filter @btcr2-aggregation/web build`: exit 0 (pre-existing chunk-size advisory only).
- `pnpm e2e:browse`, `pnpm e2e:operator`, `pnpm e2e:kofn`, `pnpm e2e:fallback`: all exit 0 (re-proving no regression; no e2e or Node-participant code changed).
- Source greps: `awaitingSeats` = 9 (>= 6); `joinGrace = setTimeout` = 1 (single arming site); `JOIN_SEAT_GRACE_MS = 90000` = 1; zero em-dash across the three touched files.

## Deviations from Plan

None - plan executed exactly as written.

## Threat surface

No new security-relevant surface. `awaitingSeats` carries only the `joined`/`capacity` counts already public in the directory row (no DIDs or keys). The high-severity threats in the plan register are mitigated in code and proven by spec: T-02-G2-02 (arm-once) and T-02-G2-03 (CR-01 member protection during the grace window).

## Self-Check: PASSED

- Files exist: participant.ts, participant.spec.ts, JoinIdentityStep.tsx (all modified, verified on disk).
- Commits exist: a53b9ca (test RED), ef7971f (feat store), c1c36cc (feat waiting line).
