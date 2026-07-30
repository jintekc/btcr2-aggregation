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
result: pass

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

## Retired: covered by automation

The ledger the second gap-closure round (05-21 through 05-27) writes into, opened by 05-21.

**The rule.** A plan appends one row per CLAUSE of a UAT test it now covers deterministically, and
moves a test out of `## Tests` into this section only when EVERY clause of that test has a row. A
test whose clauses are only partly covered stays in `## Tests`; 05-27 reconciles the whole ledger in
one final pass and rewrites the `## Summary` counts from it. No plan in this round edits those counts
directly.

| UAT test | Clause now covered | Citation | Landed by |
|----------|--------------------|----------|-----------|
| 4 | Rung 4 (funded beacon) requires a typed cohort id before the confirm arms, and discloses the recovery-key situation | `packages/web/tests/lifecycle.spec.ts`, "CancelConfirm chooses the rung and wires its gate (D-03, rendered)" | 05-21 |
| 4 | Rung 3 (ordinary cancel) asks for no typed id and keeps its confirm armed | `packages/web/tests/lifecycle.spec.ts`, same block, "keeps the ordinary cancel at low friction" | 05-21 |
| 4 | Cancel is HIDDEN rather than disabled after broadcast, and the post-broadcast line explains itself | `packages/web/tests/lifecycle.spec.ts`, "LifecycleActions hides Cancel once the beacon transaction is out (D-04, rendered)" | 05-21 |
| 8 | A service that set no terms shows no terms step at all: no scroll box, no acceptance checkbox | `packages/web/tests/terms-render.spec.tsx`, "a service that set NO terms renders NO terms step at all" | 05-21 |
| 6 | The `Advertising paused` chip appears BESIDE the mode chip, leaving the mode label unchanged | `packages/web/tests/service-controls.spec.ts`, "keeps the mode label unchanged and adds the paused chip beside it while draining" | 05-22 |
| 9 | A cohort with no seats left renders the test-peer control disabled beside the real refusal reason, and that reason is the service's own 409 sentence | `packages/web/tests/service-controls.spec.ts`, "renders the control DISABLED beside the refusal reason when no seats are left" plus "states the seat-exhausted refusal reason, which the service must repeat byte for byte" | 05-22 |
| 11 | The dismissal confirmation body discloses what a dismissal costs: the record AND its activity log, from this console, for this session, with no undo | `packages/web/tests/service-controls.spec.ts`, "states the rung-1 dismissal copy, including that there is no undo" (exact equality on all three sentences) | 05-22 |
| 17 | The kill-switch control is offered ONLY on a live boot mode with broadcasting still available, and is replaced rather than disabled once engaged | `packages/web/tests/service-controls.spec.ts`, "ServiceControls offers the kill switch only where it can act (rendered)" | 05-22 |
| 17 | After the switch engages, the health strip still reports the LIVE boot mode, with a separate warn chip beside it rather than a rewritten mode chip | `packages/web/tests/service-controls.spec.ts`, "keeps the LIVE label and adds the broadcast-off chip once the kill switch engages" | 05-22 |
| 2 | The edit form opens pre-filled from the DRAFT's own captured values, including both timing windows, rather than from the service's current defaults | `packages/web/tests/cohort-form-render.spec.tsx`, "shows a saved discovery and funding window as MINUTES, not as empty fields" plus "seeds the beacon type, the size and the threshold from the draft too" | 05-23 |
| 2 | A timing field the operator never set round-trips as EMPTY, meaning "use the default", rather than as a zero or a pre-filled service default | `packages/web/tests/cohort-form-render.spec.tsx`, "leaves a window the operator never set EMPTY", with `packages/web/tests/cohort-form.spec.ts` "reads an EMPTY field as unset, never as a zero window" on the wire half | 05-23 |
| 2 | The same validation messages appear on the create and the edit path, and they are the service's own sentences byte for byte | `packages/web/tests/cohort-form.spec.ts`, "the shape-error copy, pinned independently of the constants that carry it" (both forms delegate to the one shared module, so one pin covers both paths) | 05-23 |
| 6 | A paused service disables its advertise controls, on BOTH the draft and the expired call site, with the reason rendered beside each | `packages/web/tests/operator-rows-render.spec.tsx`, "a paused service disables BOTH advertise controls and says why", plus "pause is DRAIN MODE, not a kill switch" for the narrowness | 05-23 |
| 12 | A completed co-sign round reads as `Signed` rather than as anything naming an anchor, and the k-of-n script-path cohort keeps its own distinct label | `packages/web/tests/operator-rows.spec.ts`, "every chip label is pinned word for word" (exact per-chip labels plus the anchor-wording guard on the unconfirmed pair and the in-flight chip) | 05-23 |
| 4 | A mid-session 401 routes through the single shared session-expiry path, on BOTH lifecycle verbs, dropping to login and resetting the console view | `packages/web/tests/operator.spec.ts`, "routes a mid-session 401 on CANCEL through the one shared session-expiry path" plus the FINALIZE twin (each asserts auth, reason, view and the verb's own busy flag) | 05-24 |
| 4 | A failed action renders the action-error line and leaves every cohort fact untouched, with no optimistic chip | `packages/web/tests/operator.spec.ts`, "narrates the opaque cancel 404 as nothing more than a failed action", with "preserves the server's own reason on a refused (409) finalize" pinning the deliberate asymmetry between the two refusals | 05-24 |
| 5 | The chain endpoint disclosure's documented E16 verdicts are each produced by the shipped check: `ok`, `mismatch` naming both chains, `browser-rejected`, `unreachable` and `malformed` | `packages/web/tests/tx-client.spec.ts`, the `checkEndpoint` and `setting and clearing an endpoint` blocks (every verdict driven through the store, plus the two marker rows and per-row request counts). HERMETIC LIMIT: these produce each verdict against a stubbed endpoint. A real CORS refusal and a real wrong-chain third-party host are NOT covered and stay with test 15 | 05-24 |
| 10 | The participant's terminal card names the cancel and never narrates it as a stall or a timeout | `packages/web/tests/terminal-reason.spec.ts`, "narrates a cancel as a cancel on the EXACT input that produces stall copy today" plus "never narrates a cancel as a stall, a failure, or an expiry" | 05-24 |
| 10 | Both narration variants read correctly, and the specific one is reachable ONLY from a real answer: the operator attribution on a service-reported cancel, the honest fallback on anything else | `packages/web/tests/participant-fate.spec.ts`, "names the operator on a 200 whose body carries the boolean true" against the four refusal rows in "a fault cannot fabricate a cancel accusation", each asserting the rendered sentence and not only the flag | 05-24 |
| 15 | A wrong-chain endpoint is refused with a mismatch naming BOTH chains | `packages/web/tests/tx-client.spec.ts`, "judges the endpoint against THIS participant's chain, not a chain the code picked" (the store's own network on one side, the endpoint's on the other) | 05-24 |
| 2 | A timing field the operator CLEARS on an edit round-trips as EMPTY, meaning "use this service's default", rather than silently keeping the value that was there | `packages/service/tests/draft-edit.spec.ts`, "a per-cohort timing window can be CLEARED and SET on the edit path (audit #29)": both windows, each driven both ways, each read back from the update verb AND from the served gated list, with the service's own default still carried beside the cleared key | 05-25 |
| 11 | A canceled cohort still reads as canceled to anyone querying its fate after the operator dismisses the row | `packages/service/tests/cohort-fate.spec.ts`, "still carries a CANCELED fate through a dismissal, so the condition really discriminates", beside the shipped 05-19 row "still answers the canceled fact after a 200 dismissal" | 05-25 |
| 11 | An EXPIRED cohort does NOT start reading as canceled once its row is dismissed, so a lapse is never presented as a deliberate cancel | `packages/service/tests/cohort-fate.spec.ts`, "does NOT carry an EXPIRED fate, so a lapse never becomes a reported cancel (audit #19)", with "answers FALSE for an expired record that was NOT dismissed" isolating the dismissal and "answers a dismissed EXPIRED id byte-identically to one this service never issued" keeping the route non-oracle | 05-25 |
| 1 | A boot-time clamp warning names BOTH numbers rather than failing silently | `packages/service/tests/runtime-settings.spec.ts`, "warns LOUDLY on the clamped boot, naming both numbers on the real console", captured off `console.warn` on a real `createService` boot. Test 1 already passed by eye, so this row retires nothing; it records that the clause is now a script rather than an observation somebody made once, so 05-27 can narrow test 1 honestly | 05-26 |
| 2 | A discovery window longer than this service can honor is refused at SAVE with the real maximum named in minutes | `packages/service/tests/runtime-settings.spec.ts`, "refuses a settings save above the TTL, naming the real maximum the console renders" plus "accepts a save at EXACTLY the TTL", both on a real boot that supplies the ceiling from its own cohort TTL. The PER-DRAFT half of the same rule was already covered by `packages/service/tests/discovery-window.spec.ts`, "refuses a window ABOVE the ceiling, naming the service maximum in minutes"; 05-26 adds the settings-default half and, crucially, proves a real boot supplies the ceiling at all | 05-26 |
| 6 | A paused advertise carries the operator-facing refusal reason, and never raw library phrasing | `packages/service/tests/pause.spec.ts`, "matches the operator-facing sentence byte for byte", "is a lowercase clause that reads inside the console action-error sentence" and "carries no raw library phrasing" (the guard shown firing against an inline raw-library fixture). The two shipped rows that assert the 409 body carries this reason were already there; what was missing was any assertion about what the reason SAYS | 05-26 |
| 7 | A save with one invalid field applies NOTHING, and every rendered field still shows what the service holds | Already covered on both sides before this plan and recorded here for the ledger: `packages/service/tests/runtime-settings.spec.ts`, "applies NOTHING when any field in the patch is invalid" (the service half), and `packages/web/tests/settings.spec.ts`, the block "a rejected save leaves the rendered snapshot exactly as the service holds it", specifically "renders the service message and changes NO field on a 400" (the rendered half). Checked before claiming, per 05-26's action | pre-existing, recorded 05-26 |
| 9 | On a LIVE cohort the peers' own post-cohort registration is honestly skipped with a console note rather than silently omitted | `packages/service/tests/test-peers.spec.ts`, "records the registration-skipped note on a LIVE service with a broadcaster" paired with "records NO such note on the hermetic boot, so a false live-only caveat is caught too". Both drive the shipped `createService` spawn path over real HTTP with real participants; both also assert the two unconditional entries, so the hermetic absence is not passing because nothing was logged | 05-26 |

No test above is fully covered yet, so all of them stay in `## Tests`. Test 8 still needs the
long-body-at-a-narrow-viewport clause, which is a genuine visual judgment and stays with a human.
Test 6 still needs the public paused notice and the narrow-width chip wrap. Test 9's live-cohort
registration disclosure was closed by 05-26; what it still needs is the interpolated test-peer
confirm copy (see the clause-by-clause note below). Test 17 still needs a real
`LIVE=1 BROADCAST=1` boot, which no unit gate can stand
up. Test 2's over-ceiling refusal naming this service's real maximum was closed by 05-26; what it
still needs is the `Cancel edit` closes-without-destroying clause, which is behind a click. Test 12 still
carries an owner JUDGMENT, "confirm the new wording reads as honest rather than as a regression",
which no assertion can make for them; 05-27 narrows it rather than removing it.

Test 4's remaining clauses are the ceremony ladder's rung-2 k-of-n consequence wording and the
in-flight disable-both-buttons behavior, which is behind a click.

**Test 11 was checked clause by clause for full retirement in 05-25 and is NOT retired.** Three of
its four clauses now have rows: the canceled-fate survival, the expired-fate non-invention, and (from
05-22) the confirmation body's disclosure of what a dismissal costs. The fourth, "the row disappears
and stays gone, including after a refresh", is covered on the SERVICE side only. `forgetTerminal`
plus `monitor.dismissEnded` are proven to clear both ended-record sources (`05-19`, re-read through
`listCohorts()` in `packages/service/tests/lifecycle-routes.spec.ts`, and again in 05-25's expired
row), so a refresh cannot bring the record back from the source of truth. What is NOT covered is the
CONSOLE side: `grep -rn dismissEnded packages/web/tests` finds nothing, so the store action at
`packages/web/src/stores/operator.ts:1144` is invoked by no test at all, and its deliberate design
choice (re-read from the service rather than filter the row out locally, which is exactly what makes
the row stay gone rather than merely look gone) is unexercised, as are its 401 and unreachable
branches. `packages/web/tests/operator.spec.ts` is not in 05-25's `files_modified` and no other plan
in this round claims it, so the pin was left to whoever owns it rather than guessed at. Its natural
shape is the same four-fact 401 row 05-24 wrote for cancel and finalize, plus one row asserting the
dismissal re-reads instead of splicing.

**A copy question raised by 05-25, for the batched copy read.** The service refuses an edit of a
draft that is no longer a draft with `{ error: 'unknown draft' }`, and the web client renders that
string VERBATIM (`packages/web/src/lib/operator.ts`), contrary to a docstring that claimed a 404 fell
back to the generic message. 05-25 corrected the docstring and pinned the server string where it is
emitted, deliberately without changing either. Whether "unknown draft" is the right sentence for an
operator staring at a stale edit form, given that the id may well be a cohort they just advertised,
is a copy decision. The uniformity itself is now protected: all three draft refusals are asserted
identical to each other, so any reword has to keep them so.

**Test 2 was checked clause by clause for full retirement in 05-26 and is NOT retired.** Four of its
five clauses now have rows: the edit form pre-filling from the DRAFT's own captured values (05-23),
the shared validation copy across both paths (05-23), the empty timing field round-tripping as empty
rather than as a zero (05-23 on the form side, 05-25 on the clear-and-save side), and the over-long
discovery window refused with the real maximum named in minutes (per-draft pre-existing, settings
default and the boot seed added by 05-26). The fifth, "`Cancel edit` closes the form without
destroying anything", is uncovered and is behind a click: nothing renders `DraftEditForm`, and no
store test invokes the cancel-edit action, so both the form-state reset and the draft's survival are
unexercised. It stays with a human until a render harness reaches that component.

**Test 9 was checked clause by clause for full retirement in 05-26 and is NOT retired.** Its
live-cohort clause is now closed above, and its zero-seat disabled reason was closed by 05-22. What
remains uncovered is the COPY of the test-peer confirm family in
`packages/web/src/stores/operator.ts`. 05-22 pinned the four STATIC constants
(`ADD_TEST_PEERS_LABEL`, `ADD_TEST_PEERS_BODY`, `ADD_TEST_PEERS_CANCEL_LABEL`,
`ADD_TEST_PEERS_BUSY`) and `NO_SEATS_LEFT_REASON`, with an em-dash guard over exactly those five.
The four INTERPOLATED ones are pinned by nothing: `addTestPeersHelp` (which is where "throwaway keys
created inside this process" actually lives, so test 9's help-line clause and half of its
"co-sign for real with throwaway keys" clause both ride on an unpinned string),
`addTestPeersHeading`, `addTestPeersConfirmLabel`, and `liveTestPeersLine` (the live disclosure the
operator reads at the moment of deciding, which is the console-side twin of the service-side note
05-26 just pinned). `packages/web/tests/service-controls.spec.ts` is not in 05-26's
`files_modified`, so the pins were left to whoever owns that file rather than guessed at. Their
natural shape is the same literal-plus-em-dash-guard treatment 05-22 gave the static five, evaluated
at a representative seat count and network name.

**Test 10 was checked clause by clause for full retirement in 05-24 and is NOT retired.** Two of its
three clauses now have rows above. The third, "the next-step line reads correctly", is uncovered:
`TERMINAL_NEXT_STEP_LINE` in `packages/web/src/components/cohort/CohortPage.tsx:18` is exported and
rendered at `:212`, and no test in the repo reads it, so its wording could change unnoticed. That
file is not in 05-24's `files_modified`, so the pin was not added here rather than guessed at.
Whoever closes it should pin the sentence and render the terminal card, which would also cover the
one thing no store row can: that the named cancel and the next-step line appear TOGETHER on the card
a participant actually sees.

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
