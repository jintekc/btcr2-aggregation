---
phase: 05-operator-cohort-lifecycle-control
verified: 2026-07-30T00:00:00Z
status: gaps_found
score: 5/7 roadmap Success Criteria verified at code level; 2 FAILED (SC1, SC6); 16 human-verification items still pending (unresolved, per 05-UAT.md)
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: human_needed
  previous_score: "7/7 roadmap Success Criteria verified at code level (per prior 05-VERIFICATION.md, which predates both gap-closure rounds and the code review)"
  gaps_closed: []
  gaps_remaining:
    - "SC1: operator drill-down cancel/finalize ceremony can be armed against a stale, wrong cohort's data (CR-1)"
    - "SC6: the PART-05 'mismatch' failure message is unreachable on the project's actual default network"
  regressions:
    - "This is the FIRST verification pass to run 05-REVIEW.md's findings against the live tree; the previous 05-VERIFICATION.md predates the code review and both gap-closure rounds (05-15..05-27), so these are newly surfaced gaps rather than reopened ones"
gaps:
  - truth: "SC1: The operator moves a cohort through open -> close -> finalize from the console and the directory reflects each state change"
    status: failed
    reason: "The drill-down's confirmation ceremony for Cancel/Finalize (the destructive-confirmation ladder that makes lifecycle control safe) can render based on a DIFFERENT cohort's stale data than the one it is about to act on. `pollDetail` in the operator store reads `view.cohortId` once, before the await, and writes the fetch result into the shared `detail` slot unconditionally afterward, with no re-check that the view still names the same cohort. If the operator navigates from cohort A's drill-down to cohort B's drill-down while A's poll is still in flight, A's stale response can land in `detail` while `LifecycleActions` (which receives `cohortId` as a prop, correctly naming B) computes `cancelRung`, `cancelAvailability`, and `finalizeAvailability` from that stale A data. A single confirm click then fires `cancelCohort(baseUrl, cohortId)` targeting B (the cohort actually on screen) but under the confirmation friction, seat count, and recovery-key disclosure computed for A. If A is unfunded/hermetic and B is a funded live cohort, the operator sees the low-friction rung-3 panel (no typed confirmation, no recovery-key disclosure) while the click cancels a funded cohort, which is exactly the outcome the ceremony ladder exists to prevent. Confirmed directly against the live tree, independent of 05-REVIEW.md's own trace: `pollDetail` (packages/web/src/stores/operator.ts:1247-1267) has no post-await guard, and `LifecycleActions`/`CancelConfirm` (packages/web/src/components/operator/LifecycleActions.tsx) trust `detail` from the store without cross-checking it against the `cohortId` prop it was also given."
    artifacts:
      - path: "packages/web/src/stores/operator.ts"
        issue: "pollDetail (line ~1247) captures `view.cohortId` before the await but writes `result.value` into `detail` unconditionally afterward, with no re-check that `get().view` still names the same cohort."
      - path: "packages/web/src/components/operator/LifecycleActions.tsx"
        issue: "Receives `cohortId` as a prop (from the current view) but derives cancel/finalize rung, seat count, and recovery-key disclosure entirely from the store's `detail` slot (line ~131), with no check that `detail`'s own id agrees with the `cohortId` prop."
    missing:
      - "Re-check `get().view` after the await inside pollDetail and discard/ignore a response whose cohortId no longer matches the current view (the same discipline the participant store already applies to `fetchCohortFate`)."
      - "Defense in depth: LifecycleActions/CancelConfirm should refuse to render its controls when the served detail cannot be tied to the `cohortId` prop, rather than trusting that the store slot and the prop always agree."
      - "A regression test that drives two concurrent detail polls for different cohorts and asserts the ceremony renders only for the one currently in view (no such test exists today; this defect shipped through 969/1169-test gates without being caught)."
  - truth: "SC6: A participant can point their browser's chain reads at their own esplora endpoint, with a network-mismatch guard, four distinguishable failure messages, no silent fallback, and every real-funds guard rail unweakened (PART-05)"
    status: failed
    reason: "The 'mismatch' verdict, one of the four failure messages PART-05 and this SC explicitly require, is unreachable on the project's own DEFAULT network (mutinynet). `classifyEndpoint` refuses to classify a foreign chain as 'mismatch' unless the second (distinguishing) marker was observed; `checkEndpoint` only probes that second marker when block zero ALREADY agrees with `ourNetwork`'s genesis hash. Because mutinynet carries a `distinguishingBlock` (it shares block zero with plain signet), any endpoint on a genuinely different chain family (mainnet, testnet3, testnet4, regtest) has a DIFFERENT genesis hash from mutinynet's, so the second probe never fires, `observed.distinguishing` stays undefined, and `classifyEndpoint`'s guard (`ours.distinguishingBlock && observed.distinguishing === undefined`) returns `unreachable` BEFORE the genesis-hash comparison that would otherwise immediately produce 'mismatch'. Verified directly: traced `classifyEndpoint`/`checkEndpoint` (packages/web/src/lib/esplora.ts:154-261) against `NETWORKS` (packages/shared/src/networks.ts), and independently confirmed that every existing 'mismatch' test case in `packages/web/tests/tx-client.spec.ts` uses `ourNetwork: 'regtest'` (which has NO `distinguishingBlock`, so the masking guard never triggers) or a signet-vs-signet pairing; no test exercises `ourNetwork: 'mutinynet'` against a non-signet foreign chain, which is the actual default-deployment case this guard exists for. The endpoint is still refused (fails safe, not a trust hole), but the participant is told 'Couldn't reach that endpoint' instead of 'That endpoint is on Bitcoin mainnet, but this service is on Mutinynet (signet)', which directly contradicts the stated four-distinguishable-messages requirement and sends the participant to debug their network instead of their endpoint choice."
    artifacts:
      - path: "packages/web/src/lib/esplora.ts"
        issue: "classifyEndpoint (~line 176) checks the distinguishing-marker requirement before identifying the observed chain by genesis hash alone, masking every non-signet foreign chain as 'unreachable' when ourNetwork has a distinguishingBlock (true for mutinynet, the DEFAULT_NETWORK)."
    missing:
      - "Identify the chain from genesis hash first (a genesis-hash mismatch is already conclusive and needs no second marker); only require the distinguishing marker when the genesis hash already matches ours."
      - "A classifyEndpoint/checkEndpoint test case with `ourNetwork: 'mutinynet'` against a non-signet foreign genesis hash (mainnet/testnet3/testnet4/regtest), which today's suite does not exercise."
deferred:
  - truth: "The transport advert slot is also cleared when a cohort FILLS (keygen-complete), not only on the three settle paths, so a sibling open cohort stays listed but stops being joinable to a freshly connecting participant."
    addressed_in: "Phase 6 (suggested home; not yet claimed by a Phase 6 success criterion)"
    evidence: "Logged in .planning/phases/05-operator-cohort-lifecycle-control/deferred-items.md and documented as upstream limit 1 in docs/UPSTREAM-LIMITS.md. No Phase 5 must-have covers the fill path: 05-01 scopes repair to 'cancel, signing-complete, cohort-failed', all three of which are wired and behaviorally proven. Carried forward unchanged from the prior verification pass."
behavior_unverified_items: []
human_verification:
  - test: "Judgment 1 (05-UAT test 3): confirm by eye that no Close button exists anywhere on the console, and accept or refuse the deliberate re-reading of roadmap SC 1 (Closed is an automatic nth-seat stage, not an operator-pressed button, per locked CONTEXT D-01)."
    expected: "No Close control exists anywhere on the console; the Closed stage appears automatically the instant the nth seat fills, narrated with its caption, not as an act the operator performs."
    why_human: "A deliberate divergence from the literal wording of the roadmap goal that only the owner can accept or refuse. The stage's existence, trigger, and caption are automated and passing (packages/web/tests/operator-stage.spec.ts); the absence of a Close button anywhere on the rendered console is not asserted by any test."
  - test: "Judgment 2 (05-UAT test 12): read the Ended-group labels (a completed hermetic co-sign now reads 'Signed', not an anchor claim) and decide whether the change reads as newly honest rather than as a regression."
    expected: "Owner accepts the relabeling as an honest disclosure of what MuSig2 completion does and does not prove about an on-chain anchor."
    why_human: "Pure copy/framing judgment; every label and the anchor-wording guard are automated and passing (packages/web/tests/operator-rows.spec.ts)."
  - test: "Eyes (05-UAT test 13, plus narrowed 5/7/8): at a real browser viewport, walk the operator console list, drill-down (with cancel/finalize/seat-reclaim/funding disclosures all visible at once), health strip, a saved long SERVICE_NAME on both the console and the public directory header, and a long TERMS_TEXT body at a narrow viewport height."
    expected: "Nothing overflows, chips stay on screen, grouping is legible with no horizontal scroll; the long service name renders as plain escaped text on both surfaces without pushing chips off screen; the long terms body scrolls inside its capped container, wraps unbroken tokens, never escapes the card, and join controls stay reachable below it."
    why_human: "Layout/legibility at a real screen size. The round's render harness is a static server render (no layout engine), so it can prove the capping/wrapping classes are present but never that anything actually fits."
  - test: "Copy (05-UAT test 9, plus two follow-on questions): read the four interpolated test-peer confirm strings, the verbatim 'unknown draft' refusal shown to an operator editing a stale draft, and the duplicated 'Operator console' heading shown on both sides of sign-in."
    expected: "All read correctly, in particular that the test-peer confirm states BEFORE the act that peers co-sign for real with throwaway keys; decide whether 'unknown draft' is the right sentence and whether the signed-in console deserves its own heading."
    why_human: "Copy/framing decisions; the four interpolated strings are pinned by nothing today (a named, not-yet-done follow-up), and the other two are deliberate, already-shipped choices awaiting the owner's sign-off."
  - test: "Hands (05-UAT tests 2, 4, 6, 10, 11): exercise 'Cancel edit' on a draft in place; open the finalize and ordinary-cancel confirms and read their in-place wording plus the in-flight disable; load the public directory paused/unpaused and narrow the window; cancel a cohort a participant is seated in and read their terminal card; dismiss an ended cohort row and refresh the page."
    expected: "Cancel edit closes the form with the draft unchanged; finalize/cancel confirms state the real consequence before it happens and disable correctly while in flight; the paused notice and empty states render distinctly and the controls row wraps at narrow widths; the cancel narration and next-step line appear together on the participant's terminal card; a dismissed row stays gone after a refresh."
    why_human: "This round's render harness is a static server render: no events fire, no effects run, so no state a click produces is reachable from it. Needs a DOM environment or a browser leg that does not exist yet."
  - test: "Environment 1 (05-UAT test 14): follow docs/DEPLOY.md from a clean machine using only the document (sign in, create, advertise, join, rehearse)."
    expected: "Every new control is reachable from the document alone; the retired filler knob appears nowhere; MIN_PARTICIPANTS/AUTO_FALLBACK/SSE_DEBUG and the /v1/config sample match what the service actually reads and serves."
    why_human: "Needs a clean machine and a person following written instructions verbatim; not something a unit or e2e test can stand in for."
  - test: "Environment 2 (05-UAT test 15, narrowed): try a real host that blocks browser requests (CORS) and a real wrong-chain third-party esplora host against this service's actual default network."
    expected: "browser-rejected and mismatch (naming both chains) appear correctly, with the explicit switch-back control offered on failure and no silent fallback in either direction. NOTE: per the newly found gap above (SC6), the mismatch case is expected to currently render as 'unreachable' instead, because of the classifyEndpoint defect on mutinynet -- this UAT walk should confirm or refute that finding against a real host before it is closed."
    why_human: "Real CORS behavior and a real wrong-chain host cannot be produced hermetically; this is also the fastest way to confirm the SC6 gap above against a live browser rather than a traced read of the source."
  - test: "Environment 3 (05-UAT test 16): export the unsigned PSBT, sign it in an actual desktop or hardware wallet, return it, and broadcast; also confirm a large pasted PSBT keeps its field scrolling internally."
    expected: "The wallet accepts the exported .psbt; the returned PSBT validates against the template; the broadcast produces the same txid the local path would; the large-PSBT field does not reflow the step."
    why_human: "No wallet interoperability was verified in this environment; the 05-14 prohibition correctly forbids claiming any specific wallet works without this walk."
  - test: "Environment 4 (05-UAT test 17, narrowed): boot with LIVE=1 BROADCAST=1, engage Disable broadcast, and confirm the real boot behavior plus the disclosed cost of the stand-down."
    expected: "No route turns broadcast back on; the health strip still reports the live boot mode with a separate warn chip; a cohort advertised after the switch shows no Funding card while one advertised before keeps its funding surface; the owner accepts that the esplora-reachability badge stops refreshing once only post-switch cohorts remain."
    why_human: "Needs a real LIVE+BROADCAST boot, which cannot be produced hermetically, plus an owner cost/benefit judgment that only the owner can make."
  - test: "Cancel settle-race backstop (05-01, `verification: backstop`): attempt to cancel a cohort at the instant its signing round completes."
    expected: "The click is answered 404 with nothing changed, and the console never shows two ended records for one cohort id."
    why_human: "A timing race that cannot be reliably driven from a test harness; classified 'backstop' by design. What is checkable about it (the opaque 404 on an already-settled cohort, and idempotent folding so no duplicate ended record is ever filed) is automated and passing."
---

# Phase 5: Operator Cohort Lifecycle Control Verification Report

**Phase Goal:** The operator runs aggregation and manages a cohort's lifecycle (open, then close, then finalize) and pauses, cancels, or reconfigures advertising from the console, without restarting the process, removing the last hardwired, uncontrollable behavior.
**Verified:** 2026-07-30
**Status:** gaps_found
**Re-verification:** Yes. A prior `05-VERIFICATION.md` existed (dated 2026-07-29, status `human_needed`, score 7/7), but it was written against only the original 14 plans (05-01..05-14), before both gap-closure rounds (05-15..05-20, 05-21..05-27) and before `05-REVIEW.md`'s code review existed. This report replaces it in full, verifies the complete 27-plan phase, and independently confirms (not merely cites) two review findings that falsify roadmap Success Criteria.

## Method

I did not trust SUMMARY.md narrative, the prior VERIFICATION.md's 7/7 score, or 05-REVIEW.md's findings at face value. For every claim that mattered to a Success Criterion, I re-derived it from the live tree:

- Ran `pnpm test` directly: **68 files, 1169 tests, all passing** (matches the baseline REVIEW.md states, confirmed independently rather than copied from it).
- Read `packages/web/src/stores/operator.ts` (`pollDetail`, `cancelCohort`, `finalizeCohort`) and `packages/web/src/components/operator/LifecycleActions.tsx` directly and traced the data flow myself to confirm CR-1 is real: there is no post-await re-check of `view.cohortId` in `pollDetail`, and `LifecycleActions` derives its rung/availability entirely from the store's `detail` slot with no cross-check against its own `cohortId` prop.
- Read `packages/web/src/lib/esplora.ts` (`classifyEndpoint`, `checkEndpoint`) and `packages/shared/src/networks.ts` (`NETWORKS`, `DEFAULT_NETWORK`) directly and traced the classification logic myself to confirm the WR-1 finding: `mutinynet` (the actual `DEFAULT_NETWORK`) carries a `distinguishingBlock`, `checkEndpoint` only requests the second marker when block zero already matches `ourNetwork`'s genesis hash, and `classifyEndpoint`'s `ours.distinguishingBlock && observed.distinguishing === undefined` guard therefore returns `unreachable` for any genuinely foreign chain before the genesis-hash comparison that would otherwise produce `mismatch`.
- Grepped `packages/web/tests/tx-client.spec.ts` for every `classifyEndpoint`/`mismatch` test case and confirmed none exercises `ourNetwork: 'mutinynet'` against a non-signet foreign genesis hash; all mismatch coverage uses `ourNetwork: 'regtest'` (no `distinguishingBlock`, so the masking guard never triggers there) or a signet-vs-signet pairing.
- Checked whether the WR-2/WR-3 settings-wedge defects (non-integer/non-whole-minute numeric seeds) are reachable on the DEFAULT deployment path: `docker-compose.yml` seeds `DEFAULT_SIZE=2` (safe integer) and leaves `DEFAULT_THRESHOLD`/`DEFAULT_DISCOVERY_WINDOW_MS`/`DEFAULT_FUNDING_WINDOW_MS` unset (so the seed defaults to `undefined`, not a wedging value). Confirmed these are real defects but conditional on an operator explicitly setting a malformed/non-whole-minute env value, not present out of the box; classified as WARNING, not BLOCKER.
- Read `05-UAT.md` in full: `status: testing`, 16 items, **all `result: [pending]`**, `awaiting: user response`. This is the reconciled human residue after both gap-closure rounds removed 17 of 18 originally-claimed human-only items by automating them; it is real, current, and unresolved.
- Cross-referenced `REQUIREMENTS.md`: exactly SVC-04, SVC-05, PART-05, PART-06 map to Phase 5, all four appear in PLAN frontmatter across the 27 plans. No orphaned requirements. (Note: all four are already marked `[x]`/`Complete` in REQUIREMENTS.md, ahead of both the still-open UAT walk and the two gaps this report newly found; this was already flagged as W2 in the prior verification pass and remains true.)
- Read `05-REVIEW.md` in full (94 files, 1 critical / 7 warning / 5 info) and weighed each finding against the seven roadmap Success Criteria rather than accepting its own severity labels uncritically.

## Goal Achievement

### Observable Truths (roadmap Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Operator moves a cohort through open, close and finalize from the console and the directory reflects each state change | ✗ FAILED | The state-transition machinery itself (finalize via `pnpm e2e:fallback:operator`, the automatic Closed stage, `FINALIZABLE_PHASES` guards shared client/server) is real and behaviorally proven. But the console's destructive-confirmation ceremony that gates Cancel/Finalize can render against a STALE, WRONG cohort's data due to an unguarded race in `pollDetail` (CR-1, confirmed directly against the live tree, not merely cited from 05-REVIEW.md). This can silently downgrade the safety friction applied to a cancel of a funded, live cohort. See Gap 1. |
| 2 | Operator pauses or cancels advertising so new cohorts stop being offered, without killing the running service | ✓ VERIFIED | `pnpm e2e:pause` (rerun during this pass, PASSED): `GET /v1/status` reports `paused:true` while still listing/counting the pre-pause cohort, a fresh participant still seats in it, a new advertise is refused 409, and resume restores both bits. This SC's own claim (drain-mode pause, service stays up) is unaffected by CR-1, which is a drill-down UI concern, not a pause/advertise-gate concern. |
| 3 | Operator reconfigures cohort shape (capacity, threshold, beacon type for the next cohort) without editing env vars or restarting | ✓ VERIFIED | `updateDraft`/`applySettings` (all-or-nothing) verified in `packages/service/tests/draft-edit.spec.ts` and `runtime-settings.spec.ts`. WR-2/WR-3 (a non-integer or non-whole-minute numeric seed can wedge every subsequent save) are real but require an operator to explicitly set a malformed env seed; the documented default path (`docker-compose.yml`: `DEFAULT_SIZE=2`, other numeric seeds unset) is unaffected. Recorded as Warning W3 below rather than a gap against this SC. |
| 4 | A canceled or closed cohort no longer appears as joinable in the participant directory | ✓ VERIFIED | `pnpm e2e:cancel` (rerun, PASSED): the canceled cohort leaves the public directory and open count immediately; a still-open sibling seats a freshly constructed participant afterward. `isJoinable` is Advertised-tier AND free-seat only. This SC's own claim (the SERVED state after a cancel) holds regardless of CR-1, because the server-side cancel always targets the id actually sent, which is the currently-viewed cohort; CR-1's harm is in which cohort gets clicked with how much friction, not in what the directory serves afterward. |
| 5 | Participation terms accepted at join and recorded as a DID-signed, server-verified, terms-hash-bound artifact, with the app-level enforcement boundary disclosed honestly (SVC-05) | ✓ VERIFIED (code level) | `packages/service/tests/tos.spec.ts` (28 tests, rerun and passing): wrong-key refusal, wrong-hash refusal, extra-field refusal, oversized-body refusal before parsing, byte-same refusal body (non-oracle), bounded acceptance ledger (200, oldest-first eviction). Boundary copy pinned in `terms.spec.ts` and `docs/DEPLOY.md`. Rendered composition with terms actually set: human item (Eyes). |
| 6 | Participant can point browser chain reads at their own esplora endpoint, with a network-mismatch guard, four distinguishable failure messages, no silent fallback, real-funds guard rails unweakened (PART-05) | ✗ FAILED | Three of the four messages (`ok`, `browser-rejected`, `malformed`) and the endpoint is always refused on any detected discrepancy (no trust hole), but the `mismatch` verdict, the one this SC and PART-05 both name explicitly, is UNREACHABLE on `mutinynet`, the project's own `DEFAULT_NETWORK`, against any genuinely foreign chain (mainnet/testnet3/testnet4/regtest). Confirmed by direct code trace, not cited secondhand. See Gap 2. |
| 7 | Participant can sign the registration transaction in their own wallet through a PSBT round trip validated against the exact template before anything is broadcast (PART-06) | ✓ VERIFIED (code level) | `validateSignedPsbt` compares witness-free unsigned bytes only, never raw hex, with five discriminated verdicts. `packages/shared/tests/psbt.spec.ts` and `packages/web/tests/psbt.spec.ts` (rerun, passing) prove txid parity, raw-hex divergence, and every verdict including the bad-sighash case. Real wallet interoperability: human item (Environment). |

**Score:** 5/7 roadmap Success Criteria verified (2 FAILED). 0 present-behavior-unverified.

### Deferred Items

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | The transport advert slot is also cleared when a cohort FILLS (`keygen-complete`), not only on the three settle paths | Phase 6 (suggested, not yet claimed) | `deferred-items.md` + `docs/UPSTREAM-LIMITS.md` limit 1. Not a Phase 5 must-have: 05-01 scopes repair to the three settle paths, all wired and behaviorally proven. Carried forward unchanged from the prior verification pass. |

### Required Artifacts

All artifacts declared across the 27 plans (14 original + 6 round-1 gap plans + 7 round-2 gap plans) exist and are substantive. The prior verification's table of 53 artifacts across the original 14 plans still holds (spot-checked this pass: `operator-cohorts.ts`, `runtime-settings.ts`, `hono-adapter.ts`, `esplora.ts`, `psbt.ts`, `tos.ts` all present, all carry their declared symbols). Round-1 and round-2 gap plans added tests and small fixes rather than new top-level artifacts; their additions are captured in the Behavioral Spot-Checks section below (120 tests added by round 2 alone, per `05-UAT.md`'s own accounting, independently confirmed by the file-count/test-count delta between the prior verification's 969 tests and today's 1169).

Two artifacts carry defects this pass surfaced independently of their existence/substance/wiring status (both pass Levels 1-3, both are HOLLOW on a specific behavioral path):

| Artifact | Provides | Status |
|---|---|---|
| `packages/web/src/stores/operator.ts` (`pollDetail`) | drill-down polling that feeds the cancel/finalize ceremony | ⚠️ WIRED, but the ceremony it feeds can be armed against the wrong cohort under a navigation race (Gap 1) |
| `packages/web/src/lib/esplora.ts` (`classifyEndpoint`) | four-way endpoint verdict for PART-05 | ⚠️ WIRED, but one of its four verdicts (`mismatch`) is unreachable on the default network (Gap 2) |

### Key Link Verification

The prior verification's 42 key-link table (38 direct matches, 4 traced-and-confirmed indirect) still holds; this pass did not find any key link newly broken. The two gaps found this pass are internal-logic defects inside already-wired modules, not broken wiring between modules.

### Data-Flow Trace (Level 4)

No new data-flow defects found beyond the prior pass's clean trace. `ServiceControls.tsx`, `BrowseView.tsx`, `SettingsView.tsx`, `TermsStep.tsx`, `ChainEndpointPanel.tsx`, and `WalletSignPanel.tsx` all still read from real, request-backed sources.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Full unit suite under composite typecheck | `pnpm test` | 1169 passed (1169), 68 files | ✓ PASS |
| Cancel: fate, directory removal, sibling still seats | `pnpm e2e:cancel` | PASSED | ✓ PASS |
| Pause: drain mode, paused bit, 409 refusal, resume | `pnpm e2e:pause` | PASSED | ✓ PASS |
| classifyEndpoint mismatch coverage on the DEFAULT network | grep `packages/web/tests/tx-client.spec.ts` for `ourNetwork: 'mutinynet'` paired with a non-signet foreign genesis | No such test case exists; all mismatch rows use `ourNetwork: 'regtest'` or signet-vs-signet | ✗ GAP CONFIRMED (Gap 2) |
| pollDetail post-await view re-check | Read `packages/web/src/stores/operator.ts:1247-1267` directly | No re-check of `get().view` after the await; `closeCohort`/`openCohort` do not cancel or invalidate an in-flight poll | ✗ GAP CONFIRMED (Gap 1) |
| Rendered composition of console/join surfaces, real-wallet/live-chain legs | — | Not runnable hermetically | ? SKIP -> human verification |

### Probe Execution

No `scripts/*/tests/probe-*.sh` convention exists in this repo. The e2e legs above were executed directly rather than taken from SUMMARY claims.

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|---|---|---|---|---|
| SVC-04 | 05-01..05-10, 05-14 (+ round-1/2 gap plans) | Operator runs aggregation and manages a cohort's lifecycle and pauses, cancels, or reconfigures advertising without restarting | ⚠️ PARTIALLY BLOCKED | SC 2-4 hold; SC 1's console-side cancel/finalize ceremony has a confirmed race (Gap 1) that undermines the safety guarantee central to this requirement's "manage a cohort's lifecycle" clause. |
| SVC-05 | 05-07, 05-13, 05-14 | Runtime participation terms; DID-signed, server-verified, terms-hash-bound acceptance with honest app-level boundary | ✓ SATISFIED (code level) | SC 5 above; 28-test `tos.spec.ts`; boundary copy pinned. |
| PART-05 | 05-11, 05-14 (+ round-2 gap plans) | Participant esplora override with mismatch guard, four failure messages, no silent fallback, guard rails unweakened | ✗ BLOCKED | SC 6 above: the `mismatch` message is unreachable on the project's own default network (Gap 2), which directly contradicts the "four distinguishable failure messages" clause of this requirement's own text. |
| PART-06 | 05-12, 05-14 | Wallet PSBT round trip validated against the exact template before broadcast | ✓ SATISFIED (code level) | SC 7 above; `psbt.spec.ts` (shared + web). |

**Orphan check:** `REQUIREMENTS.md` maps exactly SVC-04, SVC-05, PART-05 and PART-06 to Phase 5. All four appear in PLAN frontmatter. **No orphaned requirements.** (Note: `REQUIREMENTS.md` already marks all four `[x]`/`Complete`, ahead of both this report's two findings and the still-fully-pending `05-UAT.md` walk; see Warning W2.)

### Anti-Patterns Found

No new debt markers (`TBD`/`FIXME`/`XXX`) found in files touched by the round-2 gap plans. The prior pass's clean anti-pattern scan (no `dangerouslySetInnerHTML`, no persistence in `runtime-settings.ts`, no browser storage in the PSBT path, no wallet-compatibility claims) still holds; this pass did not re-scan every file but spot-checked the modules touched by the two new gaps and found no additional stub/placeholder patterns there.

### Prohibition Disposition

Carried forward from the prior pass: 25 prohibitions (17 test-tier, all with wired enforcement; 8 judgment-tier, recorded as a non-authoritative reading, human review recommended, unchanged by this pass's findings). Neither of this pass's two new gaps is a prohibition violation; both are functional defects in the *positive* truths (the ceremony must apply the right friction to the right cohort; the guard must actually produce all four named messages).

### Human Verification Required

Ten items, detailed in full in the frontmatter `human_verification` list (mapped 1:1 onto `05-UAT.md`'s 16 remaining pending tests, several of which are batched together where the same real-viewport/wallet/live-boot pass covers multiple numbered tests). In summary:

1. Automatic-close acknowledgement (owner decision, test 3).
2. Anchored-vs-Signed relabeling acknowledgement (owner decision, test 12).
3. Batched real-viewport eye pass: console/drill-down/health strip, long service name, long terms body (tests 13, 5, 7, 8).
4. Batched copy read: test-peer confirm strings, `unknown draft` wording, duplicated console heading (test 9 plus two riders).
5. Batched hands pass needing a real DOM/browser: cancel-edit, finalize/cancel confirm wording and in-flight disable, public paused notice, participant terminal-card wording, console-side dismissal survives refresh (tests 2, 4, 6, 10, 11).
6. Runbook walkthrough from a clean machine (test 14).
7. PART-05 live leg against a real CORS-blocking host and a real wrong-chain host (test 15) -- this walk should also confirm or refute Gap 2 against a live host, not just a stub.
8. PART-06 real wallet PSBT round trip (test 16).
9. LIVE+BROADCAST boot leg for the one-way kill switch (test 17).
10. Cancel settle-race backstop (05-01, `verification: backstop`).

`05-UAT.md` (`status: testing`) already tracks all sixteen of these by number with step-by-step procedures in `05-UAT-PROCEDURES.md`; none has a recorded result yet (`result: [pending]` on all sixteen).

### Warnings

**W1 (elevated to Gap 1 this pass) -- superseded, see Gaps section.**

**W2 -- `REQUIREMENTS.md` already marks all four IDs `[x]`/`Complete` before the human UAT gate has run, and before this pass's two new findings are resolved.** Carried forward from the prior verification. Suggest holding the `Validated` transition until both gaps in this report are closed and `05-UAT-CHECKLIST.md`/`05-UAT.md` are walked and signed.

**W3 -- a non-integer or non-whole-minute numeric settings seed can wedge every subsequent settings/draft save until restart (05-REVIEW.md WR-2/WR-3).** Confirmed real but conditional: the documented `docker-compose.yml` default path only seeds `DEFAULT_SIZE=2` (a safe integer) and leaves the window/threshold seeds unset, so this does not fire on the default deployment. It fires only if an operator sets, e.g., `DEFAULT_SIZE=2.5` or `DEFAULT_DISCOVERY_WINDOW_MS=90000` (a legal-at-the-knob-level but non-whole-minute value). Not a blocker against any roadmap SC as stated, but a real robustness gap worth closing before recommending arbitrary env overrides in `docs/DEPLOY.md`.

**W4 -- five additional 05-REVIEW.md warnings (WR-4 through WR-7) and five info items are real, unresolved, but do not falsify a roadmap Success Criterion.** `GET /cas/:kind/:hash` prototype-pollution 500 on the filesystem store (WR-4), the endpoint verdict cache never clearing on an explicit re-check (WR-5), unbounded timeouts on the two participant-supplied chain calls (WR-6), and a test-peer seat cap that holds only for serial calls (WR-7) are all genuine defects worth fixing, but none of them is exercised by any of the seven roadmap SCs as literally stated. Recorded here so they are not lost, not elevated to gaps.

### Gaps Summary

Two gaps block full goal achievement, both confirmed by direct inspection of the live tree rather than taken on 05-REVIEW.md's word:

1. **The drill-down cancel/finalize ceremony can be armed against a stale, wrong cohort's data** (`pollDetail`'s unguarded navigation race), which undermines the safety property the destructive-confirmation ladder exists to provide (SVC-04 / roadmap SC 1).
2. **The PART-05 four-distinguishable-messages guarantee is not actually four-way on the project's own default network** (`classifyEndpoint`'s `mismatch` verdict is unreachable against mutinynet), which directly contradicts PART-05's own text and roadmap SC 6 (both name `mismatch` as one of the required messages).

Both gaps are narrow, well-understood, and each has a concrete two-to-five-line fix already sketched (in this report and independently in 05-REVIEW.md). Neither requires new architecture. Everything else checked in this pass, including all five other roadmap SCs, the full 27-plan requirements traceability, the 1169-test gate, and the four e2e legs, holds. The sixteen items in `05-UAT.md` remain genuinely pending and are not gaps in the automated sense, but the phase cannot be marked `passed` while two SCs are FAILED, so status is `gaps_found` (which takes precedence over `human_needed` per the verification decision tree). Recommend a focused gap-closure round targeting exactly these two defects (plus, at the owner's discretion, W3) before re-running `05-UAT.md`'s human pass, since several of that pass's items (notably test 15, the PART-05 live leg) sit directly on top of Gap 2 and would otherwise be walked against code known to be wrong.

---

_Verified: 2026-07-30_
_Verifier: Claude (gsd-verifier)_
