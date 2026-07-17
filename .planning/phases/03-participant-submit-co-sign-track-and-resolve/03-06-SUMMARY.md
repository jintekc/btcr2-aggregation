---
phase: 03-participant-submit-co-sign-track-and-resolve
plan: 06
subsystem: web-participant-cohort-page
tags: [participant, tracking, resolve, round-trip, degraded-states, capstone, PART-04]
status: complete
requires:
  - "03-04 participant store stage model (deriveStage, anchor poll, roundTripOutcome, shouldAutoResolve, startOver, unreachable, postSeatCohortGone)"
  - "03-05 CohortPage + StageTimeline + SubmitPanel; directory-only entry (stepper retired)"
  - "03-02 public GET /v1/anchor/:cohortId anchor read"
provides:
  - "CompletionSummary.tsx: mode-honest signed/anchored + three-way round-trip + sidecar export + conditional live Register/IPFS stages"
  - "StageTimeline live anchor sub-steps (Signed/Broadcast/Confirmed + txid + explorer, D-22)"
  - "Honest degraded/terminal states (D-24 unreachable / D-25 terminal / stall) + Start over on the cohort page"
  - "e2e/browser-participant-cohort.ts + e2e:browser:participant (criterion-4 browser capstone)"
affects:
  - packages/web/src/components/cohort
  - packages/web/src/stores/participant.ts
  - packages/web/src/components/browse/BrowseView.tsx
  - packages/web/src/App.tsx
  - e2e
tech-stack:
  added: []
  patterns:
    - "Absorb-then-delete: four tail panels' logic folded into CompletionSummary stage internals, then the panels deleted (D-31)"
    - "Conditional post-completion stages gated on live/enabled bits (Register on anchor.enabled+KEY, IPFS on GET /v1/ipfs, D-17/Finding 8)"
    - "Post-seat terminal failures route to the one cohort page; pre-seat closes stay directory cards"
key-files:
  created:
    - packages/web/src/components/cohort/CompletionSummary.tsx
    - e2e/browser-participant-cohort.ts
  modified:
    - packages/web/src/components/cohort/StageTimeline.tsx
    - packages/web/src/components/cohort/CohortPage.tsx
    - packages/web/src/stores/participant.ts
    - packages/web/src/components/browse/JoinIdentityStep.tsx
    - packages/web/src/components/browse/BrowseView.tsx
    - packages/web/src/App.tsx
    - package.json
  deleted:
    - packages/web/src/components/participant/RegisterPanel.tsx
    - packages/web/src/components/participant/PublishPanel.tsx
    - packages/web/src/components/participant/ResolvePanel.tsx
    - packages/web/src/components/participant/ResultCard.tsx
decisions:
  - "Post-seat terminal failures (D-24/D-25) land ON the cohort page (BrowseView routes status==='failed' && seated to CohortPage); pre-seat joinClosed / non-seated join failures keep the browse-directory cards."
  - "The k-of-n fallback outcome (D-23) names k of n by threading the picked directory row's threshold/capacity through join(); fallbackObserved is set from the runner's fallback-requested event."
  - "The dedicated stall copy is only rendered on a POSITIVE signal (this participant's update is in but co-signing never completed, Finding 2), never invented; otherwise the honest 'didn't say why' fallback stands (D-25)."
metrics:
  duration_min: 20
  tasks: 3
  files_touched: 13
  completed: 2026-07-17
---

# Phase 03 Plan 06: Participant tracking, resolve, honest states, and the browser capstone Summary

Completed the PART-04 tracking + resolve tail on the one cohort page: mode-honest anchor sub-steps, an auto-resolve completion summary with the three-way round-trip and sidecar export, the conditional live-only registration/IPFS stages, the honest degraded/terminal/fallback/non-inclusion states with Start over, the deletion of the four absorbed tail panels, and a browser-level hermetic capstone that proves the whole discover -> submit -> co-sign -> signed -> resolve loop with the stepper retired (criterion 4).

## What was built

**Task 1 - Anchor sub-steps + CompletionSummary; absorb + delete the tail panels (`52653c8`)**
- `StageTimeline.tsx`: live anchor sub-steps (Signed -> Broadcast with txid + a "View on explorer" link -> Confirmed) rendered ONLY when `anchor.enabled`, freezing at last-known state; the final row relabels to "Anchored" on a broadcasting service and stays "Signed" on the hermetic path (D-22, mode-honest per D-07).
- `CompletionSummary.tsx` (NEW): the mode-honest signed/anchored line, the three-way round-trip outcome from `roundTripOutcome` (reflected / hermetic-genesis expected / not-reflected retry, D-28/D-29), the resolved DID document behind a scrolling raw-detail expander, the "Download sidecar (resolver artifacts)" export (reusing `downloadSidecar`/`lib/sidecar`), the explicit k-of-n fallback outcome (D-23), cooperative non-inclusion as a distinct non-error outcome (D-10), and the CONDITIONAL post-completion stages absorbed from `RegisterPanel`/`PublishPanel` (KEY first-update registration gated on `anchor.enabled`; IPFS publish gated on `GET /v1/ipfs` enabled, D-17/Finding 8, never on the hermetic path).
- Store: added `fallbackObserved` (from the runner's `fallback-requested`), `nonInclusionReason` (from the participant's `getDeclineReason`), and `cohortThreshold`/`cohortCapacity` threaded through `join()` so the fallback outcome names k of n; `JoinIdentityStep` passes the picked row's sizing.
- `CohortPage.tsx` mounts `CompletionSummary` at `status === 'complete'` and passes `anchor` to the timeline.
- Deleted `RegisterPanel.tsx`, `PublishPanel.tsx`, `ResolvePanel.tsx`, `ResultCard.tsx` (logic absorbed, D-31); no component imports them.

**Task 2 - Degraded/terminal states + Start over (`eaaba6e`)**
- `CohortPage.tsx`: the D-24 "Can't reach this service" transient banner off the store's `unreachable` flag (quiet auto-retry, stages frozen, never terminal); the D-25 terminal card with a best-effort specific reason (`terminalReason` maps timeout / seat / signing / stall + the honest "didn't say why" fallback) + "Back to cohorts"; the k-of-n fallback and cooperative non-inclusion outcomes render in `CompletionSummary`; "Start over" (D-10) behind a danger-variant key-custody confirmation calling `startOver()`.
- `BrowseView.tsx`: a post-seat terminal failure (`status === 'failed' && seated`) routes to the cohort page's D-24/D-25 states instead of the browse-directory error card; pre-seat closes/failures stay directory cards.
- `App.tsx`: the "Your cohort" chip stays visible and freezes bad-tone (no pulse) with the terminal stage label under a post-seat terminal (E10).

**Task 3 - Browser capstone + script (`4e7e075`)**
- `e2e/browser-participant-cohort.ts`: ONE real Chromium page drives browse -> pick -> join -> explicit "Submit my DID update" CLICK -> co-sign (64-byte aggregate) -> mode-honest SIGNED (no "anchored", no txid, no explorer link) -> auto-resolve -> honest hermetic-genesis round-trip, while (n-1) headless in-process peers fill the remaining seats and auto-submit. Asserts criterion 4 (the directory is the landing, no KeyGen-first stepper affordance), advertises exactly one cohort (single-advert-slot discipline, Pitfall 7), and synchronizes on the service's hard `signing-complete` + visible round-trip copy.
- `e2e:browser:participant` script (local like `e2e:kofn`; NOT wired into CI, Phase-6 debt D-32).

## Verification

- `pnpm --filter @btcr2-aggregation/web build`: clean (no dangling imports after the four deletions).
- `pnpm test`: 355 passed (27 files).
- `pnpm lint`: clean.
- `pnpm e2e:browser:participant`: PASS (the phase-level browser proof).
- Regression: `pnpm e2e`, `e2e:browse`, `e2e:operator`, `e2e:kofn`, `e2e:fallback` all PASS.
- The two booth-topology browser jobs (`e2e:browser`, `e2e:browser:prod`) remain red by prior operator decision (Phase-6 debt); not counted.
- End-of-phase human verify (config `human_verify_mode=end-of-phase`) covers the visual/interaction states; no checkpoint task in this plan.

## Deviations from Plan

### Auto-added / blocking-fix functionality (no user permission needed)

**1. [Rule 3 - Blocking] Edited `BrowseView.tsx` and `App.tsx` (not in the plan's `files_modified`)**
- **Found during:** Task 2.
- **Why:** The plan's truths require post-seat terminal failures to land ON the cohort page (E3) and the "Your cohort" chip to stay visible + frozen under a terminal (E10). In the shipped 03-05 flow, `BrowseView` intercepted every `status === 'failed'` with its own directory error card and `App`'s chip hid when the lifecycle was not active, so the cohort page could never own the D-24/D-25 states. Both edits are additive and minimal: `BrowseView` routes `status === 'failed' && seated` to `CohortPage`; `App` extends the chip's visibility/tone to the terminal-seated case. Pre-seat closes/failures keep the directory cards.
- **Commit:** `eaaba6e`.

**2. [Rule 2 - Missing functionality] Threaded the picked row's k/n through `join()` and added store fields for the D-23 fallback outcome**
- **Found during:** Task 1.
- **Why:** The D-23 k-of-n fallback outcome copy must name "{k} of {n} signatures", but the store had no k/n at completion and did not persist the fallback-observed fact or the cooperative-non-inclusion reason. Added `fallbackObserved` (set from `fallback-requested`), `nonInclusionReason` (from `getDeclineReason`), and `cohortThreshold`/`cohortCapacity` threaded through an optional third `join()` argument (`JoinIdentityStep` supplies the row's `threshold`/`capacity`). The change is additive-optional, so every headless caller (which constructs `createParticipant` directly, not the store) is untouched.
- **Commit:** `52653c8`.

## Honesty notes (prohibitions honored)

- No "your update is reflected" / txid / anchor claim on a hermetic (`enabled:false`) service: every anchor/resolve string branches on `anchor.enabled`; the capstone asserts the SIGNED (not anchored) wording and the absence of a "View on explorer" link and "Your update is reflected" (D-07/D-29).
- A transient poll/SSE failure is the D-24 unreachable banner (quiet retry, stages frozen), never a terminal by itself.
- No invented failure reason: `terminalReason` uses the honest "didn't say why" fallback unless there is a positive signal (recognizable runner reason, or "submitted but co-signing never completed" for the stall copy, Finding 2).
- The conditional Register/IPFS stages render only on live/enabled paths; the hermetic path exposes no funding/registration surface (D-17).
- The browser capstone is a LOCAL script, not wired into CI (Phase-6 debt, D-32).
- No em-dash character and no new booth/attendee framing in any new copy, comment, or code (verified by grep).

## Known Stubs

None. The conditional Register and IPFS stages are real logic ported verbatim from the deleted panels, gated on the live/enabled mode bits (not empty placeholders); on the hermetic default they correctly do not render.

## Flagged assumption (carried forward)

The PART-04 specless-probe `unclassified` edge (03-06-PLAN "Flagged assumption") is interpreted as the general PART-04 tracking/resolve reliability surface and is covered by the anchor-freeze (D-22), resolver-lag retry gated on `enabled` (Finding 7), hermetic-genesis honest round-trip (D-29), and unreachable/terminal states (D-24/D-25). If end-of-phase human verify reveals a distinct uncovered PART-04 reliability edge, fold it into a gap-closure plan.

## Self-Check: PASSED

- Created files present: `CompletionSummary.tsx`, `e2e/browser-participant-cohort.ts`, `03-06-SUMMARY.md`.
- Deleted panels gone: `RegisterPanel.tsx`, `PublishPanel.tsx`, `ResolvePanel.tsx`, `ResultCard.tsx`.
- Commits present: `52653c8` (Task 1), `eaaba6e` (Task 2), `4e7e075` (Task 3).
