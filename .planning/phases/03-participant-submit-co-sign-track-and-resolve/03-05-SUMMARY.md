---
phase: 03-participant-submit-co-sign-track-and-resolve
plan: 05
subsystem: ui
tags: [react, zustand, tailwind, did-btcr2, participant, cohort, musig2]

# Dependency graph
requires:
  - phase: 03-04
    provides: "participant store stage model (deriveStage render authority, pendingSubmit/submitUpdate, anchor slice, preSeatFitWarning)"
  - phase: 03-02
    provides: "public GET /v1/anchor/:cohortId enabled bit for the submit-panel mode probe"
  - phase: 03-03
    provides: "widened directory DISPLAY set (in-flight signing phases surfaced to participants)"
  - phase: 02
    provides: "browse-and-pick loop, JoinIdentityStep, CohortRow, DirectoryList, ui/primitives"
provides:
  - "The one continuous live cohort page (CohortPage) rendering the D-01 stage timeline through the mode-honest Signed state"
  - "StageTimeline: full-journey timeline from deriveStage with the quiet Active-for indicator (D-05) and shared STAGE_LABEL"
  - "SubmitPanel: explicit submit moment (preview + one consent line + submit-window urgency) with no second gate (D-14)"
  - "JoinIdentityStep D-18 identity reuse default + D-19 non-blocking fit warning"
  - "Directory row seated affordance (You're in this cohort + View cohort) and the persistent Your cohort link (D-03/D-04)"
  - "Standalone stepper fully retired: the directory is the only entry path (D-31, criterion 4)"
affects: [03-06, participant-resolve, degraded-states, ui-review]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure deriveStage render authority drives the timeline, the persistent chip, and CohortPage view routing from one store fact"
    - "App-owned participant view toggle (cohort/browse) so a single persistent link agrees with BrowseView"
    - "Component-local anchor mode probe (GET /v1/anchor enabled bit) keeps the submit consent line mode-honest before the post-sign poll"

key-files:
  created:
    - packages/web/src/components/cohort/StageTimeline.tsx
    - packages/web/src/components/cohort/CohortPage.tsx
    - packages/web/src/components/cohort/SubmitPanel.tsx
  modified:
    - packages/web/src/components/browse/BrowseView.tsx
    - packages/web/src/components/browse/CohortRow.tsx
    - packages/web/src/components/browse/JoinIdentityStep.tsx
    - packages/web/src/components/browse/DirectoryList.tsx
    - packages/web/src/App.tsx
    - packages/web/src/stores/participant.ts
    - packages/web/src/lib/directory.ts

key-decisions:
  - "The active-lifecycle branch (connecting/live/complete) mounts CohortPage; terminal failures keep the shipped joinClosed/failed cards for now (D-24/D-25 cohort-page absorption is 03-06)."
  - "SubmitPanel probes the public anchor endpoint for the broadcast-mode bit so the consent line is mode-honest at submit time, before the post-sign anchor poll runs."
  - "statusLabel maps in-flight signing phases to 'In progress' BEFORE the Full check, so a busy full cohort reads In progress not Full (D-26)."

patterns-established:
  - "Pattern 1: one continuous cohort surface routed by deriveStage, no per-stage screens"
  - "Pattern 2: shared STAGE_LABEL from StageTimeline is the single stage-naming source for the chip, the link, and the timeline"

requirements-completed: [PART-03]

coverage:
  - id: D1
    description: "CohortPage renders the full D-01 stage timeline upfront through the mode-honest Signed state, driven by deriveStage; empty state renders when unjoined"
    requirement: PART-03
    verification:
      - kind: e2e
        ref: "pnpm e2e:browse (browse -> pick -> join -> co-sign over real HTTP)"
        status: pass
      - kind: manual_procedural
        ref: "visual verify of timeline / identity section / Signed copy deferred to end-of-phase human verify (human_verify_mode: end-of-phase)"
        status: unknown
    human_judgment: true
    rationale: "The stage timeline, identity section, and Signed copy are visual surfaces; UI-SPEC conformance and the mode-honest Signed line need a human look (config: human_verify_mode=end-of-phase)."
  - id: D2
    description: "SubmitPanel shows preview + collapsed raw-JSON expander + one anchor.enabled-branched consent line + submit CTA + submit-window title urgency, no second gate"
    requirement: PART-03
    verification:
      - kind: manual_procedural
        ref: "end-of-phase human verify: open a submit window, confirm consent branch + tab-title escalation + single CTA"
        status: unknown
    human_judgment: true
    rationale: "The submit-window urgency (heading escalation + tab title) and the hermetic/live consent branch are interaction/visual behaviors verified at the end-of-phase human check."
  - id: D3
    description: "In-flight signing rows read 'In progress' (D-26) via statusLabel"
    requirement: PART-03
    verification:
      - kind: unit
        ref: "packages/web/src/lib/directory.spec.ts#maps an in-flight signing phase -> In progress even when full (D-26)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Directory row seated affordance (You're in this cohort + View cohort), Join disabled on other rows while active, and the persistent Your cohort link"
    requirement: PART-03
    verification:
      - kind: manual_procedural
        ref: "end-of-phase human verify: seated row affordance + one-cohort-at-a-time + persistent link navigation"
        status: unknown
    human_judgment: true
    rationale: "Row-state flips on the live poll and the persistent-link navigation are visual/interaction behaviors for the end-of-phase human check."
  - id: D5
    description: "Standalone stepper retired: KeyGenPanel deleted, generate/import lives only in JoinIdentityStep, the directory is the only entry path"
    requirement: PART-03
    verification:
      - kind: unit
        ref: "grep: no import references to FlowStepper/ParticipantView/KeyGenPanel; tsc -b + vite build clean"
        status: pass
    human_judgment: false

# Metrics
duration: 21min
completed: 2026-07-17
status: complete
---

# Phase 03 Plan 05: Live cohort page (submit through mode-honest Signed) Summary

**One continuous cohort page - stage timeline, explicit submit moment (preview + consent + urgency), compact identity + technical/activity expander, seated directory row + persistent Your cohort link - reached only from the directory, with the standalone stepper deleted.**

## Performance

- **Duration:** 21 min
- **Started:** 2026-07-17T15:52:00Z
- **Completed:** 2026-07-17T16:11:00Z
- **Tasks:** 3
- **Files modified:** 12 (3 created, 8 modified, 1 deleted)

## Accomplishments
- Built the one live cohort page (CohortPage) that absorbs the Phase-2 waiting/seated states into a single surface driven by the pure `deriveStage` render authority: the full stage timeline upfront (Waiting for seats -> Seated -> Submit update -> Co-signing -> Signed) with a pulsing accent active dot + quiet "Active for {mm:ss}" indicator (D-05), the mode-honest Signed copy (D-07), a compact identity section with the key-custody note, the keep-tab-open note, and a scrolling technical-detail expander holding the raw protocol facts + timestamped activity log (D-06/D-27).
- Built SubmitPanel: the explicit submit moment with the plain-language preview lead, a collapsed-by-default raw signed-update JSON expander, one beacon-commitment consent line branched on the service broadcast mode (D-14), the D-13 submit-window urgency (escalated heading + tab-title change restored on close), and a single submit CTA calling `submitUpdate()`. No second mid-round approval gate.
- Upgraded JoinIdentityStep with D-18 (reuse the current identity as the default, so the same DID can accumulate a version N+1 update across cohorts) and D-19 (render `preSeatFitWarning` as an informed, non-blocking "join anyway" note).
- Rewired BrowseView to mount CohortPage on the active joined-cohort lifecycle (internal SPA view, D-11); added the App-owned view toggle + persistent "Your cohort . {stage}" header link with a live StatusDot (D-03); gave CohortRow the seated "You're in this cohort" + View cohort affordance and one-cohort-at-a-time Join disabling (D-04); and deleted KeyGenPanel so the directory is the only entry path (D-31, criterion 4).

## Task Commits

Each task was committed atomically:

1. **Task 1: StageTimeline + CohortPage shell + identity/expander (with SubmitPanel + store accessor, needed to build)** - `305fce4` (feat)
2. **Task 2: SubmitPanel wiring via JoinIdentityStep D-18/D-19** - `abe44a6` (feat)
3. **Task 3: mount CohortPage in BrowseView + directory row state + Your cohort link + delete stepper** - `448bf2a` (feat)

**Plan metadata:** (this SUMMARY + STATE/ROADMAP) - docs commit follows.

## Files Created/Modified
- `packages/web/src/components/cohort/StageTimeline.tsx` - full-journey timeline from a single Stage; exports STAGE_LABEL and the quiet elapsed indicator.
- `packages/web/src/components/cohort/CohortPage.tsx` - the one continuous cohort surface (timeline, submit, Signed, identity, keep-tab note, technical/activity expander, Leave confirm).
- `packages/web/src/components/cohort/SubmitPanel.tsx` - preview + consent + submit-window urgency; component-local anchor mode probe.
- `packages/web/src/components/browse/BrowseView.tsx` - mounts CohortPage on the active lifecycle; view toggle + persistent link; keeps terminal cards for now.
- `packages/web/src/components/browse/CohortRow.tsx` - seated "You're in this cohort" + View cohort; reads store for seated/pickedCohortId.
- `packages/web/src/components/browse/JoinIdentityStep.tsx` - D-18 reuse default + D-19 non-blocking fit warning; takes the picked row.
- `packages/web/src/components/browse/DirectoryList.tsx` - threads the onView handler to CohortRow.
- `packages/web/src/App.tsx` - owns the participant view toggle; surfaces the persistent "Your cohort . {stage}" header link.
- `packages/web/src/stores/participant.ts` - added the additive `pendingSubmitUpdate()` accessor.
- `packages/web/src/lib/directory.ts` - statusLabel maps in-flight signing phases to "In progress" (D-26).
- `packages/web/src/lib/directory.spec.ts` - test for the new In progress label.
- `packages/web/src/components/participant/KeyGenPanel.tsx` - DELETED (stepper retirement).

## Decisions Made
- Active-lifecycle branch (connecting/live/complete) mounts CohortPage; terminal failures (joinClosed / general failed) keep the shipped Phase-2 error cards. The plan lists "terminal" among the CohortPage states, but the full D-24/D-25 degraded cohort-page states are explicitly 03-06; routing them to CohortPage now would regress the shipped recovery UX with no must_have coverage in this plan. Documented so 03-06 absorbs them.
- SubmitPanel reads the broadcast-mode bit from the public anchor endpoint (`enabled`) at submit time, since the store's `anchor` slice is null until the post-sign poll. The endpoint reports `enabled` regardless of cohort state, so the consent line stays mode-honest; on a probe failure it defaults to the conservative hermetic copy (claims nothing is published to Bitcoin).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] statusLabel did not map in-flight phases to "In progress"**
- **Found during:** Task 3 (directory row state)
- **Issue:** The must_have and Task 3 state that in-flight rows read "In progress" "from statusLabel (D-26)", but `statusLabel` returned the raw phase (e.g. "SigningStarted"), and a full signing cohort would even read "Full". `directory.ts` was not in `files_modified`.
- **Fix:** Added an `IN_FLIGHT_PHASES` set (mirroring the service) and mapped it to "In progress" BEFORE the Full check; added a unit test.
- **Files modified:** packages/web/src/lib/directory.ts, packages/web/src/lib/directory.spec.ts
- **Verification:** New test passes; `pnpm test` 355/355 green.
- **Committed in:** `305fce4` (Task 1 commit)

**2. [Rule 3 - Blocking] SubmitPanel could not read the exact pending update body**
- **Found during:** Task 1/2 (submit preview must_have E2)
- **Issue:** The pending submit body lives at module scope in the store (never in reactive state, by design) and had no accessor, so SubmitPanel could not render "the exact locally-built update".
- **Fix:** Added an additive, non-reactive `pendingSubmitUpdate()` export (reads the module-scope deferred). No state shape or behavior change; `stores/participant.ts` was not in `files_modified`.
- **Files modified:** packages/web/src/stores/participant.ts
- **Verification:** Build clean; the preview renders the exact body via the accessor.
- **Committed in:** `305fce4` (Task 1 commit)

**3. [Rule 3 - Blocking] DirectoryList onView pass-through**
- **Found during:** Task 3 (View cohort action on the seated row)
- **Issue:** CohortRow's "View cohort" needs a navigate-back handler, but CohortRow is rendered by DirectoryList, which was not in `files_modified`.
- **Fix:** Added an optional `onView` prop to DirectoryList and passed it through to CohortRow (symmetric with the existing `onPick` drill).
- **Files modified:** packages/web/src/components/browse/DirectoryList.tsx
- **Verification:** Build + lint clean.
- **Committed in:** `448bf2a` (Task 3 commit)

**4. [Build-ordering] SubmitPanel landed in the Task 1 commit**
- **Found during:** Task 1
- **Issue:** CohortPage (Task 1) imports SubmitPanel (Task 2), so a Task-1-only commit could not build.
- **Fix:** Included SubmitPanel.tsx in the Task 1 commit; Task 2's commit carries the JoinIdentityStep D-18/D-19 work and the BrowseView call-site adaptation.
- **Impact:** Commit boundaries shifted slightly; each commit still builds green.

---

**Total deviations:** 4 (1 missing-critical, 2 blocking, 1 build-ordering)
**Impact on plan:** All necessary for correctness and to satisfy the must_haves. No scope creep; the terminal-state scoping decision defers work to 03-06 as the plan intended.

## Issues Encountered
- JoinIdentityStep's signature changed (now takes the picked `row`), which is BrowseView's only call site. Adapted the BrowseView call in Task 2 (minimal), then fully rewrote BrowseView in Task 3; each commit builds.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- 03-06 owns: anchor sub-steps (Signed -> Broadcast -> Confirmed), the resolve result view (reflected / hermetic-genesis / mismatch), the full D-24/D-25 degraded and terminal cohort-page states, the completion export/CompletionSummary, and Start over. The four Phase-2 tail panels (PublishPanel/RegisterPanel/ResolvePanel/ResultCard) are now orphaned (no importer) and are slated for deletion/absorption in 03-06.
- Verification green: `pnpm --filter @btcr2-aggregation/web build`, `pnpm lint`, `pnpm test` (355 passed), `pnpm e2e:browse`, `pnpm e2e:operator`.
- Visual/UI-SPEC conformance is deferred to the end-of-phase human verify (config: human_verify_mode=end-of-phase).

## Self-Check: PASSED

- All three created files present on disk (StageTimeline.tsx, CohortPage.tsx, SubmitPanel.tsx).
- KeyGenPanel.tsx deleted as planned.
- All three task commits present in git history (305fce4, abe44a6, 448bf2a).

---
*Phase: 03-participant-submit-co-sign-track-and-resolve*
*Completed: 2026-07-17*
