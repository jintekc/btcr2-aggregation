# Requirements: btcr2-aggregation

**Defined:** 2026-07-07
**Core Value:** A stranger can self-host a real aggregation service that advertises cohorts, and another stranger can point a participant at that service's URL, browse its cohorts, join, co-sign, and resolve - a genuinely two-sided, self-hostable product, not a demo.

> Scope note: this milestone is a **course-correction** onto the intended two-sided, self-hostable product. The existing protocol lifecycle (advertise -> join -> submit -> co-sign -> anchor -> resolve) already works and is treated as the salvageable base (see PROJECT.md "Validated"); v1 below is the realignment on top of it. Accreted features (KEY/EXTERNAL/x1/baked-genesis onboarding, in-browser IPFS, mainnet guard rails, regtest CI, Docker deploy) are retained and folded in behind the core, not rebuilt.

## v1 Requirements

Requirements for the realigned two-sided product. Each maps to roadmap phases.

### Service (operator experience)

- [x] **SVC-01**: Operator can create and configure a new cohort on demand, choosing beacon type (CAS or SMT), Bitcoin network, n-of-n threshold, and capacity/roster, without editing boot-time env vars or restarting the process
- [x] **SVC-02**: Operator can advertise (publish) a configured cohort so it becomes visible and joinable in that service's cohort directory
- [ ] **SVC-03**: Operator can monitor a cohort in real time (members joined, pending DID-update submissions, co-sign progress, anchor status)
- [ ] **SVC-04**: Operator can run aggregation and manage a cohort's lifecycle (open -> close -> finalize) and pause, cancel, or reconfigure advertising without restarting the process

### Participant (attendee experience)

- [x] **PART-01**: Participant can point a client at a service's URL and browse that service's advertised open cohorts, with enough per-cohort detail (beacon type, network, open seats, status) to choose one
- [x] **PART-02**: Participant can join an advertised open cohort of their choice (browse-and-pick), rather than auto-joining whatever advert arrives
- [x] **PART-03**: Participant can submit a DID update and take part in the cohort's n-of-n MuSig2 co-signing round
- [ ] **PART-04**: Participant can track co-sign and anchor progress for a joined cohort and resolve the updated DID once it is anchored

### Self-hostable for real (product quality)

- [x] **HOST-01**: The operator control and telemetry surface requires operator authentication; no unauthenticated client can perform operator actions or view operator-only telemetry
- [ ] **HOST-02**: A stranger operator and a stranger participant can complete the full two-sided loop (advertise -> discover -> join -> submit -> co-sign -> anchor -> resolve) end to end without insider knowledge, verified by an automated end-to-end scenario
- [ ] **HOST-03**: The product presents as a real self-hostable aggregator: the "booth"/"attendee" demo framing is retired from code comments, UI copy, and docs

## v2 Requirements

Deferred to a future milestone. Tracked but not in the current roadmap.

### Durability

- **DUR-01**: Cohort state survives a coordinator process restart (crash recovery for in-flight cohorts)

### Participant management

- **PMG-01**: Participant has a richer management view for many concurrent cohorts across one or more services

### Operator access

- **OACC-01**: Multiple operators / role granularity on a single service (beyond a single operator credential)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Federated / cross-service cohort registry | Discovery is deliberately per-service, so each service stays a self-contained, self-hostable node with no shared infrastructure to run |
| Invite-link / join-code-only discovery | The chosen model is a public per-service directory participants browse |
| Horizontal scaling / multi-instance coordinator | Single-box self-host model (ADR 0014); multiple instances would split in-memory cohort state and break correctness |
| Slim production Docker image (`pnpm deploy --prod`) | Deferred (ADR 0014) until the workspace-symlink pruning issue is worked around |
| Changes to the `@did-btcr2/*` protocol/library | This is a reference consumer application, not a fork of the aggregation library |

## Traceability

Which phases cover which requirements. Populated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| SVC-01 | Phase 1 | Complete |
| SVC-02 | Phase 1 | Complete |
| SVC-03 | Phase 4 | Pending |
| SVC-04 | Phase 5 | Pending |
| PART-01 | Phase 2 | Complete |
| PART-02 | Phase 2 | Complete |
| PART-03 | Phase 3 | Complete |
| PART-04 | Phase 3 | Pending |
| HOST-01 | Phase 1 | Complete |
| HOST-02 | Phase 6 | Pending |
| HOST-03 | Phase 6 | Pending |

**Coverage:**

- v1 requirements: 11 total
- Mapped to phases: 11 ✓
- Unmapped: 0

---
*Requirements defined: 2026-07-07*
*Last updated: 2026-07-07 after roadmap creation (traceability populated)*
