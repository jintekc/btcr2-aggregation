---
phase: 03-participant-submit-co-sign-track-and-resolve
verified: 2026-07-20T10:30:00Z
status: human_needed
score: 8/8 must-haves verified
behavior_unverified: 0
overrides_applied: 0
mode: mvp
mvp_goal_format_discrepancy: true
re_verification:
  previous_status: gaps_found
  previous_score: 7/8
  gaps_closed:
    - "Truth 8: anchorSummaryState and deriveStage both now reserve the 'anchored' value/Stage for anchor.state === 'confirmed' only; a broadcast-but-unconfirmed anchor (enabled:true, state:'broadcast') narrates as 'broadcasting'/'signed' everywhere instead of being conflated with a truly confirmed anchor."
  gaps_remaining: []
  regressions: []
---

# Phase 3: Participant Submit, Co-Sign, Track, and Resolve Verification Report

**Phase Goal:** From the cohort they chose, a participant submits a DID update, takes part in the n-of-n MuSig2 co-signing round, tracks the anchor, and resolves the updated DID, wiring the existing signing/resolve flow into the discover-to-join path instead of the linear demo stepper.
**Verified:** 2026-07-20
**Status:** human_needed
**Re-verification:** Yes, fourth pass (after gap-closure plans 03-07, 03-08, and 03-09; latest commits f53c0da, 3f8cc3d, d7753bf, d53f3ec)

**MVP-mode note (carried forward):** The phase carries `Mode: mvp` in ROADMAP.md, but the roadmap `**Goal:**` line is outcome-shaped, not literal User Story form. This is a documentation-process gap, not a phase-goal-achievement gap, and is unchanged since the first verification.

## What Changed Since the Last Verification

The previous verification (2026-07-19, third pass) scored 7/8: Truth 8 failed because `anchorSummaryState`'s pre-existing `state === 'confirmed' || state === 'broadcast' -> 'anchored'` branch (untouched by plan 03-08) meant a broadcast-but-unconfirmed anchor was narrated as "Anchored" on the StageTimeline header and the CompletionSummary heading/narration, while `AnchorSubSteps` in the same view correctly rendered "Confirmed: pending" for that exact state. `deriveStage` had the identical `confirmed || broadcast` conflation, which additionally drove the persistent "Your cohort · Anchored" chip (`App.tsx`, `BrowseView.tsx`) to the same premature claim, a third surface the prior verification's Truth 8 wording had not explicitly named but which the 03-09 plan's own ripple grep found and closed alongside the other two.

Gap-closure plan 03-09 executed two tasks (commits `f53c0da`, `3f8cc3d`):

1. Narrowed `anchorSummaryState`'s 'anchored' branch (`packages/web/src/stores/participant.ts:701-717`) from `state === 'confirmed' || state === 'broadcast'` to `state === 'confirmed'` only; `state === 'broadcast'` now falls through to the existing `return 'broadcasting'`, alongside `state === 'none'`.
2. Narrowed `deriveStage`'s complete-cohort 'anchored' condition (`participant.ts:626-647`) from `a?.enabled && (a.state === 'confirmed' || a.state === 'broadcast')` to `a?.enabled && a.state === 'confirmed'` only; a broadcast-but-unconfirmed complete cohort now returns `'signed'`.
3. Narrowed `CompletionSummary`'s `anchored` heading boolean (`CompletionSummary.tsx:78`) to the matching `Boolean(anchor?.enabled && anchor.state === 'confirmed')`.
4. Re-pinned `participant.spec.ts`: the `anchorSummaryState` broadcast case now asserts `'broadcasting'` (line 562), the `deriveStage` broadcast case now asserts the `'signed'` Stage (lines 374-376), and both confirmed cases still assert `'anchored'` (lines 566, 379-382). The `shouldAutoResolve` broadcast-false regression guard (line 527) is unchanged.
5. `StageTimeline.tsx` needed and received no source edit: its final-row label is already gated on `anchorSummaryState(anchor) === 'anchored'` (from 03-08) and `AnchorSubSteps` already independently computes `confirmed = anchor.state === 'confirmed'`; both auto-corrected once the underlying selector was fixed.

Direct source reading in this verification confirms all of the above landed exactly as described, and that `shouldAutoResolve` is byte-for-byte unchanged (`anchor.state === 'confirmed' || anchor.state === 'failed'`, still excluding 'broadcast'), so auto-resolve timing did not shift. The persistent "Your cohort" chip in `App.tsx` and `BrowseView.tsx` both derive their label from `STAGE_LABEL[deriveStage(...)]`, so they inherit the fix automatically without their own edit, confirmed by direct reading of both files. `pnpm test` (364/364, 27 files) and `pnpm --filter @btcr2-aggregation/web build` (clean, 693 modules) both pass. No em-dash characters and no debt markers (`TBD`/`FIXME`/`XXX`) in the three modified files. A same-day deep code review (`03-REVIEW.md`, `d53f3ec`) independently traced the same six surfaces (`deriveStage`, `anchorSummaryState`, `CompletionSummary` heading+paragraph, `StageTimeline` relabel, `AnchorSubSteps`, the chip) and confirmed they all now derive "Anchored" from the single confirmed-only condition, finding 0 critical and 0 new warnings tied to this fix (its 4 warnings and 2 info items are pre-existing, unrelated defects: `SubmitPanel` literal `&apos;`, an unbounded poll on a never-confirming broadcast, a round-trip narration edge for cooperative non-inclusion, and a `terminalReason` mis-narration, none of which block Phase 3's goal).

Truth 8 is now closed. All 8 observable truths for the phase are verified. The phase's remaining open items are the same human-verification (visual/interaction) checks carried forward from the first verification, none of which are new gaps.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 (SC1) | From a cohort they joined by choice, the participant submits a DID update and takes part in that cohort's n-of-n MuSig2 co-signing round | VERIFIED (regression-checked) | `onSubmitGate`/`createUpdateProvider` (`packages/participant/src/index.ts`), `SubmitPanel.tsx`, `pendingSubmit`/`submitUpdate()` in the store; untouched by 03-09; 364/364 unit tests pass |
| 2 (SC2) | The participant sees co-sign progress and anchor status for their joined cohort update in real time | VERIFIED | `StageTimeline.tsx` renders the full journey plus live anchor sub-steps on a 5s poll, freezing at confirmed/failed; the narration is now internally consistent for every reachable anchor state including the broadcast-but-unconfirmed window (Truth 8, closed this pass) |
| 3 (SC3) | Once the beacon is anchored, the participant resolves the updated DID and sees the new DID document | VERIFIED | Auto-resolve (`shouldAutoResolve`) fires on `enabled+failed` and `enabled+confirmed`, byte-for-byte unchanged by 03-09; `CompletionSummary.tsx` renders the resolved DID document, three-way `roundTripOutcome`, sidecar export; regression-checked |
| 4 (SC4) | The participant reaches submit/co-sign only via a cohort discovered and joined from the directory; the standalone linear stepper is no longer the entry path | VERIFIED (regression-checked) | `packages/web/src/components/participant/` directory confirmed absent; no `FlowStepper`/`KeyGenPanel`/`RegisterPanel`/`PublishPanel`/`ResolvePanel`/`ResultCard` component references outside comments; `e2e/browser-participant-cohort.ts:179-189` still asserts no KeyGen-first affordance |
| 5 (derived, CR-01) | Post-seat completion reporting is race-free: a genuinely successful cohort is never mis-reported as a terminal failure | VERIFIED, CLOSED (regression-checked) | `postSeatGoneStreak`/`POST_SEAT_GONE_CONFIRMATIONS` confirmed present in `participant.ts:486-505,1402-1424`, untouched by 03-09 |
| 6 (derived, WR-01 original) | Mode-honest signed/anchored copy correctly narrates every live anchor state in the CompletionSummary Signed-line | VERIFIED, CLOSED | `anchorSummaryState` remains a five-way selector (`participant.ts:692-717`); `CompletionSummary.tsx:100-122` branches on all five states with distinct copy |
| 7 (derived, closed by 03-08) | StageTimeline's final-row header does not claim "Anchored" while the anchor has not yet broadcast or has terminally failed; the pre-first-read (null) window is narrated neutrally | VERIFIED, CLOSED | `StageTimeline.tsx:138,163`: label gated on `anchorSummaryState(anchor) === 'anchored'`; `anchorSummaryState(null)` returns `'checking'`; confirmed unchanged by 03-09 and still passing (`participant.spec.ts:546-574`) |
| 8 (derived, closed this pass by 03-09) | StageTimeline's final-row header, the persistent "Your cohort" chip, and CompletionSummary's header/narration do not claim "Anchored"/"anchored" while the anchor tx has been broadcast but not yet confirmed (`enabled:true, state:'broadcast'`), agreeing with `AnchorSubSteps`' "Confirmed: pending" in the same view | VERIFIED, CLOSED | `participant.ts:710-712`: `if (anchor.state === 'confirmed') return 'anchored';` (no longer matches `'broadcast'`), falls through to `return 'broadcasting';` at line 716; `deriveStage` at `participant.ts:632-634` narrowed identically to `a.state === 'confirmed'`; `CompletionSummary.tsx:78`: `anchored = Boolean(anchor?.enabled && anchor.state === 'confirmed')`; `App.tsx:55,96` and `BrowseView.tsx:53,132` both derive the chip label from the corrected `deriveStage`; `participant.spec.ts:374-376,562` re-pin the honest 'signed'/'broadcasting' values; `AnchorSubSteps` (`StageTimeline.tsx:73-79`) is unchanged and now agrees with every other surface for this state |

**Score:** 8/8 truths verified (0 present-but-behavior-unverified; 0 failed)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/web/src/stores/participant.ts` (`anchorSummaryState`, `deriveStage`) | Mode-honest anchor narration and stage-derivation selectors that reserve 'anchored' for a confirmed (mined) anchor only | VERIFIED | Both selectors' 'anchored' branch now reads `state === 'confirmed'` only (lines 632, 710); confirmed by direct source reading and 6/6 + full `deriveStage`/`anchorSummaryState` spec cases passing |
| `packages/web/src/components/cohort/CompletionSummary.tsx` (`anchored` heading boolean) | Heading agrees with the narration paragraph and `AnchorSubSteps` for every reachable anchor state | VERIFIED | `anchored = Boolean(anchor?.enabled && anchor.state === 'confirmed')` (line 78); heading `{anchored ? 'Anchored' : 'Signed'}` (line 95) now reads "Signed" for a broadcast-but-unconfirmed anchor |
| `packages/web/src/components/cohort/StageTimeline.tsx` (label gated on `anchorSummaryState(anchor) === 'anchored'`) | Anchor-status label consistent with the honest selector, no source edit needed | VERIFIED | Confirmed unchanged (`StageTimeline.tsx:138,163`); auto-corrects via the selector fix, verified by direct reading |
| `packages/web/src/App.tsx`, `packages/web/src/components/browse/BrowseView.tsx` (persistent "Your cohort" chip) | Chip label agrees with the corrected `deriveStage` | VERIFIED | Both derive `STAGE_LABEL[deriveStage(...)]` (`App.tsx:55,96`, `BrowseView.tsx:53,132`), unedited but automatically inherit the fix |
| `packages/web/src/stores/participant.spec.ts` (`anchorSummaryState`/`deriveStage` unit cases) | Behavioral proof of the corrected mapping, contradiction no longer pinned as intended behavior | VERIFIED | Broadcast cases now assert `'broadcasting'`/`'signed'`; confirmed cases still assert `'anchored'`; 59/59 store-spec tests pass |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `anchorSummaryState(anchor)` (store) | `StageTimeline` final-row label + `CompletionSummary` narration paragraph | `summary === 'anchored'` gate / direct call | WIRED, mode-honest | `state:'broadcast'` now maps to `'broadcasting'`, so both surfaces read the honest "Signed"/"Broadcasting..." copy |
| `deriveStage(state)` (store) | persistent "Your cohort · {stage}" chip AND StageTimeline row position | `STAGE_LABEL[stage]` / `STAGE_ORDER.indexOf(stage)` | WIRED, mode-honest | `state:'broadcast'` now maps to the `'signed'` Stage, so the chip reads "Your cohort · Signed" and the signed row stays active while unconfirmed |
| `CompletionSummary` `anchored` boolean | completion-card heading | `{anchored ? 'Anchored' : 'Signed'}` | WIRED, mode-honest | Gated on `state === 'confirmed'` only, agreeing with `AnchorSubSteps`' independent check |
| `AnchorSubSteps` `confirmed = anchor.state === 'confirmed'` (unchanged) | every other completion-view surface | shared `state === 'confirmed'` gate | AGREES | All surfaces now derive their "Anchored"/"confirmed" claim from the same condition; no contradiction reachable |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `anchorSummaryState`/`deriveStage`/`shouldAutoResolve` full store spec | `npx vitest run packages/web/src/stores/participant.spec.ts` | 59/59 pass, including the re-pinned broadcast/'broadcasting' and broadcast/'signed' cases | PASS |
| Full hermetic gate | `pnpm test` (root `tsc -b && vitest run`) | 364 passed, 27 files, 0 failed | PASS |
| Web production build | `pnpm --filter @btcr2-aggregation/web build` (tsc --noEmit + vite build) | Clean, 693 modules, no type errors | PASS |
| Em-dash scan on the 3 files modified by 03-09 | `grep -cP '\x{2014}'` x3 | 0, 0, 0 | PASS |
| Debt-marker scan on the 3 files modified by 03-09 | `grep -n -E "TBD\|FIXME\|XXX"` x3 | No matches | PASS |
| `anchorSummaryState({enabled:true, state:'broadcast'})` no longer 'anchored' | Direct source read: `participant.ts:701-717` + `participant.spec.ts:559-563` | Returns `'broadcasting'`, test asserts this value | PASS (confirms Truth 8 closure) |
| `deriveStage` complete+broadcast no longer 'anchored' | Direct source read: `participant.ts:626-647` + `participant.spec.ts:368-377` | Returns `'signed'`, test asserts this value | PASS (confirms Truth 8 closure) |
| Diff scope check | `git diff 57349f5 d53f3ec -- <3 files>` | Diff exactly matches the 03-09 plan/SUMMARY claims, no stray edits | PASS |
| Linear stepper absence | `ls packages/web/src/components/participant/`, grep for retired component names | Directory absent; no live references outside comments | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| PART-03 | 03-01, 03-04, 03-05, 03-07 | Participant can submit a DID update and take part in the n-of-n MuSig2 co-signing round | SATISFIED | Mechanism built, proven by the browser capstone plus unit tests; unaffected by 03-09 |
| PART-04 | 03-02, 03-03, 03-04, 03-06, 03-07, 03-08, 03-09 | Participant can track co-sign/anchor progress and resolve once anchored | SATISFIED | Tracking plus resolve mechanism proven; narration is now honest for every reachable anchor state (checking, hermetic, broadcasting/not-yet-posted, broadcast-failed, broadcast-but-unconfirmed, confirmed-anchored); Truth 8 residual gap closed |

REQUIREMENTS.md marks both PART-03 and PART-04 `[x] Complete` (lines 23-24) and maps both to "Phase 3 | Complete" in its Requirement Coverage table (lines 72-73). No orphaned requirements: only PART-03/PART-04 map to Phase 3, and both are claimed across the plans' `requirements:` frontmatter, including gap-closure plans 03-07, 03-08, and 03-09.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| - | - | No `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` markers found in the 3 files modified by 03-09 | info | Clean |
| - | - | No em-dash characters found in the 3 files modified by 03-09 | info | Clean, house style honored |
| `packages/web/src/components/cohort/SubmitPanel.tsx` | 137 | Carried forward, confirmed still present: literal `&apos;` renders if the `beaconAddress` fallback is ever reached (03-REVIEW.md WR-01, distinct from the closed anchor-narration defect) | info | Currently unreachable in the normal flow; out of this verification's blocking scope |
| `packages/web/src/stores/participant.ts` | 729-737, 1364-1368 | Carried forward (03-REVIEW.md WR-02, new numbering): a live beacon tx that broadcasts but never confirms polls indefinitely with no auto-resolve, and stays at "Signed" forever | info | Benign edge (manual "Resolve again" still works); out of Phase 3 blocking scope, tracked as a candidate follow-up |
| `packages/web/src/components/cohort/CompletionSummary.tsx` | 85, 169-174 | New this review (03-REVIEW.md WR-03): round-trip card invites "Try Resolve again" for a cooperatively non-included DID on a live service | info | Reachable but narrow (baked x1 beacon-type mismatch join path); out of Phase 3 blocking scope |
| `packages/web/src/components/cohort/CohortPage.tsx` | 26-35 | New this review (03-REVIEW.md WR-04): `terminalReason` can misattribute a co-signing-phase stall to "waiting for updates" | info | Narrow race window; out of Phase 3 blocking scope |
| `packages/service/src/operator-cohorts.ts` | ~272-274 | Carried forward: no upper bound on operator draft cohort `size` (03-REVIEW.md, prior WR-03) | info (out of Phase 3 participant-facing scope) | Operator-authenticated Phase-1 concern |

None of the above are blockers: all are pre-existing, narrow-scope, non-blocking edges the code review itself classified as warning/info, not tied to Truth 8's closure, and none contradicts a phase success criterion.

### Human Verification Required

Carried forward from the prior verifications (not resolvable by grep/static analysis); item 1 is updated to confirm the contradiction is now resolved rather than reproducible.

1. **Stage timeline + identity section + Signed copy visual check (now confirming the fix, not the defect)**
   **Test:** Join a cohort as a real browser user on both a hermetic and a live-configured (broadcast-enabled) service; observe the stage timeline through Waiting -> Seated -> Submit -> Co-signing -> Signed -> Anchored, including the pre-first-read checking window, a broadcasting-but-not-yet-posted window, a broadcast-but-unconfirmed window, and, if reproducible, a failed-broadcast case.
   **Expected:** Active stage pulses accent, completed stages read good-tone, future stages are dimmed; the Signed-line copy on the completion card matches the actual anchor state (checking / broadcasting / failed / anchored / hermetic) at every moment; the StageTimeline header, the persistent "Your cohort" chip, and the CompletionSummary heading all read "Signed"/"Broadcasting" (not "Anchored") while the anchor sub-steps beneath read "Confirmed: pending", and all flip to "Anchored"/"Confirmed" together only once the tx is mined.
   **Why human:** Visual tone/contrast/pulsing and "these panels tell the same story" judgments are not resolvable by grep or static analysis; this is the real-browser confirmation of the fix the static/unit checks in this verification cannot themselves provide.

2. **Submit-window consent + urgency check**
   **Test:** Reach the submit window; observe the heading escalation, the tab title change, the one consent line (hermetic vs live), and click Submit.
   **Expected:** Heading reads "Your update is needed"; tab title becomes "(!) Submit your update" and restores on submit/leave; exactly one consent line and one CTA; no second approval gate.
   **Why human:** Tab-title/interaction-timing behavior and "reads as exactly one consent, not two" are interaction/visual judgments.

3. **Seated-row affordance + one-cohort-at-a-time + persistent-link navigation check**
   **Test:** While seated in a cohort, view the directory; observe the seated row's "You're in this cohort" + View cohort affordance, that Join is disabled on every other row, and that the persistent "Your cohort · {stage}" link correctly returns to the cohort page.
   **Expected:** Exactly one row shows the seated affordance; all other rows show a disabled Join; the persistent link/chip stays live and accurate (now including the corrected Signed/Anchored transition point).
   **Why human:** Live-poll-driven UI state flips and navigation correctness are interaction behaviors.

4. **Checking-window neutral copy visual check**
   **Test:** On a live-configured (broadcast-enabled) service, observe the completion view the instant `status` becomes `complete`, before the first anchor read lands (a brief window).
   **Expected:** The Signed-line reads "Confirming this service's broadcast mode." and the round-trip placeholder reads "Resolving your updated DID..."; the hermetic "no-broadcast service" copy does NOT appear during this window.
   **Why human:** This is a brief, timing-dependent render window not asserted by an existing test; confirming it requires observing a real network round trip in a browser.

### Gaps Summary

No gaps remain. Gap-closure plan 03-09 closed Truth 8 at its root: both pure selectors (`anchorSummaryState`, `deriveStage`) that could produce an 'anchored' value now reserve it for `state === 'confirmed'` only, and `CompletionSummary`'s heading boolean was aligned to the same definition. This was independently confirmed in this verification by direct reading of the current source (not by trusting the plan or SUMMARY narrative), by re-running the relevant unit specs (59/59 store-spec tests, 364/364 full suite), by a clean production build, and by a same-day deep code review that traced all six affected surfaces and found the fix internally consistent with zero new blocking findings.

All three defect-class rounds the phase has now run (03-07: the original two-way anchored-or-hermetic collapse; 03-08: the not-yet-broadcast and terminally-failed sub-cases; 03-09: the broadcast-but-unconfirmed sub-case, including the previously-unnoted `deriveStage`/chip ripple) are closed, and no reachable anchor state remains where one completion-view surface claims "Anchored" while another shows "Confirmed: pending". The phase's remaining human-verification items are the same category of visual/interaction checks flagged since the first verification pass; none represent a new or newly-discovered gap, and status routes to `human_needed` rather than `passed` purely because those items still require a human to confirm in a real browser.

---

_Verified: 2026-07-20_
_Verifier: Claude (gsd-verifier)_
