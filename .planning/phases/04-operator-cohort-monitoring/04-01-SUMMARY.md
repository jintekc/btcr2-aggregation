---
phase: 04-operator-cohort-monitoring
plan: 01
subsystem: api
tags: [monitoring, event-fold, read-model, hono, zustand, react, polling, aggregation-runner]

# Dependency graph
requires:
  - phase: 03-participant-lifecycle
    provides: "anchor-state.ts bounded-fold template, operator-cohorts.ts list/directory merge target, operatorAuth gated route block, gated operator store + lib fetch conventions"
provides:
  - "Per-service createCohortMonitor(runner) fold: opt-in -> pending, accept -> seated, bounded at 24 with oldest-first eviction, pure idempotent detail(cohortId) projection"
  - "Gated GET /v1/operator/cohorts/:id monitoring detail read (operator-only, non-oracle, 401 before any lookup)"
  - "Discriminated FetchResult<T> + fetchCohortDetail (401 vs unreachable vs ok) on the web client"
  - "Operator store drill-down view state + pollDetail (session-expiry re-login vs freeze-on-unreachable) + SESSION_EXPIRED copy"
  - "CohortDetail drill-down component rendering live members (seated/pending) + seats, reached from advertised rows"
affects: [04-02-dashboard-sse-retirement, 04-drill-down-submissions, 04-drill-down-anchor, 04-funding-stage, 04-export, phase-5-runtime-toggles]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Runner-event fold as an independent per-service closure factory (D-27): subscribe once to membership events, fold into a bounded Map, serve a pure O(1) projection - mirrors anchor-state without entangling the frozen public read"
    - "Discriminated fetch result (FetchResult<T>) so the store tells session-expiry (401 -> re-login) apart from a transient fault (unreachable -> freeze last-known), the discrimination the status-blind Phase 1 helpers lacked"
    - "SPA-internal drill-down view state (D-03): list vs { detail, cohortId } toggle, polled only while open"

key-files:
  created:
    - packages/service/src/monitor.ts
    - packages/service/tests/monitor.spec.ts
    - packages/web/src/components/operator/CohortDetail.tsx
    - packages/web/tests/operator.spec.ts
  modified:
    - packages/service/src/index.ts
    - packages/service/src/hono-adapter.ts
    - packages/web/src/lib/operator.ts
    - packages/web/src/stores/operator.ts
    - packages/web/src/components/operator/OperatorConsole.tsx
    - packages/web/src/components/operator/OperatorCohortList.tsx

key-decisions:
  - "Monitor is an INDEPENDENT per-service module (D-27) consuming the same runner emitters, not folded into the frozen anchor-state; the public anchor read stays byte-untouched"
  - "detail() enriches seats/phase/capacity from runner.session even when no fold entry exists, so an advertised cohort with zero opt-ins still reads exists:true with its real seat count (UI-SPEC E5 empty), while an unknown/evicted id with no live presence reads the non-oracle exists:false"
  - "Members are folded from the monitor's OWN entry (each wall-clock stamped at receipt, D-22) so a session-GC'd ended cohort still projects its members"
  - "The tracer deliberately stops at members/seats; partial-sig / submissions / anchor / funding are later plans (D-32 honest-limit preserved, no invented progress)"

patterns-established:
  - "Bounded runner-event fold (createCohortMonitor): remember()/evict at MAX_MONITORED=24, fire-and-forget listeners with a defensive catch so a monitoring failure never rejects to the runner"
  - "Gated monitoring read mounted after requireOperator inside the operatorAuth block: anonymous -> 401 before any cohort-id lookup (no existence oracle)"
  - "pollDetail branch table: unauthorized -> logged-out + SESSION_EXPIRED; unreachable -> freeze + detailStale; ok -> store detail + stamp lastUpdated"

requirements-completed: [SVC-03]

coverage:
  - id: D1
    description: "createCohortMonitor folds opt-in -> pending and accept -> seated, is a per-service closure (independent instances), bounds entries at 24 with oldest-first eviction, and returns a pure idempotent non-oracle projection"
    requirement: SVC-03
    verification:
      - kind: unit
        ref: "packages/service/tests/monitor.spec.ts#createCohortMonitor"
        status: pass
    human_judgment: false
  - id: D2
    description: "Gated GET /v1/operator/cohorts/:id: 401 anonymous (before any lookup), 400 on bad id shape, 200 detail DTO with a session, non-oracle 200 for unknown ids"
    requirement: SVC-03
    verification:
      - kind: integration
        ref: "packages/service/tests/monitor.spec.ts#GET /v1/operator/cohorts/:id monitoring route"
        status: pass
    human_judgment: false
  - id: D3
    description: "fetchCohortDetail never throws and discriminates 401 (unauthorized) vs network/non-ok (unreachable) vs 200 (ok); the store's pollDetail routes 401 -> logged-out+session-expired, unreachable -> freeze, ok -> store+stamp; drill-down view opens/closes"
    requirement: SVC-03
    verification:
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#fetchCohortDetail, operator store pollDetail branching, operator store drill-down view state"
        status: pass
    human_judgment: false
  - id: D4
    description: "Operator can open an advertised cohort and watch members (seated vs pending) + seats live in the CohortDetail drill-down; drafts do not open a drill-down; back link returns to the list"
    requirement: SVC-03
    verification:
      - kind: manual_procedural
        ref: "end-of-phase live-UAT (04-08); operator session, open an advertised cohort, watch a join land"
        status: unknown
    human_judgment: true
    rationale: "Live member/seat updating and the visual drill-down are a rendered UX behavior best confirmed by the owner in the browser; the unit + route tests prove the data path but not the rendered live view."

# Metrics
duration: 13min
completed: 2026-07-24
status: complete
---

# Phase 4 Plan 01: Monitoring Read-Model Tracer Summary

**Per-service runner-event fold (`createCohortMonitor`) serving a gated `GET /v1/operator/cohorts/:id` members/seats detail read, consumed by a polled operator drill-down that discriminates session-expiry (re-login) from an unreachable poll (freeze).**

## Performance

- **Duration:** ~13 min
- **Started:** 2026-07-24T14:52:00Z (approx)
- **Completed:** 2026-07-24T15:05:00Z (approx)
- **Tasks:** 2
- **Files modified:** 6 modified, 4 created

## Accomplishments
- Proved the polled-snapshot monitoring architecture (D-19) end to end on the members/seats fact: runner membership events -> per-service bounded fold -> gated detail read -> polled console drill-down.
- Established the two seams later Phase 4 plans build on: the independent `createCohortMonitor` accumulator (D-27) and the discriminated `FetchResult<T>` (D-16/D-25) with SPA-internal drill-down view state (D-03).
- SVC-03 criterion 1 (who joined, seats remaining, live) and criterion 4 (operator-only, 401 before any lookup) hold for the tracer scope.

## Task Commits

Each task was committed atomically (unsigned per project convention):

1. **Task 1: Monitor fold module + gated detail read (backend tracer)** - `1814ca9` (feat)
2. **Task 2: Discriminated fetch + drill-down view state + live members/seats render (web tracer end)** - `3922142` (feat, TDD RED->GREEN during development)

## Files Created/Modified
- `packages/service/src/monitor.ts` - `createCohortMonitor(runner)` per-service fold + `detail(cohortId)` projection + DTOs (created)
- `packages/service/tests/monitor.spec.ts` - fold / non-oracle / eviction / idempotency / isolation + gated route tests (created)
- `packages/service/src/index.ts` - construct the monitor after the runner, thread into `createHonoApp`, re-export types (modified)
- `packages/service/src/hono-adapter.ts` - `monitor?` option + gated `GET /v1/operator/cohorts/:id` route inside the operatorAuth block (modified)
- `packages/web/src/lib/operator.ts` - `FetchResult<T>`, `CohortDetailDTO`/`CohortMemberDTO`, `fetchCohortDetail` (modified)
- `packages/web/src/stores/operator.ts` - drill-down view state, detail slice, `openCohort`/`closeCohort`/`pollDetail`, `SESSION_EXPIRED` (modified)
- `packages/web/src/components/operator/CohortDetail.tsx` - polled drill-down rendering live members + seats, honest checking/unreachable states (created)
- `packages/web/src/components/operator/OperatorConsole.tsx` - swap list vs detail on `view.kind`; pass `openCohort` to the list (modified)
- `packages/web/src/components/operator/OperatorCohortList.tsx` - optional `onOpen` prop + `Open` affordance on advertised rows (modified)
- `packages/web/tests/operator.spec.ts` - fetch discrimination + store poll branching + view state tests (created)

## Decisions Made
- **Independent monitoring module (D-27 discretion resolved):** `monitor.ts` subscribes to the same runner emitters the shipped modules use rather than entangling the frozen `anchor-state.ts` / `operator-cohorts.ts`. The public anchor read stays byte-untouched.
- **Live-enriched, fold-projected detail:** `detail()` reads `runner.session` for seats/phase/capacity when the cohort is still live (so a zero-opt-in advertised cohort reads `exists:true` with real seats for the UI-SPEC E5 empty line), but folds the member list from the monitor's own entry so a session-GC'd ended cohort still projects. An unknown id with neither a fold entry nor a live cohort reads the non-oracle `exists:false`.
- **Monitor constructed unconditionally** in `createService` (it is mode-agnostic and cheap), but the gated read it backs mounts only inside the operatorAuth block, so a fail-closed boot exposes no monitoring surface (D-26).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Wired `OperatorCohortList.tsx` (not in the Task 2 file list) so advertised rows open the drill-down**
- **Found during:** Task 2 (drill-down render)
- **Issue:** Task 2's acceptance criterion "Opening an advertised cohort row renders CohortDetail" and "Draft rows do NOT open a drill-down (D-09)" require an open affordance on advertised rows, but the rows are rendered by `OperatorCohortList.tsx`, which the task `<files>` list did not enumerate. Without touching it there was no way to reach the drill-down from the list.
- **Fix:** Added an optional `onOpen?: (id: string) => void` prop threaded to `CohortRow`; advertised rows (state === 'advertised') render a ghost `Open` button that calls it. Additive and backward-compatible (absent prop = no affordance); drafts and expired rows keep their existing treatment (D-09).
- **Files modified:** packages/web/src/components/operator/OperatorCohortList.tsx
- **Verification:** `pnpm --filter @btcr2-aggregation/web build` green; OperatorConsole passes `openCohort` and swaps to `CohortDetail` on `view.kind === 'detail'`.
- **Committed in:** `3922142` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking wiring).
**Impact on plan:** Necessary to satisfy the stated Task 2 acceptance criteria; the change is a single optional prop, no scope creep. All other work matched the plan.

## Issues Encountered
- None. The service package's `tsconfig.json` includes only `src/**/*`, so the new `packages/service/tests/monitor.spec.ts` is not typechecked by `tsc -b` (it is discovered and run by root vitest by default), consistent with the tests-outside-src convention. Verified both the vitest run and `tsc -b` pass.

## Known Stubs
None. The tracer intentionally scopes to members + seats; submissions, per-member co-sign progress, anchor detail, funding, and the activity log are explicitly later Phase 4 plans (and the partial-signature leg has no library event, D-32, so it will be honest-limited copy, not a stub). No hardcoded empty values flow to UI as invented data.

## Verification Evidence
- `pnpm vitest run packages/service/tests/monitor.spec.ts` -> 12 passed.
- `pnpm vitest run packages/web/tests/operator.spec.ts` -> 8 passed.
- `pnpm --filter @btcr2-aggregation/service exec tsc -b` -> exit 0.
- `pnpm --filter @btcr2-aggregation/web build` (tsc --noEmit + vite build) -> green.
- Full hermetic gate `pnpm vitest run` -> 384 passed (29 files), no regressions.
- Em-dash scan over all created/modified files -> none.

## Next Phase Readiness
- The monitoring seam is proven and under test. 04-02 (atomic dashboard-SSE retirement) and the deeper drill-down surfaces (submissions, co-sign, anchor, funding, activity, export) build on `createCohortMonitor` + the gated read + the discriminated fetch + drill-down view state established here.
- End-of-phase live-UAT (04-08) will confirm the rendered live members/seats view (coverage D4, human judgment) against Polar/regtest.

## Self-Check: PASSED

---
*Phase: 04-operator-cohort-monitoring*
*Completed: 2026-07-24*
