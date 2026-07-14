---
phase: 02-participant-discovery-browse-and-pick-join
plan: 04
subsystem: web
tags: [participant, browse-and-pick, join, identity, seated, react, ui]

requires:
  - phase: 02-participant-discovery-browse-and-pick-join
    provides: "plan 02's browse surface (BrowseView/DirectoryList/CohortRow + lib/directory helpers) and plan 03's store lifecycle join(baseUrl, cohortId)/seated/joinClosed/leave"
provides:
  - "browse/JoinIdentityStep.tsx: the inline KEY-generate / import identity panel revealed at Join, confirming into store.join(baseUrl, cohortId) with the always-visible custody note (D-04)"
  - "browse/CohortRow.tsx: onPick now carries the whole picked directory row (not just the id) so the identity step + seated confirmation read its live seats/status; Join enabled iff isJoinable (D-06 belt)"
  - "browse/BrowseView.tsx: the pick -> inline identity -> seated confirmation -> reused submit/co-sign/resolve tail (D-11) + Leave/filled-or-closed integration, with the participant store as the single lifecycle owner"
affects: [participant-store, ParticipantView, phase-3-tail-rewire]

tech-stack:
  added: []
  patterns:
    - "onPick carries the DirectoryCohortDTO (widened from cohortId) so the pick region reads seats/status from the picked row without a second directory poll"
    - "Store-owned lifecycle, component-owned pick: BrowseView holds only the local pickedRow snapshot and reads seated/joinClosed/result/error; every join/leave/seated transition stays in the Zustand store (RESEARCH Pitfall 4)"
    - "Reused-tail gate: the same hasResult gate ParticipantView used renders the four unchanged tail panels below the seated confirmation (D-11)"

key-files:
  created:
    - packages/web/src/components/browse/JoinIdentityStep.tsx
  modified:
    - packages/web/src/components/browse/CohortRow.tsx
    - packages/web/src/components/browse/BrowseView.tsx
    - packages/web/src/components/browse/DirectoryList.tsx

key-decisions:
  - "onPick was widened from (cohortId: string) to (row: DirectoryCohortDTO) so BrowseView receives the full picked row and can source joined/capacity/statusLabel for the inline identity step and the seated confirmation directly from it (the plan's 'source joined/capacity/statusLabel from the picked directory row'), avoiding a second directory poll in the component; DirectoryList's one-line prop type was widened to thread it through (a plan-02 file, a scoped Rule 3 pass-through change, not a tail file)."
  - "JoinIdentityStep keeps KeyGenPanel's KEY (k1) / EXTERNAL (x1) radiogroup verbatim (both onboarding models available, D-04) and layers the UI-SPEC generate/import button labels + custody note on top; the confirm's Joining state covers both status 'connecting' and 'live' so the panel stays in its in-flight state through the whole waiting-to-fill window."
  - "Leave and the filled/closed 'Back to directory' both call store.leave() AND clear the local pickedRow, so returning to browse is a single reset with no stale pick left rendering the identity step (no confirmation dialog, D-15)."

requirements-completed: [PART-01, PART-02]

coverage:
  - id: D1
    description: "The inline identity step is revealed at Join, reuses the store generate/importSecret (keys stay client-side), keeps the custody note visible, mints nothing on Cancel, and confirms into store.join(baseUrl, cohortId)"
    requirement: "PART-02"
    verification:
      - kind: build
        ref: "pnpm --filter @btcr2-aggregation/web exec tsc --noEmit + build (both exit 0)"
        status: pass
      - kind: grep
        ref: "JoinIdentityStep.tsx: importSecret>=1, generate>=1, join(>=1, configStatus>=1; copy 'Choose an identity to join' / custody note / 'Join cohort' present"
        status: pass
    human_judgment: true
    rationale: "That Cancel actually mints no key and the KEY/import choice renders correctly is the Task 2 <human-check> (visual + interaction); the web package has no DOM test harness, so no automated test drives the click path."
  - id: D2
    description: "Browse -> pick an open cohort -> confirm identity -> join by choice -> seated -> the unchanged tail co-signs a 64-byte aggregated signature and resolves (criterion 3, D-11)"
    requirement: "PART-02"
    verification:
      - kind: e2e
        ref: "pnpm e2e:browse (browse -> pick -> join -> seated -> 64-byte co-sign over real HTTP; join-by-filter selectivity + deterministic no-seat)"
        status: pass
    human_judgment: true
    rationale: "e2e:browse proves the headless browse-and-pick lifecycle end to end; the in-browser seated confirmation -> reused-tail visual flow to a resolve is the Task 2 <human-check> (no DOM harness in packages/web)."
  - id: D3
    description: "A non-joinable row disables Join; a pick that filled/closed during the poll returns to browse with the deterministic store message; Leave returns to the directory with no confirmation dialog"
    requirement: "PART-02"
    verification:
      - kind: grep
        ref: "CohortRow.tsx: onPick>=1 + isJoinable>=1 (Join enabled iff joinable); BrowseView.tsx: JoinIdentityStep>=1, hasResult>=1, leave>=1, seated + filled/closed copy strings present"
        status: pass
      - kind: e2e
        ref: "pnpm e2e:browse: the B-picker and the random-id picker reach no seat by A's hard-completion (deterministic no-seat, no dead spinner)"
        status: pass
    human_judgment: true
    rationale: "The disabled-Join appearance on a Filling/Full row and the return-to-browse banner UX are the Task 2 <human-check>; the deterministic no-seat is e2e-covered but its UI surfacing is visual."

duration: 2 min
completed: 2026-07-14
status: complete
---

# Phase 2 Plan 04: Pick-and-join, inline identity, seated confirmation Summary

**Completed the browse-and-pick loop in the UI: a participant browses the directory, clicks Join on an open row, confirms an identity inline (KEY-generate or import, with a persistent key-custody note and nothing minted on Cancel), joins that one cohort by choice via `store.join(baseUrl, cohortId)`, sees a seated confirmation, and the existing submit/co-sign/resolve tail keeps working unchanged (D-11), while a filled-or-closed pick returns to browse with a deterministic message and Leave returns to the directory - all with the participant store as the single lifecycle owner and zero new primitive/backend/protocol.**

## Performance

- **Duration:** 2 min
- **Started:** 2026-07-14T20:42:40Z
- **Completed:** 2026-07-14T20:45:19Z
- **Tasks:** 2
- **Files created/modified:** 4 (1 created, 3 modified)

## Accomplishments
- `browse/JoinIdentityStep.tsx` (NEW): the inline identity-at-Join panel extracted from the retired `KeyGenPanel`. It reuses the KEY (k1) / EXTERNAL (x1) radiogroup verbatim plus the store's `generate`/`importSecret`, gates generation on `configStatus === 'ready'` (so a DID is never minted on the wrong chain), shows the always-visible custody note `Your keys stay in this browser. This service never sees your private key.`, and once an identity exists offers a primary `Join cohort` (`Joining…` while connecting/live) that calls `join(baseUrl, cohortId)` plus a ghost `Cancel`. Generation runs only on the explicit click, so Cancel mints nothing (D-04). Composed only from the locked primitives + the store - no duplicated join/leave logic.
- `browse/BrowseView.tsx` (MODIFIED): now the full pick region. A local `pickedRow` snapshot (set only by an isJoinable row's `onPick`) drives four mutually-exclusive states off the store: default browse (`DirectoryList`), picked-not-seated (`JoinIdentityStep`), `seated` (a resting confirmation `You're seated in cohort {shortId}` + `Leave cohort`, then the reused tail on `hasResult`), and `joinClosed` (the store's deterministic `That cohort just filled or closed…` in a bad-tone banner + `Back to directory`). The four tail panels (`ResultCard`/`PublishPanel`/`RegisterPanel`/`ResolvePanel`) render below the seated confirmation via the exact `hasResult` gate ParticipantView used, unchanged (D-11).
- `browse/CohortRow.tsx` + `browse/DirectoryList.tsx` (MODIFIED): `onPick` was widened from `(cohortId: string)` to `(row: DirectoryCohortDTO)` so BrowseView receives the whole picked row and reads its live seats/status for the identity step and the seated confirmation, with no second directory poll. Join stays enabled exactly when `isJoinable(row) && onPick` (D-06 belt-and-suspenders to the server authority).
- Store-owned lifecycle preserved: BrowseView holds only the local pick and calls `join`/`leave`; every seated/joinClosed/result transition stays in the Zustand store (RESEARCH Pitfall 4). `Leave` and the filled/closed `Back to directory` both `leave()` and clear the local pick in one reset (no confirmation dialog, D-15).

## Task Commits

1. **Task 1: inline JoinIdentityStep identity panel revealed at Join** - `dd9a3b6` (feat)
2. **Task 2: wire pick -> identity -> seated -> reused tail + Leave** - `280a4d2` (feat)

_Non-TDD auto tasks (a UI-integration plan); each committed once. The store lifecycle they drive was TDD-covered in plan 03._

## Files Created/Modified
- `packages/web/src/components/browse/JoinIdentityStep.tsx` - new; the inline KEY-generate / import identity panel at Join.
- `packages/web/src/components/browse/BrowseView.tsx` - modified; pick -> identity -> seated -> reused tail + Leave + filled/closed integration.
- `packages/web/src/components/browse/CohortRow.tsx` - modified; `onPick` carries the picked row; Join enabled iff isJoinable.
- `packages/web/src/components/browse/DirectoryList.tsx` - modified; widened the `onPick` prop type to thread the row through (one-line pass-through).

## Decisions Made
- **`onPick` carries the whole `DirectoryCohortDTO`, not just the id.** The plan asks BrowseView to source `joined`/`capacity`/`statusLabel` "from the picked directory row", but DirectoryList owns the rows via its own poll. Widening `onPick` to pass the row gives BrowseView the exact picked-row snapshot at click time without duplicating a second poll in the component, and keeps the row's seats/status consistent across the identity step and the seated confirmation. The grep contracts (`onPick` in CohortRow, `JoinIdentityStep`/`hasResult` in BrowseView) and the key_links (onPick fires only from an isJoinable row) are unchanged.
- **The confirm's `Joining…` state covers both `connecting` and `live`.** After the opt-in is sent the runner goes `connecting -> live` (cohort-joined) before the definitive `cohort-ready` seat; treating both as in-flight keeps the confirm from flashing back to an enabled `Join cohort` while waiting for the cohort to fill.
- **KEY/EXTERNAL radiogroup kept verbatim from KeyGenPanel.** Both onboarding models stay available at Join (D-04); the UI-SPEC generate/import button labels + custody note are layered on top of the reused radiogroup markup rather than replacing it.

## Deviations from Plan

### Approach adaptation

**1. [Rule 3 - Blocking-avoided] Widened `onPick` to carry the row; touched DirectoryList (a plan-02 file) for the one-line prop-type thread**
- **Found during:** Task 2
- **Issue:** BrowseView must render `<JoinIdentityStep joined capacity statusLabel .../>` sourced "from the picked directory row", but the rows live inside `DirectoryList`'s self-poll; passing only `cohortId` up would force a second directory fetch in the component.
- **Fix:** Changed `CohortRow`'s `onPick` from `(cohortId: string)` to `(row: DirectoryCohortDTO)` (calling `onPick(row)`) and widened `DirectoryList`'s `onPick` prop type to match (a pure pass-through). BrowseView now holds the picked row and reads seats/status from it directly.
- **Files modified:** packages/web/src/components/browse/CohortRow.tsx, packages/web/src/components/browse/DirectoryList.tsx
- **Verification:** `tsc --noEmit` + `build` clean; `pnpm e2e:browse` green; the DirectoryList pure-logic spec (`directoryView`/`fetchDirectoryState`) still passes (8 tests); the four tail files untouched.
- **Committed in:** `280a4d2`

---

**Total deviations:** 1 (a scoped prop-type widening within the plan's own `<files>` set + a one-line pass-through in a same-phase plan-02 file). **Impact:** none on the shipped lifecycle - the store remains the single owner and no tail file was touched. The change strictly improves data locality (no second poll).

## Issues Encountered
- **No DOM test harness in `packages/web` (carried from 02-02/02-03).** The interactive click paths (Cancel mints nothing, the disabled-Join appearance, the seated -> tail visual flow) are the Task 2 `<human-check>`, non-blocking; `e2e:browse` covers the headless browse -> pick -> join -> seated -> 64-byte co-sign lifecycle and the deterministic no-seat, but not the rendered pixels.
- **Advert-republish latency for a non-latest picked cohort (carried from 02-01).** Unchanged here: the store's join-time poll and `shouldJoin` filter both work off the picked `cohortId` against `/v1/directory` (the HTTP source of truth over all live cohorts), which `e2e:browse` exercises with two concurrent adverts. No dead-spin: a lost pick resolves to `joinClosed` deterministically.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The Phase 2 browse-and-pick loop is complete end to end: a stranger browses the directory, picks an open cohort, confirms an identity inline, joins by choice, is seated, and the shipped submit/co-sign/resolve tail still completes (PART-01 + PART-02, criterion 3). `e2e:browse` proves it hermetically.
- Phase 3 owns the reused tail (`RegisterPanel`/`PublishPanel`/`ResolvePanel`/`ResultCard`) rewire; this plan left those four files untouched (D-11). `BrowseView` reveals them via the same `hasResult` gate, so the Phase 3 rewire is a drop-in below the seated confirmation.
- No blockers.

## Self-Check: PASSED

- Created/modified files exist on disk: `packages/web/src/components/browse/JoinIdentityStep.tsx` (new), `packages/web/src/components/browse/{BrowseView,CohortRow,DirectoryList}.tsx` (modified), and this SUMMARY.
- Task commits exist: `dd9a3b6` (feat/Task 1), `280a4d2` (feat/Task 2).
- Plan verification re-run green: `pnpm --filter @btcr2-aggregation/web exec tsc --noEmit` exit 0, `pnpm --filter @btcr2-aggregation/web build` clean, `pnpm e2e:browse` PASSED (64-byte co-sign for the picked cohort + join-by-filter selectivity + deterministic no-seat), `pnpm vitest run` browse/store/directory specs 33 pass, eslint clean on the four touched files.
- Acceptance greps: JoinIdentityStep `importSecret`>=1 / `generate`>=1 / `join(`>=1 / `configStatus`>=1 + the three copy strings; CohortRow `onPick`>=1 / `isJoinable`>=1; BrowseView `JoinIdentityStep`>=1 / `hasResult`>=1 / `leave`>=1 + seated/closed copy present; the four tail files (`RegisterPanel`/`PublishPanel`/`ResolvePanel`/`ResultCard`) NOT in `git diff --name-only` (D-11). Zero em-dash characters in any touched `.tsx`.

---
*Phase: 02-participant-discovery-browse-and-pick-join*
*Completed: 2026-07-14*
