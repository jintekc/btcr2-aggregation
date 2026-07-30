---
status: testing
phase: 05-operator-cohort-lifecycle-control
source: [05-01-SUMMARY.md, 05-02-SUMMARY.md, 05-03-SUMMARY.md, 05-04-SUMMARY.md, 05-05-SUMMARY.md, 05-06-SUMMARY.md, 05-07-SUMMARY.md, 05-08-SUMMARY.md, 05-09-SUMMARY.md, 05-10-SUMMARY.md, 05-11-SUMMARY.md, 05-12-SUMMARY.md, 05-13-SUMMARY.md, 05-14-SUMMARY.md, 05-15-SUMMARY.md, 05-16-SUMMARY.md, 05-17-SUMMARY.md, 05-18-SUMMARY.md, 05-19-SUMMARY.md, 05-20-SUMMARY.md, 05-21-SUMMARY.md, 05-22-SUMMARY.md, 05-23-SUMMARY.md, 05-24-SUMMARY.md, 05-25-SUMMARY.md, 05-26-SUMMARY.md, 05-27-SUMMARY.md, 05-UAT-CHECKLIST.md]
started: 2026-07-30T00:00:00Z
updated: 2026-07-30T00:00:00Z
---

## Current Test

number: 2
name: Draft creation, in-place edit, and per-cohort timing windows
expected: |
  NARROWED. Edit a draft in place, then press `Cancel edit`. The form closes and the draft survives
  unchanged: its captured beacon type, size, threshold and both timing windows are still what they
  were before the edit was opened. Every other clause of the original test 2 is now automated and
  cited in the ledger below.
awaiting: user response

## Tests

**Provenance, and why this list is shorter than it was.** This list was reduced by the second
gap-closure round (plans 05-21 through 05-27), after the coverage triage recorded in
`05-AUDIT-2.md` found that **17 of the 18 human-only claims here were automatable**. A manual list
that still claimed 18 items after that round would be as inaccurate, in the other direction, as the
coverage claims the round was written to correct. Nothing was deleted: every clause removed from a
test is cited to a specific spec file and block in `## Retired: covered by automation` below, and
every one of those citations was resolved against the tree before this list was rewritten.

**The original numbering is preserved.** Tests keep the numbers they had, because the ledger, the
plan summaries and `05-UAT-CHECKLIST.md` all cite them by number. Two tests (1 and 18) are retired
outright and their numbers are not reused. Step-by-step detail for most items lives in
`05-UAT-PROCEDURES.md`, which 05-16, 05-20 and 05-27 each amended; a retired test's procedure is
left in place rather than deleted.

**A NARROWED test states its reduced scope.** Its removed clauses are in the ledger; what is
printed here is the part that still needs a person.

The remaining items are grouped by the KIND of human input each one needs, so it is visible at a
glance which are decisions, which are eyes, which are copy, and which are environment.

### Judgment: a decision only the owner can make

No assertion can make these calls. Each is the owner accepting, or refusing, a deliberate choice
the phase shipped.

#### 3. Automatic close is narrated as a stage, with no Close button (NARROWED)
scope: the owner's acknowledgement, plus one glance.
expected: This is the one deliberate divergence from the literal wording of roadmap SC 1. CONTEXT D-01 locks close as an automatic nth-seat lock because no `AggregationServiceRunner` primitive exists for it and a partially filled n-of-n cohort that stopped accepting joins could never proceed. Accept or refuse that re-reading. While on the console, confirm by eye that no Close button exists anywhere on it; nothing asserts that absence, though a one-line count-of-zero check in `e2e/browser-operator.ts` would (recorded in 05-27's summary as a named cheap follow-up). The stage's existence, its trigger and its exact caption are automated and cited below.
result: [pending]

#### 12. The Anchored chip is reserved for confirmed anchors (NARROWED)
scope: the wording, not the behavior.
expected: Read the new labels on the console and decide whether they read as HONEST rather than as a regression. This is a deliberate user-visible change from gap plan 05-20: a finished MuSig2 round is no longer allowed to mint a claim about Bitcoin, so a completed hermetic co-sign now reads `Signed` in the Ended group and the anchored counter stays at zero. Every label, the anchor-wording guard on the unconfirmed pair, and the k-of-n script-path cohort's distinct label are automated and cited below. What no assertion can decide is whether an operator reads the change as newly honest or as something taken away.
result: [pending]

**Also a judgment, but reachable only from test 17's live boot:** whether the disclosed cost of the
broadcast stand-down is acceptable (once only post-switch cohorts remain, the health strip's
esplora-reachability badge stops refreshing, recorded in ADR 0017 rather than simulated). It is
kept with test 17 rather than duplicated here, because it cannot be evaluated without that boot.

### Eyes: one batched visual pass at a real viewport

All four are layout and legibility at a real browser size, and they can be done in ONE sitting on
one running service. None of them is checkable by the render harness this round added, which is a
static server render: it evaluates initial markup, so it can prove a container carries the capping
and wrapping classes but never that anything actually fits on a screen.

#### 13. The three console surfaces read well at a real viewport
expected: At a real browser viewport, the operator console list, the drill-down, and the health strip all read well together: nothing overflows, chips stay on screen, and the grouping is legible without horizontal scrolling. Unchanged: this test was always the batched eye pass, and the three items below fold into it.
result: [pending]

#### 5. Worst-case lifecycle block at a real viewport (NARROWED)
scope: overflow only.
expected: With cancel availability, finalize availability, and the seat-reclaim note rendered at once above the funding disclosures, the block stays readable without overflow. The Chain endpoint disclosure's documented E16 states are automated and cited below, with their hermetic limit stated; the real-CORS and real-wrong-chain halves stay with test 15.
result: [pending]

#### 7. The long-name backstop at a real viewport (NARROWED)
scope: the long SERVICE_NAME only.
expected: Save a very long SERVICE_NAME and confirm it renders on BOTH the console health strip and the public directory header as plain escaped text, without pushing chips off screen. Nothing asserts either the escaping or the layout of that case. The source captions, a field reporting its boot value versus an override, the all-or-nothing save, and the acceptance-retention note in the operator help are all automated and cited below.
result: [pending]

#### 8. The long terms body at a narrow viewport (NARROWED)
scope: the rendered behavior of a long document.
expected: Set TERMS_TEXT to a long document containing unbroken tokens and URLs, then join at a NARROW viewport height. The body really scrolls inside its capped container, really wraps the unbroken tokens, never escapes the card, and the join controls stay reachable below it. The safety half (no dangerous HTML prop, never a link target, a plain React text child, the capping and wrapping classes, the app-level enforcement caption, and the no-terms empty state) is automated and cited below; what stays here is whether it behaves as intended in a real browser at a real size.
result: [pending]

### Copy: one batched read of sentences this round pinned but did not decide

The round's rule was to pin what ships rather than redesign it, so three copy questions were
recorded rather than resolved. Read them together, once.

#### 9. The interpolated test-peer confirm copy (NARROWED)
scope: four strings, unpinned and unread.
expected: Open the drill-down test-peer control and read its help line, its heading, its confirm label and, on a live cohort, its disclosure line. Confirm each reads correctly, in particular that the confirm states BEFORE the act that the peers co-sign for real with throwaway keys. These four are INTERPOLATED strings (`addTestPeersHelp`, `addTestPeersHeading`, `addTestPeersConfirmLabel`, `liveTestPeersLine` in `packages/web/src/stores/operator.ts`) and are pinned by nothing, so this is both a copy read and a live coverage gap; the recommended pin shape is recorded in the ledger. The four STATIC constants, the zero-seat disabled reason and the live-cohort registration disclosure are automated and cited below.
result: [pending]

**Two more copy questions, no procedure needed, just a decision:**

1. **`unknown draft`** (raised by 05-25). The service refuses an edit of a draft that is no longer
   a draft with `{ error: 'unknown draft' }`, and the web client renders that string VERBATIM.
   Whether that is the right sentence for an operator staring at a stale edit form, on an id that
   may well be a cohort they just advertised, is a copy decision. The uniformity is protected
   either way: all three draft refusals are asserted identical to each other, so any reword has to
   keep them so.
2. **The duplicated `Operator console` heading** (raised by 05-27). `OperatorConsole.tsx` and
   `LoginPanel.tsx` render the byte-identical string, so the heading is the same on both sides of
   the sign-in boundary. 05-27 pinned it and corrected the two `05-UAT-PROCEDURES.md` citations
   that named it as the observable proof of sign-in, deliberately WITHOUT changing either string.
   Whether the signed-in console deserves a heading of its own is the owner's call.

### Hands: clauses behind a click that no harness in this repo reaches yet

These are not judgment and not environment. Each is a concrete fact a machine could assert, and
none of them is asserted today, because the round's render harness is a static server render: no
events fire, no effects run, and no state transition occurs, so a panel or a form state that a
click produces is unreachable from it. They need a person until a DOM environment or a browser leg
reaches them, and each one below names what would close it.

#### 2. `Cancel edit` closes the form without destroying anything (NARROWED)
expected: Edit a draft in place, then press `Cancel edit`. The form closes and the draft survives unchanged, with its captured beacon type, size, threshold and both timing windows intact. Nothing renders `DraftEditForm` and no store test invokes the cancel-edit action, so both the form-state reset and the draft's survival are unexercised. The other four clauses of the original test 2 are cited below.
result: [pending]

#### 4. The rung-2 consequence wording, read in place, and the in-flight disable (NARROWED)
expected: Open the finalize confirm and read it: it must state the real k-of-n consequence BEFORE it happens, including that unsigned signers are excluded and that fewer than k signatures cannot anchor. Open the ordinary cancel confirm and confirm it names the short cohort id and the seated count (the rung-3 heading is pinned, the body's interpolated id and seat count are not). While an action is in flight, both buttons disable and the in-flight label holds. Everything else in the original test 4, including the two ceremony gates, the post-broadcast hiding, the shared 401 path and the failed-action behavior, is cited below.
result: [pending]

#### 6. The public paused notice as rendered, and the narrow-width wrap (NARROWED)
expected: Pause advertising, then load the PUBLIC directory both with open rows and with none. With open rows the notice sits above a still-rendering list; with no rows the empty-state body reads distinctly from the idle body. Then narrow the window and confirm the controls row wraps rather than overflowing. The notice's four-state selection from the served bit, its fail-closed behavior on unknown or unreachable status, the paused chip beside the mode chip, the restart-honesty and full-quiesce lines, the disabled advertise controls and the operator-facing refusal reason are all cited below. What is uncovered is the rendered BODIES of the two empty states, the notice's position on the page, the wrap, and that pause takes no confirmation.
result: [pending]

#### 10. The next-step line, on the card a participant actually sees (NARROWED)
expected: Cancel a cohort a participant is seated in, and read their terminal card as a whole: the named cancel and the next-step line appear TOGETHER. `TERMINAL_NEXT_STEP_LINE` (`packages/web/src/components/cohort/CohortPage.tsx`) is exported and rendered and read by no test, so its wording could change unnoticed. Whoever closes it should pin the sentence and render the terminal card, which also covers the one thing no store row can: that the two appear on the same card. The cancel narration itself, both variants, and the guard against a fault fabricating a cancel accusation are cited below.
result: [pending]

#### 11. Dismissal survives a refresh, on the console side (NARROWED)
expected: Dismiss an ended cohort record from the console, then REFRESH the page. The row is gone and stays gone. This is covered on the SERVICE side only: `forgetTerminal` plus `monitor.dismissEnded` are proven to clear both ended-record sources, so a refresh cannot bring the record back from the source of truth. The CONSOLE side is unexercised: `grep -rn dismissEnded packages/web/tests` finds nothing, so the store action at `packages/web/src/stores/operator.ts:1144` is invoked by no test, and its deliberate design choice (re-read from the service rather than splice the row out locally, which is what makes the row stay gone rather than merely look gone) plus its 401 and unreachable branches are all unrun. Its natural shape is the same four-fact 401 row 05-24 wrote for cancel and finalize, plus one row asserting the dismissal re-reads instead of splicing. The confirmation body's disclosure, the canceled-fate survival and the expired-fate non-invention are cited below.
result: [pending]

### Environment: a real chain, a real wallet, a real third-party host, or a clean machine

Nothing hermetic can stand these up. They are last for that reason.

#### 14. The runbook describes what actually ships
expected: Follow docs/DEPLOY.md from a clean machine using only the document. The quick start sets OPERATOR_PASSWORD first and walks log in at /operator, create, advertise, join, rehearse. The retired filler knob appears nowhere. MIN_PARTICIPANTS, AUTO_FALLBACK and SSE_DEBUG match what the service actually reads, and the /v1/config sample matches what the service actually serves. An operator can run every new control from this document alone, and its stated limits are true. Rewritten by gap plan 05-18. Note that step 4's sign-in observable was corrected by 05-27: look for the `New cohort` control, not the heading.
result: [pending]

#### 15. PART-05 live leg against real third-party esplora hosts (NARROWED)
scope: the two verdicts no stub can produce.
expected: Try a host that blocks browser requests (real CORS) and a real wrong-chain third-party host. The browser-rejected message and the mismatch naming BOTH chains appear, no silent fallback occurs in either direction, and the explicit switch-back control is offered on failure. All five verdicts (`ok`, `mismatch`, `browser-rejected`, `unreachable`, `malformed`) are driven through the store against stubbed endpoints and cited below, including the row proving the check judges against THIS participant's chain rather than one the code picked. A real CORS refusal and a real wrong-chain host are what the stubs cannot be.
result: [pending]

#### 16. PART-06 real wallet PSBT round trip
expected: Export the unsigned PSBT, sign it in an actual desktop or hardware wallet, return it, and broadcast. The wallet accepts the exported .psbt, the returned PSBT validates against the template, and the broadcast produces the same txid the local path would. A large pasted PSBT keeps its field scrolling internally without reflowing the step. The sighash REFUSAL is automated and cited below, so what is left here is genuine wallet interoperability, which was verified in no environment; 05-14 correctly forbids claiming any specific wallet works.
result: [pending]

#### 17. LIVE plus BROADCAST boot, the kill switch, and the funding stand-down (NARROWED)
scope: the real boot, plus the cost judgment.
expected: Boot with LIVE=1 BROADCAST=1 and engage Disable broadcast. Confirm on a REAL live boot that no route turns broadcast back on, that the health strip still reports the live boot mode with a separate warn chip beside it, and that a NEW cohort advertised afterwards shows no Funding card at all while a cohort advertised before the switch keeps its funding surface. Then make the judgment call: confirm the disclosed cost is acceptable, namely that once only post-switch cohorts remain the health strip's esplora-reachability badge stops refreshing (ADR 0017, recorded rather than simulated). The control's mode gating, its replacement once engaged, the preserved LIVE label with its warn chip, the funding-watch asymmetry across the engage moment, and the control's ABSENCE on a hermetic boot (proven on the shipped bundle by a real Chromium page, 05-27) are all cited below.
result: [pending]

## Automated Coverage

45 deliverables across this phase are deterministically covered by passing tests and are NOT
presented as checkpoints above. Recorded in aggregate rather than as individual pre-passed entries,
because listing ~100 resolved rows would bury the items that actually need a human.

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
not a coverage gap: every entry has a passing test ref. **The second gap-closure round did NOT fix
this**, and this note is retained rather than quietly dropped: the round closed coverage holes in
the tree, not schema drift in the plan artifacts.

Plans 05-06, 05-07, 05-16, 05-17, 05-18, 05-19 and 05-20 have no coverage block at all, so their
testable deliverables were extracted from prose.

**What the second gap-closure round changed here.** Plans 05-21 through 05-27 added 120 tests
across the web, service, shared and e2e legs, 1049 at the round's baseline to 1169 at its end, with
every new block proven load-bearing by a mutation applied to shipped source, observed, and
reverted. That work is what let two tests retire outright and thirteen narrow; the rows are
itemized below rather than summarized here, because a count is not a citation.

## Retired: covered by automation

The ledger opened by 05-21 and reconciled once, by 05-27, against the tree.

**The rule.** A plan appends one row per CLAUSE of a UAT test it now covers deterministically, and
a test moves out of `## Tests` only when EVERY clause of it has a row. A test whose clauses are
only partly covered is NARROWED instead: it stays in `## Tests` with its reduced scope stated, and
the clauses removed from it appear here.

**Every citation below was resolved against the tree by 05-27**: the cited file was opened and the
named block confirmed to exist. One citation had drifted and was corrected (recorded in
05-27's summary); none had to be deleted.

| UAT test | Clause now covered | Citation | Landed by |
|----------|--------------------|----------|-----------|
| 1 | The process boots from scratch, on the hermetic default, with no errors | `pnpm e2e:gate`: thirteen legs, each booting a real service on an ephemeral port and failing on any boot error | pre-existing, recorded 05-27 |
| 1 | `GET /v1/config` answers with the resolved network | `e2e/config.ts`, `runConfigCheck`: boots a coordinator on a chosen network over a real socket and throws unless the served DTO names exactly that network, with an operator-override leg beside the default | pre-existing, recorded 05-27 |
| 1 | The operator can sign in at `/operator` | `e2e/browser-operator.ts`: a real Chromium page on the BUILT bundle fills the password, waits on the signed-in-only `New cohort` control, and asserts the console heading by exact text. Renaming that heading was observed failing this leg while all 345 web unit rows stayed green | 05-27 |
| 1 | The public directory renders | `e2e/browser-participant-cohort.ts`: a real Chromium page lands on the directory, reads a row and picks a cohort from it | pre-existing, recorded 05-27 |
| 1 | A boot-time clamp warning names BOTH numbers rather than failing silently | `packages/service/tests/runtime-settings.spec.ts`, "warns LOUDLY on the clamped boot, naming both numbers on the real console", captured off `console.warn` on a real `createService` boot | 05-26 |
| 2 | The edit form opens pre-filled from the DRAFT's own captured values, including both timing windows, rather than from the service's current defaults | `packages/web/tests/cohort-form-render.spec.tsx`, "shows a saved discovery and funding window as MINUTES, not as empty fields" plus "seeds the beacon type, the size and the threshold from the draft too" | 05-23 |
| 2 | A timing field the operator never set round-trips as EMPTY, meaning "use the default", rather than as a zero or a pre-filled service default | `packages/web/tests/cohort-form-render.spec.tsx`, "leaves a window the operator never set EMPTY", with `packages/web/tests/cohort-form.spec.ts` "reads an EMPTY field as unset, never as a zero window" on the wire half | 05-23 |
| 2 | The same validation messages appear on the create and the edit path, and they are the service's own sentences byte for byte | `packages/web/tests/cohort-form.spec.ts`, "the shape-error copy, pinned independently of the constants that carry it" (both forms delegate to the one shared module, so one pin covers both paths) | 05-23 |
| 2 | A timing field the operator CLEARS on an edit round-trips as EMPTY, meaning "use this service's default", rather than silently keeping the value that was there | `packages/service/tests/draft-edit.spec.ts`, "a per-cohort timing window can be CLEARED and SET on the edit path (audit #29)": both windows, each driven both ways, each read back from the update verb AND from the served gated list, with the service's own default still carried beside the cleared key | 05-25 |
| 2 | A discovery window longer than this service can honor is refused at SAVE with the real maximum named in minutes | `packages/service/tests/runtime-settings.spec.ts`, "refuses a settings save above the TTL, naming the real maximum the console renders" plus "accepts a save at EXACTLY the TTL", both on a real boot that supplies the ceiling from its own cohort TTL. The PER-DRAFT half was already covered by `packages/service/tests/discovery-window.spec.ts`, "refuses a window ABOVE the ceiling, naming the service maximum in minutes" | 05-26 |
| 3 | The Closed stage exists, sits between Filling and Submissions, is reached the moment the nth seat fills with no server flag and no phase change, is NOT reached while a seat is still open, never holds a filled cohort back, and carries its exact label and caption | `packages/web/tests/operator-stage.spec.ts`, the whole block "the automatic Closed stage (SVC-04, D-01): narrated, never a button", including "carries the exact UI-SPEC label and caption, and is the only captioned stage" | pre-existing, recorded 05-27 |
| 4 | Rung 4 (funded beacon) requires a typed cohort id before the confirm arms, and discloses the recovery-key situation | `packages/web/tests/lifecycle.spec.ts`, "CancelConfirm chooses the rung and wires its gate (D-03, rendered)" | 05-21 |
| 4 | Rung 3 (ordinary cancel) asks for no typed id and keeps its confirm armed | `packages/web/tests/lifecycle.spec.ts`, same block, "keeps the ordinary cancel at low friction" | 05-21 |
| 4 | Rung 3's and rung 4's headings and the rung-4 confirm label are the shipped strings, and the rung-3 panel never shows the rung-4 heading | `packages/web/tests/lifecycle.spec.ts`, the rendered `CancelConfirm` block, asserting the exported `RUNG3_HEADING` / `RUNG4_HEADING` / `RUNG4_CONFIRM` rather than retyped copies. NOTE the rung-3 BODY's interpolated short id and seat count are not asserted and stay with the narrowed test 4 | pre-existing, recorded 05-27 |
| 4 | Cancel is HIDDEN rather than disabled after broadcast, and the post-broadcast line explains itself | `packages/web/tests/lifecycle.spec.ts`, "LifecycleActions hides Cancel once the beacon transaction is out (D-04, rendered)" | 05-21 |
| 4 | A mid-session 401 routes through the single shared session-expiry path, on BOTH lifecycle verbs, dropping to login and resetting the console view | `packages/web/tests/operator.spec.ts`, "routes a mid-session 401 on CANCEL through the one shared session-expiry path" plus the FINALIZE twin (each asserts auth, reason, view and the verb's own busy flag) | 05-24 |
| 4 | A failed action renders the action-error line and leaves every cohort fact untouched, with no optimistic chip | `packages/web/tests/operator.spec.ts`, "narrates the opaque cancel 404 as nothing more than a failed action", with "preserves the server's own reason on a refused (409) finalize" pinning the deliberate asymmetry between the two refusals | 05-24 |
| 5 | The chain endpoint disclosure's documented E16 verdicts are each produced by the shipped check: `ok`, `mismatch` naming both chains, `browser-rejected`, `unreachable` and `malformed` | `packages/web/tests/tx-client.spec.ts`, the `checkEndpoint` and `setting and clearing an endpoint` blocks (every verdict driven through the store, plus the two marker rows and per-row request counts). HERMETIC LIMIT: these produce each verdict against a stubbed endpoint. A real CORS refusal and a real wrong-chain third-party host are NOT covered and stay with test 15 | 05-24 |
| 6 | The `Advertising paused` chip appears BESIDE the mode chip, leaving the mode label unchanged | `packages/web/tests/service-controls.spec.ts`, "keeps the mode label unchanged and adds the paused chip beside it while draining" | 05-22 |
| 6 | A paused service disables its advertise controls, on BOTH the draft and the expired call site, with the reason rendered beside each | `packages/web/tests/operator-rows-render.spec.tsx`, "a paused service disables BOTH advertise controls and says why", plus "pause is DRAIN MODE, not a kill switch" for the narrowness | 05-23 |
| 6 | A paused advertise carries the operator-facing refusal reason, and never raw library phrasing | `packages/service/tests/pause.spec.ts`, "matches the operator-facing sentence byte for byte", "is a lowercase clause that reads inside the console action-error sentence" and "carries no raw library phrasing" (the guard shown firing against an inline raw-library fixture) | 05-26 |
| 6 | The public directory's paused notice is CHOSEN correctly in all four states and fails closed: above the list when a paused service still has open cohorts, a DISTINCT empty state when it has none, the inherited idle empty state on a running service, and no notice at all while the status is unknown or the directory is unreachable | `packages/web/tests/directory-labels.spec.ts`, the `directoryNotice` blocks. LIMIT: this is the state SELECTION. The rendered bodies of the two empty states, and the notice's position on the page, stay with the narrowed test 6 | pre-existing, recorded 05-27 |
| 6 | The restart-honesty line and the full-quiesce guidance are present and pinned word for word | `packages/web/tests/service-controls.spec.ts`, the literal pins on `RESTART_HONESTY_LINE` and `FULL_QUIESCE_GUIDANCE` | pre-existing, recorded 05-27 |
| 7 | A save with one invalid field applies NOTHING, and every rendered field still shows what the service holds | `packages/service/tests/runtime-settings.spec.ts`, the block "createRuntimeSettings: applySettings is all-or-nothing (UI-SPEC E8 partial)", specifically "applies NO field when any supplied field is invalid, and returns the first message" (the service half), and `packages/web/tests/settings.spec.ts`, the block "a rejected save leaves the rendered snapshot exactly as the service holds it", specifically "renders the service message and changes NO field on a 400" (the rendered half). **Citation corrected by 05-27**: 05-26 recorded the service-side row under a name it does not have | 05-26, corrected 05-27 |
| 7 | The per-setting source caption has exactly two formats, `env default` and `changed this session (environment default: X)`, including the not-set case | `packages/web/tests/settings.spec.ts`, "the per-setting source caption has exactly two formats (D-12, UI-SPEC E8)" | pre-existing, recorded 05-27 |
| 7 | A field holding its boot value reports `changed: false`, and an overridden one reports `changed: true` while STILL carrying its original env value, which is what lets a field set BACK to its boot value read as `env default` again | `packages/service/tests/runtime-settings.spec.ts`, "reports an overridden field as changed and STILL carries its original env value", beside the untouched-field rows | pre-existing, recorded 05-27 |
| 7 | The acceptance-retention note added by 05-17 is present in the operator help, word for word | `packages/web/tests/settings.spec.ts`, "states the honest limit on RETAINED acceptances (SVC-05, T-05-17-05/07)" | pre-existing, recorded 05-27 |
| 8 | A service that set no terms shows no terms step at all: no scroll box, no acceptance checkbox | `packages/web/tests/terms-render.spec.tsx`, "a service that set NO terms renders NO terms step at all" | 05-21 |
| 8 | The terms body never renders as markup or as a link target, is a plain React text child, sits in a height-capped scrolling container that wraps unbroken tokens, and carries the app-level enforcement caption | `packages/web/tests/terms.spec.ts`, the containment block: "uses no dangerous HTML prop of any kind", "never renders the operator text as a link target", "caps the terms container height, scrolls it, and wraps unbroken tokens", "renders the terms as a plain React text child of the capped container", "states the app-level limit rather than claiming protocol enforcement". LIMIT: this reads the shipped classes and props. That the result actually scrolls and stays inside the card at a narrow viewport stays with the narrowed test 8 | pre-existing, recorded 05-27 |
| 9 | A cohort with no seats left renders the test-peer control disabled beside the real refusal reason, and that reason is the service's own 409 sentence | `packages/web/tests/service-controls.spec.ts`, "renders the control DISABLED beside the refusal reason when no seats are left" plus "states the seat-exhausted refusal reason, which the service must repeat byte for byte" | 05-22 |
| 9 | On a LIVE cohort the peers' own post-cohort registration is honestly skipped with a console note rather than silently omitted | `packages/service/tests/test-peers.spec.ts`, "records the registration-skipped note on a LIVE service with a broadcaster" paired with "records NO such note on the hermetic boot, so a false live-only caveat is caught too". Both drive the shipped `createService` spawn path over real HTTP with real participants; both also assert the two unconditional entries, so the hermetic absence is not passing because nothing was logged | 05-26 |
| 10 | The participant's terminal card names the cancel and never narrates it as a stall or a timeout | `packages/web/tests/terminal-reason.spec.ts`, "narrates a cancel as a cancel on the EXACT input that produces stall copy today" plus "never narrates a cancel as a stall, a failure, or an expiry" | 05-24 |
| 10 | Both narration variants read correctly, and the specific one is reachable ONLY from a real answer: the operator attribution on a service-reported cancel, the honest fallback on anything else | `packages/web/tests/participant-fate.spec.ts`, "names the operator on a 200 whose body carries the boolean true" against the four refusal rows in "a fault cannot fabricate a cancel accusation", each asserting the rendered sentence and not only the flag | 05-24 |
| 11 | The dismissal confirmation body discloses what a dismissal costs: the record AND its activity log, from this console, for this session, with no undo | `packages/web/tests/service-controls.spec.ts`, "states the rung-1 dismissal copy, including that there is no undo" (exact equality on all three sentences) | 05-22 |
| 11 | A canceled cohort still reads as canceled to anyone querying its fate after the operator dismisses the row | `packages/service/tests/cohort-fate.spec.ts`, "still carries a CANCELED fate through a dismissal, so the condition really discriminates", beside the shipped 05-19 row "still answers the canceled fact after a 200 dismissal" | 05-25 |
| 11 | An EXPIRED cohort does NOT start reading as canceled once its row is dismissed, so a lapse is never presented as a deliberate cancel | `packages/service/tests/cohort-fate.spec.ts`, "does NOT carry an EXPIRED fate, so a lapse never becomes a reported cancel (audit #19)", with "answers FALSE for an expired record that was NOT dismissed" isolating the dismissal and "answers a dismissed EXPIRED id byte-identically to one this service never issued" keeping the route non-oracle | 05-25 |
| 12 | A completed co-sign round reads as `Signed` rather than as anything naming an anchor, and the k-of-n script-path cohort keeps its own distinct label | `packages/web/tests/operator-rows.spec.ts`, "every chip label is pinned word for word" (exact per-chip labels plus the anchor-wording guard on the unconfirmed pair and the in-flight chip) | 05-23 |
| 15 | A wrong-chain endpoint is refused with a mismatch naming BOTH chains, judged against THIS participant's chain rather than one the code picked | `packages/web/tests/tx-client.spec.ts`, "judges the endpoint against THIS participant's chain, not a chain the code picked" (the store's own network on one side, the endpoint's on the other) | 05-24 |
| 16 | A wallet that signs with any sighash other than DEFAULT or ALL is REFUSED with its own bad-sighash verdict and its own message, rather than being reported as unparseable | `packages/web/tests/psbt.spec.ts`, "returns the bad-sighash verdict for a signature that does not commit to the outputs" and the block "the accepted sighash set, one row per flavour the audit executed", with the rendered message pinned beside them | pre-existing, recorded 05-27 |
| 17 | The kill-switch control is offered ONLY on a live boot mode with broadcasting still available, and is replaced rather than disabled once engaged | `packages/web/tests/service-controls.spec.ts`, "ServiceControls offers the kill switch only where it can act (rendered)" | 05-22 |
| 17 | After the switch engages, the health strip still reports the LIVE boot mode, with a separate warn chip beside it rather than a rewritten mode chip | `packages/web/tests/service-controls.spec.ts`, "keeps the LIVE label and adds the broadcast-off chip once the kill switch engages" | 05-22 |
| 17 | The one-way control is ABSENT on a hermetic boot, on the SHIPPED BUNDLE | `e2e/browser-operator.ts`: a count-of-zero check on a real Chromium page after sign-in. Deleting the component's mode guard was observed failing this leg. Measured rather than assumed: 05-22's rendered matrix reddens on the same mutation, so this is a SECOND witness at the bundle level, not the only one | 05-27 |
| 17 | A cohort advertised AT or AFTER the engage moment takes the fixture path, reads no UTXO and records no funding view, while one advertised BEFORE keeps its funding watch | `packages/service/tests/kill-switch.spec.ts`, "drops a cohort advertised AT or AFTER the engage moment onto the fixture path", "does NOT broadcast a cohort advertised AFTER the switch engaged", "reads NO utxo and records NO funding view for a cohort advertised AFTER the switch" and "KEEPS the funding watch for a cohort advertised BEFORE the switch engaged". LIMIT: a real `LIVE=1 BROADCAST=1` boot is still test 17's own | pre-existing, recorded 05-27 |
| 18 | A cancel of an already-settled cohort answers a 404 with nothing changed, byte-identical to the 404 an id this service never issued earns | `packages/service/tests/cohort-cancel.spec.ts`, "reads \"unknown\" on a second cancel of the same cohort (already settled)" and "200s a live advertised cohort and files the canceled fate through the route", whose second POST asserts exactly that | pre-existing, recorded 05-27 |
| 18 | Never two ended records for one cohort id | `packages/service/tests/cohort-cancel.spec.ts`, "is idempotent in the fold: a second noteCanceled adds no duplicate record or log line" | pre-existing, recorded 05-27 |

### Test 1: retired, and its recorded pass preserved

Test 1 was the one test in this list that had already been run and had `result: pass`. All five of
its clauses now have rows above, so it is retired rather than left sitting as a passed item whose
claims rest on an observation somebody made once. The pass stands; what changed is that a script
now makes each of its claims on every run.

### Test 18: retired as un-runnable, with the backstop recorded

05-01 classified test 18 "verification: backstop" because the settle-race timing cannot be reliably
driven from a test harness. **The decision taken here: it is retired, not kept.** The reason it
cannot be driven from a harness is that it is a race at the instant a signing round completes, and
that is not more drivable by a human with a mouse than by a script; leaving it in a list of
procedures somebody can follow was a claim the list could not support.

What is checkable about it IS checked, and is cited above: a cancel of an already-settled cohort
answers the same opaque 404 an unknown id earns, and the fold refuses to file a second ended record
for one cohort id. What remains genuinely unverified is only the instantaneous interleaving, which
stays a backstop: if it ever fires in the wild, the symptom would be two ended records for one
cohort id, and the idempotence row above is the assertion that would have to have regressed.

### What the round did NOT close, restated here rather than in a summary

1. **The reflected round-trip outcome still has no live witness.** 05-27 pinned the honest-success
   sentence, its single call site and its rendering, which closes the rename and the deletion. Real
   closure needs a live regtest browser leg, because every browser harness in this repo is hermetic
   by construction. That leg is FILED and not built:
   `.planning/todos/pending/2026-07-30-live-regtest-browser-leg-for-the-reflected-outcome.md`.
2. **No DOM environment was adopted.** The reasoning and what it would buy are recorded in
   `packages/web/tests/support/render.tsx` and in 05-21's summary. The direct consequence is the
   whole `Hands` group above: roughly eight to ten clauses that are behind a click and therefore
   still need a person.
3. **Four interpolated test-peer strings are pinned by nothing** (narrowed test 9). The recommended
   pin shape is the same literal-plus-em-dash-guard treatment 05-22 gave the five static ones,
   evaluated at a representative seat count and network name.
4. **The console-side dismissal action is invoked by no test** (narrowed test 11), including its
   401 and unreachable branches.
5. **`TERMINAL_NEXT_STEP_LINE` is read by no test** (narrowed test 10).

## Summary

total: 16
passed: 0
issues: 0
pending: 16
skipped: 0
blocked: 0
retired: 2

**How these counts changed, and one correction.** The list held 18 items. Tests 1 and 18 are
retired, leaving 16. Thirteen of those sixteen are NARROWED (2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15
and 17) and three carry their original scope (13, 14 and 16).

The previous `## Summary` recorded `passed: 0` while test 1 carried `result: pass`. That
inconsistency is resolved by test 1's retirement: its pass is recorded in the ledger section above,
and the remaining 16 are genuinely all pending.

**Where the residue differs from what the triage predicted, and why.** The round brief expected the
residue to be roughly four owner decisions, one batched copy read and one wallet pass, plus the
legs needing a real chain or a real third-party host. The honest result is close on three of those
and adds a group the brief did not anticipate:

- **Owner decisions: two, not four** (tests 3 and 12), plus one embedded in test 17's live boot.
  Two of the four the brief listed turned out to be a different kind of input on inspection: the
  viewport pass is eyes rather than a decision, and the broadcast stand-down cost cannot be judged
  without the live boot it sits inside.
- **The batched copy read: one, as predicted**, carrying three questions (test 9's interpolated
  strings, `unknown draft`, and the duplicated console heading).
- **The wallet pass: one, as predicted** (test 16).
- **The environment legs: four** (14, 15, 16, 17), one more than the brief's "a real chain or a
  real third-party host", because the runbook walkthrough needs a clean machine and belongs with
  them rather than with the judgment calls.
- **A fifth group the brief did not predict: `Hands`, five items** (2, 4, 6, 10, 11). Their cause
  is structural and is stated above: the render harness this round added is a static server render,
  so no clause behind a click is reachable from it. They are not judgment and not environment; they
  are automatable work nobody has done. Counting them as judgment would have overstated how much of
  this list genuinely needs a person, which is the exact error the round exists to correct.

The counts were not adjusted to hit a target, per the round brief's own instruction.

## Gaps

<!-- Populated by /gsd-verify-work when a test reports an issue. -->
<!-- NOTE: the eight defects confirmed by the FIRST adversarial audit were recorded in 05-AUDIT.md -->
<!-- and closed by gap plans 05-15 through 05-20. The 24 defects confirmed by the SECOND audit are -->
<!-- recorded in 05-AUDIT-2.md and closed by 05-21 through 05-27. Neither set is listed here, -->
<!-- because this file tracks the human UAT pass, not the audits. -->
