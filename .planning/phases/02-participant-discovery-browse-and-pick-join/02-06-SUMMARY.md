---
phase: 02-participant-discovery-browse-and-pick-join
plan: 06
subsystem: api
tags: [hono, react, zustand, cohort-lifecycle, discovery, aggregation]

# Dependency graph
requires:
  - phase: 02-participant-discovery-browse-and-pick-join
    provides: single cohort-size ({ beaconType, size }) operator create shape (02-05)
  - phase: 01
    provides: operator auth + on-demand advertiseDraft (sole runner.advertiseCohort caller) + derived /v1/directory + /v1/status
provides:
  - 30-minute discovery-window cohort lifetime defaults (DEFAULT_PHASE_TIMEOUT_MS / DEFAULT_COHORT_TTL_MS), env-tunable
  - bounded terminal 'expired' record surfaced to the operator (never silently deleted, never shown to participants)
  - gated POST /v1/operator/cohorts/:id/readvertise (second operator-driven advertiseCohort caller, D-17)
  - operator cohort-list Expired row (bad-tone badge + reason) with a Re-advertise action
  - e2e:operator F2 expiry leg (idle-Advertised expiry -> surfaced -> re-advertised)
affects: [02-07, phase-4-monitoring, phase-5-lifecycle-control]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "settleCompletion(): prune-on-success / retain-terminal-on-rejection instead of finally-prune"
    - "bounded terminal map (MAX_TERMINAL, oldest-first eviction) for operator-only cohort state"
    - "second operator-driven advertiseCohort call site (readvertiseExpired) preserving D-17"

key-files:
  created: []
  modified:
    - packages/service/src/demo-server.ts
    - packages/service/src/index.ts
    - packages/service/src/operator-cohorts.ts
    - packages/service/src/operator-cohorts.spec.ts
    - packages/service/src/hono-adapter.ts
    - packages/web/src/lib/operator.ts
    - packages/web/src/stores/operator.ts
    - packages/web/src/components/operator/OperatorCohortList.tsx
    - e2e/operator-cohort.ts

key-decisions:
  - "Raise the single inter-phase stall timer (phaseTimeoutMs) + overall TTL defaults to a 30-min discovery window; the library has no Advertised-phase exemption, so this is the clean library-native lever (F2)."
  - "On completion rejection, retain a bounded terminal 'expired' record (config + reason) instead of only pruning; surface it operator-only via listCohorts, never via directory()/status()."
  - "readvertiseExpired is a SECOND operator-driven advertiseCohort caller, so re-advertise does not reintroduce the removed boot-time loop (D-17 preserved)."

patterns-established:
  - "Pattern 1: settleCompletion(cohortId, completion) with then(prune, remember-terminal) is the shared settlement for advertiseDraft AND readvertiseExpired."
  - "Pattern 2: expired cohorts are operator-only state (bounded, evicted) surfaced through the gated list, never the public directory."

requirements-completed: [PART-01, PART-02]

coverage:
  - id: D1
    description: "Advertised, unjoined cohort stays discoverable for a 30-min default window (env-tunable via PHASE_TIMEOUT_MS / COHORT_TTL_MS), replacing the 60s/3min booth-era defaults."
    requirement: "PART-01"
    verification:
      - kind: unit
        ref: "packages/service/src/config.spec.ts + packages/service/src/operator-boot.spec.ts (green)"
        status: pass
      - kind: other
        ref: "grep DEFAULT_PHASE_TIMEOUT_MS/DEFAULT_COHORT_TTL_MS = 1_800_000 in demo-server.ts; tsc -b exit 0"
        status: pass
    human_judgment: false
  - id: D2
    description: "Cohort expiry is surfaced to the operator (state: 'expired' + reason), absent from /v1/directory, and re-advertisable via a gated route; terminal map is bounded."
    requirement: "PART-02"
    verification:
      - kind: unit
        ref: "packages/service/src/operator-cohorts.spec.ts#cohort expiry is surfaced to the operator (20 tests pass)"
        status: pass
      - kind: e2e
        ref: "e2e/operator-cohort.ts#runExpiryLeg (pnpm e2e:operator exit 0)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Operator cohort list shows an Expired row (bad-tone badge + reason) with a Re-advertise action instead of a silent disappearance."
    requirement: "PART-02"
    verification:
      - kind: automated_ui
        ref: "packages/web tsc --noEmit + vite build (exit 0); grep 'Re-advertise' in OperatorCohortList.tsx"
        status: pass
      - kind: manual_procedural
        ref: "At /operator, let an advertised cohort sit past the window; row flips to Expired + Re-advertise revives it"
        status: unknown
    human_judgment: true
    rationale: "Visual-fidelity + interaction (badge tone, reason placement, accent scarcity of the Re-advertise button) needs a human eye; the e2e proves the wire behavior but not the rendered surface."

# Metrics
duration: 18min
completed: 2026-07-15
status: complete
---

# Phase 2 Plan 06: Cohort Discovery-Window Lifetime + Surfaced Expiry Summary

**30-minute discovery-window cohort defaults plus a bounded operator-only 'expired' record and a gated re-advertise route, so an advertised cohort no longer vanishes ~60s after advertise and an operator can revive an expired one (closes UAT F2).**

## Performance

- **Duration:** 18 min
- **Started:** 2026-07-15T13:55:00Z
- **Completed:** 2026-07-15T14:05:00Z
- **Tasks:** 3 (Task 1 completed in a prior run at `0f6b36e`)
- **Files modified:** 9

## Accomplishments
- Raised the cohort lifetime defaults to a 30-minute discovery window (`DEFAULT_PHASE_TIMEOUT_MS` / `DEFAULT_COHORT_TTL_MS` = `1_800_000`), still env-tunable via `PHASE_TIMEOUT_MS` / `COHORT_TTL_MS`, and de-boothed the timer JSDoc across `demo-server.ts` + `index.ts` (Task 1, prior run).
- Surfaced cohort expiry instead of silent deletion: a bounded terminal `'expired'` record (config + reason) is retained when an advertised cohort's completion rejects, listed to the operator via `listCohorts()`, and never shown in the participant `directory()`/`status()`.
- Added `readvertiseExpired()` (a second operator-driven `advertiseCohort` call site, preserving D-17) and the gated, CSRF-checked `POST /v1/operator/cohorts/:id/readvertise` route.
- Wired the web operator surface: `state: 'expired'` + `reason` on the client DTO, a `readvertise` client + store action, and an Expired row (bad-tone badge + reason) with a single primary `Re-advertise` action.
- Extended `e2e:operator` with an F2 expiry leg proving an idle-Advertised cohort expires out of the public directory but is surfaced to the operator as expired-with-reason, then re-advertised back into the directory.

## Task Commits

Each task was committed atomically:

1. **Task 1: Two-sided-appropriate cohort lifetime defaults (30-min discovery window)** - `0f6b36e` (feat, prior run)
2. **Task 2: Surface expiry + gated operator re-advertise** - `a586ff0` (test, RED) -> `b1fcdf8` (feat, GREEN)
3. **Task 3: Operator surface for expired cohorts + Re-advertise + hermetic proof** - `a56a1b8` (feat)

_Note: Task 2 followed TDD (failing spec first, then implementation)._

## Files Created/Modified
- `packages/service/src/demo-server.ts` - exported `DEFAULT_PHASE_TIMEOUT_MS` / `DEFAULT_COHORT_TTL_MS` (30 min), env knobs retained (Task 1)
- `packages/service/src/index.ts` - de-boothed `cohortTtlMs` / `phaseTimeoutMs` JSDoc (Task 1)
- `packages/service/src/operator-cohorts.ts` - bounded `terminal` map, `settleCompletion` (prune/remember-terminal), `readvertiseExpired`, `listCohorts` expired rows, `OperatorCohortDTO.state` gains `'expired'` + optional `reason`
- `packages/service/src/operator-cohorts.spec.ts` - expired-surfacing + re-advertise + gated-401/404 tests
- `packages/service/src/hono-adapter.ts` - gated `POST /v1/operator/cohorts/:id/readvertise`
- `packages/web/src/lib/operator.ts` - DTO `state`/`reason` + `readvertise` client
- `packages/web/src/stores/operator.ts` - `readvertise` store action + transient confirmation
- `packages/web/src/components/operator/OperatorCohortList.tsx` - Expired row (bad-tone badge + reason) + Re-advertise button
- `e2e/operator-cohort.ts` - `runExpiryLeg` (idle-Advertised expiry -> surfaced -> re-advertised)

## Decisions Made
- None beyond the plan. Followed the plan's design: raise the single stall/TTL timer (no Advertised-phase exemption exists), retain a bounded operator-only terminal record, and add a second operator-driven advertise call site for re-advertise (D-17 preserved).

## Deviations from Plan

None - plan executed exactly as written. (The e2e's local `OperatorCohortDTO` type mirror needed the `'expired'` state + `reason` field to typecheck; this was part of the planned Task 3 change to `e2e/operator-cohort.ts`, not an unplanned deviation.)

## Issues Encountered
- First `pnpm e2e:operator` run failed `tsc -b` because the harness's local `OperatorCohortDTO` interface still declared `state: 'draft' | 'advertised'` without `reason`. Updated the local mirror to `'draft' | 'advertised' | 'expired'` + optional `reason`; the run then passed (64-byte co-sign + the full F2 expiry/re-advertise leg green).

## User Setup Required

None - no external service configuration required. Operators wanting snappier signing liveness can lower `PHASE_TIMEOUT_MS` at the cost of a shorter discovery window (documented in the timer JSDoc).

## Next Phase Readiness
- Plan 02-07 (F1c) will convert the longer single-timer stall budget from a hard mid-signing failure into a graceful k-of-n script-path fallback; this plan deliberately did NOT wire any fallback option (timer defaults + expiry surfacing only).
- CI debt unchanged: `e2e:browser` / `e2e:browser:prod` remain deferred to Phase 6; `e2e:operator` (now including the F2 leg) is still not wired into CI.

## Self-Check: PASSED

- SUMMARY.md exists on disk.
- Task commits `a586ff0` (RED), `b1fcdf8` (GREEN), `a56a1b8` (Task 3), `98bd3a6` (docs) all present in git history.
- `operator-cohorts.spec.ts` (20) + `config.spec.ts` + `operator-boot.spec.ts` all green (34 tests); `pnpm e2e:operator` exit 0; web `tsc --noEmit` + `vite build` clean; service `tsc -b` clean; lint clean.

---
*Phase: 02-participant-discovery-browse-and-pick-join*
*Completed: 2026-07-15*
