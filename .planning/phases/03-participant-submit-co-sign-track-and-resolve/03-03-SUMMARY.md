---
phase: 03-participant-submit-co-sign-track-and-resolve
plan: 03
subsystem: service
tags: [service, directory, public-read, phase-filter, vitest, security, D-26]

# Dependency graph
requires:
  - phase: 01-operator-auth-and-on-demand-advertise
    provides: directory()/status() derived from runner.session.cohorts + the advertised enrichment map (D-15) and OPEN_PHASES joinable tier
  - phase: 02-participant-discovery-and-browse-and-pick-join
    provides: Advertised-only join gate (isJoinable/pickedCohortClosed) and the honest joined/n-seats + k-of-n directory DTO
provides:
  - "IN_FLIGHT_PHASES display-only constant (SigningStarted/NoncesCollected/AwaitingPartialSigs) kept distinct from OPEN_PHASES"
  - "DISPLAY_PHASES union that directory() filters on so in-flight cohorts list as honest non-joinable 'In progress' rows (D-26)"
  - "openCount() helper: status().openCohorts narrows the widened directory back to the Advertised-tier so the public open count never inflates (Pitfall 3)"
affects: [03-04 participant post-seat cohort-gone detection, 03-06 tracking UI 'In progress' label, participant, web]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Display-set vs count-set split: a widened DISPLAY_PHASES governs what the public directory SHOWS while a narrower OPEN_PHASES governs what is joinable AND counted, so widening the listing never widens the join gate or the open count"
    - "Count reuses the display derivation then narrows: openCount() calls directory() (single source: membership + enrichment guard) and filters to OPEN_PHASES, keeping D-15's single-derivation property while making the count joinable-only"

key-files:
  created: []
  modified:
    - packages/service/src/operator-cohorts.ts
    - packages/service/src/operator-cohorts.spec.ts

key-decisions:
  - "The public directory DISPLAY widens to the in-flight signing phases (D-26) so a mid-signing service looks alive to a stranger, but IN_FLIGHT_PHASES is kept OUT of OPEN_PHASES so the join gate and the open count stay Advertised-tier only (Pitfall 3 / D-09)"
  - "status().openCohorts now derives from openCount() (directory() narrowed to OPEN_PHASES) instead of directory().length, so the widened DISPLAY can never silently inflate the public open count while keeping directory and count on one derivation (D-15 preserved)"
  - "pickedCohortClosed/isJoinable (web) and listCohorts/terminal/settleCompletion are byte-untouched; the enrichment guard in directory() still drops a settled/pruned cohort so widening the phase filter never makes the directory outlive the live set"

patterns-established:
  - "In-flight rows carry their raw phase (DirectoryCohortDTO.phase); the client renders the D-26 'In progress' label off the raw string with an unknown-phase raw fallback, so this is display copy not logic"
  - "Expired terminal records stay operator-only (listCohorts) even under the widened DISPLAY: expiry prunes the enrichment entry and moves the cohort to the terminal set, so the widened phase filter cannot resurrect it into the public directory"

requirements-completed: [PART-04]

coverage:
  - id: D1
    description: "directory() filters on DISPLAY_PHASES (OPEN_PHASES + the in-flight signing phases) so an Advertised cohort AND a SigningStarted cohort both list as rows carrying their raw phase (D-26 widened display)"
    requirement: "PART-04"
    verification:
      - kind: unit
        ref: "packages/service/src/operator-cohorts.spec.ts#lists an Advertised row AND a signing-phase row while status().openCohorts counts only the Advertised one"
        status: pass
    human_judgment: false
  - id: D2
    description: "status().openCohorts is derived from openCount() (Advertised-tier only), not directory().length over the widened set, so widening the DISPLAY never inflates the public open count (Pitfall 3 / D-09)"
    requirement: "PART-04"
    verification:
      - kind: unit
        ref: "packages/service/src/operator-cohorts.spec.ts#lists an Advertised row AND a signing-phase row while status().openCohorts counts only the Advertised one"
        status: pass
      - kind: e2e
        ref: "pnpm e2e:browse && pnpm e2e:operator && pnpm e2e:kofn"
        status: pass
    human_judgment: false
  - id: D3
    description: "A settled/pruned cohort drops from the widened directory (enrichment guard, not the phase filter), and an expired terminal record stays out of directory()/status() but present in listCohorts even with an in-flight phase forced"
    requirement: "PART-04"
    verification:
      - kind: unit
        ref: "packages/service/src/operator-cohorts.spec.ts#drops a settled (pruned) cohort from the widened directory even when its phase would still match the DISPLAY set"
        status: pass
      - kind: unit
        ref: "packages/service/src/operator-cohorts.spec.ts#keeps an expired terminal record out of the widened directory/status but present in listCohorts"
        status: pass
    human_judgment: false

# Metrics
duration: 9min
completed: 2026-07-17
status: complete
---

# Phase 3 Plan 03: Widened In-Flight Directory Rows Summary

**The public directory now lists in-flight (mid-signing) cohorts as honest non-joinable "In progress" rows (D-26) via a display-only DISPLAY_PHASES union, while status().openCohorts is narrowed to the Advertised-tier through a new openCount() helper so the widened listing never inflates the public open count and the Phase 2 join gate stays byte-untouched.**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-07-17T15:14Z
- **Completed:** 2026-07-17T15:23Z
- **Tasks:** 2
- **Files modified:** 2 (0 created)

## Accomplishments

- Added a display-only `IN_FLIGHT_PHASES = {SigningStarted, NoncesCollected, AwaitingPartialSigs}` constant plus a `DISPLAY_PHASES = OPEN_PHASES ∪ IN_FLIGHT_PHASES` union, kept deliberately distinct from `OPEN_PHASES` so the join gate never widens.
- Changed `directory()` to filter on `DISPLAY_PHASES.has(phase)` (was `OPEN_PHASES.has(phase)`), so in-flight cohorts list as honest non-joinable rows each carrying their raw `phase`; the existing `advertised.get(cohort.id)` enrichment guard is unchanged, so a settled/pruned cohort still drops out.
- Added an `openCount()` helper and repointed `status().openCohorts` at it (was `directory().length`): the count reuses the same `directory()` derivation then narrows to `OPEN_PHASES`, so the public open count stays exactly the joinable Advertised-tier set (Pitfall 3) while keeping D-15's single-derivation property.
- Left `OPEN_PHASES`, the web `isJoinable`/`pickedCohortClosed`, and `listCohorts`/`terminal`/`settleCompletion` byte-untouched; updated the module docstring and the `DirectoryCohortDTO.phase` doc to reflect the DISPLAY-vs-count split.
- Pinned both halves with three new spec cases: an Advertised + stubbed-SigningStarted pair both listing while `openCohorts === 1`; a settled/pruned cohort dropping from the widened directory even with an in-flight phase forced; and an expired terminal record staying out of `directory()`/`status()` but present in `listCohorts`.
- Regression gate green: 320 unit + e2e tests (up from 317, +3 new), plus the three plan-called-out e2e gates (`e2e:browse`, `e2e:operator`, `e2e:kofn`) all pass, confirming the display widening disturbs neither the Phase 2 join gate nor the open-count assertions.

## Task Commits

Each task was committed atomically:

1. **Task 1: widen directory() display to in-flight phases; keep the joinable count Advertised-only** - `df32517` (feat)
2. **Task 2: spec the widened display vs the unchanged joinable count** - `74bd52b` (test)

## Files Created/Modified

- `packages/service/src/operator-cohorts.ts` - Added `IN_FLIGHT_PHASES` + `DISPLAY_PHASES`; `directory()` filters on `DISPLAY_PHASES`; added `openCount()` and repointed `status().openCohorts` at it; updated module + DTO docstrings to explain the display-vs-count split (D-09/D-26/Pitfall 3).
- `packages/service/src/operator-cohorts.spec.ts` - Added a `createAndAdvertise` helper and a `D-26` describe block (3 cases): widened display + joinable-only count, pruned-cohort drop under the widened filter, and expired-record exclusion vs `listCohorts` presence.

## Decisions Made

- **Display set and count set are split, not merged.** `DISPLAY_PHASES` (what the public directory shows) widens to include the in-flight signing phases so a busy service looks alive (D-26); `OPEN_PHASES` (what is joinable and counted) stays Advertised-tier. This is the exact drift D-09/D-15 exist to prevent, so widening was an explicit task with its own count path, never a side effect of the filter change (RESEARCH Finding 5 / Pitfall 3).
- **The open count reuses the display derivation, then narrows.** `openCount()` calls `directory()` (single source: membership + enrichment guard) and filters the result to `OPEN_PHASES`, rather than iterating a parallel list. This keeps the public count and the directory on one derivation (D-15's anti-drift intent) while making the count joinable-only.
- **The join gate and expiry paths are frozen.** `isJoinable`/`pickedCohortClosed` (Advertised-only) and `listCohorts`/`terminal`/`settleCompletion` were left byte-untouched; the enrichment guard means the widened phase filter can never make the directory outlive the live/enriched set, and an expired record stays operator-only even under the wider DISPLAY.

## Deviations from Plan

None - plan executed exactly as written. The `IN_FLIGHT_PHASES`/`DISPLAY_PHASES` constants, the `directory()` filter change, the `openCount()`-backed `status()`, the untouched join gate/expiry paths, and the three spec cases all match the plan's `must_haves`, prohibitions, and threat register verbatim.

## Prohibition Verification

All three plan prohibitions (`flagged-unverified` in the plan) are now verified as honored:
- **MUST NOT fold signing phases into OPEN_PHASES:** `OPEN_PHASES` is unchanged (`{Advertised, CohortSet, CollectingUpdates}`); the signing phases live only in the separate `IN_FLIGHT_PHASES`/`DISPLAY_PHASES`. Verified by source and by the `openCohorts === 1` spec assertion against a listed SigningStarted row.
- **MUST NOT change pickedCohortClosed or isJoinable:** `packages/web/src/lib/directory.ts` is untouched (no diff); `e2e:browse`/`e2e:kofn` (Phase 2 join gate) stay green.
- **MUST NOT list an expired/completed cohort in the PUBLIC directory:** the enrichment guard + settle-prune keep pruned and expired cohorts out of `directory()`/`status()`; the new spec asserts an expired record is absent from both yet present in `listCohorts`.

## Threat Register Verification

All three STRIDE items in the plan's `<threat_model>` are mitigated as designed:
- **T-03-03-01 (info disclosure, widened rows):** rows carry only the existing non-sensitive `DirectoryCohortDTO` fields (beaconType/network/threshold/capacity/joined/phase); no member DIDs or keys are added.
- **T-03-03-02 (tampering / invariant drift, openCohorts):** the open count counts Advertised-tier only via `openCount()`; the widened display never inflates it (spec-pinned).
- **T-03-03-03 (info disclosure, expired/completed leakage):** expired records stay operator-only (`listCohorts`); completed cohorts prune from the enrichment map, so neither appears in the public directory (spec-pinned under a forced in-flight phase).

## Issues Encountered

None. The existing 29 spec cases continued to pass after the Task 1 source change (they act as the regression guard), and `runner.session.getCohortPhase` proved spyable (session is a stable readonly `AggregationService`), so the in-flight phase could be stubbed without driving real signing. No new packages (zero-install plan).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The widened public directory read is ready for its Wave 3 consumers: the 03-04 participant store's post-seat cohort-gone detection reads the widened directory (a row present in a signing phase means "normal / in progress", absent means "candidate ended"), and the 03-06 tracking UI renders the D-26 "In progress" label off the raw `phase`.
- The join gate and open count are provably unchanged, so nothing downstream that depends on Advertised-only joinability or the public open count is affected.
- No blockers introduced. This plan adds no user-visible surface on its own; it is the directory half of the PART-04 tracking surface.

---
*Phase: 03-participant-submit-co-sign-track-and-resolve*
*Completed: 2026-07-17*

## Self-Check: PASSED

- FOUND: `packages/service/src/operator-cohorts.ts` (modified)
- FOUND: `packages/service/src/operator-cohorts.spec.ts` (modified)
- FOUND: `.planning/phases/03-participant-submit-co-sign-track-and-resolve/03-03-SUMMARY.md`
- FOUND commit `df32517` (Task 1, feat)
- FOUND commit `74bd52b` (Task 2, test)
- FOUND commit `5212daa` (docs: complete plan)
- 320 unit + e2e tests pass (tsc -b typecheck green); e2e:browse / e2e:operator / e2e:kofn all green
