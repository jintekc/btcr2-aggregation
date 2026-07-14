---
phase: 02-participant-discovery-browse-and-pick-join
plan: 01
subsystem: participant
tags: [aggregation, participant, shouldJoin, join-by-filter, e2e, musig2]

requires:
  - phase: 01-operator-cohort-lifecycle
    provides: operator login + on-demand create/advertise + public /v1/directory (used to advertise the two cohorts and browse them)
provides:
  - "CreateParticipantOptions.cohortId (browse-and-pick picked cohort, D-14)"
  - "exported pure predicate matchesPickedCohort(pickedCohortId, advertCohortId)"
  - "shouldJoin narrowed to opt into ONLY the picked cohort (client-side selectivity)"
  - "hermetic e2e/browse-join-cohort.ts capstone (browse -> pick -> join -> seated -> co-sign) + e2e:browse script"
affects: [02-03-store-join-lifecycle, 02-04-browse-view, participant-store]

tech-stack:
  added: []
  patterns:
    - "Join-by-filter: a pure predicate gates shouldJoin so a non-matching advert sends no opt-in"
    - "Hermetic browse capstone mirroring e2e/operator-cohort.ts (problems-list return, withTimeout, offline/fixture path)"

key-files:
  created:
    - packages/participant/src/index.spec.ts
    - e2e/browse-join-cohort.ts
  modified:
    - packages/participant/src/index.ts
    - package.json

key-decisions:
  - "Advertise the PICKED cohort LAST in the capstone so it is the reachable current advert: the service HttpServerTransport keeps a single most-recent advert slot and createService does not lower the ~60s republish, so a late-subscribing picker only receives the most-recently published advert."
  - "The B-picker and random-id picker prove selectivity at runtime by DISCOVERING the live advert (cohort A) and REFUSING it (matchesPickedCohort false), leaving cohort B at 0 seats deterministically."
  - "Seat authority is cohort-ready / cohort-complete (D-11), never cohort-joined; the capstone asserts the signed cohort id === the picked cohort A."

patterns-established:
  - "matchesPickedCohort(undefined, x) === true keeps legacy accept-all for non-browsing callers; Phase 2 always passes a picked cohortId."

requirements-completed: [PART-01, PART-02]

coverage:
  - id: D1
    description: "Join-by-filter predicate matchesPickedCohort narrows shouldJoin to the picked cohortId (PART-02, D-14)"
    requirement: "PART-02"
    verification:
      - kind: unit
        ref: "packages/participant/src/index.spec.ts#matchesPickedCohort (join-by-filter predicate)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Hermetic browse -> pick -> join -> seated -> co-sign capstone proves a picked participant co-signs only the chosen cohort (64-byte aggregate) while a concurrent cohort and a no-match picker reach no seat"
    requirement: "PART-01"
    verification:
      - kind: e2e
        ref: "pnpm e2e:browse (e2e/browse-join-cohort.ts)"
        status: pass
    human_judgment: false

duration: 14min
completed: 2026-07-14
status: complete
---

# Phase 2 Plan 01: Join-by-filter + browse-and-pick capstone Summary

**Narrowed the participant runner's `shouldJoin` from accept-every-advert to opt into only the picked `cohortId` via an exported `matchesPickedCohort` predicate, and proved the whole browse -> pick -> join -> seated -> co-sign loop headlessly over real HTTP with a new hermetic `e2e/browse-join-cohort.ts` capstone.**

## Performance

- **Duration:** 14 min
- **Started:** 2026-07-14T19:55:27Z
- **Completed:** 2026-07-14T20:10:20Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- `CreateParticipantOptions.cohortId?` + the pure, exported `matchesPickedCohort(pickedCohortId, advertCohortId)` predicate; `shouldJoin` now returns false (sends no opt-in) for any advert that is not the picked cohort, byte-identical to before when no cohortId is set.
- First co-located spec in `packages/participant` (`index.spec.ts`), TDD RED->GREEN, asserting match=true / non-match=false / undefined-picked=true.
- New hermetic `e2e/browse-join-cohort.ts`: an operator advertises two cohorts (A and B), both appear in the public directory, a participant that picked cohort A joins ONLY A and co-signs a real 64-byte aggregated Taproot signature, while the B-picker and a random-id picker discover the live advert, refuse it, and reach no seat (B ends at 0 seats) - all deterministic, synchronized on A's `signing-complete` (no watchdog timer). Registered as `e2e:browse` (not wired into CI).

## Task Commits

1. **Task 1 (RED): failing predicate test** - `4c718db` (test)
2. **Task 1 (GREEN): matchesPickedCohort + narrowed shouldJoin** - `eed2bfa` (feat)
3. **Task 2: browse -> pick -> join -> co-sign capstone + e2e:browse** - `3c2a9a9` (test)

_TDD task 1 produced test then feat commits; no refactor was needed._

## Files Created/Modified
- `packages/participant/src/index.ts` - added `cohortId?` option + exported `matchesPickedCohort`; guarded `shouldJoin` with the predicate before recording the beacon type.
- `packages/participant/src/index.spec.ts` - new; unit-tests the predicate (match / non-match / undefined).
- `e2e/browse-join-cohort.ts` - new hermetic capstone (positive picked-only co-sign + selectivity + deterministic no-seat).
- `package.json` - added `e2e:browse` script.

## Decisions Made
- **Advertise the picked cohort last (capstone).** The service `HttpServerTransport` keeps a single `#currentAdvert` slot and `createService` does not lower the ~60s republish cadence, so a late-subscribing picker (exactly how a browser picker connects) is replayed only the most-recently published advert. Advertising the picked cohort A last makes A the reachable current advert, so the A-pickers receive and co-sign A while the B-picker and random-id picker receive that same advert and refuse it. This yields a deterministic `B.joined === 0` and genuinely exercises the filter at runtime.
- **Seat authority is `cohort-ready` / `cohort-complete`, not `cohort-joined`** (D-11); the capstone asserts the signed cohort id equals the picked cohort.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Advert ordering so the picked cohort is reachable by a late subscriber**
- **Found during:** Task 2 (capstone)
- **Issue:** The plan's naive shape (advertise A then B, then start the A-pickers) timed out: the server transport keeps only a single most-recent advert slot, so the late-subscribing A-pickers were replayed cohort B's advert and never received A's advert, so cohort A never filled or co-signed.
- **Fix:** Advertise the picked cohort (A) LAST so it is the reachable current advert; the two negative controls then receive A's advert and refuse it. Documented the constraint prominently in the harness header.
- **Files modified:** e2e/browse-join-cohort.ts
- **Verification:** `pnpm e2e:browse` exits 0 with a 64-byte co-sign for A and 0 seats for B; confirmed empirically before finalizing.
- **Committed in:** 3c2a9a9

**2. [Rule 1 - Assertion correctness] B-picker never opts in (so the plan's `cohort-joined`-then-no-seat expectation is stronger)**
- **Found during:** Task 2 (capstone)
- **Issue:** The plan text expected the B-picker to opt into B (emit `cohort-joined`) yet never seat. Under the single-advert-slot reality the B-picker never receives B's advert (it is refused the current advert A), so it never opts in at all.
- **Fix:** Asserted the robust negative that holds either way: the B-picker never reaches `cohort-ready`/`cohort-complete`, and B stays at 0 seats; the random-id picker never reaches `cohort-joined`/`cohort-ready`/`cohort-complete`. Added an informational log when a negative control discovers-and-refuses the live advert (the runtime-filter proof).
- **Files modified:** e2e/browse-join-cohort.ts
- **Verification:** `pnpm e2e:browse` exits 0; the "filter exercised: the B-picker discovered the live advert and refused it" line prints.
- **Committed in:** 3c2a9a9

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 assertion-correctness). Both are test-harness realism against the library's real advert-cache semantics; the shipped `matchesPickedCohort` mechanism is exactly as planned.
**Impact on plan:** No scope creep. The PART-02 mechanism and its unit test are unchanged from the plan; only the e2e capstone's cohort-ordering and negative-control assertions were adjusted to the library's single-advert-slot behavior.

## Issues Encountered
- **Single most-recent advert slot (important for plans 02-03 / 02-04).** The service `HttpServerTransport` replays only the most-recently published advert to a new broadcast subscriber, and the runner re-publishes each open cohort's advert only on the default ~60s cadence (not lowered by `createService`). A browser participant is always a late subscriber, so a picker of a NON-latest advertised cohort will not receive that cohort's advert (and thus cannot join) until the runner re-publishes it. The Phase-2 browser store/UX (02-03/02-04) must either tolerate up to the republish latency after a pick, or a follow-up should let the server replay all live adverts (or the store re-poll/retry). The directory (`/v1/directory`, HTTP poll) is unaffected: it lists all open cohorts regardless of the advert slot.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The PART-02 join-by-filter mechanism is shipped and unit + e2e verified; plans 02-03 (store `join(baseUrl, cohortId)`) and 02-04 (browse view) can wire UI onto a mechanism already proven deterministic.
- Carry forward the single-advert-slot finding above into 02-03's store lifecycle (post-pick join may need to wait for / retry against the advert republish for a non-latest cohort).
- No blockers.

## Self-Check: PASSED

- Created files exist on disk: `packages/participant/src/index.spec.ts`, `e2e/browse-join-cohort.ts`, `02-01-SUMMARY.md`.
- Task commits exist: `4c718db` (test), `eed2bfa` (feat), `3c2a9a9` (test/e2e).
- Plan verification re-run green: `pnpm vitest run packages/participant` (3 pass), `pnpm e2e:browse` exit 0, `tsc -b` clean, eslint clean on touched files.

---
*Phase: 02-participant-discovery-browse-and-pick-join*
*Completed: 2026-07-14*
