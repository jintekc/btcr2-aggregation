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
- [ ] **Phase 3: Participant Submit, Co-Sign, Track, and Resolve** - From a chosen cohort, participant submits a DID update, co-signs, tracks the anchor, and resolves
- [ ] **Phase 4: Operator Cohort Monitoring** - Operator watches members, submissions, co-sign progress, and anchor status live on the protected console
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

**Plans**: 7/7 plans executed
Plans:

- [x] 03-07-PLAN.md

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

### Phase 4: Operator Cohort Monitoring

**Goal**: On the authenticated console, the operator monitors each advertised cohort's members, pending submissions, co-sign progress, and anchor status in real time, turning the read-only telemetry tab into the operator's live view of on-demand cohorts.
**Mode:** mvp
**Depends on**: Phase 3 (a full participant lifecycle to monitor) and Phase 1 (the protected console)
**Requirements**: SVC-03
**Success Criteria** (what must be TRUE):

  1. The operator sees, per advertised cohort, who has joined and how many seats remain, updating live as participants join.
  2. The operator sees pending DID-update submissions and co-sign progress for a cohort as it advances through the MuSig2 round.
  3. The operator sees anchor status (beacon broadcast / confirmed) for each cohort.
  4. This monitoring view is reachable only by the authenticated operator, not by anonymous participants.

**Plans**: TBD
**UI hint**: yes

### Phase 5: Operator Cohort Lifecycle Control

**Goal**: The operator runs aggregation and manages a cohort's lifecycle (open -> close -> finalize) and pauses, cancels, or reconfigures advertising from the console, without restarting the process - removing the last hardwired, uncontrollable behavior.
**Mode:** mvp
**Depends on**: Phase 4 (extends the same authenticated console) and Phase 1
**Requirements**: SVC-04
**Success Criteria** (what must be TRUE):

  1. The operator moves a cohort through open -> close -> finalize from the console and the directory reflects each state change.
  2. The operator pauses or cancels advertising so new cohorts stop being offered, without killing the running service (dashboard and resolve routes stay up).
  3. The operator reconfigures cohort shape (e.g. capacity, threshold, beacon type for the next cohort) without editing env vars or restarting the process.
  4. A canceled or closed cohort no longer appears as joinable in the participant directory.

**Plans**: TBD
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
| 3. Participant Submit, Co-Sign, Track, and Resolve | 7/7 | In Progress|  |
| 4. Operator Cohort Monitoring | 0/TBD | Not started | - |
| 5. Operator Cohort Lifecycle Control | 0/TBD | Not started | - |
| 6. Two-Stranger End-to-End + Real-Aggregator Framing | 0/TBD | Not started | - |
