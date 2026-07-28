---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
current_phase: 05
current_phase_name: operator-cohort-lifecycle-control
status: executing
stopped_at: Completed 05-03-PLAN.md
last_updated: "2026-07-28T23:31:14.509Z"
last_activity: 2026-07-28
last_activity_desc: Phase 05 execution started
progress:
  total_phases: 5
  completed_phases: 4
  total_plans: 44
  completed_plans: 33
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-22)

**Core value:** A stranger can self-host a real aggregation service that advertises cohorts, and another stranger can point a participant at that service's URL, browse its cohorts, join, co-sign, and resolve - a genuinely two-sided, self-hostable product, not a demo.
**Current focus:** Phase 05 — operator-cohort-lifecycle-control

## Current Position

Phase: 05 (operator-cohort-lifecycle-control) — EXECUTING
Plan: 4 of 14
Status: Ready to execute
Last activity: 2026-07-28 — Phase 05 execution started

Progress: [████████░░] 75%

## Performance Metrics

**Velocity:**

- Total plans completed: 30
- Average duration: - min
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1 | 4 | - | - |
| 02 | 9 | - | - |
| 3 | 9 | - | - |
| 04 | 8 | - | - |

**Recent Trend:**

- Last 5 plans: -
- Trend: -

*Updated after each plan completion*
| Phase 01 P01 | 11 | 3 tasks | 15 files |
| Phase 01 P02 | 6min | 2 tasks | 9 files |
| Phase 01 P03 | 13 min | 3 tasks | 10 files |
| Phase 01 P04 | 8m | 1 tasks | 2 files |
| Phase 02 P01 | 14 min | 2 tasks | 4 files |
| Phase 02 P02 | 5 min | 3 tasks | 8 files |
| Phase 02 P03 | 12min | 1 tasks | 3 files |
| Phase 02 P04 | 2 min | 2 tasks | 4 files |
**Per-Plan Metrics:**

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 02 P05 | 6min | 3 tasks | 7 files |
| Phase 02 P06 | 18min | 3 tasks | 9 files |
| Phase 02 P07 | 10min | 2 tasks | 7 files |
| Phase 02 P08 | 12min | 3 tasks | 16 files |
| Phase 02 P09 | 7min | 2 tasks | 3 files |
| Phase 03 P01 | 8 min | 2 tasks | 2 files |
| Phase 03 P02 | 6min | 2 tasks | 4 files |
| Phase 03 P03 | 9min | 2 tasks | 2 files |
| Phase 03 P04 | 24 min | 3 tasks | 6 files |
| Phase 03 P05 | 21min | 3 tasks | 12 files |
| Phase 03 P06 | 20 min | 3 tasks | 13 files |
| Phase 03 P07 | 3 min | 3 tasks | 3 files |
| Phase 03 P08 | 5 min | 3 tasks | 4 files |
| Phase 03 P09 | 1 min | 2 tasks | 3 files |
| Phase 04 P01 | 13 min | 2 tasks | 10 files |
| Phase 04 P02 | 40 min | 2 tasks | 19 files |
| Phase 04 P03 | 18min | 2 tasks | 13 files |
| Phase 04 P04 | 35min | 3 tasks | 8 files |
| Phase 04 P05 | 15min | 3 tasks | 7 files |
| Phase 04 P06 | 35min | 3 tasks | 13 files |
| Phase 04 P07 | 22min | 3 tasks | 8 files |
| Phase 04 P08 | 3 days elapsed (checkpoint-dominated) | 3 tasks | 32 files |
| Phase 05 P01 | 24 min | 2 tasks | 12 files |
| Phase 05 P02 | 22 min | 2 tasks | 11 files |
| Phase 05 P03 | 20 min | 2 tasks | 16 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work (Phase 2):

- [Phase 02] Two-field k-of-n cohort shape: n seats that ALL join before start (min == max == n, no phantom seat), k = the ADR-042 script-path fallbackThreshold (1 <= k <= n, default k = n); DTO flipped threshold=k / capacity=n at all four emit sites; honest cosignValue/cosignCaption copy (02-05/02-08).
- [Phase 02] The ADR-042 k-of-n script-path fallback is ACTIVATED for signing liveness (createService.autoFallbackOnStall; demo-server default ON via AUTO_FALLBACK); n-of-n MuSig2 stays the primary spend; validateDraft refuses k < n when the fallback is off (02-07).
- [Phase 02] Advertised cohorts get a 30-min discovery window (env-tunable); expiry surfaces to the operator as a bounded 'expired' record + reason behind the gated re-advertise route (second operator-driven advertiseCohort caller, D-17 preserved); never shown to participants (02-06).
- [Phase 02] Join-seat grace arms at the picked cohort's FIRST OBSERVED DEPARTURE from the Advertised set (directory poll), not at opt-in; while still Advertised the participant waits with the truthful awaitingSeats `joined/capacity` line (02-09).
- [Phase 02] Hermetic capstones gate the phase: e2e:browse + e2e:kofn (n=4/k=2, chosen because k = n-1 is a false green vs the library default) + e2e:operator + e2e:fallback, all green alongside 302 unit tests.
- [Phase ?]: [Phase 03] PART-03 explicit-submit gate is opt-in via CreateParticipantOptions.onSubmitGate: absent = byte-identical auto-submit (headless peers/FILLERS/capstones unchanged), present = build-once then await the gate then submit the exact previewed body (D-12/D-16); logic extracted to exported createUpdateProvider seam for hermetic testing.
- [Phase ?]: [Phase 03] PART-04 anchor tracking source is a PUBLIC GET /v1/anchor/:cohortId backed by a bounded (24, oldest-first) per-service retained map that folds the existing BeaconBroadcaster frames (broadcast/anchored/failed) into a last-known DTO; anonymous because anchor facts are public chain data, mode-honest via an enabled bit, non-oracle (unknown->state:none), and mounted OUTSIDE the operatorAuth block so ADR 0015 gating stays byte-untouched (D-20/D-21/D-22).
- [Phase ?]: [Phase 03] D-26 public directory DISPLAY widens to the in-flight signing phases (SigningStarted/NoncesCollected/AwaitingPartialSigs) via a display-only DISPLAY_PHASES union so a mid-signing service looks alive to a stranger, while IN_FLIGHT_PHASES stays OUT of OPEN_PHASES and status().openCohorts is narrowed via a new openCount() so the join gate and public open count stay Advertised-tier only (03-03; Pitfall 3 / D-09).
- [Phase ?]: [Phase 03] 03-04: participant store restructured into the D-01 stage model - deriveStage(state) is the single pure render authority (no parallel enum, Pattern 3); explicit-submit is a module-scope deferred (onSubmitGate opt-in) flipped to a serializable pendingSubmit projection; submitUpdate() resolves-then-nulls it and every teardown clears WITHOUT settling (Pitfall 2). All ADDED around the byte-untouched Phase-2 join-through-seat block.
- [Phase ?]: [Phase 03] 03-04: anchor tracking is an epoch-guarded post-sign poll over the public GET /v1/anchor read that freezes at confirmed/failed and stops after one read on a hermetic enabled:false service (D-22); auto-resolve (D-28) gates on pure shouldAutoResolve (hermetic-signed OR live-confirmed) with the resolver-lag retry gated on anchor.enabled (Finding 7); post-seat cohort-gone uses a NEW postSeatCohortGone predicate (absent entirely) never handleDirectorySnapshot, landing the honest D-25 fallback, and a post-seat directory poll raises the D-24 unreachable signal (closes 02-09 WR-02) without going terminal.
- [Phase ?]: [Phase 03] 03-04: removing FLOW_STEPS/FlowStep from lib/types.ts forced deleting the now-dead FlowStepper.tsx + ParticipantView.tsx (already unreachable from App) to keep the web build green; KeyGenPanel + the BrowseView/CohortPage rewire stay in 03-05 (Rule 3 blocking-fix, partial pull-forward of the stepper retirement).
- [Phase ?]: [Phase 03] 03-05: the live cohort page is one continuous surface routed by the pure deriveStage authority (StageTimeline + CohortPage). Active lifecycle (connecting/live/complete) mounts CohortPage; terminal failures keep the shipped Phase-2 error cards (full D-24/D-25 cohort-page absorption is 03-06). SubmitPanel probes the public GET /v1/anchor enabled bit for the mode-honest consent line before the post-sign poll runs. statusLabel maps in-flight signing phases to 'In progress' before Full (D-26). KeyGenPanel deleted: the directory is the only entry path (D-31).
- [Phase ?]: [Phase 03] 03-06: the tracking+resolve tail lives on the one cohort page (CompletionSummary absorbs ResultCard/ResolvePanel/RegisterPanel/PublishPanel then the four panels are deleted, D-31); anchor sub-steps + round-trip + Register/IPFS all branch on the anchor enabled bit, so the hermetic path never claims an anchor/txid/reflected outcome (D-07/D-29).
- [Phase ?]: [Phase 03] 03-06: post-seat terminal failures (D-24/D-25) route to the cohort page (BrowseView status===failed && seated -> CohortPage; App chip freezes bad-tone), pre-seat closes stay directory cards; the dedicated stall copy fires only on the positive 'submitted but co-signing never completed' signal (Finding 2), else the honest 'didn't say why' fallback.
- [Phase ?]: [Phase 03] 03-06: e2e:browser:participant is the criterion-4 browser capstone (one real Chromium page + headless peers; directory landing, explicit submit click, mode-honest SIGNED, hermetic-genesis round-trip); local-only, not wired into CI (Phase-6 debt D-32).
- [Phase ?]: [Phase 03] 03-07 (gap closure): CR-01 fixed with a POST_SEAT_GONE_CONFIRMATIONS=2 consecutive-gone streak on handlePostSeatSnapshot so a cohort-complete SSE wins the directory-drop race and a genuine success keeps its result+sidecar; WR-01 fixed with a pure anchorSummaryState (anchored/broadcasting/broadcast-failed/hermetic) driving a four-way honest Signed-line, plus shouldAutoResolve firing on enabled+failed so a failed live broadcast still reaches a resolve outcome. 364 tests + web build green.
- [Phase 03]: 03-08: anchorSummaryState gained a neutral 'checking' member (null anchor) so the pre-first-read window is never narrated as a confirmed no-broadcast service
- [Phase 03]: 03-08: StageTimeline final-row label is state-driven (anchorSummaryState === 'anchored'), not the enabled bit, so the timeline header, anchor sub-steps, and CompletionSummary Signed-line never contradict
- [Phase ?]: [Phase 03] 03-09: reserve the 'anchored' narration for state === 'confirmed' only across anchorSummaryState, deriveStage, and the CompletionSummary heading boolean; state === 'broadcast' routes to 'broadcasting'/'signed', closing Truth 8 (PART-04, D-07, WR-02)
- [Phase 04] 04-02 (SVC-03, dashboard-SSE retirement + summary read): retired the booth-era telemetry channel end to end (D-02/D-19) - deleted `dashboard-sse.ts` + `GET /dashboard/events` + the `/dashboard/*` guard + the web Dashboard tab (DashboardView/CohortCard/MetricsStrip/stores/dashboard.ts), lifting `serialize()`/`summarizeTx` (fixture-fee guard preserved) into `monitor.ts` for later plans, and removing the now-inert runner/broadcaster/network HonoAppOptions. Migrated every committed pin in ONE change: `broadcast.spec` drives the BeaconBroadcaster emitter directly, the Phase-3 negative-auth (401) evidence moved onto the gated monitoring read (operator-boot.spec, operator-auth.spec, e2e/operator-cohort). Grew the monitor into `summary()` (per-cohort status-chip rows: live filling/co-signing + ended anchored/fallback/failed) + `serviceMetrics()` ({open,inFlight,anchored,failed} from the live set + a bounded-24 ended set, never a cumulative counter); ended fate captured AT EVENT TIME so a session-GC'd cohort still projects (D-23); a beacon-broadcast-failed flips anchored->failed (D-18); fallback counts as anchored. Merged into `GET /v1/operator/cohorts` as a NEW `monitoring` sibling key with the `cohorts` array + public directory/status/anchor DTOs byte-frozen (D-26, freeze pins). App.tsx needed no edit (Phase-1 route refactor already retired the tab). `needs-funding` chip is a reserved placeholder for 04-06 (not a stub). 392 tests + web build + lint + e2e:operator all green.
- [Phase 04] 04-01 (SVC-03 tracer): monitoring is an INDEPENDENT per-service `createCohortMonitor(runner)` fold (D-27) mirroring anchor-state (bounded 24, oldest-first evict), NOT entangling the frozen anchor-state/operator-cohorts; public anchor read byte-untouched. `detail(cohortId)` is a pure idempotent projection: members folded from the monitor's OWN wall-clock-stamped entry (D-22) so session-GC'd ended cohorts still project, but seats/phase/capacity enrich live from `runner.session` when the cohort is live (a zero-opt-in advertised cohort reads exists:true with real seats, UI-SPEC E5). Unknown id with no entry AND no live cohort = non-oracle exists:false. Gated `GET /v1/operator/cohorts/:id` mounts after requireOperator (anonymous -> 401 before any lookup). Web: discriminated `FetchResult<T>` + `fetchCohortDetail` (401 vs unreachable vs ok) + store `pollDetail` (401 -> logged-out+SESSION_EXPIRED re-login D-16; unreachable -> freeze last-known+detailStale D-25; ok -> store+lastUpdated) + SPA-internal drill-down view state (D-03). Partial-sig/submissions/anchor/funding deliberately deferred to later plans (D-32 honest-limit, NO stubs). 384 tests green. NEW spec convention held: monitor.spec.ts + operator.spec.ts live in package `tests/` (outside src).
- [Phase ?]: [Phase 04] 04-03 (SVC-03, list-first operator console): reworked the console into the monitoring-first surface (D-07) - service-metrics row (four tabular-nums count-neutral counters) + status-chip rows grouped Needs attention/Active/Drafts/Ended with single-membership bucketing (headings only when non-empty) and the fixed tone map (Draft/Filling/Co-signing/Needs funding/Fallback/Anchored/Failed/Expired), create form behind a New cohort button, advertise lands in the drill-down (D-13), View the public directory link. Added HealthStrip (mode/network/esplora-live-only/IPFS/freshness + SERVICE_NAME) always-visible above both views; freshness derives from the store lastUpdated and FREEZES the {n}s-ago label on a stale read (D-25); mode is a reserved Hermetic default until 04-06 populates live mode. SERVICE_NAME is a boot-time env carrier threaded demo-server->createService->createHonoApp, returned ADDITIVELY on GET /v1/config only when set (frozen network fields byte-identical, additive config.spec pin), surfaced on BOTH the console strip and the public directory header (via the participant store's loadConfig) as plain auto-escaped text with no edit surface (D-51/T-04-03-01). The list read replaced the throwing listCohorts with a discriminated fetchOperatorCohorts so refreshCohorts + a new list-view interval poll route 401->re-login / unreachable->freeze+banner / ok->update+lastUpdated (D-16/D-25). Expander promoted to ui/primitives (D-12). 393 tests + web build + lint green.
- [Phase ?]: [Phase 04] 04-04 (SVC-03 drill-down depth): the monitor fold now folds every identity-carrying runner event into per-member round state (seated->submitted->validated->nonce-sent, rejected off-path), submissions (who/when + the live raw signed-update body), honest co-sign ({noncesReceived,total,awaitingPartialSigs} with NO partial-sig count anywhere, D-32), an operator anchor view composed from the SAME injected anchor-state the public read serves (byte-untouched public read, hermetic={enabled:false,state:none}, D-18/D-26), a fallback flag (k/n when derivable, D-33), and a bounded (200, oldest-first, per-cohort monotonic id) server-wall-clock-stamped activity ring (D-21/D-22); plus exportRecord + the gated two-segment GET /v1/operator/cohorts/:id/export (anon 401 before lookup, 400 bad id, Content-Disposition filename from the shape-validated id only, no new auth surface, D-34). Drill-down renders top-to-bottom (D-05): OperatorStageTimeline (own stage set, Anchored reserved for confirmed) + Members(round chips + pubkeys behind Technical detail, D-28) + Submissions(Raw signed update expander) + honest Co-sign + Anchor sub-steps(hermetic+fallback lines) + Activity(LogPanel gained a formatTime prop for server wall-clock) + Export card. Member pubkeys + LogPanel.formatTime were Rule 2/3 pull-ins; onboarding-model badge honestly omitted (DTO carries no idType, bech32m decode avoided in the bundle). 407 tests + web build + lint green.
- [Phase ?]: 04-05: LIVE-01 boot half - BROADCAST=1 (requires LIVE=1) passes {live,broadcast} into createService behind ADR 0010 rails; bounded broadcast send retry (duplicate-acceptance=success, honest exhaustion); monitor serviceHealth mode+esplora bit. LIVE=1 alone unchanged (fixture co-sign). LIVE-01 advanced, completed by 04-06 funding stage + 04-08 UAT.
- [Phase ?]: [Phase 04] 04-06 (LIVE-01 funding half): ONE selectSpendableUtxo predicate (classifyFunding) + one suggested minimum shared by the operator display watch and the authoritative onProvideTxData wait (D-36/D-37); the wait clamps its deadline to min(window, remaining TTL - slack) and throws 'funding never arrived' (clean lapse) or an uncertainty-honest reason (blind lapse, D-39) before either library timer, engaged only when fundingWindowMs is set (single-shot pre-flight preserved). Monitor FundingView + needs-funding chip (D-44) + FundingStage.tsx (recovery-key always, mainnet lines, truncated-window/esplora-stale disclosures) gated to live+broadcast. recoveryKeyOperatorHeld is a new option (config.recoveryKey is always auto-filled so cannot distinguish); demo-server passes Boolean(RECOVERY_KEY). Stateful []-then-funded e2e proves awaiting-funding -> funded auto-advance. 452 tests + web build + mock e2e green. LIVE-01 advanced (completed by 04-08 UAT).

- [Phase 04] 04-08 (SVC-03 + LIVE-01 close-out): the proof layer is three-tier - hermetic fixture `e2e:monitor` leg on operator-cohort.ts, a local playwright-core `e2e:browser:operator` capstone (CI wiring stays Phase-6 debt, D-49), and the committed opt-in `pnpm uat:live` harness reshaped onto the env-passthrough LIVE=1 BROADCAST=1 demo-server boot with the getUtxos monkey-patch dropped (D-48). Docs: ADR 0016 records the polled monitoring read model with `Supersedes: ADR 0004` + `Amends: ADR 0015` (the retired /dashboard/events + EventSource-header rationale removed; the cookie session survives on its own merits), DEPLOY gained the honest going-live section (BROADCAST/RECOVERY_KEY/FUNDING_WINDOW_MS/LIVE_CHANGE_ADDRESS/SERVICE_NAME, the funding walkthrough, mutinynet flagship / regtest local / hermetic default), and three scoping one-pagers landed under .planning/scoping/ (D-52/D-53/D-54).
- [Phase 04] 04-08 (live-UAT gate APPROVED after 3 gap-closure rounds): the owner drove the full two-sided loop on Polar/regtest (advertise -> two browser participants join -> single-payment cohort funding -> co-sign -> broadcast -> confirmed anchor -> per-participant KEY registration -> resolve reflected the update). Nine of our own defects fixed: advert replay window equalized with the 30-min directory window via advertTtlMs threading (finite-positive guarded, typed HttpServerTransportConfig so an upstream rename fails tsc); the four funding-wait phases (UpdatesCollected/DataDistributed/Validated/FallbackRequested) added to IN_FLIGHT_PHASES in ALL THREE mirrored places (operator-cohorts.ts, monitor.ts, web directory.ts) so a funding cohort stays listed, keeps its needs-funding chip, and counts inFlight; the live seat count moved to CohortPage (its only prior home was dead since 03-05); honest race-loser copy via the pure seatLineCopy() helper; single-payment funding copy + the oldest-coin dead-end explanation; firstUpdateResolveNote() explaining the ADR 0007 KEY first-update chicken-and-egg + the 1330-sat register minimum, claiming 'anchored' ONLY on state === 'confirmed'; and `funded` made a terminal DISPLAY state (the watch retires, the monitor never regresses) because beacon change routes back to the beacon address.
- [Phase 04] 04-08: six library-level defects surfaced by the live UAT were deliberately NOT worked around in this consumer app (standing constraint: reference consumer, not a fork) - single advert slot, no seat release, silent duplicate/surplus opt-in drop, ignored advertRepeatIntervalMs, 60s envelope-skew replay rejection (all @did-btcr2/aggregation@0.4.0), and deepest-first selectSpendableUtxo with only a dust floor (@did-btcr2/method@0.51.0). They are documented in 04-LIVE-UAT-CHECKLIST.md under 'Known upstream limits' and queued for upstream issue filing.
- [Phase 05]: [Phase 05] 05-01 (SVC-04 tracer): cohort fate is classified from an out-of-band per-service INTENT registry declared BEFORE runner.stopCohort (which emits nothing at all), never from the completion rejection message - stopCohort, the whole-runner stop(), and a stall all reject through the same channel. cancelCohort files a distinct 'canceled' fate at all three mirrored server sites (operator list DTO state, monitor ended chip, service metrics where it counts as NEITHER anchored nor failed), captured at event time per 04 D-23 so a session-GC'd cohort still projects. Gated POST /v1/operator/cohorts/:id/cancel: 401 before any lookup, 400 shape guard, one indistinguishable 404 for unknown/never-advertised/already-settled. Cancel retires the funding watch via releaseCohortTables PLUS a canceled guard on the anonymous publicFunding read (releaseCohortTables alone leaves the last-known 'waiting' view claiming the cohort awaits funding forever - the WR-01 failure mode). - RESEARCH Pattern 1 / Pitfalls 1 and 2, D-05. This is the seam every later Phase 5 lifecycle verb rides (05-06's per-draft discovery window declares 'window-expired' into the same registry).
- [Phase 05]: [Phase 05] 05-01: the transport's SINGLE advert slot is repaired after every settle path (cancel, signing-complete, cohort-failed) by rebuilding the library's own createCohortAdvertMessage and re-installing it through transport.publishRepeating. The repair tracks which cohort OWNS the slot so only the owner's settle re-publishes: re-publishing over a live advert would hand already-seated participants a duplicate advert their runner rejects with INVALID_PHASE. The republisher also exposes clear(), because its own advert is id-scoped and would otherwise outlive the last open cohort. Proven by a hermetic TWO-cohort e2e:cancel leg (a single-cohort test passes while the defect is live) that seats a FRESHLY constructed participant in the sibling, and validated non-vacuous by disabling the repair and watching it fail. - RESEARCH Pattern 3 / Pitfall 3. Pre-existing latent defect that Cancel would have promoted from a rare race to a button. Known remaining gap: the runner also clears the slot at keygen-complete (a cohort FILLING), logged in deferred-items.md.
- [Phase 05]: [Phase 05] 05-02 (SVC-04 cancel UI): ConfirmPanel lands in ui/primitives.tsx as the ONE inline (no portal, no overlay) laddered confirmation every later Phase 5 destructive action composes; its docstring pins the rule that tone is never the only carrier of meaning. Cancel availability and ceremony rung are PURE predicates in lib/lifecycle.ts (the terminalReason precedent): cancel is HIDDEN not disabled once the beacon tx broadcasts (D-04), a FAILED anchor is judged by its txid rather than its state name (a send that never reached the network stays cancelable), and dead-end funding joins funded/awaiting-confirmation on the TOP rung because money has already arrived below the usable minimum. The type-to-confirm instruction is a Body-size label, NOT a Field micro-label, whose uppercase class would have instructed the operator to type a value the case-sensitive match then rejects; its value is a plain 8-char id prefix with no ellipsis. cancelCohort routes 401 through the single shared expireSession path and NEVER paints an optimistic chip: the Canceled fate arrives from the served projection only. The monitor now stamps every ended record at event time and serves it, so the neutral Canceled Ended row names a real server wall-clock time instead of the browser inventing one.
- [Phase 05]: [Phase 05] 05-03 (SVC-04 finalize + the honest close): FINALIZABLE_PHASES lands in shared/phases.ts as a THIRD phase set mirroring the library's own private #SIGNING_PHASES, read by BOTH the browser finalize predicate and the server finalize guard. It is deliberately NOT IN_FLIGHT_PHASES, which 04-08 widened with the four funding-wait phases for the public directory DISPLAY: startFallbackSigning throws in those four, so reusing the wider set would offer a button that can only fail. finalizeCohort guards on the phase BEFORE calling runner.triggerFallback (the validateDraft discipline extended to an async verb) and returns a closed verdict union, so a refusal is a 409 carrying app-authored copy, never a 500 with a library string; a LATE library rejection (phase moved between guard and call) also maps to the refusal verdict rather than escaping. triggerFallback is idempotent, so a repeat resolves ok, and monitor.noteOperatorAction de-duplicates consecutive identical text so a double-click cannot claim the action twice. That seam exists because fallback-started fires identically for the operator's Finalize now and the automatic stall timer: only an out-of-band record can attribute the actor.
- [Phase 05]: [Phase 05] 05-03: CLOSE is narrated, never faked. There is no close primitive (min == max == n, so the nth seat both locks the roster and starts keygen, and a partially filled n-of-n cohort that stopped accepting joins could never anchor), so closing renders as an automatic Closed stage on OperatorStageTimeline derived from the served seat counts, with no server flag and no control (grep '<Button' on that file is 0). The terminal Canceled marker is APPENDED after the stage the cohort actually reached rather than promoted to active, because promoting it would mark every earlier stage complete and imply a cohort canceled while filling had reached anchoring; it needed a new additive fate?: 'canceled' on the monitor detail projection, read from the SAME ended record the summary chip reads. Seat reclaim is likewise a SENTENCE, not a control (@did-btcr2/aggregation@0.4.0 has no seat-release API at all), scoped by a pure seatReclaimNoteVisible predicate. Finalize renders DISABLED with a reason (the act WILL become possible) where cancel-after-broadcast renders HIDDEN (it never will); a refused finalize preserves the server's reason in the action-error line where a failed cancel does not, because cancel's 404 is deliberately opaque while finalize's 409 explains a phase race the operator could not have seen. New e2e:fallback:operator leg proves the real library path with the stall timer 60s away.

### Pending Todos

[From .planning/todos/pending/ - ideas captured during sessions]

All 7 pending todos (captured 2026-07-21/22 from Phase 3 UAT) were folded into Phase 4 and are now resolved or scoped:

- ✓ Fix terminalReason misattributed stall copy - shipped in 04-07
- ✓ Handle unconfirmed beacon signals during resolution - resolve guard shipped in 04-07
- ✓ Add operator UI flow to fund cohort beacon address - funding stage shipped in 04-06
- ✓ Surface live beacon broadcast in the UI - BROADCAST=1 boot enablement shipped in 04-05
- → Let participants supply their own esplora endpoint - SCOPED in .planning/scoping/participant-esplora-override.md (no build this phase, D-54)
- → Support external signers instead of pasted private keys - SCOPED in .planning/scoping/external-signers.md (PSBT registration leg sooner; full MuSig2 needs an upstream signer interface)
- → Scope ToS, contracts, payments, and participant notifications - SCOPED in .planning/scoping/tos-payments-notifications.md (milestone-level scope)

### Blockers/Concerns

[Issues that affect future work]

- ✓ [Phase 1] Operator authentication shipped (ADR 0015) - the control plane is no longer unauthenticated; this must stay green in every later phase. Non-blocking follow-up before public-internet deploy: T-01-06 login-throttle-per-proxy + WR-02 NaN-TTL hardening (see 01-SECURITY.md / 01-REVIEW.md).
- Cohort state is single-process and in-memory; durability/crash-recovery is deferred to v2 (DUR-01). The boot-time auto-advertise loop that used to drive cohorts was removed in Phase 1 - cohorts now exist only on operator action.
- ✓ [Phase 3 UAT] Live-path operability gaps found over a real regtest chain (Polar) are CLOSED by Phase 4 (LIVE-01): BROADCAST=1 boot enablement (04-05), the cohort-beacon funding stage (04-06), the participant awaiting-funding / stall-copy / unconfirmed-signal-resolve fixes (04-07), and the owner-approved live walkthrough (04-08). (The Phase 2 WR-02 mid-join-feedback concern was RESOLVED by Phase 3's D-24/D-25 states.)
- [Phase 4 UAT] Six upstream defects are OPEN against the published libraries and shape how a live cohort must be run (single advert slot, no seat release, silent duplicate/surplus opt-in drop, ignored advertRepeatIntervalMs, 60s envelope-skew replay rejection, deepest-first coin selection with only a dust floor). Documented as known limits in 04-LIVE-UAT-CHECKLIST.md; issues still need to be FILED upstream against @did-btcr2/aggregation and @did-btcr2/method.

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| Durability | DUR-01: cohort state survives process restart | v2 | 2026-07-07 |
| Participant mgmt | PMG-01: richer multi-cohort management view | v2 | 2026-07-07 |
| Operator access | OACC-01: multiple operators / role granularity | v2 | 2026-07-07 |
| CI / test debt | Rewire `e2e:browser` + `e2e:browser:prod` (booth-topology, broke when the auto-advertise loop was removed in 01-03) and add `e2e:operator` to CI; those 2 CI jobs stay red until then | Phase 6 | 2026-07-08 |

## Session Continuity

Last session: 2026-07-28T23:31:07.414Z
Stopped at: Completed 05-03-PLAN.md
Resume file: None
Next command: /gsd-verify-work 4 (phase 4 execution is complete; verification is the remaining gate before Phase 5)
