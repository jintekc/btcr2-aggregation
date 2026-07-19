---
phase: 03-participant-submit-co-sign-track-and-resolve
verified: 2026-07-19T11:00:00Z
status: gaps_found
score: 7/8 must-haves verified (1 newly discovered, narrower mode-honesty gap)
behavior_unverified: 0
overrides_applied: 0
mode: mvp
mvp_goal_format_discrepancy: true
re_verification:
  previous_status: gaps_found
  previous_score: 6/7
  gaps_closed:
    - "Truth 7 as originally scoped: StageTimeline's final-row header no longer claims 'Anchored' when the anchor has not yet posted (enabled:true, state:'none') or has terminally failed (enabled:true, state:'failed'); both now correctly read 'Signed', matching AnchorSubSteps and CompletionSummary in the same view."
    - "The pre-first-read (null anchor) window now has its own neutral 'checking' state instead of being collapsed into 'hermetic', so a live service never falsely claims to be a no-broadcast service before its first anchor read lands."
  gaps_remaining:
    - "A NEW, narrower defect surfaced by the post-closure code review (03-REVIEW.md WR-02) and independently confirmed by this verification: anchorSummaryState maps a broadcast-but-unconfirmed anchor (enabled:true, state:'broadcast') to 'anchored', so the StageTimeline header and CompletionSummary both claim 'Anchored'/'Signed and anchored' at the exact moment AnchorSubSteps renders 'Confirmed: pending' beneath it. This is the same contradiction class Truth 7 targeted, in a sub-case not covered by gap-closure plan 03-08."
  regressions: []
gaps:
  - truth: "Anchor-status narration is internally consistent across every component rendered in the same view for EVERY reachable anchor state, including the broadcast-but-unconfirmed window (enabled:true, state:'broadcast'), not only the not-yet-broadcast and failed-broadcast windows plan 03-08 closed."
    status: failed
    reason: "Gap-closure plan 03-08 correctly closed the two sub-cases explicitly cited in the prior 03-VERIFICATION.md Truth 7 finding (state:'none' -> now 'Signed'/'broadcasting' narration; state:'failed' -> now 'Signed'/'broadcast-failed' narration), confirmed here by direct source reading of participant.ts:692-708, StageTimeline.tsx:138,163, and CompletionSummary.tsx:94-116, plus passing unit tests. However, a fresh code review conducted the same day as 03-08 (03-REVIEW.md WR-02), and independently confirmed in this verification by direct reading of the current source and its spec file, found that anchorSummaryState's pre-existing 'confirmed' || 'broadcast' -> 'anchored' branch (participant.ts:701-703, unchanged by plan 03-08 and explicitly pinned by participant.spec.ts:557 which asserts anchorSummaryState({enabled:true, state:'broadcast'}) === 'anchored') still drives BOTH the StageTimeline final-row label (via the shared summary === 'anchored' gate added by 03-08, StageTimeline.tsx:163) AND the CompletionSummary header/narration (CompletionSummary.tsx:89,94-95, anchored = state 'confirmed' OR 'broadcast'). At the same moment, AnchorSubSteps (StageTimeline.tsx:73-79) computes confirmed = anchor.state === 'confirmed' only, so it renders 'Confirmed: pending' directly beneath a header that reads 'Anchored', and CompletionSummary says 'Signed and anchored on {netLabel}.' This is a genuine, reachable, non-trivial-duration (however long block confirmation takes) internal contradiction on the exact success criterion (SC2: 'sees...anchor status...in real time') and the exact defect class (StageTimeline header vs. sub-steps/CompletionSummary disagreement) two prior gap-closure rounds (03-07, 03-08) targeted. It was not in 03-08's stated scope (which cited only state:'none' and state:'failed' as the target sub-cases) and is not addressed by any later ROADMAP phase (Phase 4/5/6 cover operator monitoring, operator lifecycle control, and cross-stranger E2E, none of which own the participant-facing anchor-narration selector or components)."
    artifacts:
      - path: "packages/web/src/stores/participant.ts"
        issue: "Lines 701-703: `if (anchor.state === 'confirmed' || anchor.state === 'broadcast') return 'anchored';` treats an accepted-but-unmined tx the same as a confirmed one, so 'anchored' is returned before the tx is actually anchored on-chain."
      - path: "packages/web/src/components/cohort/StageTimeline.tsx"
        issue: "Line 163 gates the 'Anchored' label on `summary === 'anchored'`, which is now internally consistent with anchorSummaryState's OWN mapping, but that mapping itself still conflates 'broadcast' (unconfirmed) with 'anchored', so the label still contradicts AnchorSubSteps' 'Confirmed: pending' sub-step (lines 74,79) for the same anchor read."
      - path: "packages/web/src/components/cohort/CompletionSummary.tsx"
        issue: "Line 72 `anchored = Boolean(anchor?.enabled && (anchor.state === 'confirmed' || anchor.state === 'broadcast'))` and line 94's `anchorNarration === 'anchored'` branch both narrate 'Anchored'/'Signed and anchored' for the same unconfirmed-broadcast state."
    missing:
      - "Reserve the 'anchored' narration state for `anchor.state === 'confirmed'` only; route `state === 'broadcast'` (accepted, not yet mined) into the existing 'broadcasting' narration branch instead, which already reads honest 'Broadcasting the beacon transaction...This can take a few minutes to post.' copy (per 03-REVIEW.md WR-02's suggested fix)."
      - "Align CompletionSummary's `anchored` boolean (line 72) and the StageTimeline label gate to the same corrected definition, so the header/narration and AnchorSubSteps' 'Confirmed' sub-step can never disagree for any reachable anchor state."
      - "Update participant.spec.ts's `anchorSummaryState({enabled:true, state:'broadcast'})` expectation from 'anchored' to 'broadcasting' (currently pins the contradiction as intended behavior at line 557) and add/adjust StageTimeline and CompletionSummary tests/spot-checks accordingly."
human_verification_deferred_note: "3 items carried forward from the initial verification (D1/D2/D4 in 03-05-SUMMARY.md coverage, human_judgment:true) plus 2 new items from 03-08's own coverage (D3/D4, human_judgment:true) remain unresolvable by static analysis; see Human Verification Required below. They do not change the gaps_found status (which is driven by the new anchorSummaryState 'broadcast' finding above) but must still be confirmed."
---

# Phase 3: Participant Submit, Co-Sign, Track, and Resolve Verification Report

**Phase Goal:** From the cohort they chose, a participant submits a DID update, takes part in the n-of-n MuSig2 co-signing round, tracks the anchor, and resolves the updated DID, wiring the existing signing/resolve flow into the discover->join path instead of the linear demo stepper.
**Verified:** 2026-07-19
**Status:** gaps_found
**Re-verification:** Yes, third pass (after gap-closure plans 03-07 and 03-08, commits 18ea0b4, 0b560bc, a063fb6, 49c9dbd, 30d41c1, 510d40a)

**MVP-mode note (carried forward):** The phase carries `Mode: mvp` in ROADMAP.md, but the roadmap `**Goal:**` line is outcome-shaped, not literal User Story form. `gsd_run query user-story.validate` confirmed the raw goal fails the format check in the initial verification; all plans independently derived the SAME valid user story, so goal-backward verification proceeds using that derived story. Documentation-process gap, not a phase-goal-achievement gap. Unchanged since the last verification.

## What Changed Since the Last Verification

The previous verification (2026-07-17, second pass) scored 6/7: Truth 7 failed because `StageTimeline.tsx` relabeled its final row "Anchored" from `anchor?.enabled` alone, ignoring `anchor.state`, and `anchorSummaryState(null)` collapsed the pre-first-read window into `'hermetic'`. Gap-closure plan 03-08 executed three tasks:

1. Extended `anchorSummaryState`'s return union with a new leading `'checking'` member returned for a `null` anchor, before the `!anchor?.enabled` hermetic check.
2. Drove `StageTimeline`'s final-row label off `anchorSummaryState(anchor) === 'anchored'` instead of the raw `enabled` bit (`liveAnchor` is now retained only to gate `showSubSteps`).
3. Added a distinct `'checking'` branch to `CompletionSummary`'s Signed-line and gated the round-trip genesis-document placeholder on a confirmed `'hermetic'` read instead of `!anchorEnabled`.

Direct source reading confirms all three changes landed exactly as described, `shouldAutoResolve(null)` is unchanged (still `false`), and both originally-cited Truth 7 sub-cases (`state:'none'` and `state:'failed'`) are now correctly narrated as "Signed" everywhere, closing the two specific defects the prior verification cited.

**However**, a fresh deep code review conducted the same day as 03-08 landed (03-REVIEW.md, dated 2026-07-19, a re-review of the current state of the code) found a THIRD, narrower defect in the same mode-honesty family (WR-02): `anchorSummaryState`'s pre-existing `state === 'confirmed' || state === 'broadcast' -> 'anchored'` branch (untouched by plan 03-08, since 03-08 only added the `'checking'` guard) means a broadcast-but-unconfirmed anchor is narrated as "Anchored" everywhere (StageTimeline header, CompletionSummary header and narration paragraph), while `AnchorSubSteps` in the very same view correctly renders "Confirmed: pending" for that same state. This verification independently confirmed the defect by direct reading of `participant.ts:701-703`, `participant.spec.ts:557` (which pins `anchorSummaryState({enabled:true, state:'broadcast'})` to `'anchored'`, i.e. the contradiction is the CURRENTLY-INTENDED, tested behavior, not an accidental miss), `StageTimeline.tsx:73-79,163`, and `CompletionSummary.tsx:72,89,94-95`. This is why the phase remains `gaps_found` even though the two originally-cited Truth 7 sub-cases are genuinely closed.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 (SC1) | From a cohort they joined by choice, the participant submits a DID update and takes part in that cohort's n-of-n MuSig2 co-signing round | VERIFIED (regression-checked) | `onSubmitGate`/`createUpdateProvider` (`packages/participant/src/index.ts`), `SubmitPanel.tsx`, `pendingSubmit`/`submitUpdate()` in the store; unaffected by 03-08's changes; 364/364 unit tests pass |
| 2 (SC2) | The participant sees co-sign progress and anchor status for their joined cohort update in real time | VERIFIED with a caveat, mechanism intact | `StageTimeline.tsx` renders the full journey + live anchor sub-steps, 5s poll, freeze at confirmed/failed. Caveat: narration is still not fully internally consistent across all reachable anchor states (see gap below); the tracking MECHANISM (poll cadence, freeze, sub-step tone) is correct |
| 3 (SC3) | Once the beacon is anchored, the participant resolves the updated DID and sees the new DID document | VERIFIED | Auto-resolve (`shouldAutoResolve`) fires on `enabled+failed` and `enabled+confirmed`, unchanged by 03-08; `CompletionSummary.tsx` renders the resolved DID document, three-way `roundTripOutcome`, sidecar export; regression-checked |
| 4 (SC4) | The participant reaches submit/co-sign only via a cohort discovered and joined from the directory; the standalone linear stepper is no longer the entry path | VERIFIED (regression-checked) | `packages/web/src/components/participant/` directory confirmed absent; no `FlowStepper`/`KeyGenPanel`/`RegisterPanel`/`PublishPanel`/`ResolvePanel`/`ResultCard` component references outside comments; `e2e/browser-participant-cohort.ts:179-189` still asserts no KeyGen-first affordance |
| 5 (derived, CR-01) | Post-seat completion reporting is race-free: a genuinely successful cohort is never mis-reported as a terminal failure | VERIFIED, CLOSED (regression-checked) | `postSeatGoneStreak`/`POST_SEAT_GONE_CONFIRMATIONS` confirmed present in `participant.ts:486-505,1393-1415`, unchanged by 03-08 |
| 6 (derived, WR-01 original) | Mode-honest signed/anchored copy correctly narrates every live anchor state in the CompletionSummary Signed-line (not only confirmed/broadcast vs hermetic) | VERIFIED, CLOSED | `anchorSummaryState` now a five-way selector (`participant.ts:692-708`); `CompletionSummary.tsx:94-116` branches on all five states with distinct copy |
| 7 (derived, prior gap, closed by 03-08) | StageTimeline's final-row header does not claim "Anchored" while the anchor has not yet broadcast (`enabled:true, state:'none'`) or has terminally failed (`enabled:true, state:'failed'`); the pre-first-read (null) window is narrated neutrally, not as hermetic | VERIFIED, CLOSED | `StageTimeline.tsx:138,163`: `const summary = anchorSummaryState(anchor)`, label gated on `summary === 'anchored'`; for `state:'none'` this yields `'broadcasting'` -> "Signed" header; for `state:'failed'` -> `'broadcast-failed'` -> "Signed" header. `anchorSummaryState(null)` now returns `'checking'` (`participant.ts:695-697`), and `CompletionSummary.tsx:105-110` renders neutral "Confirming this service's broadcast mode." copy for that state instead of the hermetic no-broadcast copy. Confirmed by direct source reading and passing `participant.spec.ts` cases (`anchorSummaryState is checking before the first read`, `anchorSummaryState is hermetic on a no-broadcast service`, `shouldAutoResolve is false before the first anchor read`) |
| 8 (derived, NEW - discovered this re-verification via 03-REVIEW.md WR-02) | StageTimeline's final-row header, and CompletionSummary's header/narration, do not claim "Anchored"/"anchored" while the anchor tx has been broadcast but not yet confirmed (`enabled:true, state:'broadcast'`), since `AnchorSubSteps` in the same view correctly shows "Confirmed: pending" for that exact state | FAILED | `participant.ts:701-703`: `if (anchor.state === 'confirmed' || anchor.state === 'broadcast') return 'anchored';` - unchanged by plan 03-08, and explicitly pinned as intended behavior by `participant.spec.ts:557` (`anchorSummaryState({enabled:true, state:'broadcast'}) === 'anchored'`). `StageTimeline.tsx:163`'s new `summary === 'anchored'` gate inherits this mapping, so the header reads "Anchored" for the same state that `AnchorSubSteps` (`StageTimeline.tsx:73-79`, `confirmed = anchor.state === 'confirmed'` only) renders "Confirmed: pending" beneath it; `CompletionSummary.tsx:72,89,94-95` shows the same contradiction ("Anchored" header + "Signed and anchored on {netLabel}." narration) |

**Score:** 7/8 truths verified (0 present-but-behavior-unverified; 1 failed, a narrower residual mode-honesty gap in a sub-case not covered by the just-executed gap-closure plan)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/web/src/stores/participant.ts` (`anchorSummaryState`, five-member union incl. `'checking'`) | Mode-honest five-way anchor narration selector | VERIFIED for the `'checking'`/`'hermetic'`/`'broadcasting'`/`'broadcast-failed'` members; GAP in the `'anchored'` member's own definition | Confirmed present, exported, unit-tested; the `'anchored'` branch itself still conflates unconfirmed-broadcast with confirmed (Truth 8) |
| `packages/web/src/components/cohort/StageTimeline.tsx` (label gated on `anchorSummaryState(anchor) === 'anchored'`) | Anchor-status label consistent with the honest five-way narration | VERIFIED that it correctly consumes the selector; GAP inherited from the selector's own `'anchored'` mapping | Confirmed: `summary = anchorSummaryState(anchor)`; label gate correctly wired, but the underlying selector value is itself dishonest for the unconfirmed-broadcast state |
| `packages/web/src/components/cohort/CompletionSummary.tsx` (five-way Signed-line branch + gated round-trip placeholder) | Honest narration for every reachable anchor state | VERIFIED for `'checking'`; GAP inherited from the same `'anchored'` mapping for the unconfirmed-broadcast state | Confirmed: distinct `'checking'` branch renders neutral copy; the `anchored` boolean at line 72 duplicates the selector's own conflation |
| `packages/web/src/stores/participant.spec.ts` (`anchorSummaryState` unit cases) | Behavioral proof of all narration branches | VERIFIED as written, but PINS the gap | `participant.spec.ts:557` asserts `anchorSummaryState({enabled:true, state:'broadcast'})==='anchored'` - this test currently encodes the defect as intended behavior, so it will need updating alongside the fix |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `anchorSummaryState(anchor)` (store) | `StageTimeline` final-row label | `summary === 'anchored'` gate (03-08) | WIRED, correctly consumes the selector | Confirmed: `StageTimeline.tsx:138,163` |
| `anchorSummaryState(anchor)` (store) | `CompletionSummary` Signed-line five-way branch | direct import + call | WIRED | Confirmed: `CompletionSummary.tsx:3,76,94-116` |
| null anchor (pre-first-read) | `anchorSummaryState` -> `'checking'` -> neutral copy on every completion-view surface | first guard in the selector | WIRED | Confirmed: `participant.ts:695-697`, `StageTimeline.tsx` label stays "Signed" for `'checking'`, `CompletionSummary.tsx:105-110` |
| broadcast-but-unconfirmed anchor (`enabled:true, state:'broadcast'`) | `anchorSummaryState` -> `'anchored'` (SAME as a confirmed anchor) -> "Anchored" label + narration | the pre-existing, unchanged `'confirmed' \|\| 'broadcast'` branch | WIRED, but mode-dishonest | The selector itself, not just a consumer, produces the wrong value for this state; every consumer that correctly reads the selector still surfaces the contradiction against `AnchorSubSteps`' independent `state === 'confirmed'` check |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `anchorSummaryState` five-way mapping (incl. new `'checking'` member) | `npx vitest run packages/web/src/stores/participant.spec.ts` | 6/6 `anchorSummaryState` cases pass (including `null -> 'checking'`) | PASS |
| `shouldAutoResolve(null)` regression guard | Same file, `shouldAutoResolve (D-28 gating)` describe | 5/5 pass, `shouldAutoResolve(null) === false` confirmed | PASS |
| Full hermetic gate | `pnpm test` (root `tsc -b && vitest run`) | 364 passed, 27 files, 0 failed | PASS |
| Web production build | `pnpm --filter @btcr2-aggregation/web build` (tsc --noEmit + vite build) | Clean, 693 modules, no type errors | PASS |
| Em-dash scan on the 3 files modified by 03-08 | `grep -cP '\x{2014}'` x3 | 0, 0, 0 | PASS |
| Debt-marker scan on the 3 files modified by 03-08 | `grep -n -E "TBD\|FIXME\|XXX"` x3 | No matches | PASS |
| `anchorSummaryState({enabled:true, state:'broadcast'})` pins 'anchored' (new finding) | Direct source read: `participant.ts:701-703` + `participant.spec.ts:557` | Returns `'anchored'`, test explicitly asserts this value | FAIL (confirms Truth 8 gap) |
| Linear stepper absence | `ls packages/web/src/components/participant/`, grep for retired component names | Directory absent; no live references outside comments | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| PART-03 | 03-01, 03-04, 03-05, 03-07 | Participant can submit a DID update and take part in the n-of-n MuSig2 co-signing round | SATISFIED | Mechanism built, proven by the browser capstone + unit tests; unaffected by 03-08 |
| PART-04 | 03-02, 03-03, 03-04, 03-06, 03-07, 03-08 | Participant can track co-sign/anchor progress and resolve once anchored | SATISFIED with a flagged residual honesty gap | Tracking + resolve mechanism proven; the CompletionSummary/StageTimeline-level narration is honest for `checking`/`hermetic`/`broadcasting (not-yet-posted)`/`broadcast-failed`, but the newly-discovered `broadcast (unconfirmed)` -> `'anchored'` conflation (Truth 8) remains open under this requirement's "track...anchor status" clause |

REQUIREMENTS.md marks both PART-03 and PART-04 `[x] Complete` (lines 23-24) and maps both to "Phase 3 | Complete" in its Requirement Coverage table (lines 72-73). No orphaned requirements: only PART-03/PART-04 map to Phase 3, and both are claimed across the plans' `requirements:` frontmatter, including gap-closure plans 03-07 and 03-08.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| - | - | No `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` markers found in the 4 files modified by 03-08 | info | Clean |
| - | - | No em-dash characters found in the 4 files modified by 03-08 | info | Clean, house style honored |
| `packages/web/src/stores/participant.ts` | 701-703 | `anchorSummaryState` maps `state === 'broadcast'` (accepted, not yet mined) to `'anchored'`, the same value as a confirmed anchor | warning (elevated to gap, Truth 8) | Contradicts `AnchorSubSteps`' independent `confirmed = state === 'confirmed'` check and pins the contradiction as intended, tested behavior (`participant.spec.ts:557`) |
| `packages/web/src/components/cohort/SubmitPanel.tsx` | 137 | Carried forward, confirmed still present: `beaconAddress ?? 'this cohort&apos;s beacon'` renders a literal `&apos;` if the fallback is ever reached (03-REVIEW.md WR-01, distinct from the anchor-narration WR-01) | info | Currently unreachable (submit window only opens after `beaconAddress` is set); out of this verification's blocking scope, but should be fixed opportunistically |
| `packages/web/src/components/cohort/SubmitPanel.tsx`, `JoinIdentityStep.tsx`, `DirectoryList.tsx` | various | `…` (U+2026 single-glyph ellipsis) used inconsistently vs. the `...` (ASCII) convention used elsewhere (03-REVIEW.md IN-01) | info | Cosmetic, not an em-dash violation |
| `packages/web/src/stores/participant.ts` | 720-728, 1355-1359 | A live beacon tx that broadcasts but never confirms polls indefinitely with no auto-resolve (03-REVIEW.md IN-03) | info | Benign edge (manual "Resolve again" still works); out of Phase 3 blocking scope |
| `packages/service/src/operator-cohorts.ts` | ~272-274 | Carried forward: no upper bound on operator draft cohort `size` (03-REVIEW.md, prior WR-03) | info (out of Phase 3 participant-facing scope) | Operator-authenticated Phase-1 concern |

### Human Verification Required

Carried forward from the initial and second verifications (still not resolvable by grep/static analysis), plus two new items from 03-08's own coverage claims (D3/D4, `human_judgment:true`):

1. **Stage timeline + identity section + Signed copy visual check (updated scope, now including the broadcast-but-unconfirmed window)**
   **Test:** Join a cohort as a real browser user on both a hermetic and a live-configured (broadcast-enabled) service; observe the stage timeline through Waiting -> Seated -> Submit -> Co-signing -> Signed/Anchored, including the pre-first-read checking window, a broadcasting-but-not-yet-posted window, a broadcast-but-unconfirmed window, and, if reproducible, a failed-broadcast case.
   **Expected:** Active stage pulses accent, completed stages read good-tone, future stages are dimmed; the Signed-line copy on the completion card matches the actual anchor state (checking / broadcasting / failed / anchored / hermetic) at every moment; the StageTimeline header does not read "Anchored" while the anchor sub-steps beneath it read "Confirmed: pending" (this is Truth 8 above, currently failing by design; a human should confirm today's contradiction is visible on a real broadcast-but-unconfirmed tx, and re-confirm once a closure plan fixes it).
   **Why human:** Visual tone/contrast/pulsing and "these two panels tell the same story" judgments are not resolvable by grep or static analysis.

2. **Submit-window consent + urgency check**
   **Test:** Reach the submit window; observe the heading escalation, the tab title change, the one consent line (hermetic vs live), and click Submit.
   **Expected:** Heading reads "Your update is needed"; tab title becomes "(!) Submit your update" and restores on submit/leave; exactly one consent line and one CTA; no second approval gate.
   **Why human:** Tab-title/interaction-timing behavior and "reads as exactly one consent, not two" are interaction/visual judgments.

3. **Seated-row affordance + one-cohort-at-a-time + persistent-link navigation check**
   **Test:** While seated in a cohort, view the directory; observe the seated row's "You're in this cohort" + View cohort affordance, that Join is disabled on every other row, and that the persistent "Your cohort · {stage}" link correctly returns to the cohort page.
   **Expected:** Exactly one row shows the seated affordance; all other rows show a disabled Join; the persistent link/chip stays live and accurate.
   **Why human:** Live-poll-driven UI state flips and navigation correctness are interaction behaviors.

4. **Checking-window neutral copy visual check (new, from 03-08 coverage D4)**
   **Test:** On a live-configured (broadcast-enabled) service, observe the completion view the instant `status` becomes `complete`, before the first anchor read lands (a brief window).
   **Expected:** The Signed-line reads "Confirming this service's broadcast mode." and the round-trip placeholder reads "Resolving your updated DID..."; the hermetic "no-broadcast service" copy does NOT appear during this window.
   **Why human:** This is a brief, timing-dependent render window not asserted by an existing test; confirming it requires observing a real network round trip in a browser.

### Gaps Summary

Gap-closure plan 03-08 genuinely and durably closed both sub-cases explicitly cited in the prior verification's Truth 7 finding: a StageTimeline header no longer claims "Anchored" for a not-yet-broadcast or a terminally-failed live anchor, and the pre-first-read null-anchor window is now honestly neutral ("checking") rather than falsely hermetic. Both are confirmed by direct reading of the current source (not by re-reading the plan's or SUMMARY's claims) and by independently re-running the relevant tests (364/364 full suite, clean web build, em-dash/debt-marker scans clean).

However, a deep code review conducted the same day as the gap closure landed, and independently confirmed in this verification by direct source reading rather than by trusting the review document, found that the underlying `anchorSummaryState` selector's pre-existing `'confirmed' || 'broadcast' -> 'anchored'` mapping (untouched by plan 03-08, which only added the `'checking'` guard ahead of it) still produces the same "Anchored" narration for a broadcast-but-unconfirmed anchor as for a truly confirmed one. Because 03-08's own fix correctly wired every consumer (StageTimeline, CompletionSummary) to this selector, all three surfaces now agree with EACH OTHER on the wrong value, while `AnchorSubSteps`' independently-computed `confirmed = anchor.state === 'confirmed'` check still (correctly) disagrees with them. The contradiction the phase has now spent two gap-closure rounds eliminating (StageTimeline header vs. AnchorSubSteps vs. CompletionSummary) persists in this one remaining reachable state, and it is explicitly pinned as intended, tested behavior at `participant.spec.ts:557`.

This directly bears on Success Criterion 2 ("the participant sees...anchor status...in real time") and the phase's own D-07 mode-honesty through-line, cited repeatedly in the store's comments and the subject of both prior gap-closure rounds. The fix is small and already sketched with code in 03-REVIEW.md WR-02 (route `state === 'broadcast'` into the existing `'broadcasting'` narration branch instead of `'anchored'`, reserving `'anchored'` for `state === 'confirmed'` only, and aligning `CompletionSummary`'s `anchored` boolean the same way). Recommend routing this phase to `/gsd-plan-phase --gaps` for a small, targeted third closure plan, analogous to 03-07 and 03-08, rather than accepting an override; this is an unresolved correctness/honesty defect in the core success path shown on the participant's own page, in the exact same defect family two prior rounds already fixed for other sub-cases.

---

_Verified: 2026-07-19_
_Verifier: Claude (gsd-verifier)_
