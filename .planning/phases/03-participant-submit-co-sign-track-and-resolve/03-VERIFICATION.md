---
phase: 03-participant-submit-co-sign-track-and-resolve
verified: 2026-07-17T00:00:00Z
status: gaps_found
score: 4/6 must-haves verified (2 derived correctness truths failed)
behavior_unverified: 0
overrides_applied: 0
mode: mvp
mvp_goal_format_discrepancy: true
gaps:
  - truth: "Post-seat completion reporting is race-free: a genuinely successful cohort is never mis-reported as a terminal failure to the participant (bears on Success Criteria 1 and 3)"
    status: failed
    reason: "packages/web/src/stores/participant.ts:handlePostSeatSnapshot (~line 1319) treats 'picked cohort absent from the widened public directory' as sufficient, on its own, to call fail(\"The cohort ended and this service didn't say why.\"). But packages/service/src/operator-cohorts.ts directory() drops a cohort from DISPLAY_PHASES the instant its phase becomes Complete - the SAME transition that also fires the participant's cohort-complete SSE, over a different channel with no ordering guarantee. If the post-seat directory poll (5s cadence) observes the phase-flip-to-Complete before the browser processes cohort-complete, handlePostSeatSnapshot calls fail() and teardownLive() stops the runner; the pending cohort-complete is then never processed, so result/sidecar/captured are never built. A participant who genuinely co-signed and completed is shown a false terminal-failure message and loses their downloadable sidecar. This is CR-01 from the phase's own 03-REVIEW.md (deep code review, critical severity) and remains unfixed in the current codebase - confirmed by direct reading of the cited lines; no streak counter, corroboration check, or cohort-complete-wins-the-race guard exists."
      artifacts:
        - path: "packages/web/src/stores/participant.ts"
          issue: "handlePostSeatSnapshot / postSeatCohortGone lacks corroboration (e.g. a consecutive-poll streak, or deferring to a cohort-complete/cohort-failed race winner) before calling fail() on directory absence; the plan's own must_have text ('absent from the directory AND the runner silent') is only half-implemented - the 'runner silent' half is not checked anywhere."
      missing:
        - "A guard that requires the cohort-gone signal to persist across N consecutive post-seat polls before failing, OR a mechanism that lets a subsequent cohort-complete/cohort-failed event cancel/override an in-flight directory-absence fail() (so the SSE always wins a race it should win)."
  - truth: "Mode-honest signed/anchored copy on the LIVE (anchor.enabled:true) path correctly narrates every anchor state, not only 'confirmed'/'broadcast' vs the hermetic default (bears on Success Criterion 2)"
    status: failed
    reason: "packages/web/src/components/cohort/CompletionSummary.tsx:72 computes anchored = Boolean(anchor?.enabled && (anchor.state === 'confirmed' || anchor.state === 'broadcast')); the branch at :91-98 renders 'Signed. This no-broadcast service does not publish to Bitcoin...' whenever anchored is false - which is also true on a LIVE broadcasting service transiently in state:'none' (broadcast not yet posted) or permanently in state:'failed' (broadcast failed). The page then simultaneously shows StageTimeline's live 'Anchored'/Broadcast/Confirmed sub-steps (rendered because anchor.enabled is true) while CompletionSummary claims the service does not broadcast at all - a direct mode-honesty contradiction on the exact posture (D-07) this phase is built to protect. Worse, on state:'failed', shouldAutoResolve returns false for enabled+failed, so auto-resolve never fires and the anchor poll freezes, leaving the participant stuck on the false 'no-broadcast service' copy with no resolve outcome for a broadcast that actually failed. This is WR-01 from 03-REVIEW.md and remains unfixed in the current codebase - confirmed by direct reading of the cited lines."
      artifacts:
        - path: "packages/web/src/components/cohort/CompletionSummary.tsx"
          issue: "The Signed-line copy branches on the derived `anchored` boolean instead of on `anchor?.enabled`, collapsing 'broadcasting but not yet/never confirmed' into the same copy as 'this service does not broadcast at all'."
      missing:
        - "A three-way branch: anchored (Signed and anchored) / anchorEnabled-but-not-yet-confirmed-or-failed (broadcasting copy, with a distinct failed-broadcast message) / hermetic (no-broadcast copy) - matching the fix already sketched in 03-REVIEW.md WR-01."
human_verification_deferred_note: "3 items from 03-05-SUMMARY.md coverage (D1/D2/D4, human_judgment:true, status:unknown) were explicitly deferred to this end-of-phase verification per config human_verify_mode=end-of-phase. They are visual/interaction checks (timeline+identity+Signed copy rendering, submit-window consent/urgency, seated-row+persistent-link navigation) that this verifier cannot exercise via grep/static analysis alone; see Human Verification Required below. They do not change the gaps_found status (which is driven by CR-01/WR-01) but must still be confirmed once the gaps are closed."
---

# Phase 3: Participant Submit, Co-Sign, Track, and Resolve Verification Report

**Phase Goal:** From the cohort they chose, a participant submits a DID update, takes part in the n-of-n MuSig2 co-signing round, tracks the anchor, and resolves the updated DID - wiring the existing signing/resolve flow into the discover->join path instead of the linear demo stepper.
**Verified:** 2026-07-17
**Status:** gaps_found
**Re-verification:** No - initial verification

**MVP-mode note:** The phase carries `Mode: mvp` in ROADMAP.md, but the roadmap `**Goal:**` line is outcome-shaped, not literal User Story form ("As a ... I want to ... so that ..."). `gsd_run query user-story.validate` confirms the raw goal fails the format check. All 6 plans independently derived the SAME valid user story from the goal plus the four success criteria (validated `true` by the same tool) and used it consistently, so I proceeded with goal-backward verification using that derived story for the User Flow Coverage section below, rather than hard-refusing. This is flagged as a documentation-process gap (recommend running `/gsd mvp-phase 3` retroactively to align ROADMAP.md's literal text), not a phase-goal-achievement gap.

## User Flow Coverage (MVP mode)

User story (derived, validated): «As a participant who joined a cohort by choice, I want to submit my DID update, take part in the cohort's n-of-n MuSig2 co-signing round, track the anchor, and resolve my updated DID, so that I complete the real aggregation lifecycle from the cohort I discovered, not a standalone demo stepper.»

| Step | Expected | Evidence | Status |
|------|----------|----------|--------|
| Land on directory | The directory is the only entry path; no KeyGen-first stepper | `packages/web/src/components/browse/BrowseView.tsx` default branch; `FlowStepper.tsx`/`ParticipantView.tsx`/`KeyGenPanel.tsx` deleted (confirmed: no matches in a repo-wide grep); `e2e/browser-participant-cohort.ts:179-189` asserts no stepper affordance | ✓ |
| Pick + join a cohort | Inline identity step, D-18 reuse default, D-19 non-blocking fit warning, join() | `packages/web/src/components/browse/JoinIdentityStep.tsx` (reviewed in full) | ✓ |
| Submit the DID update | Explicit consent moment: preview + one consent line + submit CTA, no second gate | `packages/web/src/components/cohort/SubmitPanel.tsx` (reviewed in full); `packages/participant/src/index.ts` `createUpdateProvider`/`onSubmitGate` seam | ✓ |
| Co-sign / track | Stage timeline + live anchor sub-steps on a ~5s poll, freeze at confirmed/failed | `packages/web/src/components/cohort/StageTimeline.tsx` (reviewed in full); `packages/service/src/anchor-state.ts` + `GET /v1/anchor/:cohortId` (reviewed) | ✓ (mode-honesty caveat below) |
| See completion / resolve | Auto-resolve, three-way honest round-trip, resolved DID document, sidecar export | `packages/web/src/components/cohort/CompletionSummary.tsx` (reviewed in full); `roundTripOutcome`/`shouldAutoResolve` in `stores/participant.ts` | ✓ (reliability caveat below - CR-01) |
| Outcome: "complete the real aggregation lifecycle... not a standalone demo stepper" | End-to-end loop provably reachable only from the directory, with real submit/co-sign/track/resolve | `e2e/browser-participant-cohort.ts` (real Chromium page + headless peers) recorded PASS at 03-06 execution; `pnpm test` 355/355 green (re-run during this verification); `pnpm --filter @btcr2-aggregation/web build` clean (re-run) | ⚠️ mechanism proven, but two review-confirmed unfixed defects (CR-01, WR-01) can make the loop misreport a genuine success as a failure, or misreport a live broadcast's status - see Gaps below |

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 (SC1) | From a cohort they joined by choice, the participant submits a DID update and takes part in that cohort's n-of-n MuSig2 co-signing round | ✓ VERIFIED | `onSubmitGate`/`createUpdateProvider` (participant pkg), `SubmitPanel.tsx`, `pendingSubmit`/`submitUpdate()` in the store; proven end-to-end by `e2e/browser-participant-cohort.ts` (real click, real co-sign) and 355/355 unit tests |
| 2 (SC2) | The participant sees co-sign progress and anchor status for their joined cohort update in real time | ✓ VERIFIED, with a caveat | `StageTimeline.tsx` renders the full journey + live anchor sub-steps (Signed/Broadcast/Confirmed) gated on `anchor.enabled`, 5s poll, freezes at confirmed/failed (`anchor-state.ts` + `GET /v1/anchor/:cohortId`). Caveat: WR-01 (below) makes the completion summary's narrative of that status mode-dishonest on a live-broadcasting service outside the confirmed/broadcast states. |
| 3 (SC3) | Once the beacon is anchored, the participant resolves the updated DID and sees the new DID document | ✓ VERIFIED, with a caveat | Auto-resolve (`shouldAutoResolve`) + `CompletionSummary.tsx` renders the resolved DID document, three-way `roundTripOutcome`, sidecar export. Caveat: CR-01 (below) can cause the participant to never reach this state at all for a cohort that genuinely succeeded, because the post-seat poll can false-fail it first. |
| 4 (SC4) | The participant reaches submit/co-sign only via a cohort discovered and joined from the directory; the standalone linear stepper is no longer the entry path | ✓ VERIFIED | `FlowStepper.tsx`, `ParticipantView.tsx`, `KeyGenPanel.tsx`, `RegisterPanel.tsx`, `PublishPanel.tsx`, `ResolvePanel.tsx`, `ResultCard.tsx` all deleted and unimported (confirmed: `packages/web/src/components/participant/` directory no longer exists); `App.tsx`/`BrowseView.tsx` route through the directory only; `e2e/browser-participant-cohort.ts:179-189` explicitly asserts no KeyGen-first affordance |
| 5 (derived) | Post-seat completion reporting is race-free: a genuinely successful cohort is never mis-reported as a terminal failure | ✗ FAILED | CR-01 (03-REVIEW.md), confirmed unfixed by direct reading of `packages/web/src/stores/participant.ts` `handlePostSeatSnapshot`/`postSeatCohortGone` (~line 1319-1341) against `packages/service/src/operator-cohorts.ts` `directory()` (~line 385-388) |
| 6 (derived) | Mode-honest signed/anchored copy correctly narrates every live anchor state (not only confirmed/broadcast vs hermetic) | ✗ FAILED | WR-01 (03-REVIEW.md), confirmed unfixed by direct reading of `packages/web/src/components/cohort/CompletionSummary.tsx:72,91-98` |

**Score:** 4/6 truths verified (0 present-but-behavior-unverified; 2 failed - both are review-confirmed, unfixed correctness/honesty defects in the participant store and completion copy)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/participant/src/index.ts` (`SubmitGateInfo`, `onSubmitGate`, `createUpdateProvider`) | Opt-in explicit-submit gate, build-once, decline-before-gate | ✓ VERIFIED | Exported types present; decline path precedes gate offer; `pnpm test` green including the gate specs |
| `packages/service/src/anchor-state.ts` + `hono-adapter.ts` route | Public, bounded, mode-honest, non-oracle anchor read | ✓ VERIFIED | `GET /v1/anchor/:cohortId` mounted before `if (operatorAuth)`; bounded 24-entry map; unknown -> `{state:'none'}`; specs pass |
| `packages/service/src/operator-cohorts.ts` (`DISPLAY_PHASES`/`IN_FLIGHT_PHASES`/`openCount`) | Widened in-flight directory display, unchanged joinable count | ✓ VERIFIED | Constants present as designed; `openCount()` narrows to `OPEN_PHASES`; specs pin both; **is also the mechanism whose interaction with the store produces CR-01** (see gap) |
| `packages/web/src/stores/participant.ts` (`deriveStage`, `pendingSubmit`, anchor poll, degraded states) | Single lifecycle owner, D-01 stage model, epoch-guarded polls, honest degraded states | ⚠️ VERIFIED with a defect | Pure selectors present and spec-tested; teardown-safe deferred confirmed (no `pendingSubmit.resolve(` in teardown blocks); **`handlePostSeatSnapshot` is the CR-01 defect site** |
| `packages/web/src/components/cohort/{CohortPage,StageTimeline,SubmitPanel,CompletionSummary}.tsx` | The one live cohort page through submit/co-sign/track/resolve/degraded states | ⚠️ VERIFIED with a defect | All four files exist, are substantive, and are wired into `BrowseView`/`App`; **`CompletionSummary.tsx` is the WR-01 defect site** |
| `e2e/browser-participant-cohort.ts` + `e2e:browser:participant` script | Browser-level hermetic capstone proving the whole loop + criterion 4 | ✓ VERIFIED (recorded pass, not re-run) | Script registered in `package.json`; asserts no-stepper + explicit submit click + mode-honest SIGNED + hermetic round-trip; recorded PASS at 03-06 execution time per SUMMARY and per this phase's own instructions (not re-run here as a long-running browser e2e) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `onSubmitGate` (participant pkg) | `pendingSubmit` deferred (store) | `join()` passes the gate into `createParticipant` | ✓ WIRED | Confirmed in `stores/participant.ts` |
| `pendingSubmit`/`submitUpdate()` | `SubmitPanel.tsx` | `pendingSubmitUpdate()` accessor + `submitUpdate` store action | ✓ WIRED | Confirmed in `SubmitPanel.tsx` |
| `GET /v1/anchor/:cohortId` (service) | anchor poll (store) | `fetchAnchor` (`lib/anchor.ts`) | ✓ WIRED | Confirmed epoch-guarded poll in `participant.ts`, freeze at confirmed/failed |
| `cohort-complete` SSE | auto-resolve -> `CompletionSummary` | `shouldAutoResolve` -> `resolve()` -> `roundTripOutcome` | ✓ WIRED | Confirmed, but **races against the post-seat directory poll's `fail()` path (CR-01)** - the SSE is not guaranteed to win |
| widened public directory (`operator-cohorts.ts`) | post-seat cohort-gone detection (store) | `fetchDirectory` -> `handlePostSeatSnapshot` -> `postSeatCohortGone` | ⚠️ WIRED but unsafe | Wired as designed, but the predicate is missing the "AND the runner silent" corroboration the plan's own must_have text specifies (CR-01) |
| directory row / `BrowseView` | `CohortPage` | joined-cohort lifecycle branch + view toggle | ✓ WIRED | Confirmed in `BrowseView.tsx` |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| PART-03 | 03-01, 03-04, 03-05 | Participant can submit a DID update and take part in the n-of-n MuSig2 co-signing round | ⚠️ SATISFIED with a flagged reliability defect | Mechanism built and proven by the browser capstone + unit tests; CR-01 threatens the reliability of the completion outcome after a genuine success |
| PART-04 | 03-02, 03-03, 03-04, 03-06 | Participant can track co-sign/anchor progress and resolve once anchored | ⚠️ SATISFIED with flagged defects | Tracking + resolve mechanism built and proven for the hermetic default path; CR-01 (completion reachability) and WR-01 (live-mode narration honesty) are unresolved, review-confirmed gaps |

No orphaned requirements: REQUIREMENTS.md maps only PART-03/PART-04 to Phase 3, and both are claimed across the plans' `requirements:` frontmatter.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| - | - | No `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` markers found in any of the 21 phase-modified files | info | Clean - no debt markers to gate on |
| - | - | No em-dash characters found in any of the 21 phase-modified files | info | Clean - house style honored |
| `packages/web/src/components/cohort/SubmitPanel.tsx` | 137 | `IN-02` (03-REVIEW.md): `beaconAddress ?? 'this cohort&apos;s beacon'` is a JS string, so a literal `&apos;` would render verbatim if the fallback is ever reached | info | Currently unreachable (submit window only opens after `beaconAddress` is set), latent only |
| `packages/web/src/stores/participant.ts` | ~1139-1155 | `IN-04` (03-REVIEW.md): a fast-path re-sets `steps.join` from `done` back to `active` after `cohort-joined` already completed it | info | Cosmetically invisible today (`deriveStage` does not read `steps.join`) but a real state inconsistency |
| `packages/service/src/hono-adapter.ts` | ~364-372 | `IN-03` (03-REVIEW.md): `createDraft` on a null/non-object body surfaces a raw `TypeError` as the 400 body | info | Operator-authenticated surface, not participant-facing; out of this phase's success-criteria scope (Phase 1 route) |
| `packages/service/src/operator-cohorts.ts` | ~272-274 | `WR-02` (03-REVIEW.md): no upper bound on operator draft cohort `size` | info (out of Phase 3 scope) | Operator-authenticated Phase-1 concern, not a Phase-3 participant-facing success criterion |

The two BLOCKER/WARNING-severity findings from 03-REVIEW.md (CR-01, WR-01) are elevated to gaps above rather than left as review info, since they directly and materially bear on Success Criteria 1/2/3 and remain unfixed in the current codebase (confirmed by direct source reading, not merely by re-reading 03-REVIEW.md's claims).

### Human Verification Required

These are visual/interaction checks explicitly deferred from mid-phase `checkpoint:human-verify` to this end-of-phase verification, per `.planning/config.json` `human_verify_mode: end-of-phase`, and harvested from `03-05-SUMMARY.md`'s coverage section (items D1/D2/D4, each marked `human_judgment: true`, `status: unknown`). They do not change the `gaps_found` verdict (driven by CR-01/WR-01) but should still be confirmed, ideally after the two gaps are closed:

1. **Stage timeline + identity section + Signed copy visual check**
   **Test:** Join a cohort as a real browser user; observe the stage timeline through Waiting -> Seated -> Submit -> Co-signing -> Signed, the compact identity section, and the mode-honest Signed line on both a hermetic and a live-configured service.
   **Expected:** Active stage pulses accent, completed stages read good-tone, future stages are dimmed; the identity section shows DID/onboarding-model/key-custody note; the Signed line never claims a txid/anchor on the hermetic path (and, once WR-01 is fixed, correctly narrates a live service's non-confirmed states too).
   **Why human:** Visual tone/contrast/pulsing and copy-reads-right judgments are not resolvable by grep or static analysis.

2. **Submit-window consent + urgency check**
   **Test:** Reach the submit window; observe the heading escalation, the tab title change, the one consent line (hermetic vs live), and click Submit.
   **Expected:** Heading reads "Your update is needed"; tab title becomes "(!) Submit your update" and restores on submit/leave; exactly one consent line and one CTA; no second approval gate.
   **Why human:** Tab-title/interaction-timing behavior and "reads as exactly one consent, not two" are interaction/visual judgments.

3. **Seated-row affordance + one-cohort-at-a-time + persistent-link navigation check**
   **Test:** While seated in a cohort, view the directory; observe the seated row's "You're in this cohort" + View cohort affordance, that Join is disabled on every other row, and that the persistent "Your cohort · {stage}" link correctly returns to the cohort page.
   **Expected:** Exactly one row shows the seated affordance; all other rows show a disabled Join; the persistent link/chip stays live and accurate.
   **Why human:** Live-poll-driven UI state flips and navigation correctness are interaction behaviors.

### Gaps Summary

The phase's plans are thorough, well-documented, and the vast majority of the intended mechanism is real, tested, and wired: the explicit-submit gate, the public anchor read, the widened in-flight directory, the pure `deriveStage` render authority, the one continuous cohort page, the mode-honest hermetic path, the honest three-way round-trip, and the browser-level capstone all exist and pass their own tests (355/355 unit tests re-confirmed during this verification; the web build re-confirmed clean; no debt markers or em-dashes found).

However, a deep code review conducted at the end of phase execution (03-REVIEW.md) found one CRITICAL and one relevant WARNING issue that were never fixed after the review ran (the git history shows only a `docs(03): add code review report` commit after the review, no follow-up fix commit), and both are confirmed still present by direct reading of the current source in this verification:

- **CR-01 (blocking):** a race between the post-seat directory poll and the `cohort-complete` SSE can cause a participant whose cohort genuinely completed successfully to be shown a false "cohort ended, didn't say why" terminal failure, discarding their sidecar. This directly undermines Success Criteria 1 and 3 - the phase's core promise that a participant who submits and co-signs successfully will see that success and be able to resolve/export it.
- **WR-01 (related, elevated because it bears on SC2's "sees ... anchor status ... in real time" honesty requirement):** the completion summary's Signed-line copy collapses "broadcasting but not yet confirmed" and "broadcast failed" into the same "this no-broadcast service does not publish to Bitcoin" copy used for a genuinely hermetic service, contradicting the live anchor sub-steps rendered in the same view and leaving a failed-broadcast participant permanently stuck with no resolve outcome.

Neither finding is deferred to a later milestone phase: Phase 4/5/6 in ROADMAP.md cover operator monitoring, operator lifecycle control, and cross-stranger E2E/framing respectively - none of them own a fix to the participant store's post-seat completion detection or the completion-summary copy. Both gaps are therefore live, actionable closure items for Phase 3, not intentional future work.

**This looks fixable as a small, targeted gap-closure plan** (both fixes are sketched with code in 03-REVIEW.md itself): add a consecutive-poll-streak (or SSE-wins-the-race) guard to `handlePostSeatSnapshot`, and branch the Signed-line copy on `anchor.enabled` with the missing broadcasting/failed middle case. Recommend routing this phase to `/gsd-plan-phase --gaps` rather than accepting an override, since these are genuine unresolved correctness/honesty defects in the core success path, not an intentional alternative design.

---

_Verified: 2026-07-17_
_Verifier: Claude (gsd-verifier)_
