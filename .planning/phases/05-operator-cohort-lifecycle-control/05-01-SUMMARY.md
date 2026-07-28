---
phase: 05-operator-cohort-lifecycle-control
plan: 01
subsystem: api
tags: [aggregation, cohort-lifecycle, operator-console, hono, transport, sse, vitest]

# Dependency graph
requires:
  - phase: 01-operator-auth-and-on-demand-cohorts
    provides: the gated operator surface (ADR 0015 requireSameOrigin + requireOperator) and the two operator-driven advertiseCohort call sites every lifecycle verb now mounts behind
  - phase: 04-operator-monitoring-and-live-path
    provides: the per-service monitoring fold (event-time ended taxonomy, bounded-24 retention, noteFunding push seam) and the per-cohort side tables the cancel path retires
provides:
  - a per-service cohort INTENT registry (declare-then-stop) that classifies deliberate cohort ends without matching on error text
  - a distinct canceled fate propagated to all three mirrored server sites (operator list DTO, monitoring chip, service metrics)
  - a gated POST /v1/operator/cohorts/:id/cancel with 401-before-lookup, 400 shape guard, and one 404 body for unknown/settled
  - funding-watch retirement on cancel, so the anonymous funding read stops claiming a canceled cohort awaits funding
  - transport advert-slot repair after every settle path, with slot-ownership tracking so a settle never re-publishes over a live advert
  - a hermetic two-cohort e2e:cancel leg proving a canceled cohort does not take its siblings joinability with it
affects: [05-02 cancel UI and canceled chip, 05-03 finalize-now, 05-06 per-draft discovery window, 05-07 pause drain mode]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Declare intent, then stop: an out-of-band per-service registry written BEFORE a silent library call, read by every fate consumer"
    - "Advert-slot repair: rebuild the library's own advert message and re-install it through the transport after any settle empties the single slot"
    - "App-side mirroring of library-private state with a deliberately SAFE failure direction (a stale mirror skips a repair, never causes a spurious one)"

key-files:
  created:
    - packages/service/src/cohort-intent.ts
    - packages/service/src/advert-republish.ts
    - packages/service/tests/cohort-cancel.spec.ts
  modified:
    - packages/service/src/operator-cohorts.ts
    - packages/service/src/monitor.ts
    - packages/service/src/index.ts
    - packages/service/src/hono-adapter.ts
    - e2e/operator-cohort.ts
    - package.json

key-decisions:
  - "Cohort fate is classified from an out-of-band intent registry, never from the completion rejection message: stopCohort (cancel), stop() (shutdown), and a stall all reject through the same channel, and message matching is the exact technique 04 D-45 was created to stop"
  - "A canceled cohort counts as NEITHER anchored NOR failed in the service metrics: it never anchored, and a deliberate operator decision must not inflate a failure counter (D-05)"
  - "cancelCohort does not delete the advertised entry itself: the completion rejection drives settleCompletion, which stays the single place a cohort leaves the advertised map"
  - "The advert-slot repair tracks which cohort owns the transport slot so only the owner's settle triggers a re-publish; re-publishing over a live advert would hand already-seated participants a duplicate advert their runner rejects"
  - "The e2e cancel leg was verified against a deliberately disabled repair (it fails), so the two-cohort assertion is proven not to be a false green"

patterns-established:
  - "Pattern 1 (RESEARCH): declare intent, then stop - the seam every later Phase 5 lifecycle verb rides"
  - "Pattern 3 (RESEARCH): repair the transport advert slot on every settle path, not only after cancel"
  - "Push seams for facts the runner does not emit: noteCanceled mirrors noteFunding exactly"

requirements-completed: [SVC-04]

coverage:
  - id: D1
    description: "The operator can cancel an advertised cohort before its beacon tx broadcasts; it immediately leaves GET /v1/directory and drops out of the GET /v1/status open count"
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/service/tests/cohort-cancel.spec.ts#removes the canceled cohort from the public directory and drops the open count"
        status: pass
      - kind: e2e
        ref: "pnpm e2e:cancel"
        status: pass
    human_judgment: false
  - id: D2
    description: "A canceled cohort is recorded with a distinct 'canceled' fate, never folded into 'failed' and never filed as 'expired' with the raw library string"
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/service/tests/cohort-cancel.spec.ts#lists the canceled cohort as state \"canceled\" with the fixed reason, never \"expired\""
        status: pass
      - kind: unit
        ref: "packages/service/tests/cohort-cancel.spec.ts#counts a cancel as neither anchored nor failed (an operator decision is not a failure)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The canceled fate is captured at event time, so a cohort the runner session has already garbage-collected still projects a Canceled record with its seats and an activity entry"
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/service/tests/cohort-cancel.spec.ts#captures the fate at event time in the monitoring fold: a canceled chip and an activity entry"
        status: pass
    human_judgment: false
  - id: D4
    description: "POST /v1/operator/cohorts/:id/cancel is reachable only with a valid operator session; an anonymous request returns 401 before any cohort-id lookup, so an existing and a never-existed id are indistinguishable"
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/service/tests/cohort-cancel.spec.ts#401s with no session cookie, before any cohort-id lookup"
        status: pass
    human_judgment: false
  - id: D5
    description: "Cancel is idempotent-safe at the edges: an unknown or already-settled cohort id returns 404 and changes nothing, and a malformed id returns 400 before any lookup"
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/service/tests/cohort-cancel.spec.ts#400s a malformed cohort id before any lookup"
        status: pass
      - kind: unit
        ref: "packages/service/tests/cohort-cancel.spec.ts#404s an unknown cohort id with a body that reveals nothing"
        status: pass
      - kind: unit
        ref: "packages/service/tests/cohort-cancel.spec.ts#reads \"unknown\" on a second cancel of the same cohort (already settled)"
        status: pass
    human_judgment: false
  - id: D6
    description: "The fate is classified from the intent registry and not from the rejection message: a whole-runner stop() is still filed as expired"
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/service/tests/cohort-cancel.spec.ts#files a whole-runner stop() as expired, not canceled"
        status: pass
      - kind: unit
        ref: "packages/service/tests/cohort-cancel.spec.ts#files an idle-cohort stall as expired while a cancel of its sibling reads canceled"
        status: pass
    human_judgment: false
  - id: D7
    description: "Canceling the most recently advertised cohort leaves every other still-open cohort joinable: a freshly constructed participant pointed at a sibling still receives a COHORT_ADVERT and seats"
    requirement: SVC-04
    verification:
      - kind: e2e
        ref: "pnpm e2e:cancel"
        status: pass
    human_judgment: false
  - id: D8
    description: "Canceling a cohort retires its funding watch, so the public GET /v1/funding/:cohortId read stops claiming the cohort awaits funding"
    requirement: SVC-04
    verification: []
    human_judgment: true
    rationale: "The wiring is unit-proven in isolation (the monitor's canceled guard) but the end-to-end claim spans the live+broadcast funding watch, which only exists on a real esplora path. The hermetic suite cannot exercise it; the owner's opt-in live walkthrough is where a canceled funding cohort would actually be observed."
  - id: D9
    description: "Cancel under a settle race is answered 404 with nothing changed, and never produces two ended records for one cohort id"
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/service/tests/cohort-cancel.spec.ts#reads \"unknown\" on a second cancel of the same cohort (already settled)"
        status: pass
      - kind: unit
        ref: "packages/service/tests/cohort-cancel.spec.ts#is idempotent in the fold: a second noteCanceled adds no duplicate record or log line"
        status: pass
    human_judgment: false

# Metrics
duration: 24 min
completed: 2026-07-28
status: complete
---

# Phase 5 Plan 01: Cancel Tracer and Advert-Slot Repair Summary

**Operator cancel built end to end on a declare-intent-then-stop registry, giving a canceled cohort its own fate everywhere the operator can see it, plus the transport advert-slot repair that keeps a cancel from silently un-advertising its sibling cohorts.**

## Performance

- **Duration:** 24 min
- **Started:** 2026-07-28T22:31:00Z
- **Completed:** 2026-07-28T22:55:00Z
- **Tasks:** 2
- **Files modified:** 12 (3 created, 9 modified)

## Accomplishments

- `cohort-intent.ts`: a per-service, bounded-24, closure-scoped registry whose whole reason for existing is that `runner.stopCohort` emits NOTHING. The intent is declared before the library call, so both fate consumers read a deliberate declaration instead of guessing from an error string.
- A distinct `canceled` fate propagated to all three mirrored server sites: the operator list DTO (`state: 'canceled'` with the fixed reason `canceled by the operator`), the monitoring summary chip, and the service metrics (counted as neither anchored nor failed).
- `monitor.noteCanceled`: a push seam mirroring `noteFunding` exactly, capturing the seats/capacity snapshot at event time so a session-GC'd cohort still projects an honest Canceled record with its activity line.
- A gated `POST /v1/operator/cohorts/:id/cancel` that rejects anonymously with 401 before any lookup, 400s a malformed id, and answers one indistinguishable 404 for unknown, never-advertised, and already-settled ids.
- `advert-republish.ts` plus `repairAdvertSlot`: the transport's single advert slot is re-installed after every settle path, closing a latent defect (a settle un-advertises still-open siblings) that Cancel would otherwise have promoted from a rare race to a button.
- A hermetic two-cohort `e2e:cancel` leg, verified against a deliberately disabled repair so the assertion is proven not to be a false green.

## Task Commits

Each task was committed atomically:

1. **Task 1: Declare intent then stop - cancelCohort, the canceled fate, and the gated route** - `cb82d9f` (feat)
2. **Task 2: Repair the single advert slot after every settle, proven by a two-cohort e2e** - `a547f20` (feat)

## Files Created/Modified

- `packages/service/src/cohort-intent.ts` (new) - the declare/read/clear intent registry, bounded at 24 with oldest-first eviction, with the full rationale for why message-text classification is forbidden.
- `packages/service/src/advert-republish.ts` (new) - rebuilds exactly the advert `AggregationService.advertise` builds and re-installs it via `transport.publishRepeating`; also exposes `clear()` so an empty open set genuinely empties the slot.
- `packages/service/tests/cohort-cancel.spec.ts` (new, 18 tests) - the registry's own semantics, the canceled fate across list/monitor/metrics, the route's 401/400/404/200 matrix, the edge cases, and the two negative controls proving intent-driven (not message-driven) classification.
- `packages/service/src/operator-cohorts.ts` - widened `OperatorCohortDTO.state`, terminal records now carry a fate, `settleCompletion` branches on the declared intent, `cancelCohort`, and `repairAdvertSlot` on all three settle paths.
- `packages/service/src/monitor.ts` - `noteCanceled`, the `canceled` chip on both unions, cancel excluded from the anchored and failed counters, and a canceled guard on the anonymous funding read.
- `packages/service/src/index.ts` - one intents registry per service, the `onCancel` hook (fold the fate, then release the per-cohort side tables), and the republisher built from the same transport and identity the runner publishes with.
- `packages/service/src/hono-adapter.ts` - the gated cancel route inside the existing operator block.
- `e2e/operator-cohort.ts` - the `--cancel` leg and its dispatch, plus the local wire-DTO unions.
- `package.json` - the `e2e:cancel` script.
- `packages/service/src/operator-cohorts.spec.ts`, `packages/service/tests/monitor.spec.ts`, `packages/service/tests/operator-cohorts-display.spec.ts` - construction fix for the now-required `intents` option.

## Decisions Made

- **The intent registry is REQUIRED, not optional, on `createOperatorCohorts`.** An optional registry with a private fallback would let a caller silently get a surface whose cancel path cannot classify its own fate. Six existing spec call sites were updated mechanically instead.
- **`cancelCohort` deliberately does not delete the `advertised` entry.** The completion rejection drives `settleCompletion`, which stays the single place a cohort leaves that map, so there is exactly one settle path to reason about.
- **The advert-slot repair tracks slot ownership.** Only the settle of the cohort that owns the slot triggers a re-publish. The tracker mirrors library-private state, so it is documented as an approximation with a safe failure direction: a stale mirror SKIPS a repair (today's behavior) and can never cause a spurious re-publish (which would deliver a duplicate advert to already-seated participants, whose runner rejects a re-join with an error).
- **The canceled reason is fixed contract copy**, not the library's `Cohort {id} stopped.`, which reads as a malfunction rather than the operator's own decision.
- **Re-advertise accepts either terminal fate.** A canceled cohort is revivable through the existing `/readvertise` route, since an operator who changes their mind is a legitimate case and the retained config is identical.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated six existing `createOperatorCohorts` call sites for the newly required `intents` option**
- **Found during:** Task 1
- **Issue:** The plan specifies `intents` as a REQUIRED option, which breaks every existing construction site in the spec suite (`operator-cohorts.spec.ts`, `monitor.spec.ts`, `operator-cohorts-display.spec.ts`).
- **Fix:** Added the `createCohortIntents` import and `intents: createCohortIntents()` to each site. Mechanical, no behavior change: each spec gets its own independent registry, which is the correct per-service posture.
- **Files modified:** packages/service/src/operator-cohorts.spec.ts, packages/service/tests/monitor.spec.ts, packages/service/tests/operator-cohorts-display.spec.ts
- **Verification:** `pnpm typecheck` green, full 540-test suite green.
- **Committed in:** `cb82d9f`

**2. [Rule 2 - Missing Critical] Canceled guard on the anonymous funding read**
- **Found during:** Task 1
- **Issue:** The plan's truth requires that canceling a cohort stops `GET /v1/funding/:cohortId` claiming it awaits funding, and names `releaseCohortTables` as the mechanism. But `releaseCohortTables` only stops the WATCH; the monitor keeps its own last-known `FundingView`, whose `state: 'waiting'` and absent `terminal` would keep the anonymous read answering `awaitingFunding: true` forever, since nothing would ever write that view again. This is precisely the WR-01 failure mode Phase 4 fixed for the lapse case.
- **Fix:** `publicFunding` now returns `false` for any cohort holding a `canceled` ended record, checked before the view lookup so it holds whether or not a view was ever recorded.
- **Files modified:** packages/service/src/monitor.ts
- **Verification:** Reasoned against the shipped `publicFunding` contract and the WR-01 comment it sits beside; the live+broadcast funding watch has no hermetic harness, so this deliverable is flagged `human_judgment: true` (coverage D8) rather than claimed as proven.
- **Committed in:** `cb82d9f`

**3. [Rule 1 - Bug] Slot-ownership tracking and `clear()` on the advert republisher**
- **Found during:** Task 2
- **Issue:** The plan's repair (re-publish on every settle, unconditionally) introduces two new defects of its own. (a) The runner's stop closure is id-scoped, so once WE installed the current advert, the settling cohort's own dispose no longer clears it: with no open cohort left, our advert for a dead cohort would linger for its whole TTL and be replayed to new subscribers, where "leave the slot empty" was the stated intent. (b) Re-publishing on a settle that did NOT empty the slot delivers a duplicate advert to every connected participant, including ones already seated in that cohort, whose runner throws `INVALID_PHASE` on the re-join and emits an error.
- **Fix:** The republisher remembers the stop closure of the advert IT installed and exposes `clear()`, called when no open cohort remains. `operator-cohorts.ts` tracks which cohort owns the slot (set at the two `advertiseCohort` call sites and at each repair) and repairs only when the settling cohort was the owner. The tracker's failure direction is documented as safe: staleness can only skip a repair, never cause a spurious one.
- **Files modified:** packages/service/src/advert-republish.ts, packages/service/src/operator-cohorts.ts
- **Verification:** `pnpm e2e:cancel` green, and proven non-vacuous by temporarily removing the repair wiring and confirming the leg fails on exactly the sibling-seating assertion.
- **Committed in:** `a547f20`

---

**Total deviations:** 3 auto-fixed (1 blocking, 1 missing critical, 1 bug)
**Impact on plan:** All three were necessary for the plan's own stated truths to hold. The signature refinements to `createAdvertRepublisher` (an object with `republish`/`clear` rather than a bare function) and to `repairAdvertSlot` (taking the settled cohort id) are the only interface departures; no other plan in this phase references either symbol. No scope creep.

## Issues Encountered

- **The advert slot is also cleared when a cohort FILLS, not only when it settles.** `#stopAdvertRepeating` runs at `keygen-complete` as well as on the three settle paths, so the same defect fires when a cohort reaches its last seat. Out of scope for this plan (which scopes the repair to the settle paths and registers no runner listeners in `operator-cohorts.ts`); logged to `deferred-items.md` with the suggested home.

## Known Stubs

None. Every surface this plan added is fully wired: the intent registry has both consumers, the cancel route reaches a real primitive, the fate reaches all three read models, and the advert repair is proven by a failing-without-it e2e. The `'window-expired'` member of `CohortIntent` is a deliberate forward declaration for the 05-06 discovery-window timer, not a stub: it is a type member with no behavior claimed anywhere in the UI or the DTOs.

## Verification Results

| Check | Result |
|---|---|
| `pnpm vitest run packages/service/tests/cohort-cancel.spec.ts packages/service/src/operator-cohorts.spec.ts` | 50 tests pass |
| `pnpm e2e:cancel` | pass (and fails when the repair is disabled) |
| `pnpm test` (full suite, `tsc -b` gated) | 41 files, 540 tests pass |
| `pnpm lint` | clean |
| `pnpm e2e:operator` | pass (no regression; now also runs the cancel leg) |
| `pnpm e2e:monitor` | pass (no regression) |
| `pnpm --filter @btcr2-aggregation/web build` | clean |
| No em-dash in any touched file | confirmed |

## User Setup Required

None - no external service configuration required. The cancel route mounts inside the existing operator block, so it appears only on a service booted with `OPERATOR_PASSWORD` (fail-closed, unchanged).

## Next Phase Readiness

- The seam the rest of Phase 5 rests on exists and is under test. 05-06's per-draft discovery window declares `'window-expired'` into the same registry; 05-03's finalize-now mounts beside the cancel route in the same gated block.
- 05-02 (the cancel UI) can proceed: the server emits `state: 'canceled'` on the operator list DTO and a `canceled` chip on the monitoring rows, which is exactly what its `chipForCohort` / `groupForChip` work consumes. The web client keeps its own copies of both unions, so nothing there is broken today; it simply does not render the new fate yet.
- One carried concern: the advert slot is cleared on cohort FILL as well as on settle (see `deferred-items.md`). It is pre-existing, not introduced here, and does not affect the cancel path.

## Self-Check: PASSED

- Created files verified present on disk: `packages/service/src/cohort-intent.ts`, `packages/service/src/advert-republish.ts`, `packages/service/tests/cohort-cancel.spec.ts`.
- Commits verified in git history: `cb82d9f`, `a547f20`.
- All task acceptance criteria re-run and passing; plan-level verification block re-run and green.

---
*Phase: 05-operator-cohort-lifecycle-control*
*Completed: 2026-07-28*
