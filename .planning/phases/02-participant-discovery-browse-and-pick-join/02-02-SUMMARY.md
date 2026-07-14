---
phase: 02-participant-discovery-browse-and-pick-join
plan: 02
subsystem: web
tags: [participant, browse, directory, discovery, react, zustand-free, ui]

requires:
  - phase: 02-participant-discovery-browse-and-pick-join
    provides: "plan 01's CreateParticipantOptions.cohortId + the public DirectoryCohortDTO/ServiceStatus shipped in Phase 1"
provides:
  - "packages/web/src/lib/directory.ts: neutral participant-facing re-export of fetchDirectory/fetchStatus + DTO types, plus pure JOINABLE_PHASE/isJoinable/statusLabel/statusTone/beaconGloss helpers"
  - "browse/{ServiceIdentityHeader,DirectoryList,CohortRow,BrowseView}.tsx: the anonymous discover-first landing (header + ~5s-polled list) from the existing DTO and locked primitives"
  - "directoryView + fetchDirectoryState pure exports encoding the D-12 rows/empty/unreachable three-state split"
  - "App.tsx anonymous / branch renders BrowseView as the front door (D-13), replacing the KeyGen-first entry"
affects: [02-04-pick-and-join, participant-store, ParticipantView]

tech-stack:
  added: []
  patterns:
    - "D-12 split: track a reachable boolean separately from rows so a transient fetch error shows the distinct unreachable banner and never collapses into the benign empty state"
    - "Advertised-only joinability: isJoinable gates the join affordance while D-09's OPEN_PHASES governs display (all open phases listed)"
    - "Node-env hermetic component tests via pure exported state selectors (no jsdom/testing-library added)"

key-files:
  created:
    - packages/web/src/lib/directory.ts
    - packages/web/src/lib/directory.spec.ts
    - packages/web/src/components/browse/ServiceIdentityHeader.tsx
    - packages/web/src/components/browse/DirectoryList.tsx
    - packages/web/src/components/browse/CohortRow.tsx
    - packages/web/src/components/browse/DirectoryList.spec.ts
    - packages/web/src/components/browse/BrowseView.tsx
  modified:
    - packages/web/src/App.tsx

key-decisions:
  - "The DirectoryList spec is node-env pure-logic, not a DOM render test: the web package has no jsdom/testing-library and this phase adds zero packages (T-02-SC), so the D-12 three-state decision was factored into exported pure helpers (directoryView + fetchDirectoryState) and unit-tested. This is the plan's stated alternative ('assert on the component's state branch')."
  - "statusTone returns a narrow 'accent'|'warn'|'neutral' union assignable to the Badge tone prop, so no change to primitives.tsx was needed (the Tone type is not exported there)."
  - "Copy with apostrophes is written as literal JSX text (no react/no-unescaped-entities rule is active) so the acceptance greps match the exact UI-SPEC strings."

requirements-completed: [PART-01]

coverage:
  - id: D1
    description: "Pure browse helpers: isJoinable is Advertised-only + capacity-aware; statusLabel/statusTone/beaconGloss implement the D-08/D-09 plain-language contract"
    requirement: "PART-01"
    verification:
      - kind: unit
        ref: "packages/web/src/lib/directory.spec.ts#directory helpers"
        status: pass
    human_judgment: false
  - id: D2
    description: "DirectoryList D-12 states (rows / empty / unreachable) are never conflated; a fetch error shows the distinct auto-retry banner, not the empty copy"
    requirement: "PART-01"
    verification:
      - kind: unit
        ref: "packages/web/src/components/browse/DirectoryList.spec.ts#directoryView selector + fetchDirectoryState reducer"
        status: pass
    human_judgment: false
  - id: D3
    description: "The anonymous landing at / renders the service-identity header above the ~5s-polled directory of open cohorts with beacon gloss, network, seats, co-sign threshold, status badge, and copyable id; accent stays scarce (Open badge + Join only)"
    requirement: "PART-01"
    verification:
      - kind: build
        ref: "pnpm --filter @btcr2-aggregation/web build (tsc --noEmit + vite build clean)"
        status: pass
    human_judgment: true
    rationale: "Visual fidelity (focal heading, accent scarcity, live-poll appearance of a new row) is the Task 3 <human-check>, non-blocking; no automated test asserts the rendered pixels since the web package has no DOM test harness."

duration: 5 min
completed: 2026-07-14
status: complete
---

# Phase 2 Plan 02: Browse directory landing Summary

**Turned the participant landing at `/` into a discover-first browse surface: a neutral `lib/directory` module (public reads re-homed + pure joinability/label/gloss helpers) feeding a service-identity header and a ~5s-polled directory of the service's open cohorts, with distinct empty vs unreachable states, all from the existing `DirectoryCohortDTO` and the locked in-house primitives, and `BrowseView` wired as the front door replacing the old KeyGen-first entry (D-13).**

## Performance

- **Duration:** 5 min
- **Started:** 2026-07-14T20:16:14Z
- **Completed:** 2026-07-14T20:21:21Z
- **Tasks:** 3
- **Files created/modified:** 8 (7 created, 1 modified)

## Accomplishments
- `packages/web/src/lib/directory.ts`: a neutral, participant-facing surface that re-exports the public `fetchDirectory`/`fetchStatus` + `DirectoryCohortDTO`/`ServiceStatus` (keeping `credentials: 'omit'`, source of truth unchanged in `operator.ts`) and adds the pure `JOINABLE_PHASE`/`isJoinable`/`statusLabel`/`statusTone`/`beaconGloss` helpers. `isJoinable` encodes the Advertised-only join gate (a cohort locks membership at threshold the instant it leaves Advertised, RESEARCH Finding 3), the delta from D-09's display-oriented OPEN_PHASES.
- `browse/ServiceIdentityHeader.tsx`: the D-02 header polled from `GET /v1/status` (10s) with the origin as the single Display focal heading, the reused service-online dot, the active-network chip (incl. the mainnet `· REAL FUNDS` variant), and the truthful `{n} open cohorts` count.
- `browse/DirectoryList.tsx`: the ~5s-polled anonymous list (bounded interval + active guard) that SPLITS the single `.catch` into three distinct D-12 states via a pure `directoryView(reachable, rows)` selector plus a `fetchDirectoryState` reducer, so a transient error shows the auto-retry banner and never collapses into the benign empty state. Rows render newest-advertised first from the latest fetched DTO only (no parallel client list).
- `browse/CohortRow.tsx`: one presentational row from the primitives showing status badge (`statusTone`/`statusLabel`), beacon gloss chip, network chip, seats `{joined}/{capacity} seats` + `{n} open`/`Full`, `Co-sign: {threshold}-of-{threshold}`, and a `Cohort ID` CopyField. `Join` is a real function of joinability (disabled without an `onPick`; plan 04 supplies it), with accent kept scarce (Open badge + Join only) and no new 500-weight utility.
- `browse/BrowseView.tsx` + `App.tsx`: the anonymous `/` branch now renders `BrowseView` (header + directory, xl gap) as the front door (D-13); the unused `PublicStatus`/`ParticipantView` imports are dropped and the anonymous subtitle retitled to browse framing. Both component files are retained (only stop rendering at `/`).

## Task Commits

1. **Task 1 (RED): failing helper spec** - `2163cc1` (test)
2. **Task 1 (GREEN): lib/directory neutral surface + pure helpers** - `67ce3fe` (feat)
3. **Task 2: header + directory list + cohort row + D-12 spec** - `1c849fd` (feat)
4. **Task 3: BrowseView landing + App.tsx front door (D-13)** - `e20d14d` (feat)

_Task 1 followed TDD RED -> GREEN; no refactor was needed. Tasks 2 and 3 are non-TDD auto tasks committed once each._

## Files Created/Modified
- `packages/web/src/lib/directory.ts` - new; public read re-exports + pure joinability/label/tone/gloss helpers.
- `packages/web/src/lib/directory.spec.ts` - new; 16 hermetic unit tests for the helpers.
- `packages/web/src/components/browse/ServiceIdentityHeader.tsx` - new; the D-02 header (10s status poll).
- `packages/web/src/components/browse/DirectoryList.tsx` - new; ~5s directory poll + the D-12 three-state split (exports `directoryView`/`fetchDirectoryState`).
- `packages/web/src/components/browse/CohortRow.tsx` - new; presentational row from the primitives.
- `packages/web/src/components/browse/DirectoryList.spec.ts` - new; 8 hermetic tests that rows/empty/unreachable never conflate.
- `packages/web/src/components/browse/BrowseView.tsx` - new; the landing composition shell (header + directory).
- `packages/web/src/App.tsx` - modified; anonymous `/` renders `BrowseView`; removed the `PublicStatus`/`ParticipantView` imports + render; retitled the anonymous subtitle.

## Decisions Made
- **Node-env pure-logic tests instead of a DOM render harness.** The web package ships no jsdom/testing-library and this phase adds zero packages (threat T-02-SC accept). Rather than introduce a test framework, the D-12 render decision was factored into exported pure helpers (`directoryView` + `fetchDirectoryState`) and unit-tested in the default node env, faithfully realizing the plan's "assert on the component's state branch" alternative. Plan 04 (pick/join) should follow the same pattern or introduce a DOM harness deliberately if it needs interaction tests.
- **`statusTone` returns a narrow literal union** (`'accent'|'warn'|'neutral'`) assignable to the Badge `tone` prop, so `primitives.tsx` needed no change (its `Tone` type is not exported).
- **Literal-apostrophe JSX copy** for the exact UI-SPEC strings (no `react/no-unescaped-entities` rule is active), so the copy acceptance greps match verbatim.

## Deviations from Plan

### Approach adaptation

**1. [Rule 3 - Blocking-avoided] DirectoryList.spec.ts is a pure-logic node-env test, not a DOM render test**
- **Found during:** Task 2 (writing the browse spec)
- **Issue:** The plan's DirectoryList.spec.ts wording allows "assert on rendered text or on the component's state branch", but a `render()`-based text assertion needs jsdom + @testing-library/react, which the web package does not have; adding them violates the phase's zero-new-packages threat disposition (T-02-SC accept).
- **Fix:** Took the plan's explicit "component's state branch" path: exported the pure `directoryView` selector and the `fetchDirectoryState` reducer from `DirectoryList.tsx` and unit-tested them (with a mocked `fetchDirectory`) in the default node env, asserting the three D-12 states never conflate.
- **Files modified:** packages/web/src/components/browse/DirectoryList.tsx (added the two exports), packages/web/src/components/browse/DirectoryList.spec.ts
- **Verification:** `pnpm vitest run packages/web/src/components/browse` exits 0 (8 tests); rows/empty/unreachable are asserted distinct.
- **Committed in:** 1c849fd

---

**Total deviations:** 1 (a test-approach adaptation within the plan's stated allowance). **Impact:** none on shipped UI behavior; the D-12 logic is unit-covered and the components render it directly. The visual fidelity of the landing remains a non-blocking human-check (Task 3).

## Issues Encountered
- **No DOM test harness in `packages/web`.** Component rendering, accent scarcity, and the live-poll appearance of a new row are not automatically asserted (only the pure state logic is). Carry this into plan 04: interactive pick/join tests will need either the same pure-logic factoring or a deliberately added jsdom/testing-library harness.
- **Single most-recent advert slot (carried from 02-01).** Unaffected here: the directory reads `GET /v1/directory` over HTTP, which lists all open cohorts regardless of the SSE advert slot. Relevant to plan 04's post-pick join (may need to tolerate/retry the advert republish latency for a non-latest cohort).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The anonymous browse surface (header + polled directory) is shipped and the pure joinability/label/tone/gloss logic is unit-covered. Plan 04 can add `CohortRow`'s interactive `Join` (supply `onPick`) and the pick -> inline identity -> seated -> reused-tail region on top of this surface.
- `CohortRow` already accepts the optional `onPick` prop and renders Join disabled without it, so plan 04 wires the affordance with no row rewrite.
- No blockers.

## Self-Check: PASSED

- Created files exist on disk: `packages/web/src/lib/directory.ts`, `packages/web/src/lib/directory.spec.ts`, `packages/web/src/components/browse/{ServiceIdentityHeader,DirectoryList,CohortRow,BrowseView}.tsx`, `packages/web/src/components/browse/DirectoryList.spec.ts`, and this SUMMARY.
- Task commits exist: `2163cc1` (test), `67ce3fe` (feat), `1c849fd` (feat), `e20d14d` (feat).
- Plan verification re-run green: `pnpm vitest run packages/web/src/lib/directory.spec.ts packages/web/src/components/browse` (24 pass), `pnpm --filter @btcr2-aggregation/web exec tsc --noEmit` clean, `pnpm --filter @btcr2-aggregation/web build` clean, root `tsc -b` clean, eslint clean on touched files.
- `grep -c "ParticipantView" packages/web/src/App.tsx` == 0 (D-13 landing restructured); browse reads keep `credentials: 'omit'` (re-exported from `operator.ts`, unchanged).

---
*Phase: 02-participant-discovery-browse-and-pick-join*
*Completed: 2026-07-14*
