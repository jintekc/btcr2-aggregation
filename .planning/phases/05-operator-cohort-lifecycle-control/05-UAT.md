---
status: testing
phase: 05-operator-cohort-lifecycle-control
source: [05-01-SUMMARY.md, 05-02-SUMMARY.md, 05-03-SUMMARY.md, 05-04-SUMMARY.md, 05-05-SUMMARY.md, 05-06-SUMMARY.md, 05-07-SUMMARY.md, 05-08-SUMMARY.md, 05-09-SUMMARY.md, 05-10-SUMMARY.md, 05-11-SUMMARY.md, 05-12-SUMMARY.md, 05-13-SUMMARY.md, 05-14-SUMMARY.md, 05-15-SUMMARY.md, 05-16-SUMMARY.md, 05-17-SUMMARY.md, 05-18-SUMMARY.md, 05-19-SUMMARY.md, 05-20-SUMMARY.md, 05-UAT-CHECKLIST.md]
started: 2026-07-30T00:00:00Z
updated: 2026-07-30T00:00:00Z
---

## Current Test

number: 1
name: Cold Start Smoke Test
expected: |
  Kill any running coordinator. Clear ephemeral state. Start the service from scratch on the hermetic default (no LIVE, no BROADCAST) and load the web app. The process boots with no errors, GET /v1/config answers with the resolved network, the operator can sign in at /operator, and the public directory renders. Any boot-time clamp warning (05-18) names both numbers rather than failing silently.
awaiting: user response

## Tests

This list was regenerated from all 20 plan summaries in the phase, including the six gap-closure
plans (05-15 through 05-20) that shipped after the original UAT was written. Tests 1 through 14 run
on the hermetic default boot and come first. Tests 15 through 18 need a real chain, a real wallet,
or a LIVE plus BROADCAST boot, and are deferred to the end because they cannot be done hermetically.

Step-by-step detail for most items lives in `05-UAT-CHECKLIST.md`, which 05-16 and 05-20 both amended.

### 1. Cold Start Smoke Test
expected: Kill any running coordinator. Clear ephemeral state. Start the service from scratch on the hermetic default (no LIVE, no BROADCAST) and load the web app. The process boots with no errors, GET /v1/config answers with the resolved network, the operator can sign in at /operator, and the public directory renders. Any boot-time clamp warning (05-18) names both numbers rather than failing silently.
result: [pending]

### 2. Draft creation, in-place edit, and per-cohort timing windows
expected: Create a draft, then edit it in place. The edit form opens pre-filled from the draft's own captured defaults (not the service's current ones), the same validation messages appear on both the create and edit paths, and `Cancel edit` closes the form without destroying anything. Set a discovery window longer than the service can honor and confirm the save is refused with this service's real maximum named in minutes, rather than accepted. Leave a timing field empty and confirm it round-trips as empty (meaning "use the default"), not as a zero.
result: [pending]

### 3. Automatic close is narrated as a stage, with no Close button
expected: On the drill-down timeline, the Closed stage appears with its caption ("Every seat filled, so this cohort locked and stopped accepting joins.") when the nth seat fills, and no Close button exists anywhere on the console. This is the one deliberate divergence from the literal wording of roadmap SC 1. CONTEXT D-01 locks close as an automatic nth-seat lock because no AggregationServiceRunner primitive exists and a partially filled n-of-n cohort that stopped accepting joins could never proceed. Owner acknowledgement of that re-reading is a judgment call, not a code check.
result: [pending]

### 4. Lifecycle ceremony ladder renders as specified
expected: Walk 05-UAT-CHECKLIST.md "SVC-04 criterion 1" and "criterion 4". Rung 2 (finalize) states the real k-of-n consequence before it happens, including that unsigned signers are excluded and that fewer than k signatures cannot anchor. Rung 3 (cancel) names the short id and the seated count. Rung 4 (funded beacon) requires type-to-confirm and discloses the recovery-key situation before the confirm arms. While an action is in flight both buttons disable and the in-flight label holds. A failed action renders the action-error line and leaves every cohort fact untouched, with no optimistic chip. Cancel is HIDDEN rather than disabled after broadcast, and the post-broadcast line explains itself. A 401 routes through the single shared session-expiry path.
result: [pending]

### 5. Worst-case lifecycle block and the chain endpoint disclosure
expected: With cancel availability, finalize availability, and the seat-reclaim note rendered at once above the funding disclosures, the block stays readable without overflow. Separately, walk the Chain endpoint disclosure through every documented E16 state and confirm each renders.
result: [pending]

### 6. Service controls card and the public paused notice
expected: Pause advertising, then load the public directory both with open rows and with none. The restart-honesty line and the full-quiesce guidance are present. With open rows the paused notice sits ABOVE a still-rendering list. With no rows the empty-state body reads distinctly from the idle body. The controls row wraps at narrow widths, the paused chip sits beside the mode chip, and pause takes no confirmation.
result: [pending]

### 7. Settings surface composition, source captions, and the long-name backstop
expected: Change beacon type, size, threshold and both windows. Each field shows its source caption ("env default" or "changed this session (environment default: X)"), and a field set BACK to its boot value reports "env default" again. Save with one invalid field and confirm NO field applies and every rendered field still shows what the service holds. Save a very long SERVICE_NAME and confirm it renders on both the console health strip and the public directory header as plain escaped text without pushing chips off-screen. The acceptance-retention note added by 05-17 is visible in the operator help.
result: [pending]

### 8. Participation terms join step, long body and narrow viewport
expected: Set TERMS_TEXT to a long document containing unbroken tokens and URLs, then join at a narrow viewport height. The body scrolls inside its capped container, wraps unbroken tokens, never escapes the card, and never renders as markup or a link target. The join controls stay reachable below it and the app-level enforcement caption is visible.
result: [pending]

### 9. Test peers rehearsal
expected: Use the drill-down test-peer control on a hermetic cohort. Its help line, its zero-seat disabled reason, and the rung-2 confirm all read correctly, and the confirm states BEFORE the act that the peers co-sign for real with throwaway keys. On a live cohort, the peers' post-cohort registration is honestly skipped with a console note rather than silently omitted.
result: [pending]

### 10. Cancel reaches the participant as a cancel, not a stall
expected: Cancel a cohort a participant is seated in. The participant's terminal card names the cancel and never narrates it as a stall or a timeout. Both narration variants and the next-step line read correctly.
result: [pending]

### 11. Dismissal actually dismisses, and discloses its cost
expected: Dismiss an ended cohort record from the console. The row disappears and stays gone, including after a refresh, and a canceled cohort still reads as canceled to anyone querying its fate afterwards rather than reverting to unknown. On an expired row, the confirmation body carries the line disclosing that dismissing also drops the re-advertise affordance. This is new behavior from gap plan 05-19; the confirmation previously promised more than it did.
result: [pending]

### 12. The Anchored chip is reserved for confirmed anchors
expected: On the hermetic default, complete a cohort's co-sign round. The completion reads as "Signed" in the Ended group and the anchored counter stays at zero, because nothing was confirmed on chain. A k-of-n script-path cohort keeps its own distinct label and its Needs-attention bucketing. This is a deliberate user-visible change from gap plan 05-20: a finished MuSig2 round is no longer allowed to mint a claim about Bitcoin. Confirm the new wording reads as honest rather than as a regression.
result: [pending]

### 13. The three console surfaces read well at a real viewport
expected: At a real browser viewport, the operator console list, the drill-down, and the health strip all read well together: nothing overflows, chips stay on screen, and the grouping is legible without horizontal scrolling.
result: [pending]

### 14. The runbook describes what actually ships
expected: Follow docs/DEPLOY.md from a clean machine using only the document. The quick start sets OPERATOR_PASSWORD first and walks log in at /operator, create, advertise, join, rehearse. The retired filler knob appears nowhere. MIN_PARTICIPANTS, AUTO_FALLBACK and SSE_DEBUG match what the service actually reads, and the /v1/config sample matches what the service actually serves. An operator can run every new control from this document alone, and its stated limits are true. Rewritten by gap plan 05-18.
result: [pending]

### 15. PART-05 live leg against real third-party esplora hosts
expected: Try a wrong-chain endpoint, a host that blocks browser requests (no CORS), an unreachable host, and a non-https string. Four distinguishable messages appear (mismatch naming BOTH chains, browser-rejected, unreachable, malformed), no silent fallback occurs in either direction, and the explicit switch-back control is offered on failure. Real CORS and real wrong-chain hosts cannot be exercised hermetically.
result: [pending]

### 16. PART-06 real wallet PSBT round trip, including the sighash refusal
expected: Export the unsigned PSBT, sign it in an actual desktop or hardware wallet, return it, and broadcast. The wallet accepts the exported .psbt, the returned PSBT validates against the template, and the broadcast produces the same txid the local path would. A large pasted PSBT keeps its field scrolling internally without reflowing the step. If a wallet signs with any sighash other than DEFAULT or ALL, the return is REFUSED with its own message telling the participant their wallet locked the wrong thing, rather than being reported as unparseable (gap plan 05-15). No wallet interoperability was verified in this environment, and 05-14 correctly forbids claiming any specific wallet works.
result: [pending]

### 17. LIVE plus BROADCAST boot, the kill switch, and the funding stand-down
expected: Boot with LIVE=1 BROADCAST=1 and engage Disable broadcast. The control is offered only in that boot mode, no route turns broadcast back on, and afterwards the health strip STILL reports the live boot mode with a separate warn chip beside it. Then advertise a NEW cohort: it shows no Funding card at all and never asks for sats on a beacon this service will not spend, while a cohort advertised before the switch keeps its funding surface (gap plan 05-16). Confirm the disclosed cost is acceptable: once only post-switch cohorts remain, the health strip's esplora-reachability badge stops refreshing, which is recorded in ADR 0017 rather than simulated.
result: [pending]

### 18. Cancel settle-race backstop
expected: Attempt to cancel a cohort at the instant its signing round completes. Expect a 404 with nothing changed, and never two ended records for one cohort id. 05-01 classified this "verification: backstop" because the timing race cannot be reliably driven from a test harness.
result: [pending]

## Automated Coverage

45 deliverables across this phase are deterministically covered by passing tests and are NOT
presented as checkpoints above. Recorded in aggregate rather than as individual pre-passed entries,
because listing ~100 resolved rows would bury the 18 items that actually need a human.

| Plan | Auto-covered | Needing a human |
|------|--------------|-----------------|
| 05-01 | 8 | 1 |
| 05-02 | 5 | 2 |
| 05-03 | 9 | 3 |
| 05-04 | 11 | 0 |
| 05-05 | 8 | 1 |
| 05-15 | 4 | 0 |

Plans 05-08 through 05-14 also carry coverage blocks whose entries all reference passing tests, but
they use a drifted schema (`deliverable:` plus `kind: test`) where the classifier expects `id:`,
`description:` and `kind: unit|integration|e2e|automated_ui|manual_procedural|other`. Their
`human_judgment: true` entries were read directly and folded into the tests above. The schema drift
is a real artifact defect worth fixing so the deterministic path works for these plans, but it is
not a coverage gap: every entry has a passing test ref.

Plans 05-06, 05-07, 05-16, 05-17, 05-18, 05-19 and 05-20 have no coverage block at all, so their
testable deliverables were extracted from prose.

## Summary

total: 18
passed: 0
issues: 0
pending: 18
skipped: 0
blocked: 0

## Gaps

<!-- Populated by /gsd-verify-work when a test reports an issue. -->
<!-- NOTE: the eight defects confirmed by the adversarial audit were recorded in 05-AUDIT.md and -->
<!-- have since been closed by gap plans 05-15 through 05-20. They are not listed here, because -->
<!-- this file tracks the human UAT pass, not the audit. -->
