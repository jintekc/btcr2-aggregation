---
phase: 04-operator-cohort-monitoring
plan: 02
subsystem: api
tags: [monitoring, dashboard-sse-retirement, read-model, event-fold, hono, status-chips, service-metrics, ended-taxonomy]

# Dependency graph
requires:
  - phase: 04-operator-cohort-monitoring
    plan: 01
    provides: "createCohortMonitor per-service fold + gated GET /v1/operator/cohorts/:id detail read; the discriminated fetch + drill-down view state the console list surface polls"
provides:
  - "Retired dashboard-SSE channel: dashboard-sse.ts deleted, GET /dashboard/events + the /dashboard/* guard removed, the runner/broadcaster/network HonoAppOptions gone; the serialize()/summarizeTx payload helpers lifted into monitor.ts for the later drill-down plans"
  - "monitor.summary(): one CohortSummaryDTO row per live (filling / co-signing) or ended (anchored / fallback / failed) cohort, chip keyed to the fixed UI-SPEC tone map, ended fate captured at event time and bounded at 24 oldest-first"
  - "monitor.serviceMetrics(): { open, inFlight, anchored, failed } from the live set + retained records, never a since-boot cumulative"
  - "GET /v1/operator/cohorts merged: NEW monitoring sibling key { rows, metrics } beside the byte-identical cohorts array; public directory/status/anchor DTOs frozen"
  - "Retired booth-era web Dashboard tab surface (DashboardView / CohortCard / MetricsStrip / stores/dashboard.ts deleted)"
affects: [04-03-console-list-surface, 04-04-drill-down-submissions, 04-06-funding-stage, 04-08-live-uat]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Atomic channel retirement + pin migration: delete the module, lift its still-needed helpers, and repoint every committed consumer/test pin in ONE change so the CI gate never goes red mid-change (Pitfall 1, planning note 1)"
    - "Ended-record taxonomy folded at EVENT TIME into a bounded (MAX_TERMINAL=24, oldest-first) Map so a session-GC'd cohort still projects its fate (D-23), mirroring the anchor-state remember() idiom"
    - "Broadcaster frames REFINE the terminal fate: a beacon-tx broadcast that fails after a successful co-sign flips anchored -> failed, so 'anchored' is never claimed for a tx that never made it on-chain (D-18)"
    - "Merged read model: a NEW monitoring sibling key extends an operator DTO while the existing cohorts array + all public DTOs stay byte-frozen (D-26, Pitfall 7)"

key-files:
  created: []
  modified:
    - packages/service/src/monitor.ts
    - packages/service/src/hono-adapter.ts
    - packages/service/src/index.ts
    - packages/service/src/broadcast.ts
    - packages/service/src/broadcast.spec.ts
    - packages/service/src/operator-boot.spec.ts
    - packages/service/src/operator-auth.ts
    - packages/service/src/operator-auth.spec.ts
    - packages/service/src/operator-cohorts.spec.ts
    - packages/service/src/anchor-state.ts
    - packages/service/src/static-site.ts
    - packages/service/src/demo-server.ts
    - packages/service/tests/monitor.spec.ts
    - e2e/operator-cohort.ts
  deleted:
    - packages/service/src/dashboard-sse.ts
    - packages/web/src/components/dashboard/DashboardView.tsx
    - packages/web/src/components/dashboard/CohortCard.tsx
    - packages/web/src/components/dashboard/MetricsStrip.tsx
    - packages/web/src/stores/dashboard.ts

key-decisions:
  - "Removed the now-inert runner/broadcaster/network options from HonoAppOptions entirely (not left as dead fields) since the only thing wiring them was the deleted /dashboard/events mount; updated the four call sites (index.ts + three specs) - the honest clean-surface choice for an internal workspace package"
  - "cohort-failed carries an attributed cohortId + reason directly (unlike the bare error event), so the FAILED ended record is taken from it; the completion-rejection channel that operator-cohorts.settleCompletion consumes stays that module's concern (planning note 2)"
  - "fallback counts toward the anchored metric (the k-of-n script path still put the beacon tx on-chain); only cohort-failed / beacon-broadcast-failed count as failed"
  - "App.tsx needed NO edit: the two-tab Participant/Coordinator shell the plan's read_first described was already replaced by the route-based /operator console in Phase 1, so retiring the Dashboard tab was purely the deletion of the four orphaned web files"

patterns-established:
  - "Bounded ended-taxonomy fold (rememberEnded): capture terminal fate + event-time seats/capacity at signing-complete / cohort-failed, evict oldest past 24, so metrics stay a live bounded view not a cumulative counter"
  - "Live vs ended de-dup in summary(): live rows are filtered to filling/co-signing phases only, so a completed/failed cohort naturally reads from the ended set with no double-count"

requirements-completed: []
requirements-advanced: [SVC-03]

coverage:
  - id: T1
    description: "The dashboard-SSE channel is fully retired: dashboard-sse.ts deleted, GET /dashboard/events mount + /dashboard/* guard + bridgeRunnerToSse import removed, bridgeRunnerToSse/DashboardExtras re-export removed, serialize()/summarizeTx lifted into monitor.ts with the fixture-fee guard preserved"
    requirement: SVC-03
    verification:
      - kind: unit
        ref: "packages/service/tests/monitor.spec.ts#summarizeTx (lifted from dashboard-sse)"
        status: pass
      - kind: manual_procedural
        ref: "grep: no live dashboard-sse / bridgeRunnerToSse / DashboardExtras / /dashboard/events route mount or client consumer remains"
        status: pass
    human_judgment: false
  - id: T2
    description: "Every committed pin migrated green across the deletion: broadcast.spec drives the BeaconBroadcaster emitter directly; the Phase 3 negative-auth (401) evidence moved onto the gated monitoring read in operator-boot.spec, operator-auth.spec, and e2e/operator-cohort.ts"
    requirement: SVC-03
    verification:
      - kind: integration
        ref: "packages/service/src/operator-boot.spec.ts + operator-auth.spec.ts (401 on GET /v1/operator/cohorts/:id)"
        status: pass
      - kind: e2e
        ref: "e2e/operator-cohort.ts (no-cookie GET /v1/operator/cohorts/some-cohort -> 401); pnpm tsx run PASSED"
        status: pass
    human_judgment: false
  - id: T3
    description: "GET /v1/operator/cohorts merges monitoring: each row carries a status-chip key (filling / co-signing / needs-funding / fallback / anchored / failed) + a service-level metrics count { open, inFlight, anchored, failed } from the live set + retained records, never a cumulative counter; the ended fate survives a session GC and is bounded at 24"
    requirement: SVC-03
    verification:
      - kind: integration
        ref: "packages/service/tests/monitor.spec.ts#merges live monitoring chips + metrics into GET /v1/operator/cohorts"
        status: pass
      - kind: unit
        ref: "packages/service/tests/monitor.spec.ts#createCohortMonitor summary + serviceMetrics + ended taxonomy (anchored/failed/fallback survival, 24-cap eviction, broadcast-fail override)"
        status: pass
    human_judgment: false
  - id: T4
    description: "Public surfaces stay byte-frozen: DirectoryCohortDTO and ServiceStatusDTO shapes unchanged (no monitoring leak); monitoring fields extend ONLY the operator DTOs (D-26, Pitfall 7)"
    requirement: SVC-03
    verification:
      - kind: unit
        ref: "packages/service/tests/monitor.spec.ts#freezes the public DirectoryCohortDTO + ServiceStatusDTO shapes"
        status: pass
    human_judgment: false
  - id: T5
    description: "The booth-era web Dashboard tab is retired: DashboardView / CohortCard / MetricsStrip / stores/dashboard.ts deleted; App.tsx renders no Coordinator/Dashboard telemetry tab; the web build is green"
    requirement: SVC-03
    verification:
      - kind: build
        ref: "pnpm --filter @btcr2-aggregation/web build -> green (694 modules); grep: no components/dashboard or stores/dashboard reference remains"
        status: pass
    human_judgment: false

# Metrics
duration: 40min
completed: 2026-07-24
status: complete
---

# Phase 4 Plan 02: Dashboard-SSE Retirement + Monitor Summary Read Model Summary

**Collapsed the two telemetry paths into one polled snapshot: retired the booth-era dashboard-SSE channel + web Dashboard tab (migrating every committed consumer/test pin in one atomic change), then grew the monitor into a `summary()` (status-chip rows) + `serviceMetrics()` (bounded live counts) read model with an event-time ended taxonomy, merged into `GET /v1/operator/cohorts` with the public DTOs byte-frozen.**

## Performance

- **Duration:** ~40 min
- **Tasks:** 2
- **Files:** 14 modified, 5 deleted

## Accomplishments
- Retired the read-only dashboard-SSE telemetry channel end to end (D-02/D-19): `dashboard-sse.ts` deleted, `GET /dashboard/events` + the `/dashboard/*` guard + the `bridgeRunnerToSse`/`DashboardExtras` surface removed, and the `serialize()`/`summarizeTx` payload helpers lifted into `monitor.ts` (fixture-fee guard preserved) for the later drill-down plans.
- Migrated every committed pin in the SAME change so the CI gate never went red: `broadcast.spec` now drives the `BeaconBroadcaster` emitter directly, and the Phase 3 negative-auth (401) security evidence moved onto the gated monitoring read (`operator-boot.spec`, `operator-auth.spec`, `e2e/operator-cohort.ts`).
- Grew the monitor into the operator cohort-list read model: `summary()` serves per-cohort status chips (live filling/co-signing + ended anchored/fallback/failed), `serviceMetrics()` serves honest bounded counts, and both merge into `GET /v1/operator/cohorts` under a NEW `monitoring` sibling key while the `cohorts` array + all public DTOs stay byte-frozen (D-06/D-23/D-26).
- SVC-03 criterion (operator-visible cohort status/counts) advanced from the tracer's members/seats to the list-surface chips + metrics that plan 04-03 renders.

## Task Commits

Each task was committed atomically (unsigned per project convention):

1. **Task 1: Retire dashboard-SSE + Dashboard tab, migrate every pin atomically** - `4b93781` (refactor)
2. **Task 2: Monitor summary read (status chips + service metrics + ended taxonomy) merged into GET /v1/operator/cohorts** - `1dc3849` (feat)

## Files Created/Modified/Deleted
- `packages/service/src/monitor.ts` - lifted `safe`/`summarizeTx`/`serialize` helpers; added `CohortChip`/`CohortSummaryDTO`/`ServiceMetricsDTO`, the bounded ended-record set, the signing-started/fallback-started/nonce-received/signing-complete/cohort-failed + broadcaster subscriptions, and `summary()`/`serviceMetrics()`
- `packages/service/src/hono-adapter.ts` - removed the `/dashboard/events` mount + `/dashboard/*` guard + `bridgeRunnerToSse` import; dropped the inert `runner`/`broadcaster`/`network` options; merged `monitoring` into `GET /v1/operator/cohorts`
- `packages/service/src/index.ts` - removed the `bridgeRunnerToSse`/`DashboardExtras` re-export; threaded `broadcaster` into `createCohortMonitor`; added the new monitor type re-exports; dropped the deleted options from the `createHonoApp` call
- `packages/service/src/broadcast.{ts,spec.ts}` - refreshed the doc comments off the retired bridge; rewrote the SSE-bridge tests as direct `BeaconBroadcaster` emitter coverage
- `packages/service/src/operator-boot.spec.ts` / `operator-auth.spec.ts` / `operator-cohorts.spec.ts` - migrated the negative-auth pins + stand-in guarded route onto `GET /v1/operator/cohorts/:id`; dropped the `runner` option from `createHonoApp` calls
- `packages/service/src/anchor-state.ts` / `static-site.ts` / `demo-server.ts` / `operator-auth.ts` - updated stale `/dashboard/*` doc/log references
- `packages/service/tests/monitor.spec.ts` - added ended-taxonomy survival, 24-cap eviction, metrics, fallback tagging, broadcast-fail override, merged-route integration, freeze pins, and the summarizeTx fixture-fee guard
- `e2e/operator-cohort.ts` - moved the negative-auth 401 pin from `/dashboard/events` onto the gated monitoring read
- **Deleted:** `packages/service/src/dashboard-sse.ts`, `packages/web/src/components/dashboard/{DashboardView,CohortCard,MetricsStrip}.tsx`, `packages/web/src/stores/dashboard.ts`

## Decisions Made
- **Clean removal of the inert adapter options (not dead fields):** the only thing wiring `runner`/`broadcaster`/`network` into `createHonoApp` was the deleted `/dashboard/events` mount, so they were removed from `HonoAppOptions` entirely and the four call sites updated (`index.ts` + three specs). Honest for an internal workspace package with no external consumers.
- **`cohort-failed` is the failure source, not a threaded completion promise:** the service runner's `cohort-failed` event carries an attributed `cohortId` + `reason` directly (verified against `@did-btcr2/aggregation@0.4.0`'s `AggregationServiceEvents`), so the FAILED ended record is taken from it; the completion-rejection channel that `operator-cohorts.settleCompletion` consumes stays that module's concern (planning note 2 satisfied without cross-wiring).
- **Broadcaster frames refine, not duplicate, the fate:** `signing-complete` records anchored/fallback at event time; a later `beacon-broadcast-failed` overrides it to `failed` (D-18), so the operator never sees "anchored" for a tx that never confirmed. `fallback` counts toward the `anchored` metric (the script path still anchored on-chain).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] App.tsx needed no edit; the Dashboard tab was already route-retired in Phase 1**
- **Found during:** Task 1 (web Dashboard tab retirement)
- **Issue:** The plan's `read_first` described a "two-tab Participant/Coordinator shell" in `App.tsx` rendering `DashboardView`. In the current tree `App.tsx` already routes `/operator` to `OperatorConsole` and everything else to `BrowseView`; `DashboardView` was orphaned (imported by nothing). The Phase 1 route refactor had already removed the tab.
- **Fix:** Retiring the tab was purely deleting the four orphaned web files (`DashboardView`, `CohortCard`, `MetricsStrip`, `stores/dashboard.ts`); `App.tsx` was left untouched. Verified by grep (no remaining consumer) and a green web build.
- **Files modified:** none (deletions only)
- **Committed in:** `4b93781` (Task 1 commit)

**2. [Rule 3 - Blocking] Extra call sites + stale docs updated as a consequence of removing the inert adapter options**
- **Found during:** Task 1 (removing the `/dashboard/events` mount)
- **Issue:** Removing the `runner`/`broadcaster`/`network` options (and the `/dashboard/*` prefix) left them unused across `index.ts`, `operator-cohorts.spec.ts`, and `monitor.spec.ts` (eslint no-unused-vars) and left stale `/dashboard/*` references in `operator-auth.ts`, `operator-auth.spec.ts`, `anchor-state.ts`, `static-site.ts`, `broadcast.ts`, and `demo-server.ts`.
- **Fix:** Dropped the options from all four `createHonoApp` call sites (reworking `bootApp` to need no runner), migrated the `operator-auth.spec` stand-in guarded route onto `/v1/operator/cohorts/:id`, and refreshed the stale doc/log comments to reference the retired feed honestly. These files extend the plan's Task 1 `<files>` list but are necessary for a green, clean gate (the plan required the gate to stay green across the deletion).
- **Committed in:** `4b93781` (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (both blocking-issue consequences of the atomic retirement). No behavioral surprises; all other work matched the plan.

## Known Stubs
None that block the plan goal. The `needs-funding` value in the `CohortChip` union is an INTENTIONAL reserved placeholder: it is part of the fixed UI-SPEC tone map (D-04) but is DELIBERATELY never emitted by this plan's fold - the live funding-stage plan **04-06** populates it. No hardcoded empty value flows to the UI as invented data; a live cohort reads `filling`/`co-signing` from its phase and an ended cohort reads its captured terminal fate.

## Verification Evidence
- `pnpm test` (tsc -b + vitest, the committed CI gate) -> **392 passed** (29 files), no regressions.
- `pnpm vitest run packages/service/tests/monitor.spec.ts` -> **21 passed** (12 tracer + 9 new).
- `pnpm --filter @btcr2-aggregation/service exec tsc -b` -> exit 0.
- `pnpm --filter @btcr2-aggregation/web build` -> green (694 modules).
- `pnpm lint` (eslint .) -> clean.
- `pnpm tsx e2e/operator-cohort.ts --quiet` -> **E2E PASSED** (migrated no-cookie `GET /v1/operator/cohorts/some-cohort` 401 pin proven end to end, plus the F2 expiry leg).
- Em-dash scan over all created/modified files -> none.
- grep -> no live `dashboard-sse` / `bridgeRunnerToSse` / `DashboardExtras` / `/dashboard/events` route mount or client consumer remains (only retirement doc comments).

## Threat Surface
No new network endpoints, auth paths, or trust-boundary schema were introduced. The gated monitoring read (`GET /v1/operator/cohorts/:id`) and the merged `GET /v1/operator/cohorts` both sit inside the existing `requireOperator` block; the monitoring key extends the operator DTO only, and the freeze pins prove the public directory/status/anchor DTOs are byte-unchanged. The Phase 3 negative-auth (401) invariant was preserved (migrated onto the new gated reads), and the ended-record store is bounded at 24 (DoS). All threat-register dispositions (T-04-02-01..04) are covered by tests.

## Next Phase Readiness
- 04-03 renders the console list surface (chips + metrics row) off the `monitoring` sibling key served here.
- 04-06 (live funding stage) populates the reserved `needs-funding` chip.
- End-of-phase live-UAT (04-08) exercises the full monitoring surface against Polar/regtest.

## Self-Check: PASSED

---
*Phase: 04-operator-cohort-monitoring*
*Completed: 2026-07-24*
