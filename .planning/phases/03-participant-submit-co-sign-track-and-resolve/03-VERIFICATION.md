---
phase: 03-participant-submit-co-sign-track-and-resolve
verified: 2026-07-17T22:40:02Z
status: gaps_found
score: 6/7 must-haves verified (1 newly discovered mode-honesty gap)
behavior_unverified: 0
overrides_applied: 0
mode: mvp
mvp_goal_format_discrepancy: true
re_verification:
  previous_status: gaps_found
  previous_score: 4/6
  gaps_closed:
    - "Post-seat completion reporting is race-free (CR-01): a single post-seat directory-gone read no longer lands a terminal failure; the honest terminal is reached only after POST_SEAT_GONE_CONFIRMATIONS (2) consecutive gone reads, so a racing cohort-complete SSE always wins the directory-drop race and a genuine success keeps its result and sidecar."
    - "Mode-honest signed/anchored copy on the LIVE path (WR-01, CompletionSummary Signed-line): the two-way anchored-or-hermetic collapse is replaced by a four-way anchorSummaryState branch (anchored / broadcasting / broadcast-failed / hermetic); a failed live broadcast also now reaches a resolve outcome via shouldAutoResolve instead of freezing."
  gaps_remaining: []
  regressions: []
gaps:
  - truth: "Anchor-status narration is mode-honest and internally consistent across every component rendered in the same view (not just the CompletionSummary Signed-line copy WR-01 fixed): StageTimeline's final-stage header label must not claim 'Anchored' while the cohort is merely broadcasting or has a failed broadcast, and the completion view must not show the hermetic 'no-broadcast' copy for a live service whose first anchor read has not yet landed."
    status: failed
    reason: "Gap-closure plan 03-07 correctly fixed the two originally-cited defects (CR-01 and the CompletionSummary two-way collapse), confirmed by direct source reading and 59/59 passing store tests. But a fresh deep code review conducted the same day (03-REVIEW.md, re-review after 03-07) found, and this verification independently confirmed by direct reading of the current source, that the SAME mode-honesty defect class WR-01 targeted still exists in an adjacent component: StageTimeline.tsx:130 computes `liveAnchor = anchor?.enabled === true` and uses it alone (line 152: `item.key === 'signed' && liveAnchor ? 'Anchored' : item.label`) to relabel the final timeline row 'Anchored', regardless of the actual anchor.state. On a broadcasting-but-unconfirmed service (enabled:true, state:'none' - which the plan's own new copy says 'can take a few minutes to post') or a broadcast-failed service (enabled:true, state:'failed'), the timeline header pulses/reads 'Anchored' at the exact moment the AnchorSubSteps rendered directly beneath it (StageTimeline.tsx:70-109) show 'Broadcast: pending' or a bad-tone failed sub-step, and at the exact moment CompletionSummary (rendered on the same page) honestly says 'Broadcasting...' or 'The beacon broadcast...failed'. This is an internal contradiction within one page for the full duration of the broadcasting window (minutes) or permanently on a failed broadcast. Separately, `anchorSummaryState(null)` returns 'hermetic' (participant.ts:689-691), and CompletionSummary renders as soon as `status === 'complete'` (set synchronously at participant.ts:1153) while `anchor` is still its initial `null` (participant.ts:785) until the first `fetchAnchor` in `trackAnchor` (called at participant.ts:1172, immediately after) resolves - so a live-broadcasting service has a real, if brief, render window where the completion summary falsely claims 'This no-broadcast service does not publish to Bitcoin'. Neither defect was in gap-closure plan 03-07's scope (its must_haves cited only CompletionSummary.tsx and participant.ts's CompletionSummary-facing selectors), and neither is addressed by any later ROADMAP phase (Phase 4/5/6 cover operator monitoring, operator lifecycle control, and cross-stranger E2E/framing, none of which own the participant-facing StageTimeline or CompletionSummary rendering)."
    artifacts:
      - path: "packages/web/src/components/cohort/StageTimeline.tsx"
        issue: "Line 130 `liveAnchor = anchor?.enabled === true` and line 152's label branch relabel the final row 'Anchored' for ANY enabled anchor (broadcasting, failed, or truly anchored alike), contradicting both its own AnchorSubSteps beneath it and CompletionSummary's honest four-way narration rendered in the same view."
      - path: "packages/web/src/stores/participant.ts"
        issue: "anchorSummaryState(null) collapses 'not yet read' into 'hermetic' (line 689-691), and CompletionSummary can render with status:'complete' and anchor:null for the duration of the first fetchAnchor round trip, producing a transient false hermetic claim on a live service."
    missing:
      - "Drive StageTimeline's final-row label and tone from the SAME anchorSummaryState(anchor) selector CompletionSummary now uses (e.g. only render 'Anchored' when anchorSummaryState(anchor) === 'anchored'; otherwise keep 'Signed' or add a distinct broadcasting/failed label), so the header never contradicts the sub-steps or the completion summary shown alongside it."
      - "Give the null-anchor case its own neutral state (e.g. a 'checking' member of anchorSummaryState's return union) instead of defaulting to 'hermetic', with a neutral 'Confirming this service's broadcast mode' render, mirroring the pattern already used elsewhere in the codebase (SubmitPanel's enabled === undefined handling) per 03-REVIEW.md's WR-01 sketch."
human_verification_deferred_note: "3 items carried forward from the initial verification (D1/D2/D4 in 03-05-SUMMARY.md coverage, human_judgment:true) remain unresolvable by static analysis; see Human Verification Required below. They do not drive the gaps_found status (which is driven by the new StageTimeline/null-anchor finding) but must still be confirmed."
---

# Phase 3: Participant Submit, Co-Sign, Track, and Resolve Verification Report

**Phase Goal:** From the cohort they chose, a participant submits a DID update, takes part in the n-of-n MuSig2 co-signing round, tracks the anchor, and resolves the updated DID - wiring the existing signing/resolve flow into the discover->join path instead of the linear demo stepper.
**Verified:** 2026-07-17
**Status:** gaps_found
**Re-verification:** Yes - after gap closure (plan 03-07, commits 18ea0b4, 0b560bc, a063fb6)

**MVP-mode note (carried forward):** The phase carries `Mode: mvp` in ROADMAP.md, but the roadmap `**Goal:**` line is outcome-shaped, not literal User Story form. `gsd_run query user-story.validate` confirms the raw goal fails the format check; all plans independently derived the SAME valid user story, so goal-backward verification proceeded using that derived story. Documentation-process gap, not a phase-goal-achievement gap.

## What Changed Since the Last Verification

The previous verification (2026-07-17, initial) found 4/6 truths verified, blocked by two review-confirmed defects: CR-01 (a post-seat directory poll could false-fail a genuinely successful cohort) and WR-01 (the completion summary's Signed-line copy mis-narrated a live-broadcasting or failed-broadcast service as "this no-broadcast service does not publish to Bitcoin"). Gap-closure plan 03-07 executed and both are now independently confirmed CLOSED by direct source reading and passing tests (details below). During this re-verification, a fresh source-level audit of the same mode-honesty concern surfaced a DIFFERENT, previously-undetected defect in an adjacent component (`StageTimeline.tsx`) plus a narrower transient variant of the null-anchor case, both in the same "mode honesty" defect family WR-01 targeted, but outside gap-closure plan 03-07's stated scope. This is why the overall status remains `gaps_found` even though both originally-cited defects are closed.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 (SC1) | From a cohort they joined by choice, the participant submits a DID update and takes part in that cohort's n-of-n MuSig2 co-signing round | VERIFIED (regression-checked) | `onSubmitGate`/`createUpdateProvider` (`packages/participant/src/index.ts`), `SubmitPanel.tsx`, `pendingSubmit`/`submitUpdate()` in the store; unaffected by 03-07's changes; 364/364 unit tests pass |
| 2 (SC2) | The participant sees co-sign progress and anchor status for their joined cohort update in real time | VERIFIED with a caveat, mechanism intact | `StageTimeline.tsx` renders the full journey + live anchor sub-steps, 5s poll, freeze at confirmed/failed. Caveat: the anchor-status narration is not internally consistent across every rendered component (see gap below); the tracking MECHANISM itself (poll cadence, freeze, sub-step tone) is correct and unchanged by this re-verification |
| 3 (SC3) | Once the beacon is anchored, the participant resolves the updated DID and sees the new DID document | VERIFIED | Auto-resolve (`shouldAutoResolve`) now also fires on `enabled+failed` (WR-01 fix), so a failed live broadcast reaches a resolve outcome instead of freezing; `CompletionSummary.tsx` renders the resolved DID document, three-way `roundTripOutcome`, sidecar export; confirmed unchanged and regression-tested |
| 4 (SC4) | The participant reaches submit/co-sign only via a cohort discovered and joined from the directory; the standalone linear stepper is no longer the entry path | VERIFIED (regression-checked) | `packages/web/src/components/participant/` directory confirmed absent (`ls` errors "No such file or directory"); no `FlowStepper`/`KeyGenPanel`/`RegisterPanel`/`PublishPanel`/`ResolvePanel`/`ResultCard` component references outside comments/spec files; `e2e/browser-participant-cohort.ts:179-189` still asserts no KeyGen-first affordance on load |
| 5 (derived, CR-01) | Post-seat completion reporting is race-free: a genuinely successful cohort is never mis-reported as a terminal failure | VERIFIED, CLOSED | `postSeatGoneStreak` + `POST_SEAT_GONE_CONFIRMATIONS = 2` added next to `postSeatFailures` (`participant.ts:480-492`); `handlePostSeatSnapshot` only calls `fail()` once the streak reaches the threshold, returns without failing on the first gone read (`:1378-1403`); `clearPostSeatPoll` resets the streak (`:494-505`) so `cohort-complete -> teardownLive -> clearPostSeatPoll` wins the race. Behaviorally proven: `participant.spec.ts:468-491` (single gone read stays live, second consecutive gone read fails, a present read resets the streak) - all three tests independently re-run and PASSED (`npx vitest run packages/web/src/stores/participant.spec.ts`, 59/59 green) |
| 6 (derived, WR-01 original) | Mode-honest signed/anchored copy correctly narrates every live anchor state in the CompletionSummary Signed-line (not only confirmed/broadcast vs hermetic) | VERIFIED, CLOSED | `anchorSummaryState(anchor)` exported pure selector (`participant.ts:686-699`) returns 'anchored' / 'broadcasting' / 'broadcast-failed' / 'hermetic'; `CompletionSummary.tsx:94-110` branches the Signed-line paragraph on all four states with distinct, honest, em-dash-free copy; the "no-broadcast service" copy now appears ONLY in the hermetic branch. Behaviorally proven: `participant.spec.ts:542-568` (6 cases covering every state) PASSED |
| 7 (derived, NEW - discovered this re-verification) | Anchor-status narration is internally consistent across every component rendered in the same view: StageTimeline's final-stage label must not claim "Anchored" while the cohort is merely broadcasting or has a failed broadcast; the completion view must not show hermetic copy for a live service whose first anchor read has not yet landed | FAILED | `StageTimeline.tsx:130,152`: `liveAnchor = anchor?.enabled === true` alone drives the "Anchored" relabel, ignoring `anchor.state` - confirmed by direct reading, contradicts the `AnchorSubSteps` (`:70-109`, correctly bad-tone/pending on failed/broadcasting) rendered directly beneath it and `CompletionSummary`'s honest four-way copy shown alongside it. Also: `anchorSummaryState(null)` returns 'hermetic' (`participant.ts:689-691`) and `status:'complete'` is set (`:1153`) before the first `fetchAnchor` resolves (`trackAnchor` called at `:1172`), so a live service has a real, brief render window with a false hermetic claim |

**Score:** 6/7 truths verified (0 present-but-behavior-unverified; 1 failed - a newly discovered, narrower mode-honesty gap in a component adjacent to the one 03-07 fixed)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/web/src/stores/participant.ts` (`postSeatGoneStreak`, `POST_SEAT_GONE_CONFIRMATIONS`, `handlePostSeatSnapshot`, `clearPostSeatPoll`) | Race-free post-seat completion guard | VERIFIED | Confirmed present, commented with CR-01/D-24/D-25 citations, unit-tested |
| `packages/web/src/stores/participant.ts` (`anchorSummaryState`, `shouldAutoResolve`) | Mode-honest four-way anchor narration selector + failed-broadcast auto-resolve | VERIFIED | Confirmed present, exported, unit-tested (6 + 1 new cases) |
| `packages/web/src/components/cohort/CompletionSummary.tsx` | Four-way honest Signed-line branch | VERIFIED | Confirmed: imports `anchorSummaryState`, computes `anchorNarration`, four distinct paragraph branches (`:94-110`); heading/k-of-n/non-inclusion/round-trip blocks unchanged as specified |
| `packages/web/src/components/cohort/StageTimeline.tsx` | Anchor-status label consistent with the honest four-way narration | GAP | Still computes its "Anchored" relabel from `anchor?.enabled` alone (unchanged since before 03-07), not from `anchorSummaryState`; not touched by gap-closure plan 03-07 |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `cohort-complete` SSE | `teardownLive` -> `clearPostSeatPoll` | resets `postSeatGoneStreak`, bumps `postSeatEpoch` | WIRED | Confirmed: `teardownLive` (`:514-535`) calls `clearPostSeatPoll()`, called from the `cohort-complete` handler before `trackAnchor` |
| `anchorSummaryState(anchor)` (store) | `CompletionSummary` Signed-line four-way branch | direct import + call | WIRED | Confirmed: `CompletionSummary.tsx:3,76,94-110` |
| `shouldAutoResolve(anchor)` firing on enabled+failed | `trackAnchor` auto-resolve -> `resolve()` -> round-trip outcome | evaluated before the freeze check in the same tick | WIRED | Confirmed: `participant.ts:1337-1350` - `shouldAutoResolve` check precedes the freeze `clearAnchorPoll()` call, so resolve fires exactly once on a failed read |
| anchor read (store) | `StageTimeline` final-row label | `anchor?.enabled` only (NOT `anchorSummaryState`) | WIRED but mode-dishonest | `StageTimeline.tsx:130,152` derives its own `liveAnchor` boolean instead of consuming `anchorSummaryState`, so it can label a broadcasting/failed anchor "Anchored" while `CompletionSummary` (same anchor read, same page) says otherwise |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| CR-01 streak guard: single gone read stays live, second gone read fails, present read resets streak | `npx vitest run packages/web/src/stores/participant.spec.ts` (describe "handlePostSeatSnapshot (post-seat cohort-gone)", 6 tests) | All 6 passed | PASS |
| WR-01 (store): `shouldAutoResolve` true on enabled+failed; `anchorSummaryState` four-way mapping correct | Same file, describes "shouldAutoResolve (D-28 gating)" (5 tests) + "anchorSummaryState (mode-honest, WR-01)" (6 tests) | All 11 passed | PASS |
| Full hermetic gate | `pnpm test` (root `tsc -b && vitest run`) | 364 passed, 27 files, 0 failed | PASS |
| Web production build | `pnpm --filter @btcr2-aggregation/web build` (tsc --noEmit + vite build) | Clean, 693 modules, no type errors | PASS |
| Em-dash scan on the 3 modified files | `grep -cP '\x{2014}' <file>` x3 | 0, 0, 0 | PASS |
| Debt-marker scan on the 3 modified files | `grep -n -E "TBD\|FIXME\|XXX\|TODO\|HACK\|PLACEHOLDER"` x3 | No matches | PASS |
| StageTimeline "Anchored" label gating (new finding) | Direct source read: `StageTimeline.tsx:130,152` | `liveAnchor = anchor?.enabled === true`, used alone for the label | FAIL (confirms gap) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| PART-03 | 03-01, 03-04, 03-05, 03-07 | Participant can submit a DID update and take part in the n-of-n MuSig2 co-signing round | SATISFIED | Mechanism built, proven by the browser capstone + unit tests; CR-01 reliability defect closed by 03-07 |
| PART-04 | 03-02, 03-03, 03-04, 03-06, 03-07 | Participant can track co-sign/anchor progress and resolve once anchored | SATISFIED with a flagged residual honesty gap | Tracking + resolve mechanism proven; the CompletionSummary-level WR-01 defect is closed, but the StageTimeline-level anchor-status honesty gap (new Truth 7) remains open under the same requirement's "track...anchor status" clause |

REQUIREMENTS.md marks both PART-03 and PART-04 `[x] Complete` (lines 23-24) and maps both to "Phase 3 | Complete" in its Requirement Coverage table (lines 72-73). No orphaned requirements: only PART-03/PART-04 map to Phase 3, and both are claimed across the plans' `requirements:` frontmatter, including the gap-closure plan 03-07.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| - | - | No `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` markers found in the 3 files modified by 03-07 | info | Clean |
| - | - | No em-dash characters found in the 3 files modified by 03-07 | info | Clean, house style honored |
| `packages/web/src/components/cohort/StageTimeline.tsx` | 130, 152 | "Anchored" row label driven by `anchor?.enabled` alone, ignoring `anchor.state` | warning (elevated to gap, Truth 7) | Contradicts `AnchorSubSteps` in the same component and `CompletionSummary`'s honest narration in the same view, for the full broadcasting/failed duration |
| `packages/web/src/stores/participant.ts` | 689-691 | `anchorSummaryState(null)` collapses "not yet read" into "hermetic" | warning (elevated to gap, Truth 7) | Transient false hermetic claim on a live service during the first `fetchAnchor` round trip after `status:'complete'` |
| `packages/web/src/components/cohort/SubmitPanel.tsx` | 137 | Carried forward from initial verification (IN-02/WR-04 in 03-REVIEW.md): `beaconAddress ?? 'this cohort&apos;s beacon'` renders a literal `&apos;` if the fallback is ever reached | info | Currently unreachable (submit window only opens after `beaconAddress` is set); still open, out of this re-verification's blocking scope |
| `packages/service/src/operator-cohorts.ts` | ~272-274 | Carried forward: no upper bound on operator draft cohort `size` (WR-03 in 03-REVIEW.md) | info (out of Phase 3 participant-facing scope) | Operator-authenticated Phase-1 concern |

### Human Verification Required

Carried forward from the initial verification (still not resolvable by grep/static analysis; 03-07 did not touch the components these checks cover except CompletionSummary's Signed-line text, which is now unit-tested at the selector level but not visually confirmed in a real browser):

1. **Stage timeline + identity section + Signed copy visual check (updated scope)**
   **Test:** Join a cohort as a real browser user on both a hermetic and a live-configured (broadcast-enabled) service; observe the stage timeline through Waiting -> Seated -> Submit -> Co-signing -> Signed/Anchored, including a broadcasting-but-unconfirmed window and, if reproducible, a failed-broadcast case.
   **Expected:** Active stage pulses accent, completed stages read good-tone, future stages are dimmed; the Signed-line copy on the completion card matches the actual anchor state (broadcasting / failed / anchored / hermetic) at every moment, and the StageTimeline header does not read "Anchored" while the completion card says "Broadcasting" or "failed" (this is Truth 7 above; a human should confirm the fix once StageTimeline is updated to consume `anchorSummaryState`, and confirm today's contradiction is visible before that fix).
   **Why human:** Visual tone/contrast/pulsing and "these two panels tell the same story" judgments are not resolvable by grep or static analysis.

2. **Submit-window consent + urgency check**
   **Test:** Reach the submit window; observe the heading escalation, the tab title change, the one consent line (hermetic vs live), and click Submit.
   **Expected:** Heading reads "Your update is needed"; tab title becomes "(!) Submit your update" and restores on submit/leave; exactly one consent line and one CTA; no second approval gate.
   **Why human:** Tab-title/interaction-timing behavior and "reads as exactly one consent, not two" are interaction/visual judgments.

3. **Seated-row affordance + one-cohort-at-a-time + persistent-link navigation check**
   **Test:** While seated in a cohort, view the directory; observe the seated row's "You're in this cohort" + View cohort affordance, that Join is disabled on every other row, and that the persistent "Your cohort · {stage}" link correctly returns to the cohort page.
   **Expected:** Exactly one row shows the seated affordance; all other rows show a disabled Join; the persistent link/chip stays live and accurate.
   **Why human:** Live-poll-driven UI state flips and navigation correctness are interaction behaviors.

### Gaps Summary

The two defects (CR-01, WR-01's CompletionSummary collapse) that blocked the initial verification are genuinely and durably fixed by gap-closure plan 03-07: the post-seat completion guard is race-free (unit-tested with the exact race-timing semantics the plan specified), and the CompletionSummary Signed-line now narrates every anchor state honestly, with a failed broadcast correctly reaching a resolve outcome instead of freezing. Both are confirmed by direct reading of the current source (not by re-reading the plan's or SUMMARY's claims) and by independently re-running the relevant tests (59/59 store tests, 364/364 full suite, clean web build).

However, a deep re-review conducted the same day as the gap closure, and independently confirmed in this verification by direct source reading rather than by trusting the review document, found that the mode-honesty defect CLASS WR-01 targeted was not fully eradicated: it persists in `StageTimeline.tsx`, a sibling component rendered on the exact same page, whose final-stage header still claims "Anchored" for a merely-broadcasting or failed-broadcast live service, directly contradicting both its own sub-steps and the now-honest `CompletionSummary` card next to it. A narrower, more transient variant also remains in the null-anchor render window before the first anchor read lands. Neither defect is in gap-closure plan 03-07's stated scope (which correctly targeted only `CompletionSummary.tsx` and the CR-01 store logic), and neither is addressed by any later ROADMAP phase.

Given this directly bears on Success Criterion 2 ("The participant sees...anchor status...in real time") and the whole phase is explicitly built around D-07 mode honesty as an architectural principle (cited throughout the store's own comments), this is scored as a real, actionable gap rather than accepted as out of scope. It is materially smaller than the original two findings: both fixes are small, targeted, and already sketched with code in the fresh 03-REVIEW.md (drive StageTimeline's label from `anchorSummaryState` instead of `anchor?.enabled`; give the null-anchor case its own neutral narration state). Recommend routing this phase to `/gsd-plan-phase --gaps` for a small, targeted closure plan analogous to 03-07, rather than accepting an override; this is an unresolved correctness/honesty defect in the core success path shown on the participant's own page, not an intentional alternative design.

---

_Verified: 2026-07-17_
_Verifier: Claude (gsd-verifier)_
