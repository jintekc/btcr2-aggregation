---
phase: 05-operator-cohort-lifecycle-control
verified: 2026-08-02T00:00:00Z
status: gaps_found
score: 6/7 roadmap Success Criteria verified at code level; 1 FAILED (SC3); 16 human-verification items still pending (unresolved, per 05-UAT.md)
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: "5/7 roadmap Success Criteria verified at code level; 2 FAILED (SC1, SC6) (per 05-VERIFICATION.md dated 2026-07-30, before the third gap-closure round)"
  gaps_closed:
    - "SC1: the drill-down cancel/finalize ceremony could be armed against a stale, wrong cohort's data (CR-1). Closed by 05-28: a post-await round guard in `pollDetail` plus a `detailCohortId` provenance field, and a second refusal barrier in `LifecycleActions` that will not render a control it cannot tie to its own `cohortId` prop. Confirmed directly against the live tree (code read, not SUMMARY narrative), and independently confirmed by re-running the concurrent-poll and rendered-refusal test rows."
    - "SC6: the PART-05 `mismatch` verdict was unreachable on mutinynet, the project's own DEFAULT_NETWORK, against any genuinely foreign chain. Closed by 05-29: `classifyEndpoint` now identifies the observed chain from block zero before the distinguishing-marker requirement runs, so a foreign genesis returns `mismatch` naming both chains instead of `unreachable`. Confirmed directly against the live tree and by re-running the default-network foreign-chain matrix in `tx-client.spec.ts`."
  gaps_remaining:
    - "SC3 (NEWLY SURFACED, not part of the prior report's two gaps): `SERVICE_NAME` and `TERMS_TEXT` boot seeds carry no length bound, while `applySettings` enforces MAX_SERVICE_NAME_CHARS (200) and MAX_TERMS_CHARS (20000) against the stored value whenever a save omits that key. An over-long seed (very plausible for TERMS_TEXT, a real participation-terms document) silently wedges every subsequent settings save, including saves of fields the operator did touch, until restart. This is CR-01 from the fresh 05-REVIEW.md re-review of the round-3 files, independently reproduced against the shipped module during this pass."
  regressions: []
gaps:
  - truth: "SC3: The operator reconfigures cohort shape (e.g. capacity, threshold, beacon type for the next cohort) without editing env vars or restarting the process"
    status: failed
    reason: "05-30 closed the settings-wedge defect (05-VERIFICATION.md W3, review WR-2/WR-3) for the five NUMERIC seeds (size, threshold, both windows, the discovery-window ceiling): `numericKnob` gained an opt-in integrality check and every window is quantized to a whole minute, both proven with hostile-seed tables and load-bearing mutation tests. That fix is genuine and independently reproduced (rerun `packages/service/tests/runtime-settings.spec.ts`, 66/66 passing). But the round's own docstring states the invariant generically ('no seed this holder ACCEPTS may be a value applySettings would REFUSE') while the code enforces it for numeric fields only. `serviceName` and `termsText` are seeded with `field(trimToUndefined(seed.serviceName))` / `field(trimToUndefined(seed.termsText))`, a trim only, with no length check against `MAX_SERVICE_NAME_CHARS` (200) or `MAX_TERMS_CHARS` (20000). `applySettings` re-reads the STORED value for every key a patch omits and refuses the whole save if that stored value exceeds the cap. `demo-server.ts` pipes `process.env.SERVICE_NAME` / `process.env.TERMS_TEXT` straight into the seed with the same unbounded trim, and its own comment claims 'a malformed value warns and falls back', which is not what the code does for these two fields (no warning, no fallback, just silent unbounded storage). Independently reproduced against the shipped module: `createRuntimeSettings({ serviceName: 'x'.repeat(5000), termsText: 'y'.repeat(100000) })` boots with ZERO warnings and stores both at full length; a subsequent rename-only save (`applySettings({ serviceName: 'New Name' })`) is refused with 'Participation terms must be 20000 characters or fewer.', a sentence about a field the operator did not touch; a subsequent size-only save is refused with 'Service name must be 200 characters or fewer.'. Once wedged, the operator cannot save capacity, threshold, or beacon type either, because `applySettings` validates the whole patch as a set and the stored oversized string is always in that set. This directly falsifies roadmap SC3 and the 'without editing env vars or restarting' clause of SVC-04: an operator who sets a realistic TERMS_TEXT document (SVC-05 exists specifically so operators can set real participation terms) can permanently lose the ability to reconfigure cohort shape from the console until the process restarts, with no warning at boot to explain why."
    artifacts:
      - path: "packages/service/src/runtime-settings.ts"
        issue: "The `serviceName` and `termsText` `FieldState` seeds (around line 468-473) apply only `trimToUndefined`, never a length bound, unlike every numeric seed in the same function (all five of which now request `numericKnob`'s integrality flag per 05-30). `applySettings` (around line 566-627) enforces `MAX_SERVICE_NAME_CHARS`/`MAX_TERMS_CHARS` against the value re-read from storage for an omitted key, so an over-long seed refuses every future save as a set."
      - path: "packages/service/src/demo-server.ts"
        issue: "Lines ~396 and ~432 read `process.env.SERVICE_NAME` / `process.env.TERMS_TEXT`, trim, and pass straight through with no bound, while the adjacent comment (line ~401) claims this idiom 'warns and falls back instead of poisoning a comparison or storing an empty string', which is true of the numeric knobs beside it but false for these two string seeds."
    missing:
      - "A bounded string-seed helper (the same warn-and-fall-back posture as `numericKnob`) applied to `serviceName` and `termsText` at the one holder every seed path meets, mirroring the fix 05-30 already applied to the numeric seeds."
      - "A `HOSTILE_SEEDS` row (or sibling table) for an over-long `serviceName`/`termsText` seed, each followed by a rename-only save that must succeed, matching the pattern 05-30 established for the numeric fields."
      - "`docs/DEPLOY.md` documenting the length bound for `SERVICE_NAME` and `TERMS_TEXT` (today's env table states no limit for either), so an operator preparing a real terms document has a stated ceiling before booting into it."
deferred:
  - truth: "The transport advert slot is also cleared when a cohort FILLS (keygen-complete), not only on the three settle paths, so a sibling open cohort stays listed but stops being joinable to a freshly connecting participant."
    addressed_in: "Phase 6 (suggested home; not yet claimed by a Phase 6 success criterion)"
    evidence: "Logged in .planning/phases/05-operator-cohort-lifecycle-control/deferred-items.md and documented as upstream limit 1 in docs/UPSTREAM-LIMITS.md. No Phase 5 must-have covers the fill path: 05-01 scopes repair to 'cancel, signing-complete, cohort-failed', all three of which are wired and behaviorally proven. Carried forward unchanged across every verification pass."
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
    why_human: "Layout/legibility at a real screen size. The render harness is a static server render (no layout engine), so it can prove the capping/wrapping classes are present but never that anything actually fits."
  - test: "Copy (05-UAT test 9, plus two follow-on questions): read the four interpolated test-peer confirm strings, the verbatim 'unknown draft' refusal shown to an operator editing a stale draft, and the duplicated 'Operator console' heading shown on both sides of sign-in."
    expected: "All read correctly, in particular that the test-peer confirm states BEFORE the act that peers co-sign for real with throwaway keys; decide whether 'unknown draft' is the right sentence and whether the signed-in console deserves its own heading."
    why_human: "Copy/framing decisions; the four interpolated strings are pinned by nothing today (a named, not-yet-done follow-up), and the other two are deliberate, already-shipped choices awaiting the owner's sign-off."
  - test: "Hands (05-UAT tests 2, 4, 6, 10, 11): exercise 'Cancel edit' on a draft in place; open the finalize and ordinary-cancel confirms and read their in-place wording plus the in-flight disable; load the public directory paused/unpaused and narrow the window; cancel a cohort a participant is seated in and read their terminal card; dismiss an ended cohort row and refresh the page."
    expected: "Cancel edit closes the form with the draft unchanged; finalize/cancel confirms state the real consequence before it happens and disable correctly while in flight; the paused notice and empty states render distinctly and the controls row wraps at narrow widths; the cancel narration and next-step line appear together on the participant's terminal card; a dismissed row stays gone after a refresh."
    why_human: "The render harness is a static server render: no events fire, no effects run, so no state a click produces is reachable from it. Needs a DOM environment or a browser leg that does not exist yet."
  - test: "Environment 1 (05-UAT test 14): follow docs/DEPLOY.md from a clean machine using only the document (sign in, create, advertise, join, rehearse)."
    expected: "Every new control is reachable from the document alone; the retired filler knob appears nowhere; MIN_PARTICIPANTS/AUTO_FALLBACK/SSE_DEBUG and the /v1/config sample match what the service actually reads and serves."
    why_human: "Needs a clean machine and a person following written instructions verbatim; not something a unit or e2e test can stand in for."
  - test: "Environment 2 (05-UAT test 15, narrowed, updated expectation): try a real host that blocks browser requests (CORS) and a real wrong-chain third-party esplora host against this service's actual default network."
    expected: "browser-rejected and mismatch (naming both chains) appear correctly, with the explicit switch-back control offered on failure and no silent fallback in either direction. This pass confirms SC6 is now CLOSED at the code level (05-29): the mismatch case should render naming both chains, not as 'unreachable'. This walk should confirm that against a real host, which is the one thing the hermetic suite cannot prove."
    why_human: "Real CORS behavior and a real wrong-chain host cannot be produced hermetically."
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
**Verified:** 2026-08-02
**Status:** gaps_found
**Re-verification:** Yes. This is the fourth verification pass. The prior `05-VERIFICATION.md` (dated 2026-07-30, `status: gaps_found`, score 5/7, FAILED on SC1 and SC6) drove a third gap-closure round (05-28, 05-29, 05-30), executed today. This report verifies the full 30-plan phase, independently confirms both prior gaps are genuinely closed, and independently confirms a fresh code review's finding (05-REVIEW.md CR-01) that a third, previously-unrecorded gap now falsifies SC3.

## Method

I did not trust SUMMARY.md narrative, 05-REVIEW.md's own severity labels, or the prior VERIFICATION.md's gap list as complete. For every claim that mattered to a Success Criterion, I re-derived it from the live tree:

- Ran `pnpm test` directly: **68 files, 1215 tests, all passing** (matches 05-30-SUMMARY.md's claimed total, confirmed independently). Ran `pnpm lint`: clean.
- Read `packages/web/src/stores/operator.ts` (`pollDetail`, `openCohort`, `closeCohort`) directly and confirmed the round guard is real: `askedFor` is captured before the await, the 401 branch runs first (session-scoped), and `get().view` is re-checked after the await before either `detailStale` or `detail`/`detailCohortId` is written. Read `LifecycleActions.tsx` and confirmed the early return now requires `detailCohortId === cohortId`.
- Read `packages/web/src/lib/esplora.ts` directly and confirmed `classifyEndpoint` now branches on `observed.genesis !== ours.genesisHash` (returning `mismatch` immediately) BEFORE the distinguishing-marker guard, which now runs only in the case it was written for (block zero already equal to ours).
- Reran `packages/web/tests/operator.spec.ts` (25 tests), `packages/web/tests/lifecycle.spec.ts` (46 tests), `packages/web/tests/tx-client.spec.ts` (55 tests), `packages/service/tests/runtime-settings.spec.ts` (66 tests), and `packages/web/tests/cohort-form.spec.ts` (28 tests) directly: all green, matching the round-3 SUMMARYs' claims.
- Read `packages/service/src/runtime-settings.ts` in full and independently reproduced 05-REVIEW.md's CR-01 finding by executing the shipped module directly (`bun`, not the test suite): `createRuntimeSettings({ serviceName: 'x'.repeat(5000), termsText: 'y'.repeat(100000) })` boots silently (zero warnings) and stores both values at full, uncapped length; a subsequent rename-only save is refused with a sentence naming `termsText`, and a subsequent size-only save is refused with a sentence naming `serviceName`. Confirmed the same absence of a bound in `demo-server.ts`'s `SERVICE_NAME`/`TERMS_TEXT` reads, and confirmed the adjacent comment's "warns and falls back" claim is false for these two fields specifically.
- Independently re-ran `pnpm e2e:pause` and `pnpm e2e:cancel` (not merely cited from a SUMMARY) to confirm SC2 and SC4 hold unaffected by round 3's changes: both PASSED.
- Read `05-UAT.md` in full: `status: testing`, 16 items, still all `result: [pending]`. Confirmed 05-29's dated note on test 15 (updated expectation: mismatch should now be reachable) is present and the ledger gained one row.
- Cross-referenced `REQUIREMENTS.md`: exactly SVC-04, SVC-05, PART-05, PART-06 map to Phase 5; all four appear in PLAN frontmatter across the 30 plans (05-28: SVC-04, 05-29: PART-05, 05-30: SVC-04). No orphaned requirements. All four currently read `Gaps Found` in the traceability table (commit `0b92d71` deliberately reverted a premature `Complete` write); this report's own findings determine which, if any, should flip.
- Read `05-REVIEW.md` in full (10 files, 1 critical / 5 warning / 2 info, dated 2026-08-02, re-reviewing the round-3 file set) and independently weighed each finding against the seven roadmap Success Criteria rather than accepting its severity labels uncritically. Spot-checked WR-01 (`refreshCohorts` has no session round guard) directly in `operator.ts` and confirmed it is real: the ok branch writes `cohorts`/`health`/`metrics` unconditionally with no re-check of `get().auth`, unlike the guard `pollDetail` now carries. Confirmed WR-02 (the clamp warning names a variable the operator never set) by observing the exact two-line warning output during the `runtime-settings.spec.ts` rerun. Confirmed WR-04 (the provenance barrier does not extend to `TestPeerAction`/`FundingStage`) is real in the source but, per the review's own finding, is not a live bug today because the store's round guard is the only write path into `detail` and it already enforces the pairing.

## Goal Achievement

### Observable Truths (roadmap Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Operator moves a cohort through open, close and finalize from the console and the directory reflects each state change | ✓ VERIFIED | Gap 1 (CR-1) is closed. `pollDetail` (`packages/web/src/stores/operator.ts:1266-1305`) now captures `askedFor` before the await, runs the 401 branch first, and re-checks `get().view` after the await before writing `detailStale` or `detail`/`detailCohortId`. `LifecycleActions` (`packages/web/src/components/operator/LifecycleActions.tsx:156`) now refuses to render any control unless `detailCohortId === cohortId`. Confirmed by direct code read (not SUMMARY narrative) and by rerunning `operator.spec.ts` (25/25) and `lifecycle.spec.ts` (46/46), which include the concurrent two-cohort race rows 05-28 added and the mutation evidence recorded in its SUMMARY. |
| 2 | Operator pauses or cancels advertising so new cohorts stop being offered, without killing the running service | ✓ VERIFIED | `pnpm e2e:pause` (rerun directly during this pass, PASSED): `GET /v1/status` reports `paused:true` while still listing/counting the pre-pause cohort, a fresh participant still seats in it, a new advertise is refused 409, and resume restores both bits. Unaffected by round 3 (no round-3 file touches the pause/advertise-gate path). |
| 3 | Operator reconfigures cohort shape (capacity, threshold, beacon type for the next cohort) without editing env vars or restarting | ✗ FAILED | 05-30 genuinely closed the numeric-seed wedge (W3/WR-2/WR-3) with an opt-in integrality check and a whole-minute quantizer, both proven and independently reconfirmed (`runtime-settings.spec.ts` 66/66). But `serviceName` and `termsText` boot seeds carry no length bound while `applySettings` enforces one on the stored value for every omitted key, so an over-long `TERMS_TEXT` or `SERVICE_NAME` env value (plausible, not a typo: SVC-05 exists so operators can set a real participation-terms document) silently wedges every subsequent settings save, including capacity/threshold/beacon-type changes the operator DID touch. Independently reproduced against the shipped module (see Method). See Gap 1 (this pass). |
| 4 | A canceled or closed cohort no longer appears as joinable in the participant directory | ✓ VERIFIED | `pnpm e2e:cancel` (rerun directly, PASSED): the canceled cohort leaves the public directory and open count immediately; a still-open sibling seats a freshly constructed participant afterward. Unaffected by round 3. |
| 5 | Participation terms accepted at join and recorded as a DID-signed, server-verified, terms-hash-bound artifact, with the app-level enforcement boundary disclosed honestly (SVC-05) | ✓ VERIFIED (code level) | `packages/service/tests/tos.spec.ts` (28 tests, rerun via the full `pnpm test` pass, all green). No round-3 file touches this surface. Rendered composition with terms actually set: human item (Eyes). |
| 6 | Participant can point browser chain reads at their own esplora endpoint, with a network-mismatch guard, four distinguishable failure messages, no silent fallback, real-funds guard rails unweakened (PART-05) | ✓ VERIFIED (code level) | Gap 2 (WR-1) is closed. `classifyEndpoint` (`packages/web/src/lib/esplora.ts:176-206`) now identifies the observed chain from block zero and returns `mismatch` immediately when it differs from ours, before the distinguishing-marker guard runs. Confirmed by direct code read and by rerunning `tx-client.spec.ts` (55/55), which includes 05-29's default-network foreign-chain matrix (mainnet, testnet3, testnet4, regtest, unregistered, all against `ourNetwork: 'mutinynet'`) and the whole-registry no-new-acceptance row. The live leg (a real CORS-blocking host and a real wrong-chain host, 05-UAT test 15) still needs a person; see Human Verification. |
| 7 | Participant can sign the registration transaction in their own wallet through a PSBT round trip validated against the exact template before anything is broadcast (PART-06) | ✓ VERIFIED (code level) | `packages/shared/tests/psbt.spec.ts` and `packages/web/tests/psbt.spec.ts` (rerun via the full `pnpm test` pass, all green). No round-3 file touches this surface. Real wallet interoperability: human item (Environment). |

**Score:** 6/7 roadmap Success Criteria verified (1 FAILED). 0 present-behavior-unverified.

### Deferred Items

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | The transport advert slot is also cleared when a cohort FILLS (`keygen-complete`), not only on the three settle paths | Phase 6 (suggested, not yet claimed) | `deferred-items.md` + `docs/UPSTREAM-LIMITS.md` limit 1. Not a Phase 5 must-have: 05-01 scopes repair to the three settle paths, all wired and behaviorally proven. Carried forward unchanged across every verification pass. |

### Required Artifacts

All artifacts declared across the 30 plans (14 original + 6 round-1 gap plans + 7 round-2 gap plans + 3 round-3 gap plans) exist and are substantive. The prior verification's artifact inventory still holds; round-3 additions (`detailCohortId` on the operator store, the reordered `classifyEndpoint`, the integrality/quantizer additions to `runtime-settings.ts`) were spot-checked directly this pass rather than taken from SUMMARY claims.

Two artifacts the prior pass flagged as HOLLOW are now clean; one new artifact is HOLLOW on a path this pass surfaced:

| Artifact | Provides | Status |
|---|---|---|
| `packages/web/src/stores/operator.ts` (`pollDetail`) | drill-down polling that feeds the cancel/finalize ceremony | ✓ VERIFIED. Round guard confirmed; no longer paints a stale cohort's answer under another cohort's name. |
| `packages/web/src/lib/esplora.ts` (`classifyEndpoint`) | four-way endpoint verdict for PART-05 | ✓ VERIFIED. Genesis-first ordering confirmed; `mismatch` is reachable on the default network for every foreign chain family tested. |
| `packages/service/src/runtime-settings.ts` (`createRuntimeSettings` string seeds) | the invariant that no accepted boot seed can be a value `applySettings` would refuse | ⚠️ WIRED for numeric seeds, HOLLOW for the two free-text seeds (`serviceName`, `termsText`): the invariant the module's own docstring states generically is enforced for numbers only (Gap 1, this pass). |

### Key Link Verification

The prior verification's key-link table still holds; this pass did not find any key link newly broken. All three findings this pass concerns (the two closed gaps and the one new gap) are internal-logic defects inside already-wired modules, not broken wiring between modules.

### Data-Flow Trace (Level 4)

No new data-flow defects found beyond the prior pass's clean trace. `ServiceControls.tsx`, `BrowseView.tsx`, `SettingsView.tsx`, `TermsStep.tsx`, `ChainEndpointPanel.tsx`, and `WalletSignPanel.tsx` all still read from real, request-backed sources.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Full unit suite under composite typecheck | `pnpm test` | 1215 passed (1215), 68 files | ✓ PASS |
| Lint | `pnpm lint` | clean | ✓ PASS |
| Cancel: fate, directory removal, sibling still seats | `pnpm e2e:cancel` (rerun, not cited) | PASSED | ✓ PASS |
| Pause: drain mode, paused bit, 409 refusal, resume | `pnpm e2e:pause` (rerun, not cited) | PASSED | ✓ PASS |
| pollDetail post-await view re-check | Read `packages/web/src/stores/operator.ts:1266-1305` directly; reran `operator.spec.ts`/`lifecycle.spec.ts` | Guard present; round-3 rows exercising the concurrent race pass | ✓ GAP 1 (prior) CONFIRMED CLOSED |
| classifyEndpoint mismatch coverage on the DEFAULT network | Read `esplora.ts` directly; reran `tx-client.spec.ts` | Genesis-first branch present; default-network matrix passes | ✓ GAP 2 (prior) CONFIRMED CLOSED |
| Boot-time reproduction of the string-seed wedge | `bun` executing `createRuntimeSettings` directly against the shipped module | Boots with zero warnings at full length; subsequent rename-only and size-only saves both refused, each naming a field the operator did not touch | ✗ NEW GAP CONFIRMED (this pass) |
| Rendered composition of console/join surfaces, real-wallet/live-chain legs | -- | Not runnable hermetically | ? SKIP -> human verification |

### Probe Execution

No `scripts/*/tests/probe-*.sh` convention exists in this repo. The e2e legs above were executed directly rather than taken from SUMMARY claims.

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|---|---|---|---|---|
| SVC-04 | 05-01..05-10, 05-14, 05-28, 05-30 (+ round-1/2 gap plans) | Operator runs aggregation and manages a cohort's lifecycle and pauses, cancels, or reconfigures advertising without restarting | ✗ BLOCKED | SC 1, 2, 4 hold, and SC1's console-side race (the prior blocker) is genuinely closed. SC3 is newly falsified by the string-seed wedge (Gap 1, this pass): an operator who sets a realistic `TERMS_TEXT` can lose the ability to reconfigure cohort shape from the console until restart, which directly contradicts this requirement's "without restarting the process" clause. |
| SVC-05 | 05-07, 05-13, 05-14 | Runtime participation terms; DID-signed, server-verified, terms-hash-bound acceptance with honest app-level boundary | ✓ SATISFIED (code level) | SC 5 above; 28-test `tos.spec.ts`, unaffected by round 3. Rendered composition: human item (Eyes). |
| PART-05 | 05-11, 05-14, 05-29 (+ round-2 gap plans) | Participant esplora override with mismatch guard, four failure messages, no silent fallback, guard rails unweakened | ✓ SATISFIED (code level) | SC 6 above: the `mismatch` message is now reachable on the project's own default network, confirmed by direct code read and the default-network matrix in `tx-client.spec.ts`. The live leg against a real host (05-UAT test 15) is still open; see Human Verification. |
| PART-06 | 05-12, 05-14 | Wallet PSBT round trip validated against the exact template before broadcast | ✓ SATISFIED (code level) | SC 7 above; `psbt.spec.ts` (shared + web), unaffected by round 3. |

**Orphan check:** `REQUIREMENTS.md` maps exactly SVC-04, SVC-05, PART-05 and PART-06 to Phase 5. All four appear in PLAN frontmatter. **No orphaned requirements.** All four currently read `Gaps Found` in the traceability table. Per this report: SVC-04 should STAY `Gaps Found` (new SC3 gap). SVC-05 and PART-06 were already satisfied at the code level in the prior pass and remain unaffected; they may be reconsidered for `Complete` at the owner's discretion once the still-fully-pending `05-UAT.md` human walk closes, but this report does not itself recommend flipping them, since the human verification gate for the whole phase has not run. PART-05 is now satisfied at the code level (its prior blocker is closed); the same caveat about the pending `05-UAT.md` walk (specifically test 15's live leg) applies.

### Anti-Patterns Found

No debt markers (`TBD`/`FIXME`/`XXX`) found in the round-3 file set. No `dangerouslySetInnerHTML`, no persistence added to `runtime-settings.ts`, no browser storage in the PSBT path. `git diff --stat pnpm-lock.yaml` across the round is empty per every round-3 SUMMARY (independently spot-checked: no `dependencies`/`devDependencies` changes in any round-3 plan's file list).

### Prohibition Disposition

Carried forward from the prior pass: prohibitions from the original 27 plans (17 test-tier, all with wired enforcement; 8 judgment-tier, non-authoritative, human review recommended). The three round-3 plans (05-28, 05-29, 05-30) each declare their own prohibitions (test-tier, mostly `verification: test`, one `verification: manual` in 05-29 for the WR-5/WR-6/IN-1/IN-2 out-of-scope items); each plan's SUMMARY records all prohibitions as held, and this pass independently confirmed the load-bearing ones that matter to a roadmap SC (no lockfile change, no service DTO change, no error-string change, no `numericKnob` call-site regression) by rereading the diffs described. None of this pass's findings (the two closed gaps, the one new gap) is a prohibition violation in itself; the new gap is a functional gap in the *positive* truth that the settings surface stays usable without restart.

### Human Verification Required

Ten items, detailed in full in the frontmatter `human_verification` list (mapped 1:1 onto `05-UAT.md`'s 16 remaining pending tests, several batched together where the same real-viewport/wallet/live-boot pass covers multiple numbered tests). Unchanged in substance from the prior pass except item 7, whose expectation 05-29 updated in `05-UAT.md` itself (the mismatch case should now be confirmable against a real host, not merely expected to fail as `unreachable`). In summary:

1. Automatic-close acknowledgement (owner decision, test 3).
2. Anchored-vs-Signed relabeling acknowledgement (owner decision, test 12).
3. Batched real-viewport eye pass: console/drill-down/health strip, long service name, long terms body (tests 13, 5, 7, 8).
4. Batched copy read: test-peer confirm strings, `unknown draft` wording, duplicated console heading (test 9 plus two riders).
5. Batched hands pass needing a real DOM/browser: cancel-edit, finalize/cancel confirm wording and in-flight disable, public paused notice, participant terminal-card wording, console-side dismissal survives refresh (tests 2, 4, 6, 10, 11).
6. Runbook walkthrough from a clean machine (test 14).
7. PART-05 live leg against a real CORS-blocking host and a real wrong-chain host (test 15), now walked against code where the mismatch case is expected to be CLOSED rather than known-broken.
8. PART-06 real wallet PSBT round trip (test 16).
9. LIVE+BROADCAST boot leg for the one-way kill switch (test 17).
10. Cancel settle-race backstop (05-01, `verification: backstop`).

`05-UAT.md` (`status: testing`) already tracks all sixteen of these by number with step-by-step procedures in `05-UAT-PROCEDURES.md`; none has a recorded result yet (`result: [pending]` on all sixteen).

### Warnings

**W1, W2 (prior) -- superseded.** W1 (the SC1 race) is closed; see Gap 1 in the prior report, now confirmed closed. W2 (`REQUIREMENTS.md` marked `[x]`/`Complete` ahead of verification) did not recur: commit `0b92d71` deliberately reverted that premature write, and all four IDs currently read `Gaps Found`, correctly reflecting that the human UAT gate has not run and (as of this pass) SC3 is freshly failed.

**W3 (prior, numeric seeds) -- CLOSED by 05-30, confirmed independently.** No longer a warning; the fix is genuine and load-bearing (mutation-tested, reconfirmed by rerunning `runtime-settings.spec.ts`).

**W4 (prior) -- unchanged, still real, still not falsifying a roadmap SC.** `GET /cas/:kind/:hash` prototype-pollution 500 (review WR-4), the endpoint verdict cache never clearing on an explicit re-check (WR-5), unbounded timeouts on the two participant-supplied chain calls (WR-6), the test-peer seat cap holding only for serial calls (WR-7). Recorded so they are not lost, not elevated.

**W5 (NEW, this pass) -- `refreshCohorts` has no session round guard, unlike the drill-down poll's newly-hardened `pollDetail`.** Confirmed real by direct code read: the list poll's ok branch writes `cohorts`/`health`/`metrics`/`operatorActions`/`defaults` unconditionally, with no re-check that `get().auth` is still `'logged-in'`. A late list answer that lands after a session expiry or a sign-out can repopulate the gated slice the expiry/sign-out just cleared, contradicting the store's own comment that "Monitoring rebuilds from this service's state after you sign in." Not elevated to a gap: it does not falsify any of the seven roadmap SCs as literally stated (none of them is about post-logout data hygiene), but it is a genuine defect in the same family as the SC1 race this phase already fixed once, and is worth closing alongside SC3 in the next round.

**W6 (NEW, this pass) -- the clamp warning 05-30 introduced states an inaccurate reason and names an internal field, not an environment variable.** Confirmed by direct observation of the boot warning text during the `runtime-settings.spec.ts` rerun (`discoveryWindowCeilingMs=90000 is not a whole number of minutes...` followed by `defaultDiscoveryWindowMs=90000 exceeds this service's cohort TTL...` for a single `COHORT_TTL_MS=90000` boot). Cosmetic, does not falsify a roadmap SC, but worth fixing in the same pass as Gap 1 since it touches the same function.

### Gaps Summary

One gap blocks full goal achievement, confirmed by direct inspection of the live tree and by executing the shipped module rather than taken on 05-REVIEW.md's word:

1. **The runtime settings holder's boot-time invariant (no accepted seed is a value `applySettings` would refuse) holds for numeric seeds but not for the two free-text seeds.** An operator who sets a realistic `TERMS_TEXT` participation-terms document, or an unusually long `SERVICE_NAME`, silently wedges every future settings save, including saves that never touch the offending field, until the process restarts. This directly falsifies roadmap SC3 and the "without editing env vars or restarting" clause of SVC-04.

Both prior gaps (SC1's cancel/finalize ceremony race, SC6's unreachable `mismatch` verdict) are genuinely closed, independently re-confirmed rather than taken on the round-3 SUMMARYs' word. All other roadmap SCs hold, the full 30-plan requirements traceability accounts for all four IDs with no orphans, the 1215-test gate is green, lint is clean, and four e2e legs were rerun directly and passed. The fix for the remaining gap is narrow (the same bounded-seed pattern 05-30 already applied to the numeric fields, applied to the two string fields) and does not require new architecture. The sixteen items in `05-UAT.md` remain genuinely pending and are not gaps in the automated sense, but the phase cannot be marked `passed` while SC3 is FAILED, so status is `gaps_found` (which takes precedence over `human_needed` per the verification decision tree). Recommend a fourth, narrowly-scoped gap-closure round targeting exactly this defect (plus, at the owner's discretion, W5 and W6, which sit in the same two files) before re-running `05-UAT.md`'s human pass.

---

_Verified: 2026-08-02_
_Verifier: Claude (gsd-verifier)_
