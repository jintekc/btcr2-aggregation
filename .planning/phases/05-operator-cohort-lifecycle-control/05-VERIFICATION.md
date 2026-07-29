---
phase: 05-operator-cohort-lifecycle-control
verified: 2026-07-29T15:05:00Z
status: human_needed
score: 7/7 roadmap Success Criteria verified at code level; 181 plan-level truths across 14 plans backed by 53/53 artifacts, 42/42 key links, and 27/27 declared specs passing
behavior_unverified: 0
overrides_applied: 0
gaps: []
deferred:
  - truth: "The transport advert slot is also cleared when a cohort FILLS (keygen-complete), not only on the three settle paths, so a sibling open cohort stays listed but stops being joinable to a freshly connecting participant."
    addressed_in: "Phase 6 (suggested home; NOT yet claimed by a Phase 6 success criterion)"
    evidence: "Logged in .planning/phases/05-operator-cohort-lifecycle-control/deferred-items.md and documented as upstream limit 1 in docs/UPSTREAM-LIMITS.md. No Phase 5 must-have covers the fill path: 05-01 scopes repair to 'cancel, signing-complete, cohort-failed', all three of which are wired and behaviorally proven. Phase 6 SC 1 (automated stranger-to-stranger loop in CI) plausibly surfaces it but does not name it."
behavior_unverified_items: []
human_verification:
  - test: "Walk 05-UAT-CHECKLIST.md 'SVC-04 criterion 1' and 'criterion 4': advertise a cohort, let it fill, finalize a stalled round, then cancel another cohort at rung 3 and at rung 4 (funded beacon, type-to-confirm)."
    expected: "The destructive-confirmation ladder renders as specified: rung 2 finalize states the k-of-n consequence, rung 3 names the short id and seated count, rung 4 requires typing the short id and states the recovery-key situation. In-flight labels hold, both buttons disable, a failure leaves the surface unchanged. Cancel is HIDDEN (not disabled) after broadcast."
    why_human: "Rendered composition of the ceremony ladder. Every predicate is unit-tested (packages/web/tests/lifecycle.spec.ts) and every route is behaviorally proven (pnpm e2e:cancel, pnpm e2e:fallback:operator), but no automated test renders the composed confirm panels."
  - test: "Confirm the automatic-close reading is acceptable: on the drill-down timeline, watch the Closed stage appear with its caption when the nth seat fills."
    expected: "Closed reads as an automatic lifecycle stage ('Every seat filled, so this cohort locked and stopped accepting joins.'), with no Close button anywhere on the console."
    why_human: "Deliberate divergence from the literal wording of roadmap SC 1 ('moves a cohort through open, close and finalize from the console'). CONTEXT D-01 locks close as an automatic nth-seat lock because no AggregationServiceRunner primitive exists and a partially filled n-of-n cohort that stopped accepting joins could never proceed. Owner acknowledgement of that re-reading is a judgment call, not a code check."
  - test: "Walk 'SVC-04 criterion 2': pause advertising from the Service controls card, then load the public directory both with open rows and with none."
    expected: "The controls card carries the restart-honesty line and the full-quiesce guidance. With open rows the paused notice sits ABOVE the still-rendering list; with no rows the empty-state body reads distinctly from the idle body. Controls row wraps on narrow widths."
    why_human: "Rendered composition and copy placement. The drain semantics and the served paused bit are behaviorally proven (pnpm e2e:pause) and the view predicate is unit-tested (packages/web/tests/service-controls.spec.ts), but the composed card and notice are not rendered by any test."
  - test: "Walk 'SVC-04 criterion 3': change beacon type, size, threshold and both windows on the settings surface; save with one invalid field; then save a very long SERVICE_NAME."
    expected: "Each field shows its source caption (env default vs changed this session with the env value). An invalid field renders its error and NO field is applied. A long service name saves and renders on both the console health strip and the public directory header without pushing chips off-screen, as plain escaped text."
    why_human: "Rendered composition plus the 05-07 backstop truth (unbounded operator-supplied service name overflow). Route semantics (401/413/400), all-or-nothing apply, and read-per-request are unit-tested and passing."
  - test: "Walk 'SVC-05': set TERMS_TEXT to a long document containing unbroken tokens and URLs, then join from the participant side at a narrow viewport height."
    expected: "The terms body scrolls inside its capped container, wraps unbroken tokens, never escapes the card, never renders as markup or a link, and the join controls stay reachable below it. The app-level enforcement caption is visible."
    why_human: "Two 05-13 backstop truths (long terms body overflow; join controls reachable at narrow viewport heights). Server-side verification, wrong-key refusal, terms-hash binding, no-listing-endpoint and no-oracle refusals are all unit-tested and passing (packages/service/tests/tos.spec.ts, 15 tests)."
  - test: "Walk 'PART-05' against real third-party esplora hosts: a wrong-chain endpoint, a host that blocks browser requests (no CORS), an unreachable host, and a non-https string."
    expected: "Four distinguishable messages (mismatch naming BOTH chains, browser-rejected, unreachable, malformed). No silent fallback in either direction: a failure states what happened and offers the explicit switch-back control."
    why_human: "Live-chain leg. Classification, https-only refusal, genesis-hash guard and the single-parameterized-call-site design are unit-tested (packages/web/tests/tx-client.spec.ts, 636 lines) but real CORS and real wrong-chain hosts cannot be exercised hermetically."
  - test: "Walk 'PART-06' with an actual desktop or hardware wallet: export the unsigned PSBT, sign it externally, return it, and broadcast."
    expected: "The wallet accepts the exported .psbt, the returned PSBT validates against the template, and the broadcast produces the same txid the local path would. A large pasted PSBT keeps its field scrolling internally without reflowing the step."
    why_human: "No wallet interoperability was verified in this environment (RESEARCH assumptions A1/A2), and the 05-14 prohibition correctly forbids claiming any specific wallet works. Plus the 05-12 backstop truth on large-PSBT field overflow. Template matching, the five verdicts, witness-free byte comparison and txid parity are all unit-tested and passing."
  - test: "Walk the 'Absorbed items' live-only sections: boot with LIVE=1 BROADCAST=1, engage Disable broadcast, and add test peers to a live cohort."
    expected: "Disable broadcast is offered only in that boot mode; after engaging, the health strip STILL reports the live boot mode with a separate warn chip beside it; no route turns broadcast back on. The test-peer confirm states BEFORE the act that the peers co-sign for real with throwaway keys."
    why_human: "Live-chain leg. The one-way guarantee, the advertise-timestamp mode selection for in-flight cohorts, the fail-closed default and the absence of a counterpart enable route are all unit-tested (packages/service/tests/kill-switch.spec.ts) and the hermetic peer path is behaviorally proven (pnpm e2e:testpeers), but the live confirm copy and live boot gating need a real LIVE+BROADCAST boot."
  - test: "Attempt to cancel a cohort at the instant its signing round completes (05-01 settle-race backstop)."
    expected: "The click is answered 404 with nothing changed, and the console never shows two ended records for one cohort id."
    why_human: "A timing race that cannot be reliably driven from a test harness. The 05-01 plan classified it 'verification: backstop' for exactly this reason."
---

# Phase 5: Operator Cohort Lifecycle Control Verification Report

**Phase Goal:** The operator runs aggregation and manages a cohort lifecycle (open, then close, then finalize) and pauses, cancels, or reconfigures advertising from the console, without restarting the process, removing the last hardwired uncontrollable behavior.
**Verified:** 2026-07-29
**Status:** human_needed
**Re-verification:** No, initial verification.

## Method

Initial verification (no prior `05-VERIFICATION.md`). I read all 14 PLAN.md frontmatters (must_haves: truths, prohibitions, artifacts, key_links), `REQUIREMENTS.md`, the ROADMAP Phase 5 section, `05-UAT-CHECKLIST.md`, and `deferred-items.md`. I did **not** stop at SUMMARY narrative: I ran the gate myself and grepped the live tree for every claimed route, predicate, guard and deletion.

Commands run directly, not taken from SUMMARY claims:

| Check | Result |
|---|---|
| `pnpm test` (composite `tsc -b` + vitest) | **969 passed (969), 60 test files** |
| `pnpm lint` | clean, exit 0 |
| `pnpm -r build` (includes `tsc --noEmit` + `vite build` for web) | green, exit 0 |
| `pnpm e2e:cancel` | PASSED |
| `pnpm e2e:pause` | PASSED |
| `pnpm e2e:testpeers` | PASSED |
| `pnpm e2e:fallback:operator` | PASSED |
| `pnpm e2e:browser:operator` (regression capstone) | PASSED |
| `pnpm e2e:browser:participant` (regression capstone) | PASSED |

Note on MVP mode: ROADMAP marks this phase `Mode: mvp`, but the goal is authored as goal-text rather than a User Story. This matches the precedent set by `04-VERIFICATION.md` (same project, same mode, verified against goal text and Success Criteria). The seven roadmap Success Criteria are treated as the contract.

## Goal Achievement

### Observable Truths (roadmap Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Operator moves a cohort through open, close and finalize from the console and the directory reflects each state change | ✓ VERIFIED | Finalize behaviorally proven end to end by `pnpm e2e:fallback:operator`: an operator advertised a k-of-n cohort, a co-signer dropped, and `POST /v1/operator/cohorts/:id/finalize` anchored it on the ADR 042 script path with the automatic stall timer still 60s away; refusals honest (401 anonymous, 409 pre-signing with no library string in the body). `finalizeCohort` pre-guards on `FINALIZABLE_PHASES` (`packages/shared/src/phases.ts`), shared by client (`packages/web/src/lib/lifecycle.ts`) and server. Close is the automatic nth-seat lock narrated as a timeline stage (`OperatorStageTimeline.tsx:46,60`), per locked CONTEXT D-01, not a button. See human item 2. |
| 2 | Operator pauses or cancels advertising so new cohorts stop being offered, without killing the running service | ✓ VERIFIED | `pnpm e2e:pause` PASSED: `GET /v1/status` reported `paused:true` while still listing and counting the pre-pause cohort, a freshly constructed participant still seated in it, a new advertise was refused 409 leaving the draft intact, and resume restored both bits. Gate is at exactly the two `runner.advertiseCohort` call sites (`operator-cohorts.ts`, `settings.paused`); paused bit and advertise gate share one derivation. Resolve/CAS/funding/monitoring untouched. |
| 3 | Operator reconfigures cohort shape (capacity, threshold, beacon type for the next cohort) without editing env vars or restarting | ✓ VERIFIED | `updateDraft` in `operator-cohorts.ts` with create-identical validation; `packages/service/tests/draft-edit.spec.ts` includes "carries the edited shape into the ADVERTISED cohort, so the edit really took" and "refuses an ADVERTISED cohort and leaves its served shape unchanged". Settings path: `applySettings` (all-or-nothing, `runtime-settings.ts:434`) behind gated `GET`/`PUT /v1/operator/settings` with 401/413/400 semantics tested. `GET /v1/config` reads the holder per request ("reads the holder PER REQUEST, so a runtime change is reflected on the very next read"). |
| 4 | A canceled or closed cohort no longer appears as joinable in the participant directory | ✓ VERIFIED | `pnpm e2e:cancel` PASSED: the canceled cohort left the public directory and the open count immediately, was filed with its own canceled fate and neutral chip (never a failure), and a still-open sibling seated a FRESHLY constructed participant afterwards (advert-slot repair). Closed/full: `isJoinable` (`packages/web/src/lib/directory.ts:55`) is Advertised-tier AND free-seat only; a full cohort renders `Full`, display-only. `openCount` narrows `directory()` to `OPEN_PHASES` so the public number and the join gate cannot drift. |
| 5 | Participation terms accepted at join and recorded as a DID-signed, server-verified, terms-hash-bound artifact, with the app-level enforcement boundary disclosed honestly | ✓ VERIFIED (code level) | `packages/service/tests/tos.spec.ts` (15 tests, all passing): refuses a signature made by a DIFFERENT key and stores nothing; refuses a terms hash not matching CURRENT terms; refuses an EXTRA field; refuses an oversized body before parsing; answers every refusal with the byte-SAME body (not an existence oracle); "appears on NO listing endpoint". Verification order in `hono-adapter.ts` is explicit and store-last. Client signs with its own key (`participant.ts:926`, schnorr) and posts only record + signature. Boundary copy pinned in `terms.spec.ts` ("states the app-level limit rather than claiming protocol enforcement") and in `docs/DEPLOY.md:314`. Rendered step with terms set: human item 5. |
| 6 | Participant can point browser chain reads at their own esplora endpoint, with a network-mismatch guard, four distinguishable failure messages, no silent fallback, real-funds guard rails unweakened | ✓ VERIFIED (code level) | Four distinct kinds in `packages/web/src/lib/esplora.ts:57-61`: `mismatch` (naming both chains), `browser-rejected`, `unreachable`, `malformed`. https-only refused before any request (`esplora.ts:82`). `packages/web/tests/tx-client.spec.ts` (636 lines) proves the proxy path is byte-identical without an endpoint, the direct path is the SAME function with a parameter, broadcast stays on the service while the second opt-in is off, and an empty direct answer is refused rather than inventing a txid. No fallback branch exists: one URL choice, shared error handling. Live endpoints: human item 6. |
| 7 | Participant can sign the registration transaction in their own wallet through a PSBT round trip validated against the exact template the app created before anything is broadcast | ✓ VERIFIED (code level) | `validateSignedPsbt` (`packages/web/src/lib/psbt.ts`) compares `bytesToHex(tx.unsignedTx)` against the template, never raw hex, in a fixed order (parse, template match, signature presence, fee band, finalize) with five discriminated verdicts. `packages/shared/tests/psbt.spec.ts` proves "reproduces the SAME transaction id as the fully local path" AND "produces DIFFERENT raw hex from the local path, which is why raw hex must never be compared". `packages/web/tests/psbt.spec.ts` proves each verdict and "never throws, for any input". Broadcast routes through the same `broadcastTx` call site. Real wallet: human item 7. |

**Score:** 7/7 roadmap Success Criteria verified at code level (0 present-behavior-unverified).

**Plan-level truths:** 181 declared across the 14 plans (including 6 `verification: backstop` truths, which abstain by design and are routed to human verification per items 1, 4, 5, 7 and 9). Every declared artifact, key link and spec backing those truths was checked; see the tables below.

### Deferred Items

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | The transport advert slot is also cleared when a cohort FILLS (`keygen-complete`), not only on the three settle paths | Phase 6 (suggested, not yet claimed) | `deferred-items.md` + `docs/UPSTREAM-LIMITS.md` limit 1. Not a Phase 5 must-have: 05-01 scopes repair to "cancel, signing-complete, cohort-failed", and all three are wired (`repairAdvertSlot` at `operator-cohorts.ts:968`, `:989`, `:1283`) and behaviorally proven. See Warning W1. |

### Required Artifacts

All 53 artifacts declared across the 14 plans exist, are substantive, carry their declared `contains` symbol, and are wired. Full results below (line counts from the live tree).

| Artifact | Provides | Status |
|---|---|---|
| `packages/service/src/cohort-intent.ts` (97) | intent registry, declare before `stopCohort` | ✓ VERIFIED |
| `packages/service/src/advert-republish.ts` (114) | advert-slot repair | ✓ VERIFIED |
| `packages/service/src/operator-cohorts.ts` (1435) | cancel / finalize / updateDraft / paused gate | ✓ VERIFIED |
| `packages/service/src/monitor.ts` (1630) | `noteCanceled`, `dismissEnded`, actions ring, `testPeer` badge | ✓ VERIFIED |
| `packages/service/src/runtime-settings.ts` (523) | env-seeded in-memory holder, `applySettings` | ✓ VERIFIED |
| `packages/service/src/test-peers.ts` (398) | bounded spawner with teardown | ✓ VERIFIED |
| `packages/service/src/hono-adapter.ts` (1348) | all gated lifecycle routes + public `cohort-fate` | ✓ VERIFIED |
| `packages/shared/src/phases.ts` (109) | `FINALIZABLE_PHASES` | ✓ VERIFIED |
| `packages/shared/src/tos.ts` (192) | `TermsAcceptance` canonical shape | ✓ VERIFIED |
| `packages/shared/src/networks.ts` (240) | per-network genesis hashes | ✓ VERIFIED |
| `packages/web/src/lib/lifecycle.ts` (190) | `cancelAvailability` / rung predicates | ✓ VERIFIED |
| `packages/web/src/lib/esplora.ts` (287) | `probeChain` + four-kind classification | ✓ VERIFIED |
| `packages/web/src/lib/psbt.ts` (119) | `validateSignedPsbt`, five verdicts | ✓ VERIFIED |
| `packages/web/src/lib/cohort-fate.ts` (71) | anonymous fate client | ✓ VERIFIED |
| `packages/web/src/ui/primitives.tsx` (432) | `ConfirmPanel`, `TextArea` | ✓ VERIFIED |
| `packages/web/src/components/operator/LifecycleActions.tsx` (261) | drill-down Lifecycle section | ✓ VERIFIED (mounted at `CohortDetail.tsx:369`) |
| `packages/web/src/components/operator/ServiceControls.tsx` (334) | pause/resume, kill switch, actions log | ✓ VERIFIED (mounted at `OperatorConsole.tsx:102,116,127`) |
| `packages/web/src/components/operator/SettingsView.tsx` (375) | third console view | ✓ VERIFIED (mounted at `OperatorConsole.tsx:117`) |
| `packages/web/src/components/operator/DraftEditForm.tsx` (231) | in-place draft edit | ✓ VERIFIED (mounted at `OperatorCohortList.tsx:260`) |
| `packages/web/src/components/operator/OperatorStageTimeline.tsx` (221) | automatic Closed stage, terminal Canceled | ✓ VERIFIED |
| `packages/web/src/components/browse/TermsStep.tsx` (136) | terms join step | ✓ VERIFIED (mounted at `JoinIdentityStep.tsx:122`) |
| `packages/web/src/components/browse/BrowseView.tsx` (179) | public paused notice | ✓ VERIFIED |
| `packages/web/src/components/cohort/ChainEndpointPanel.tsx` (174) | chain endpoint disclosure | ✓ VERIFIED (mounted at `CohortPage.tsx:248`) |
| `packages/web/src/components/cohort/WalletSignPanel.tsx` (306) | PSBT round trip | ✓ VERIFIED (mounted at `CompletionSummary.tsx:354`) |
| `docs/adr/0017-runtime-lifecycle-control.md` (212) | architectural record | ✓ VERIFIED (names `cohort-intent`) |
| `docs/UPSTREAM-LIMITS.md` (139) | consolidated upstream limits incl. seat release | ✓ VERIFIED |
| `05-UAT-CHECKLIST.md` | owner-facing checklist for all four requirements | ✓ VERIFIED (sections for SVC-04 crit 1-4, SVC-05, PART-05, PART-06) |
| 27 declared spec files (`packages/*/tests/*.spec.ts`, `e2e/*.ts`) | see Behavioral Spot-Checks | ✓ ALL EXIST, ALL PASS |

### Key Link Verification

42 key links declared across 14 plans. 38 matched their declared pattern directly. 4 did not match the literal pattern and were traced manually; all 4 are wired under a different symbol name, none is broken.

| From | To | Via | Status |
|---|---|---|---|
| `operator-cohorts.ts` | `cohort-intent.ts` | `intents.declare` before `stopCohort`, read in reject branch | ✓ WIRED (3 hits) |
| `operator-cohorts.ts` | `monitor.ts` | `noteCanceled` at event time | ✓ WIRED |
| `operator-cohorts.ts` | `advert-republish.ts` | `repairAdvertSlot` on all three settle paths | ✓ WIRED (`:968`, `:989`, `:1283`) |
| `hono-adapter.ts` | `operator-cohorts.ts` | gated cancel / finalize / PATCH / settings / test-peers / dismiss routes | ✓ WIRED |
| `operator-cohorts.ts` | `shared/phases.ts` | `finalizeCohort` pre-guards `FINALIZABLE_PHASES` | ✓ WIRED (4 hits) |
| `web/lib/lifecycle.ts` | `shared/phases.ts` | same phase set the server guards on | ✓ WIRED (3 hits) |
| `operator-cohorts.ts` | `runtime-settings.ts` | `settings.paused` at the two advertise call sites; `status()` reports the same value | ✓ WIRED |
| `index.ts` | `runtime-settings.ts` | signing-complete handoff consults `broadcastDisabled` + advertise timestamp | ✓ WIRED (4 hits) |
| `index.ts` | `cohort-intent.ts` | `window-expired` declared before `stopCohort` | ✓ WIRED |
| `test-peers.ts` | `index.ts` | shared stop signal / abort teardown | ✓ WIRED (11 hits) |
| `web/stores/participant.ts` | `web/lib/tx-client.ts` | endpoint threaded as a parameter into the ONE UTXO read and ONE broadcast | ✓ WIRED (10 hits) |
| `docs/DEPLOY.md` | `docker-compose.yml` | every new env var documented with the same default | ✓ WIRED |
| `demo-server.ts` | `runtime-settings.ts` | boot env seeds the holder | ✓ WIRED (indirect) — pattern `createRuntimeSettings\|runtimeSettings` absent from `demo-server.ts`, but `demo-server.ts:396-524` reads `SERVICE_NAME`, `DEFAULT_BEACON_TYPE`, `DEFAULT_SIZE`, `TERMS_TEXT` (NaN-guarded via imported `numericKnob`) and passes them into `createService`, which calls `createRuntimeSettings` at `index.ts:658`. Seam is real; pattern was written against the wrong file. |
| `DraftEditForm.tsx` | `stores/operator.ts` | PATCH + inline server refusal | ✓ WIRED (indirect) — the store action is `saveDraftEdit` (`DraftEditForm.tsx:120,146` → `stores/operator.ts:897` → `apiUpdateDraft` → `lib/operator.ts:218`), not a symbol literally named `updateDraft` in the component. |
| `WalletSignPanel.tsx` | `web/lib/psbt.ts` | returned PSBT validated before any broadcast is offered | ✓ WIRED (indirect) — validation runs in the store (`stores/participant.ts:60` imports `validateSignedPsbt`, called at `:2568` inside `submitSignedPsbt`); the panel consumes the resulting `psbtVerdict` and calls `submitSignedPsbt` at `:170`. Broadcast stays disabled unless the verdict is ok. |
| `TermsStep.tsx` | `stores/participant.ts` | participant signs canonical acceptance bytes before join proceeds | ✓ WIRED (indirect) — the store owns `acceptTerms` (`:428` declared, `:1560` implemented) and signs at `:926`; the component reads `termsAcceptance` / `termsAccepting` / `termsError` slices and the join gate lives in the store (`:1636`). |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|---|---|---|---|---|
| `ServiceControls.tsx` | `paused`, `broadcastDisabled` | polled `GET /v1/status` / gated health read via `stores/operator.ts` | Yes, same derivation the server enforces on | ✓ FLOWING |
| `BrowseView.tsx` | `paused` | served status bit via `stores/participant.ts` (never inferred from an empty directory) | Yes | ✓ FLOWING |
| `LifecycleActions.tsx` | availability, rung | pure predicates over the polled detail DTO (`lib/lifecycle.ts`) | Yes | ✓ FLOWING |
| `SettingsView.tsx` | every field + source caption | gated `GET /v1/operator/settings`, holder read per request | Yes | ✓ FLOWING |
| `CohortDetail.tsx` | members, test-peer badge | gated detail projection, badge from per-service DID set | Yes (proven by `e2e:testpeers`: all 3 seated members read badged) | ✓ FLOWING |
| `TermsStep.tsx` | `termsText`, `termsAcceptance` | `GET /v1/config` additive terms field + posted acceptance hash | Yes | ✓ FLOWING |
| `ChainEndpointPanel.tsx` | endpoint, `broadcastDirect` | participant store, threaded into `tx-client` | Yes | ✓ FLOWING |
| `WalletSignPanel.tsx` | `psbtBase64`, `psbtVerdict` | `exportPsbt` from the shared template builder; verdict from `validateSignedPsbt` | Yes | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Full unit suite under composite typecheck | `pnpm test` | 969 passed (969), 60 files | ✓ PASS |
| Linter | `pnpm lint` | exit 0, clean | ✓ PASS |
| Production build incl. web | `pnpm -r build` | exit 0, `vite build` green | ✓ PASS |
| Cancel: fate, directory removal, sibling still seats, anonymous non-oracle fate read | `pnpm e2e:cancel` | PASSED | ✓ PASS |
| Pause: drain mode, paused bit, 409 refusal, resume | `pnpm e2e:pause` | PASSED | ✓ PASS |
| Test peers: seat cap, badging, co-sign to completion, zero peers after settle | `pnpm e2e:testpeers` | PASSED | ✓ PASS |
| Finalize: operator-driven k-of-n fallback via the gated route, 401/409 honesty | `pnpm e2e:fallback:operator` | PASSED | ✓ PASS |
| Operator console regression (sign-in → create → advertise → drill-down) | `pnpm e2e:browser:operator` | PASSED | ✓ PASS |
| Participant flow regression (browse → join → submit → co-sign → resolve) | `pnpm e2e:browser:participant` | PASSED | ✓ PASS |
| Kill-switch invariants (in-flight cohorts keep boot mode, one-way, fail-closed, no enable route) | `kill-switch.spec.ts` enumerated + run in suite | 14 named tests incl. "registers NO counterpart route that turns broadcast back on" | ✓ PASS |
| Discovery-window ordering (`window-expired` declared BEFORE `stopCohort`; cleanup on all settle paths) | `discovery-window.spec.ts` enumerated + run in suite | 20 named tests | ✓ PASS |
| Test-peer teardown invariants (on settle, on stopAll, on abort, idempotent) | `test-peers.spec.ts` enumerated + run in suite | 22 named tests | ✓ PASS |
| Terms server-side verification (wrong key, wrong hash, extra field, no listing endpoint, uniform refusal) | `tos.spec.ts` enumerated + run in suite | 15 named tests | ✓ PASS |
| PSBT round trip (txid parity, raw hex differs, witness-free compare, never throws) | `psbt.spec.ts` (shared + web) enumerated + run in suite | 17 named tests | ✓ PASS |
| Rendered composition of new Phase 5 surfaces | — | no test renders them | ? SKIP → human items 1, 3, 4, 5 |
| Live esplora endpoint / real wallet / LIVE+BROADCAST boot | — | needs real chain and real wallet | ? SKIP → human items 6, 7, 8 |

### Probe Execution

No `scripts/*/tests/probe-*.sh` convention exists in this repo and no PLAN or SUMMARY declares a probe. The equivalent runnable checks are the e2e legs above, which were executed directly rather than taken from SUMMARY claims.

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|---|---|---|---|---|
| SVC-04 | 05-01…05-10, 05-14 | Operator runs aggregation and manages a cohort's lifecycle and pauses, cancels, or reconfigures advertising without restarting | ✓ SATISFIED | SC 1-4 above; four e2e legs PASSED |
| SVC-05 | 05-07, 05-13, 05-14 | Runtime participation terms; DID-signed, server-verified, terms-hash-bound acceptance with honest app-level boundary | ✓ SATISFIED (code level) | SC 5 above; `tos.spec.ts` 15 tests; boundary in `docs/DEPLOY.md:314` + pinned copy |
| PART-05 | 05-11, 05-14 | Participant esplora override with mismatch guard, four failure messages, no silent fallback, guard rails unweakened | ✓ SATISFIED (code level) | SC 6 above; `tx-client.spec.ts` 636 lines |
| PART-06 | 05-12, 05-14 | Wallet PSBT round trip validated against the exact template before broadcast | ✓ SATISFIED (code level) | SC 7 above; `shared/tests/psbt.spec.ts` + `web/tests/psbt.spec.ts` |

**Orphan check:** `REQUIREMENTS.md` maps exactly SVC-04, SVC-05, PART-05 and PART-06 to Phase 5. All four appear in PLAN frontmatter. **No orphaned requirements.**

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| — | — | `TBD` / `FIXME` / `XXX` across `packages/*/src`, `e2e/`, phase docs | — | **None found.** Debt-marker gate clean. |
| `ChainEndpointPanel.tsx` | 32, 123 | `FIELD_PLACEHOLDER` | ℹ️ Info | HTML `placeholder` attribute on the endpoint input. Not a stub. |
| `shared/src/index.ts` | 86, 103-177 | `GENESIS_PLACEHOLDER` | ℹ️ Info | `did:btcr2:_` domain constant for pre-DID genesis document construction. Not a stub. |
| `packages/web/src` | — | `dangerouslySetInnerHTML` / `innerHTML` | ℹ️ Info | **Zero occurrences.** The 05-07 and 05-13 XSS prohibitions hold structurally: operator-supplied terms and service name can only render as auto-escaped React text children. |
| `runtime-settings.ts` | — | `writeFile` / `fs.` / `persist` | ℹ️ Info | **Zero occurrences.** The 05-04 no-persistence prohibition holds; the only match is the comment declaring the absence deliberate. |
| `psbt.ts`, `WalletSignPanel.tsx` | — | `localStorage` / `sessionStorage` / `indexedDB` | ℹ️ Info | **Zero occurrences.** The 05-12 ephemerality prohibition is a fact, not a claim. |
| `docs/`, `packages/*/src` | — | named wallet / "compatible with" | ℹ️ Info | No wallet compatibility claim ships. The 05-14 prohibition holds. |

### Prohibition Disposition

25 prohibitions declared across the 14 plans: 17 `verification: test`, 8 `verification: judgment`.

**Test-tier (17): all have wired enforcement.** Spot-verified structurally rather than trusted: no runtime path enables broadcast (`runtime-settings.ts:430` is the sole mutator, sole route is `/v1/operator/broadcast/disable` at `hono-adapter.ts:813`, and `kill-switch.spec.ts` asserts "registers NO counterpart route that turns broadcast back on" and "keeps the flag out of the settings SET"); no persistence; no browser storage; no `dangerouslySetInnerHTML`; pause never retracts (`e2e:pause`); a cancel is never narrated as a stall (`terminal-reason.spec.ts`, cancel fact is a dedicated boolean checked before the stall branch); the fate read is not an existence oracle (`cohort-fate.spec.ts`, plus `tos.spec.ts` "answers every refusal with the byte-SAME body"); an advertised cohort's shape cannot change (`draft-edit.spec.ts`); an over-long window is refused, never truncated (`discovery-window.spec.ts`); a tampered PSBT is rejected before broadcast (`psbt.spec.ts`). All backing tests pass.

**Judgment-tier (8): recorded as a NON-AUTHORITATIVE LLM-judge reading — human review recommended.** My reading is that all 8 hold (no control exists without a backing library primitive: there is no Close button, no un-advertise verb, no per-seat kick; danger tone is never the sole carrier of meaning; no friction on reversible pause/resume; test peers are framed as rehearsal with no auto-fill or boot-time filler loop; the live-peer confirm states peers co-sign for real; terms are never presented as protocol-enforced; wallet signing never implies MuSig2 coverage; docs describe only what shipped). This is a judgment call on copy and framing, so it belongs in the owner's UAT pass, not in an automated verdict.

### Human Verification Required

Nine items, listed in full in the frontmatter. In summary:

1. **Lifecycle ceremony ladder rendered** (rungs 2/3/4, in-flight and error states, post-broadcast replacement copy).
2. **Automatic-close acknowledgement** — the one deliberate divergence from the literal wording of roadmap SC 1.
3. **Service controls card + public paused notice** (paused-vs-idle empty state, wrap at narrow widths).
4. **Settings surface rendered** + long-service-name overflow backstop.
5. **Terms step with terms actually set** + two long-terms-body backstops.
6. **PART-05 live leg** against real third-party esplora hosts.
7. **PART-06 real wallet round trip** (no interop verified in this environment) + large-PSBT backstop.
8. **LIVE+BROADCAST boot leg** for the one-way switch and the live test-peer confirm copy.
9. **Cancel settle-race backstop.**

All nine are already scoped in `05-UAT-CHECKLIST.md`, which carries sections for SVC-04 criteria 1-4, the absorbed items, PART-05, PART-06 and SVC-05, and marks the two live-only legs.

### Warnings

**W1 — the advert-slot-on-fill defect has no committed home.** `deferred-items.md` and `docs/UPSTREAM-LIMITS.md` limit 1 both document that `#stopAdvertRepeating` also runs at `keygen-complete`, so when one open cohort FILLS, a sibling open cohort stays listed in the public directory yet delivers no `COHORT_ADVERT` to a freshly connecting participant. This is not a Phase 5 must-have failure: 05-01 explicitly scopes repair to the three settle paths, all of which are wired and behaviorally proven, and the defect is pre-existing and upstream. But it is a real two-sided-loop hazard for any operator running more than one cohort at a time, and no Phase 6 success criterion names it. **Recommend explicitly adding it to the Phase 6 plan set** (the repair machinery in `advert-republish.ts` already exists; only the `keygen-complete` trigger and its slot-ownership bookkeeping are new) rather than leaving it as a suggestion in a phase-local file.

**W2 — `REQUIREMENTS.md` already marks all four IDs `[x]` / `Complete` before the human UAT gate has run.** SVC-04, SVC-05, PART-05 and PART-06 are checked off and the traceability table reads `Complete`. Given that this phase deliberately routes rendered composition and two live-chain legs to the owner's UAT pass, that bookkeeping is ahead of the evidence. Prior phases in this project marked requirements `Validated` only after the owner's live-UAT gate (Phase 4 needed three gap-closure rounds after its checklist ran). Suggest holding the `Validated` transition until `05-UAT-CHECKLIST.md` is signed off.

### Gaps Summary

**No gaps.** Every declared artifact exists, is substantive, carries its declared symbol, and is wired into a mounted surface with real data flowing. Every declared key link resolves (four via a differently named seam, traced and confirmed). All 27 declared spec files exist and pass inside a 969-test suite gated by the composite typecheck. The four e2e legs this phase added all pass, and they behaviorally prove the load-bearing state-transition and cleanup invariants: cancel removes a cohort from the directory and repairs the advert slot so a sibling still seats a fresh participant; pause drains rather than kills and resume restores; the operator finalizes a stalled k-of-n round through the gated route before the automatic timer; and every spawned test peer is torn down when its cohort settles. Both browser capstones still pass, so the Phase 5 insertions into the participant and operator flows caused no regression.

What is left is exactly what the phase said it was leaving: the rendered composition of the new console and join surfaces, the two live-chain legs, and six `verification: backstop` truths that abstain by design. Those are human verification items, not gaps. Status is `human_needed`, and the phase should not be marked Validated until `05-UAT-CHECKLIST.md` is walked and signed.

---

_Verified: 2026-07-29_
_Verifier: Claude (gsd-verifier)_
