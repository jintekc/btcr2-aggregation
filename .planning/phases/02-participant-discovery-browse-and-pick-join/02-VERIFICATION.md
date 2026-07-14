---
phase: 02-participant-discovery-browse-and-pick-join
verified: 2026-07-14T21:30:00Z
status: human_needed
score: 10/10 must-haves verified
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Load / (anonymous) with no cohorts advertised, then advertise a cohort as operator at /operator and return to /, then stop the service and reload /."
    expected: "The service-identity header shows the origin, `Service online`, the active network, and `No open cohorts right now` when empty; within ~5s of advertising, a row appears showing beacon type + gloss, network, `1/1 seats`, `Co-sign: 1-of-1` (or configured threshold), the `Open` accent badge, and a copyable Cohort ID; when the service is unreachable, the distinct `Can't reach this service` retry banner shows (not the empty copy). Accent appears only on the Open badge + the (disabled) Join button + the wordmark/active nav."
    why_human: "Visual fidelity (focal heading, accent scarcity, live-poll appearance of a new row, distinct empty/unreachable banners) cannot be asserted by grep/unit tests; packages/web has no DOM render harness (deliberately, to avoid adding a new package, T-02-SC). Deferred from checkpoint:human-verify to end-of-phase per PLAN 02-02 Task 3 <human-check> (non-blocking)."
  - test: "As operator at /operator advertise a 2-of-2 cohort; in a second anonymous tab at /, click Join on the Open row, Cancel once before generating a key, then Generate a KEY identity and click Join cohort while a second participant fills the cohort; separately, advertise a 1-of-1 that fills before confirming and try to join it; then use Leave cohort from a seated state."
    expected: "A joinable row shows an enabled Join; a Filling/Full row shows Join disabled. Clicking Join reveals the inline identity step (KEY/import choice + custody note); Cancel returns to the directory having minted no key. Confirming Join cohort with a filling partner reaches the seated confirmation 'You're seated in cohort ...', and the existing co-sign/resolve tail proceeds to a 64-byte signature + resolve. Trying to join an already-filled cohort yields 'That cohort just filled or closed. Pick another from the directory.' and returns to browse with no dead spinner. Leave cohort returns to the directory with no confirmation dialog."
    why_human: "Visual fidelity + interaction sequencing (disabled-Join appearance, Cancel-mints-nothing, the seated-to-tail visual transition, the filled/closed banner) cannot be asserted without a DOM harness; the headless equivalent (join-by-filter selectivity, deterministic no-seat, 64-byte co-sign) is proven by the automated `pnpm e2e:browse` capstone, but the in-browser click path itself is not driven by any automated test. Deferred from checkpoint:human-verify to end-of-phase per PLAN 02-04 Task 2 <human-check> (non-blocking)."
---

# Phase 2: Participant Discovery + Browse-and-Pick Join Verification Report

**Phase Goal:** A participant pointed at a service's URL can browse that service's advertised open cohorts and join one of their choosing, replacing the `shouldJoin` auto-accept of whatever advert arrives.
**Verified:** 2026-07-14T21:30:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | (ROADMAP SC1) A participant pointed at a service's URL sees a list of that service's advertised open cohorts, each showing beacon type, network, open seats, and status | ✓ VERIFIED | `packages/web/src/components/browse/{ServiceIdentityHeader,DirectoryList,CohortRow}.tsx` render from `GET /v1/directory`/`GET /v1/status`; `App.tsx` renders `BrowseView` at `/` (grep `ParticipantView` in App.tsx == 0); `pnpm e2e:browse` confirms directory shows both advertised cohorts with correct fields |
| 2 | (ROADMAP SC2) The participant selects a specific open cohort from the directory and joins it by choice, rather than auto-joining whatever advert arrives | ✓ VERIFIED | `matchesPickedCohort(pickedCohortId, advertCohortId)` gates `shouldJoin` in `packages/participant/src/index.ts:48-52,147-155`; store `join(baseUrl, cohortId)` threads the picked id (`participant.ts:495,524`); `CohortRow.onPick` fires only on `isJoinable(row)` rows |
| 3 | (ROADMAP SC3) A joined participant is seated in the chosen cohort (counts against capacity), and a full or closed cohort cannot be joined | ✓ VERIFIED | `seated` flips only in the `cohort-ready` handler (`participant.ts:558-567`); `isJoinable` gates the UI Join button (`CohortRow.tsx:28`); `pickedCohortClosed`/`handleDirectorySnapshot` resolve a filled/closed pick deterministically (`participant.ts:332-334,688-719`), regression-tested (`protects an opted-in member ... (CR-01)` in `participant.spec.ts`) |
| 4 | join-by-filter: a participant with a picked cohortId joins ONLY that cohort and ignores every other advert; the hermetic capstone proves it end to end | ✓ VERIFIED | `packages/participant/src/index.spec.ts` (3 pass); `pnpm e2e:browse` exit 0 — cohort A co-signs a 64-byte aggregate, cohort B stays at 0 seats, a random-id picker reaches no seat |
| 5 | cohort-ready (not cohort-joined) is the definitive seat authority | ✓ VERIFIED | `participant.ts:541` (`cohort-joined` sets `optedIn: true`, not `seated`) vs `participant.ts:563` (`cohort-ready` sets `seated: true`); e2e capstone asserts the signed cohort id === picked cohort A |
| 6 | Directory empty and service-unreachable are distinct states (D-12); a fetch error never collapses into the benign empty state | ✓ VERIFIED | `DirectoryList.tsx` `directoryView`/`fetchDirectoryState` three-state split; `DirectoryList.spec.ts` (8 pass) asserts rows/empty/unreachable never conflate |
| 7 | Browse reads are anonymous (`credentials:'omit'`) and the DTO exposes only counts, never member DIDs/keys | ✓ VERIFIED | `lib/directory.ts` re-exports `fetchDirectory`/`fetchStatus` from `lib/operator.ts` unchanged (`credentials:'omit'` verified at source); `DirectoryCohortDTO` fields are counts/ids only (confirmed in code review, no widening) |
| 8 | The vague no-advert watchdog is removed; a deterministic directory-driven "filled or closed" outcome replaces it, without tearing down a genuinely-seated-pending member (CR-01 race fix) | ✓ VERIFIED | `grep -c 'JOIN_WATCHDOG_MS' participant.ts` == 0, `grep -c 'joinWatchdog'` == 0; `optedIn` field + `JOIN_SEAT_GRACE_MS` (90s) backstop timer (`participant.ts:132,284,538-556`) + `!optedIn` guard in `handleDirectorySnapshot` (`participant.ts:700-708`); regression test `protects an opted-in member when the picked cohort leaves Advertised (CR-01)` passes in the 277-test suite |
| 9 | An explicit inline identity step is revealed at Join (reusing KEY-generate/import); Cancel mints no key; after cohort-ready the participant sees a seated confirmation from which the unchanged co-sign/resolve tail continues | ✓ VERIFIED (behavior-dependent; click-path visual confirmation is human-check, see below) | `JoinIdentityStep.tsx` (`importSecret`/`generate`/`join(` present, gated on `configStatus`); `BrowseView.tsx` `hasResult` gate renders `ResultCard`/`PublishPanel`/`RegisterPanel`/`ResolvePanel` unchanged (git diff confirms those 4 files untouched); `pnpm e2e:browse` proves the headless lifecycle to a 64-byte co-sign |
| 10 | Leave cohort returns to the directory with no confirmation dialog; a full/closed cohort cannot be joined from the UI (belt-and-suspenders); one cohort at a time | ✓ VERIFIED | `BrowseView.tsx` `backToDirectory()` calls `leave()` + clears local pick, no dialog; `CohortRow.tsx` Join disabled unless `isJoinable(row) && onPick`; `leave()` tears down the live participant and resets all lifecycle fields (`participant.ts:721-741`) |

**Score:** 10/10 truths verified (0 present-but-behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/participant/src/index.ts` | `CreateParticipantOptions.cohortId?` + exported `matchesPickedCohort` | ✓ VERIFIED | Present, exported, used in `shouldJoin` guard (line 152) |
| `e2e/browse-join-cohort.ts` | Hermetic browse→pick→join→seated→co-sign capstone | ✓ VERIFIED | Exists; `pnpm e2e:browse` exits 0 |
| `package.json` | `e2e:browse` script | ✓ VERIFIED | `grep -c "browse-join-cohort" package.json` == 1 |
| `packages/web/src/lib/directory.ts` | Neutral reads + `isJoinable`/`statusLabel`/`statusTone`/`beaconGloss` | ✓ VERIFIED | All present, unit-tested (16 tests in `directory.spec.ts`) |
| `packages/web/src/components/browse/{ServiceIdentityHeader,DirectoryList,CohortRow,BrowseView}.tsx` | Discover-first landing | ✓ VERIFIED | All present, wired into `App.tsx`, build clean |
| `packages/web/src/App.tsx` | Anonymous `/` renders `BrowseView` | ✓ VERIFIED | `grep -c "BrowseView" App.tsx` >= 1; `grep -c "ParticipantView" App.tsx` == 0 |
| `packages/web/src/stores/participant.ts` | `join(baseUrl, cohortId)`, `seated`/`joinClosed`/`optedIn`, `pickedCohortClosed`, `handleDirectorySnapshot` | ✓ VERIFIED | All present; `JOIN_WATCHDOG_MS`/`joinWatchdog` fully removed |
| `packages/web/src/components/browse/JoinIdentityStep.tsx` | Inline KEY-generate/import panel at Join | ✓ VERIFIED | Present; `importSecret`/`generate`/`join(`/`configStatus` all present; copy strings match UI-SPEC |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `packages/participant/src/index.ts` | `@did-btcr2/aggregation` participant runner | `shouldJoin` guarded by `matchesPickedCohort` | ✓ WIRED | Confirmed at source; e2e proves runtime selectivity |
| `e2e/browse-join-cohort.ts` | `createParticipant` | `{ identity, baseUrl, cohortId }` | ✓ WIRED | e2e passes |
| `packages/web/src/App.tsx` | `BrowseView.tsx` | anonymous `/` branch | ✓ WIRED | `grep` confirms; build clean |
| `DirectoryList.tsx` | `GET /v1/directory` | `fetchDirectory(baseUrl)` polled ~5s, `credentials:'omit'` | ✓ WIRED | `grep -c "5000"` >= 1, `grep -c "clearInterval"` >= 1 |
| `CohortRow.tsx` | `lib/directory.ts` | `isJoinable`/`statusLabel` drive the row | ✓ WIRED | Confirmed at source |
| `packages/web/src/stores/participant.ts` | `createParticipant` | `join(baseUrl, cohortId)` → `createParticipant({..., cohortId})` | ✓ WIRED | Confirmed at source (line 524) |
| `packages/web/src/stores/participant.ts` | `lib/operator.ts fetchDirectory` | bounded ~5s poll drives `handleDirectorySnapshot` | ✓ WIRED | Confirmed at source (lines 673-680) |
| `CohortRow.tsx` | `BrowseView.tsx` | `onPick(row)` fires only on isJoinable rows | ✓ WIRED | Confirmed at source; `DirectoryList` passes through |
| `JoinIdentityStep.tsx` | `stores/participant.ts` | `generate`/`importSecret` then `join(baseUrl, cohortId)` | ✓ WIRED | Confirmed at source |
| `BrowseView.tsx` | reused participant tail | `hasResult` gate renders unchanged tail panels | ✓ WIRED | Confirmed at source; the 4 tail files (`RegisterPanel`/`PublishPanel`/`ResolvePanel`/`ResultCard`) untouched per SUMMARY + `git log` |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full unit test suite | `pnpm test` | 277 tests pass (26 files) | ✓ PASS |
| Typecheck (all packages) | `pnpm typecheck` | clean | ✓ PASS |
| Web build | `pnpm --filter @btcr2-aggregation/web build` | `tsc --noEmit` + `vite build` clean | ✓ PASS |
| Browse→pick→join→co-sign hermetic capstone | `pnpm e2e:browse` | exit 0 — cohort A co-signs 64-byte aggregate; cohort B stays at 0 seats; random-id picker reaches no seat | ✓ PASS |
| Phase 1 regression (operator lifecycle unaffected) | `pnpm e2e:operator` | exit 0 — login→create→advertise→co-sign, auth negatives, on-demand-only driver all pass | ✓ PASS |
| CR-01 regression test present and passing | `pnpm test` (participant.spec.ts) | `protects an opted-in member when the picked cohort leaves Advertised (CR-01)` passes | ✓ PASS |

### Probe Execution

Not applicable — this phase has no `scripts/*/tests/probe-*.sh` convention; verification uses the project's vitest + tsx e2e gates above instead.

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|----------------|--------------|--------|----------|
| PART-01 | 02-01, 02-02, 02-04 | Participant can browse a service's advertised open cohorts with enough detail to choose | ✓ SATISFIED | `BrowseView`/`DirectoryList`/`CohortRow`/`ServiceIdentityHeader`; REQUIREMENTS.md marked Complete |
| PART-02 | 02-01, 02-03, 02-04 | Participant can join an advertised open cohort of their choice (browse-and-pick) | ✓ SATISFIED | `matchesPickedCohort`, `join(baseUrl, cohortId)`, `onPick`/`JoinIdentityStep`; REQUIREMENTS.md marked Complete |

No orphaned requirements: both PART-01 and PART-02 are mapped to Phase 2 in REQUIREMENTS.md and both are claimed by at least one of the 4 plans.

### Anti-Patterns Found

None blocking. Debt-marker scan (`TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER`) across all 8 phase-touched source files returned zero matches. No em-dash characters in touched files (project convention).

5 open **info**-level findings remain from the deep code review (`02-REVIEW.md`, non-blocking, tracked, not phase-goal blockers):
- IN-01: `KeyGenPanel.tsx`/`ParticipantView.tsx` are now dead code (unreachable since `App.tsx` no longer renders them) — cosmetic/cleanup only.
- IN-02: `createParticipant`'s JSDoc header still says "auto-joins every advertised cohort," understating the picked-cohort filter it now implements. Confirmed still present at `packages/participant/src/index.ts:91-95` (stale doc, not a behavioral gap — the code behaves correctly, per Truth 4 above).
- IN-03: The seated confirmation reads seat counts from the frozen `pickedRow` snapshot (not re-polled), so `{joined}/{capacity}` can go stale after pick. Confirmed still present at `BrowseView.tsx:90-92`.
- IN-04: `ServiceIdentityHeader` blanks to `null` on a transient fetch error rather than keeping the last-good status (inconsistent with `DirectoryList`'s keep-stale behavior). Confirmed still present at `ServiceIdentityHeader.tsx:29-32`.
- IN-05: The join-time poll/live runner are module-scoped and have no BrowseView unmount safety net (latent; today's route change is a full page load so module state resets).

None of these block the phase goal: browsing, picking, joining, seating, and the full co-sign/resolve lifecycle all work end to end per the e2e capstone and the unit/store test coverage. The 1 critical + 2 warning findings from the same review (CR-01/WR-01/WR-02) were verified FIXED in code (not just claimed) as detailed in Truths 3, 8, and the BrowseView `status === 'failed'` branch.

### Human Verification Required

1. **Browse directory landing visual fidelity** (deferred from PLAN 02-02 Task 3 `<human-check>`, non-blocking)
   - **Test:** Load `/` anonymously with no cohorts advertised, advertise one as operator, return to `/`, then stop the service and reload.
   - **Expected:** Empty state shows `No open cohorts right now`; a new row appears within ~5s showing beacon type + gloss, network, seats, co-sign threshold, `Open` accent badge, copyable Cohort ID; unreachable shows the distinct `Can't reach this service` banner (not the empty copy); accent stays scarce.
   - **Why human:** No DOM render harness exists in `packages/web` (deliberately, to avoid a new test-framework dependency); visual/interaction fidelity cannot be grepped.

2. **Pick → identity → join → seated → tail visual/interaction flow** (deferred from PLAN 02-04 Task 2 `<human-check>`, non-blocking)
   - **Test:** As operator, advertise a 2-of-2 cohort; from a second anonymous tab, click Join, Cancel once, then generate an identity and confirm Join while a second participant fills the cohort; separately try to join a cohort that fills first; use Leave cohort from a seated state.
   - **Expected:** Non-joinable rows show disabled Join; Cancel mints no key; a successful join reaches the seated confirmation and the reused tail proceeds to a 64-byte co-sign + resolve; a lost pick shows the deterministic filled/closed message and returns to browse; Leave returns to the directory with no dialog.
   - **Why human:** Same DOM-harness gap; the headless equivalent (`pnpm e2e:browse`) proves the underlying lifecycle and selectivity, but not the rendered click path.

### Gaps Summary

No gaps found. All 3 ROADMAP success criteria and all 10 consolidated must-have truths across the 4 plans (02-01 through 02-04) are verified against the actual codebase: the join-by-filter mechanism is real and proven by a fresh hermetic e2e capstone (not just claimed), the browse directory renders from the existing public DTO with anonymous reads, the store's join lifecycle is deterministic (watchdog removed, replaced by a directory-driven outcome that was itself found racy by code review — CR-01 — and the fix (the `optedIn` field + `JOIN_SEAT_GRACE_MS` grace timer + the `!optedIn` guard) is confirmed present in code and covered by a passing regression test, not merely claimed in SUMMARY.md. The UI wiring (JoinIdentityStep, CohortRow onPick, BrowseView pick/seated/tail/leave) is confirmed at the source level and the full gate (277 unit tests, typecheck, web build, `pnpm e2e:browse`, `pnpm e2e:operator` regression) was re-run independently and passed. The only outstanding items are two non-blocking, plan-deferred visual-fidelity human-checks and 5 informational code-review findings (none of which contradict the phase goal).

---

_Verified: 2026-07-14T21:30:00Z_
_Verifier: Claude (gsd-verifier)_
