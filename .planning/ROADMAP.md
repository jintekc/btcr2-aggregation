# Roadmap: btcr2-aggregation

## Overview

This milestone is a course-correction, not a greenfield build. The full `did:btcr2` cohort lifecycle (advertise -> join -> submit -> n-of-n MuSig2 co-sign -> anchor -> resolve) already works over real HTTP/SSE, but it drifted into a single hardwired demo happy-path (one unconditional auto-advertise loop, auto-joining participants) plus a read-only telemetry tab. The roadmap realigns that working plumbing onto the intended two-sided, self-hostable product: an authenticated operator who creates, advertises, monitors, and manages cohorts on demand, and a participant who points a client at a service URL, browses its cohort directory, picks one, joins, co-signs, and resolves. Every phase is a vertical MVP slice - a user-visible piece of the two-sided loop that is demoable on its own - and each builds on the working slice before it. Accreted features (KEY/EXTERNAL/x1/baked-genesis onboarding, in-browser IPFS, mainnet guard rails, regtest CI, Docker deploy) are retained and fold in behind the realigned core; they are not phases.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Authenticated Operator Console + On-Demand Cohort Creation** - Operator logs in and creates/configures/advertises a cohort on demand, replacing the auto-advertise loop (completed 2026-07-08)
- [x] **Phase 2: Participant Discovery + Browse-and-Pick Join** - Participant points at a service URL, browses its open cohorts, and joins one by choice (completed 2026-07-16)
- [x] **Phase 3: Participant Submit, Co-Sign, Track, and Resolve** - From a chosen cohort, participant submits a DID update, co-signs, tracks the anchor, and resolves (completed 2026-07-22)
- [x] **Phase 4: Operator Cohort Monitoring** - Operator watches members, submissions, co-sign progress, and anchor status live on the protected console (completed 2026-07-27)
- [ ] **Phase 5: Operator Cohort Lifecycle Control** - Operator runs open->close->finalize and pauses/cancels/reconfigures advertising without restarting
- [ ] **Phase 6: Two-Stranger End-to-End + Real-Aggregator Framing** - Automated stranger-to-stranger loop passes in CI and the booth/attendee framing is retired

## Phase Details

### Phase 1: Authenticated Operator Console + On-Demand Cohort Creation

**Goal**: An authenticated operator can create, configure, and advertise a cohort on demand from a protected console, replacing the boot-time `while (running)` auto-advertise loop as the only way a cohort comes into existence.
**Mode:** mvp
**Depends on**: Nothing (first realignment phase; builds on the validated lifecycle base)
**Requirements**: HOST-01, SVC-01, SVC-02
**Success Criteria** (what must be TRUE):

  1. An operator authenticates with an operator credential and reaches the operator console; an unauthenticated visitor is denied the console and any operator-only telemetry (no mutating operator route is reachable without auth).
  2. From the console, the operator creates and configures a cohort on demand - choosing beacon type (CAS or SMT), Bitcoin network, n-of-n threshold, and capacity/roster - without editing boot-time env vars or restarting the process.
  3. The operator advertises the configured cohort and it appears as an open, joinable entry in that service's cohort directory.
  4. The full lifecycle still completes end to end for an operator-advertised cohort (co-sign -> anchor -> resolve), now driven by the operator's on-demand action rather than the perpetual auto-advertise loop.

**Plans**: 4/4 plans complete
Plans:
**Wave 1**

- [x] 01-01-PLAN.md - Server-enforced operator auth + fail-closed boot + /operator login-gated shell (HOST-01, Wave 1)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 01-02-PLAN.md - On-demand create/configure/discard cohort draft + operator cohort list (SVC-01, Wave 2)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 01-03-PLAN.md - Advertise draft + public directory/status + remove the auto-advertise loop (SVC-02, Wave 3)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 01-04-PLAN.md - Hermetic login->create->advertise->co-sign->resolve e2e proof (success criterion 4, Wave 4)

**UI hint**: yes

### Phase 2: Participant Discovery + Browse-and-Pick Join

**Goal**: A participant pointed at a service's URL can browse that service's advertised open cohorts and join one of their choosing, replacing the `shouldJoin` auto-accept of whatever advert arrives.
**Mode:** mvp
**Depends on**: Phase 1 (the operator populates the directory the participant browses)
**Requirements**: PART-01, PART-02
**Success Criteria** (what must be TRUE):

  1. A participant points a client at a service's URL and sees a list of that service's advertised open cohorts, each showing beacon type, network, open seats, and status - enough detail to choose.
  2. The participant selects a specific open cohort from the directory and joins it by choice, rather than auto-joining whatever advert arrives.
  3. A joined participant is seated in the chosen cohort (counts against its capacity), and a full or closed cohort cannot be joined.

**Plans**: 9/9 plans executed
Plans:

- [x] 02-05-PLAN.md - Single Cohort size (n-of-n): collapse threshold + capacity to one n, min == max == n on browser and server (F1a/F1b gap closure)
- [x] 02-06-PLAN.md - Cohort discovery-window lifetime + surfaced expiry (state:'expired' + reason) + gated operator re-advertise route (F2 gap closure)
- [x] 02-07-PLAN.md - Activate the ADR-042 k-of-n script-path fallback for signing-stall liveness (n-of-n stays primary; configurable fallbackThreshold) (F1c gap closure)
- [x] 02-08-PLAN.md - Two-field k-of-n cohort: restore the signing threshold k as a second honest number (size n seats + fallback floor k); DTO flip threshold=k/capacity=n; n=4/k=2 hermetic capstone (G-02-1 gap closure)
- [x] 02-09-PLAN.md - Join-grace rearm for wait-for-n: arm the 90s grace at observed departure (not at opt-in) + truthful `awaitingSeats` waiting line, so a still-Advertised opted-in participant is never falsely failed (G-02-2 gap closure)

**Wave 1**

- [x] 02-01-PLAN.md - Join-by-filter mechanism (shouldJoin -> picked cohortId) + hermetic browse->pick->join->co-sign capstone (PART-02, criterion 3, Wave 1)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 02-02-PLAN.md - Anonymous browse directory landing at / (service-identity header + ~5s-polled list + plain-language labels + empty/unreachable states) (PART-01, Wave 2)
- [x] 02-03-PLAN.md - Participant store lifecycle: join(baseUrl, cohortId) + cohort-ready seat + directory-driven filled/closed outcome, watchdog removed (PART-02, Wave 2)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 02-04-PLAN.md - Pick -> inline identity -> join -> seated confirmation -> reused co-sign/resolve tail + Leave (PART-02, criterion 3, Wave 3)

**UI hint**: yes

### Phase 3: Participant Submit, Co-Sign, Track, and Resolve

**Goal**: From the cohort they chose, a participant submits a DID update, takes part in the n-of-n MuSig2 co-signing round, tracks the anchor, and resolves the updated DID - wiring the existing signing/resolve flow into the discover->join path instead of the linear demo stepper.
**Mode:** mvp
**Depends on**: Phase 2 (needs a cohort the participant joined by choice)
**Requirements**: PART-03, PART-04
**Success Criteria** (what must be TRUE):

  1. From a cohort they joined by choice, the participant submits a DID update and takes part in that cohort's n-of-n MuSig2 co-signing round.
  2. The participant sees co-sign progress and anchor status for their joined cohort update in real time.
  3. Once the beacon is anchored, the participant resolves the updated DID and sees the new DID document.
  4. The participant reaches submit/co-sign only via a cohort discovered and joined from the directory; the standalone linear KeyGen -> Register -> Publish -> Resolve stepper is no longer the entry path.

**Plans**: 9/9 plans executed
Plans:

- [x] 03-07-PLAN.md
- [x] 03-08-PLAN.md - Mode-honest anchor narration consistency: StageTimeline final-row label driven by anchorSummaryState + neutral null-anchor 'checking' state in CompletionSummary (Truth 7 gap closure, PART-04, Wave 6)
- [x] 03-09-PLAN.md - Reserve 'anchored' for a confirmed tx only: route broadcast-but-unconfirmed into 'broadcasting'/'signed' across anchorSummaryState, deriveStage, and the CompletionSummary anchored boolean, re-pinning the spec cases (Truth 8 gap closure, PART-04, Wave 7)

**Wave 1** *(parallel foundations)*

- [x] 03-01-PLAN.md - Explicit submit gate (opt-in deferred onProvideUpdate) in the participant package (PART-03, Wave 1)
- [x] 03-02-PLAN.md - Minimal public anchor read (anchor-state module + GET /v1/anchor/:cohortId, mode-honest, bounded) (PART-04, Wave 1)
- [x] 03-03-PLAN.md - In-flight directory rows (D-26) with the joinable open count kept Advertised-only (PART-04, Wave 1)

**Wave 2** *(blocked on Wave 1)*

- [x] 03-04-PLAN.md - Participant store restructure: stage model + submit deferred + anchor poll + mode-honest resolve + honest degraded-state detection (PART-03/PART-04, Wave 2)

**Wave 3** *(blocked on Wave 2)*

- [x] 03-05-PLAN.md - The live cohort page through Signed + submit moment + directory row state + "Your cohort" link + delete the standalone stepper (PART-03, Wave 3)

**Wave 4** *(blocked on Wave 3)*

- [x] 03-06-PLAN.md - Anchor sub-steps + auto-resolve round-trip + completion summary/export + honest degraded states + browser capstone (PART-04, criterion 4, Wave 4)

**UI hint**: yes

### Phase 4: Operator Cohort Monitoring [EXECUTED: 8/8 plans]

**Goal**: On the authenticated console, the operator monitors each advertised cohort's members, pending submissions, co-sign progress, and anchor status in real time, turning the read-only telemetry tab into the operator's live view of on-demand cohorts.
**Mode:** mvp
**Depends on**: Phase 3 (a full participant lifecycle to monitor) and Phase 1 (the protected console)
**Requirements**: SVC-03, LIVE-01
**Success Criteria** (what must be TRUE):

  1. The operator sees, per advertised cohort, who has joined and how many seats remain, updating live as participants join.
  2. The operator sees pending DID-update submissions and co-sign progress for a cohort as it advances through the MuSig2 round.
  3. The operator sees anchor status (beacon broadcast / confirmed) for each cohort.
  4. This monitoring view is reachable only by the authenticated operator, not by anonymous participants.
  5. The live broadcast path is operable from the product itself (LIVE-01): a real boot enables live co-sign + broadcast behind guard rails (`BROADCAST=1` requires `LIVE=1`), the cohort-beacon funding stage advances honestly (waiting / seen / funded / dead-end), the funding wait fails with a specific reason before any library timer, and the participant awaiting-funding / stall / unconfirmed-signal-resolve copy is honest, verified hermetically by a mocked-chain funding leg and by an owner live-UAT walkthrough.

**Plans**: 8/8 plans executed
Plans:
**Wave 1**

- [x] 04-01-PLAN.md - TRACER: monitoring member/seat vertical slice (monitor fold + gated detail read + polled drill-down) (SVC-03, Wave 1) - SUMMARY: 04-01-SUMMARY.md

**Wave 2** *(blocked on Wave 1)*

- [x] 04-02-PLAN.md - Retire dashboard-SSE + migrate pins + monitoring summary read (chips/metrics/ended taxonomy) (SVC-03, Wave 2) - SUMMARY: 04-02-SUMMARY.md

**Wave 3** *(blocked on Wave 2)*

- [x] 04-03-PLAN.md - List-first console shell + status chips + service metrics + health strip + SERVICE_NAME (SVC-03, Wave 3)

**Wave 4** *(blocked on Wave 3)*

- [x] 04-04-PLAN.md - Drill-down depth: submissions, per-member round state, honest co-sign, anchor detail, activity log, JSON export (SVC-03, Wave 4)

**Wave 5** *(blocked on Wave 4)*

- [x] 04-05-PLAN.md - Live boot enablement (BROADCAST=1 + banners + invariant) + bounded broadcast send retry + mode/esplora health signal (LIVE-01, Wave 5)

**Wave 6** *(blocked on Wave 5)*

- [x] 04-06-PLAN.md - Cohort-beacon funding stage: watch predicate + clamped funding wait + honest disclosure + mocked-chain e2e (LIVE-01, Wave 6)

**Wave 7** *(blocked on Wave 6; the two run in parallel, disjoint files)*

- [x] 04-07-PLAN.md - Participant-side: awaiting-funding notice + stall-copy fix + unconfirmed-signal resolve guard (LIVE-01, Wave 7)
- [x] 04-08-PLAN.md - Proof + docs: fixture monitoring e2e + browser operator capstone + uat:live + ADR 0016 + DEPLOY going-live + scoping one-pagers + owner live-UAT checkpoint (SVC-03/LIVE-01, Wave 7) - SUMMARY: 04-08-SUMMARY.md

**UI hint**: yes

### Phase 5: Operator Cohort Lifecycle Control

**Goal**: The operator runs aggregation and manages a cohort's lifecycle (open -> close -> finalize) and pauses, cancels, or reconfigures advertising from the console, without restarting the process - removing the last hardwired, uncontrollable behavior.
**Mode:** mvp
**Depends on**: Phase 4 (extends the same authenticated console) and Phase 1
**Requirements**: SVC-04, SVC-05, PART-05, PART-06
**Success Criteria** (what must be TRUE):

  1. The operator moves a cohort through open -> close -> finalize from the console and the directory reflects each state change.
  2. The operator pauses or cancels advertising so new cohorts stop being offered, without killing the running service (dashboard and resolve routes stay up).
  3. The operator reconfigures cohort shape (e.g. capacity, threshold, beacon type for the next cohort) without editing env vars or restarting the process.
  4. A canceled or closed cohort no longer appears as joinable in the participant directory.
  5. Participation terms set by the operator are accepted at join and recorded as a DID-signed, server-verified, terms-hash-bound artifact, with the app-level enforcement boundary disclosed honestly (SVC-05).
  6. A participant can point their browser's chain reads at their own esplora endpoint, with a network-mismatch guard, four distinguishable failure messages, no silent fallback, and every real-funds guard rail unweakened (PART-05).
  7. A participant can sign the registration transaction in their own wallet through a PSBT round trip that is validated against the exact template the app created before anything is broadcast (PART-06).

**Slip order** (CONTEXT D-22, three tiers): CORE never slips - SVC-04 lifecycle control (plans 01 through 07 and 10). SECOND - the four absorbed parked items (plans 08 and 09). SLIP-FIRST - the three folded scoping one-pagers (plans 11, 12, and 13), which re-park cleanly to Phase 6 or the next milestone if the phase runs long.

**Plans**: 31/32 plans executed
Plans:
**Wave 1**

- [x] 05-01-PLAN.md - TRACER: cancel a cohort end to end (intent registry, canceled fate, advert-slot repair) (SVC-04, Wave 1)

**Wave 2** *(blocked on Wave 1)*

- [x] 05-02-PLAN.md - Cancel console ceremony: ConfirmPanel, Canceled chip, laddered rungs 3 and 4 (SVC-04, Wave 2)

**Wave 3** *(blocked on Wave 2)*

- [x] 05-03-PLAN.md - Finalize now: FINALIZABLE_PHASES, 409 semantics, rung-2 confirm, automatic Closed stage (SVC-04, Wave 3)

**Wave 4** *(blocked on Wave 3)*

- [x] 05-04-PLAN.md - Runtime settings holder + advertising pause gate + public paused bit (SVC-04, Wave 4)

**Wave 5** *(blocked on Wave 4)*

- [x] 05-05-PLAN.md - Service controls card + health chips + public paused notice (SVC-04, Wave 5)

**Wave 6** *(blocked on Wave 5)*

- [x] 05-06-PLAN.md - Draft editing + per-draft advanced timing windows (SVC-04, Wave 6)

**Wave 7** *(blocked on Wave 6)*

- [x] 05-07-PLAN.md - Service settings surface: defaults, service name, windows, participation terms (SVC-04 + SVC-05, Wave 7)

**Wave 8** *(blocked on Wave 7)*

- [x] 05-08-PLAN.md - Broadcast kill switch + ended-record dismissal + operator actions log (SVC-04, Wave 8)

**Wave 9** *(blocked on Wave 8)*

- [x] 05-09-PLAN.md - Operator test peers: in-process spawn, badging, bounded teardown (SVC-04, Wave 9)

**Wave 10** *(blocked on Wave 9)*

- [x] 05-10-PLAN.md - Participant canceled narration + public cohort-fate read (SVC-04, Wave 10)

**Wave 11** *(blocked on Wave 10)*

- [x] 05-11-PLAN.md - Participant chain-endpoint override (PART-05, Wave 11)

**Wave 12** *(blocked on Wave 11)*

- [x] 05-12-PLAN.md - PSBT registration leg (PART-06, Wave 12)

**Wave 13** *(blocked on Wave 12)*

- [x] 05-13-PLAN.md - DID-signed participation-terms acceptance at join (SVC-05, Wave 13)

**Wave 14** *(blocked on Wave 13)*

- [x] 05-14-PLAN.md - Phase proof and docs: hermetic gate, ADR 0017, DEPLOY, upstream limits, owner verification (SVC-04/SVC-05/PART-05/PART-06, Wave 14)

**Gap closure** (planned 2026-07-29 from the 8 confirmed defects in `05-AUDIT.md`; run with `/gsd-execute-phase 5 --gaps-only`). Waves restart at 1 for this round: the two real-funds fixes land first and alone.

**Gap wave 1**

- [x] 05-15-PLAN.md - Pin the sighash type in the registration PSBT validator (PART-06, real funds, Gap wave 1)
- [x] 05-16-PLAN.md - Stand down the funding watch under the broadcast kill switch (SVC-04, real funds, Gap wave 1)

**Gap wave 2** *(sequenced after the real-funds fixes)*

- [x] 05-17-PLAN.md - Bound the anonymous terms-acceptance artifact store (SVC-05, Gap wave 2)
- [x] 05-18-PLAN.md - Discovery-window seed ceiling + the deploy-doc reconciliation (SVC-04, Gap wave 2)

**Gap wave 3** *(blocked on 05-17: shared HTTP adapter)*

- [x] 05-19-PLAN.md - Dismissal actually dismisses + the type-to-confirm gate becomes load-bearing (SVC-04, Gap wave 3)

**Gap wave 4** *(blocked on 05-19: shared cohort-list surface)*

- [x] 05-20-PLAN.md - Reserve the Anchored chip for confirmed anchors (SVC-04, Gap wave 4)

**Second gap round** (planned 2026-07-30 from the 24 confirmed defects in `05-AUDIT-2.md`; run with `/gsd-execute-phase 5 --gaps-only`). Waves restart at 1 again and are SINGLETONS: every plan transiently mutates shipped source to prove its new assertions are load-bearing, so no two may run concurrently. Fixes both of the audit's structural causes first.

**Gap round 2, wave 1**

- [x] 05-21-PLAN.md - TRACER: typecheck `packages/web` in `pnpm test` + render web components via `react-dom/server`, proven on the funded-cancel gate, the post-broadcast suppression, and the terms empty state (SVC-04/SVC-05, defects #15/#21/#8/#7, wave 1)

Note on the `depends_on` chain: 05-22 through 05-26 each declare the previous plan, so waves stay one plan deep. The code dependency for 05-22, 05-23 and 05-24 is on 05-21 alone; the chained edges express the round's serialization rule, since three plans depending on 05-21 directly would compute to one wave, dispatch concurrently against a tree each transiently mutates, and collide on `05-UAT.md`.

**Gap round 2, wave 2** *(blocked on 05-21: the render harness)*

- [x] 05-22-PLAN.md - Operator console render pins: the mode chip, the test-peer refusal, the dismissal body, the kill-switch mode guard (SVC-04, defects #25/#22/#10/#20/#27, wave 2)

**Gap round 2, wave 3**

- [x] 05-23-PLAN.md - Chip labels, paused-row advertise guards, shape-error copy, draft edit seeding (SVC-04, defects #17/#23/#1-web/#30/#31, wave 3)

**Gap round 2, wave 4**

- [x] 05-24-PLAN.md - Participant fate read, chain-endpoint network parameter, operator 401 paths (SVC-04/PART-05, defects #13/#14/#18/#16, wave 4)

**Gap round 2, wave 5**

- [x] 05-25-PLAN.md - Draft window round trip, refusal bodies, expired-dismissal fate (SVC-04, defects #29/#32/#19, wave 5)

**Gap round 2, wave 6**

- [x] 05-26-PLAN.md - Boot-seeded ceiling, no-op action guards, live test-peer disclosure, paused reason, terms-hash known answer (SVC-04/SVC-05, defects #5/#2/#11/#1-server/#6, wave 6)

**Gap round 2, wave 7** *(blocked on the whole round: reads the UAT ledger)*

- [x] 05-27-PLAN.md - Browser witness, honest-success pin, Secure-cookie row, and the single `05-UAT.md` reconciliation (SVC-04/SVC-05/PART-05/PART-06, defects #27-e2e/#3/#28, wave 7)

**Third gap round** (planned 2026-07-30 from `05-VERIFICATION.md`, `status: gaps_found`, 5 of 7 Success Criteria verified; run with `/gsd-execute-phase 5 --gaps-only`). Owner-approved scope is exactly three items: the two Success-Criterion-failing gaps plus warning W3. Waves restart at 1 and are SINGLETONS: each plan deliberately puts the tree into a RED state (a failing row written before its fix, and a revert-the-fix check afterwards) and each ends by running the whole suite, so two plans in one wave would read each other's transiently broken tree. The files are disjoint, so the `depends_on` edges express serialization only, not a code dependency.

**Gap round 3, wave 1**

- [x] 05-28-PLAN.md - The drill-down cancel/finalize ceremony can no longer be armed against a stale, wrong cohort (SVC-04, Gap 1 / SC 1 / review CR-1, wave 1)

**Gap round 3, wave 2** *(serialized behind 05-28)*

- [x] 05-29-PLAN.md - The `mismatch` chain verdict becomes reachable on the default network, naming both chains (PART-05, Gap 2 / SC 6 / review WR-1, wave 2)

**Gap round 3, wave 3** *(serialized behind 05-29)*

- [x] 05-30-PLAN.md - A malformed or non-whole-minute settings seed can no longer wedge every save until restart (SVC-04, W3 / review WR-2 and WR-3, wave 3)

**Fourth gap round** (planned 2026-08-03 from `05-VERIFICATION.md`, `status: gaps_found`, 6 of 7 Success Criteria verified, SC3 FAILED; run with `/gsd-execute-phase 5 --gaps-only`). Owner-approved scope is exactly three items: the SC3 string-seed wedge (the round's only blocking gap) plus warnings W5 and W6. Waves restart at 1 and are SINGLETONS for the same reason as round 3: each plan deliberately puts the tree into a RED state and each ends by running the whole suite, so the `depends_on` edge expresses serialization, not a code dependency. The two plans touch disjoint packages.

**Gap round 4, wave 1**

- [x] 05-31-PLAN.md - An over-long SERVICE_NAME or TERMS_TEXT seed can no longer wedge every settings save, and every window boot warning is true of a variable the operator set (SVC-04, Gap 1 / SC 3 / review CR-01, plus W6 / review WR-02, wave 1)

**Gap round 4, wave 2** *(serialized behind 05-31)*

- [ ] 05-32-PLAN.md - A list read that outlives its session can no longer repopulate the console's gated slice (SVC-04, W5 / review WR-01, wave 2)

**UI hint**: yes

### Phase 6: Two-Stranger End-to-End + Real-Aggregator Framing

**Goal**: Prove the full two-sided loop works for a stranger operator and a stranger participant via an automated end-to-end scenario, and retire the lingering "booth"/"attendee" demo framing so the product presents as a real self-hostable aggregator.
**Mode:** mvp
**Depends on**: Phase 5 (the whole realigned two-sided loop must exist to prove stranger-to-stranger)
**Requirements**: HOST-02, HOST-03
**Success Criteria** (what must be TRUE):

  1. An automated end-to-end scenario runs the whole loop - operator advertises, a stranger participant discovers, joins, submits, co-signs, anchors, and resolves - with no insider knowledge, and passes in CI.
  2. A first-time operator and a first-time participant can complete the loop using only the console and the directory, without reading source, ADRs, or env internals.
  3. The "booth"/"attendee" framing is gone from code comments, UI copy, and docs; the surfaces describe a self-hostable aggregator.

**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Authenticated Operator Console + On-Demand Cohort Creation | 4/4 | Complete    | 2026-07-08 |
| 2. Participant Discovery + Browse-and-Pick Join | 9/9 | Complete    | 2026-07-16 |
| 3. Participant Submit, Co-Sign, Track, and Resolve | 9/9 | Complete    | 2026-07-22 |
| 4. Operator Cohort Monitoring | 8/8 | Complete    | 2026-07-27 |
| 5. Operator Cohort Lifecycle Control | 31/32 | In Progress|  |
| 6. Two-Stranger End-to-End + Real-Aggregator Framing | 0/TBD | Not started | - |
