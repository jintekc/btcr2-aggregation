---
phase: 03-participant-submit-co-sign-track-and-resolve
plan: 02
subsystem: service
tags: [service, anchor, broadcaster, public-read, hono, bounded-map, vitest, security]

# Dependency graph
requires:
  - phase: 01-operator-auth-and-on-demand-advertise
    provides: BeaconBroadcaster + attachBeaconBroadcast lifecycle events (broadcast/anchored/failed)
  - phase: 01-operator-auth-and-on-demand-advertise
    provides: operatorAuth-gated block (ADR 0015) the new public route mounts OUTSIDE of
provides:
  - "AnchorReadDTO type ({ enabled, state, txid?, explorerUrl?, reason? }) - public chain facts only"
  - "createAnchorState(broadcaster?, network?) per-service closure factory folding broadcaster frames into a bounded retained map"
  - "public GET /v1/anchor/:cohortId route (fail-open, non-oracle, shape-guarded)"
affects: [03-04 participant store anchor poll, 03-06 tracking UI, participant]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Retained-event-state fold: subscribe once to a typed EventEmitter and collapse fire-once lifecycle frames into a bounded last-known Map keyed by cohortId (compose of operator-cohorts bounded map + broadcast.ts emitter)"
    - "Mode-honesty bit: DTO carries enabled = Boolean(producer) so the client renders live-only fields (Anchored/txid) only on a service that broadcasts (mirrors GET /v1/ipfs {enabled:false} probe)"
    - "Public read = last-known state, never chain I/O: an anonymous route serves retained broadcaster state so it cannot drive esplora (DoS) nor break the hermetic default"

key-files:
  created:
    - packages/service/src/anchor-state.ts
    - packages/service/src/anchor-state.spec.ts
  modified:
    - packages/service/src/hono-adapter.ts
    - packages/service/src/index.ts

key-decisions:
  - "Anchor facts are public chain data (like /resolve + /cas), so GET /v1/anchor/:cohortId is anonymous and mounts OUTSIDE the operatorAuth block; the /dashboard/* + /v1/operator/* gating stays byte-untouched (D-20/D-21, ADR 0015 preserved)"
  - "createAnchorState is constructed only when a broadcaster is present, so its enabled bit is mode-honest; the route still mounts on a non-broadcasting service and fails open to { enabled:false, state:none } (never a 500)"
  - "Unknown cohortId returns { state:none } (never 404) so never-existed and evicted are indistinguishable (no existence oracle); the retained map is bounded at 24 oldest-first (DoS); the raw broadcast-failure reason is dropped for a generic 'broadcast failed'"

patterns-established:
  - "beacon-anchored{confirmed:false} folds to 'broadcast' (pending is not a failure); only confirmed:true reaches 'confirmed'"
  - "explorerUrl derived under a local try/catch exactly as dashboard-sse.ts, with the offline network's empty string collapsed to undefined so a bad/absent network never throws on the anonymous read"

requirements-completed: [PART-04]

coverage:
  - id: D1
    description: "createAnchorState folds the three broadcaster frames into a pollable last-known DTO: beacon-broadcast->broadcast+txid, beacon-anchored{confirmed:true}->confirmed, confirmed:false stays broadcast, beacon-broadcast-failed->failed+generic reason"
    requirement: "PART-04"
    verification:
      - kind: unit
        ref: "packages/service/src/anchor-state.spec.ts#folds broadcast -> confirmed, carrying the txid and deriving explorerUrl"
        status: pass
      - kind: unit
        ref: "packages/service/src/anchor-state.spec.ts#keeps confirmed:false as broadcast (pending, not a failure)"
        status: pass
      - kind: unit
        ref: "packages/service/src/anchor-state.spec.ts#folds a broadcast failure to failed with a GENERIC reason (never the raw error)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The DTO carries a mode-honesty enabled bit (true only with a broadcaster) and answers an unknown cohortId with state:none (no existence oracle)"
    requirement: "PART-04"
    verification:
      - kind: unit
        ref: "packages/service/src/anchor-state.spec.ts#reports enabled === Boolean(broadcaster): true with one, false without"
        status: pass
      - kind: unit
        ref: "packages/service/src/anchor-state.spec.ts#answers an unknown cohortId with state:none (no existence oracle), never throwing"
        status: pass
    human_judgment: false
  - id: D3
    description: "The retained map is bounded at 24 with oldest-first eviction so an anonymous read cannot grow it without bound (DoS)"
    requirement: "PART-04"
    verification:
      - kind: unit
        ref: "packages/service/src/anchor-state.spec.ts#bounds the retained map at 24, evicting the OLDEST cohort first"
        status: pass
    human_judgment: false
  - id: D4
    description: "GET /v1/anchor/:cohortId is public (before the operatorAuth block), shape-guards the cohortId with a cheap 400, and fails open to { enabled:false, state:none } when no anchorState is wired; the gated surface is untouched"
    requirement: "PART-04"
    verification:
      - kind: unit
        ref: "packages/service/src/anchor-state.spec.ts#fails open to { enabled:false, state:none } when no anchorState is wired"
        status: pass
      - kind: unit
        ref: "packages/service/src/anchor-state.spec.ts#rejects a malformed cohortId with a cheap 400 BEFORE any lookup"
        status: pass
      - kind: unit
        ref: "packages/service/src/anchor-state.spec.ts#serves the retained DTO for a known cohort on a broadcasting service"
        status: pass
      - kind: e2e
        ref: "pnpm e2e && pnpm e2e:operator && pnpm e2e:browse"
        status: pass
    human_judgment: false

# Metrics
duration: 6min
completed: 2026-07-17
status: complete
---

# Phase 3 Plan 02: Public Anchor-Status Read Summary

**A minimal public `GET /v1/anchor/:cohortId` read, backed by a bounded per-service retained map that folds the existing `BeaconBroadcaster`'s fire-once broadcast/anchored/failed frames into a pollable last-known DTO - the PART-04 tracking source the browser polls, anonymous because anchor facts are public chain data, and mounted without weakening the operator-gated telemetry (ADR 0015).**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-07-17T15:07Z
- **Completed:** 2026-07-17T15:13Z
- **Tasks:** 2
- **Files created:** 2, **modified:** 2

## Accomplishments

- Added `anchor-state.ts`: an `AnchorReadDTO` (`{ enabled, state, txid?, explorerUrl?, reason? }`), an `AnchorState` interface, and a `createAnchorState(broadcaster?, network?)` per-service closure factory. It subscribes once to the broadcaster's three lifecycle events and folds them into a bounded `Map<cohortId, entry>`: `beacon-broadcast` -> `broadcast`+txid, `beacon-anchored{confirmed:true}` -> `confirmed`, `confirmed:false` stays `broadcast` (pending is not a failure), `beacon-broadcast-failed` -> `failed` with a GENERIC reason (the raw esplora/policy error is dropped).
- Bounded the retained map at 24 with oldest-first (insertion-order) eviction, reusing the `rememberTerminal` idiom from `operator-cohorts.ts`, so an anonymous read can never grow the map without bound (T-03-02-03, DoS) and every read is O(1). A re-set moves a progressing cohort to the end so it is not evicted mid-life.
- Mounted the public `GET /v1/anchor/:cohortId` in the PUBLIC block beside `/v1/directory` + `/v1/ipfs` and BEFORE the `if (operatorAuth)` gate: a cheap `^[0-9a-zA-Z-]{1,64}$` 400 shape-guard runs before any lookup, an unknown cohortId returns `{ state:none }` (never 404, no existence oracle), and when no anchorState is wired it fails open to `{ enabled:false, state:none }` (never a 500), mirroring `/v1/directory`'s empty default.
- Wired `createService`: `anchorState` is constructed only when a broadcaster exists (so its `enabled` bit is mode-honest) and threaded into `createHonoApp`; the module's public types are re-exported from `index.ts`.
- Regression gate green: 317 unit + e2e tests (up from 313, +4 new route tests on top of Task 1's 8), plus the three plan-called-out e2e gates (`e2e`, `e2e:operator`, `e2e:browse`) all pass - confirming the additive public route disturbs neither the protocol path nor the gated operator surface.

## Task Commits

Each task was committed atomically (Task 1 is TDD-tagged, so RED and GREEN are separate commits):

1. **Task 1 (RED): failing spec for the retained anchor-state fold** - `b7767e6` (test)
2. **Task 1 (GREEN): retained anchor-state fold module** - `ac0e656` (feat)
3. **Task 2: mount public GET /v1/anchor/:cohortId + wire createService** - `d811b15` (feat)

## Files Created/Modified

- `packages/service/src/anchor-state.ts` (NEW) - `AnchorReadDTO`, `AnchorState`, `createAnchorState` factory; bounded fold of broadcaster frames; safe `explorerUrl` derivation.
- `packages/service/src/anchor-state.spec.ts` (NEW) - 8 fold/bound/enabled/non-oracle unit cases plus a 4-case `GET /v1/anchor/:cohortId route` integration block (fail-open, 400 guard, retained DTO, unknown->none) via `createHonoApp(...).request`.
- `packages/service/src/hono-adapter.ts` - Added the optional `anchorState?: AnchorState` field to `HonoAppOptions`, destructured it, and mounted the public route in the PUBLIC block before the operatorAuth gate (gating byte-untouched).
- `packages/service/src/index.ts` - Imported `createAnchorState`, constructed `anchorState` only when a broadcaster exists, threaded it into `createHonoApp`, and re-exported `createAnchorState` / `AnchorState` / `AnchorReadDTO`.

## Decisions Made

- **The anchor read is PUBLIC and mounts outside the operatorAuth block.** Anchor facts are public chain data, no different from the unauthenticated `/resolve` + `/cas` reads; a participant who joined by choice needs the same broadcast/confirmed/failed + txid facts to track their anchor. ADR 0015's `/dashboard/*` + `/v1/operator/*` gating is byte-untouched (the diff hunks are all before the `if (operatorAuth)` line).
- **anchorState is constructed only with a broadcaster, so `enabled` is mode-honest.** A hermetic/non-broadcasting service passes `undefined`; the route still mounts and every read is `{ enabled:false, state:none }`, so the client renders Anchored/txid only on a broadcasting service (D-07, mirrors the `/v1/ipfs {enabled:false}` probe).
- **Non-oracle + bounded + generic-reason are the security posture.** Unknown -> `{ state:none }` (never 404) so never-existed and evicted are indistinguishable (T-03-02-02); the map is bounded at 24 oldest-first (T-03-02-03); the raw broadcast-failure reason is dropped for a generic `broadcast failed` (T-03-02-01); the read never touches esplora (T-03-02-05).

## Deviations from Plan

None - plan executed exactly as written. Both DTO shape, the bounded map, the fold semantics, the route mount site, and the createService wiring match the plan's `must_haves` and threat register verbatim.

## Threat Register Verification

All five STRIDE items in the plan's `<threat_model>` are mitigated as designed and pinned by spec:
- **T-03-02-01 (info disclosure, DTO):** DTO carries only `enabled/state/txid/explorerUrl/reason`; failure reason is generic (`folds a broadcast failure to failed with a GENERIC reason` asserts the raw esplora text is absent).
- **T-03-02-02 (info disclosure, unknown-cohort oracle):** unknown -> `{ state:none }`, never 404 (`answers an unknown cohortId with state:none`).
- **T-03-02-03 (DoS, map growth):** bounded 24 oldest-first (`bounds the retained map at 24, evicting the OLDEST cohort first`).
- **T-03-02-04 (EoP, route mount site):** route mounted before the operatorAuth block; gating untouched (source-order + diff-hunk verification).
- **T-03-02-05 (DoS, esplora-on-read):** the read serves retained state only; no chain I/O on the read path.

## Issues Encountered

None. TDD RED confirmed the module was absent before implementation; GREEN passed on first run; typecheck (`tsc -b`) stayed green throughout. No new packages (zero-install plan).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The PART-04 tracking source is ready for the Wave 3 consumers: the 03-04 participant store polls `GET /v1/anchor/:cohortId` (with a stale-continuation epoch guard) and reads `enabled` to gate mode-honest copy; the 03-06 tracking UI renders Anchored/txid/explorerUrl only when `enabled`.
- The read is fail-open and non-oracle by construction, so the hermetic default (no broadcaster) still returns a sane `{ enabled:false, state:none }` - the browser E2Es and unit path never depend on a live chain.
- No blockers introduced. The additive public route leaves the operator-gated telemetry (ADR 0015) fully intact.

---
*Phase: 03-participant-submit-co-sign-track-and-resolve*
*Completed: 2026-07-17*

## Self-Check: PASSED

- FOUND: `packages/service/src/anchor-state.ts`
- FOUND: `packages/service/src/anchor-state.spec.ts`
- FOUND: `.planning/phases/03-participant-submit-co-sign-track-and-resolve/03-02-SUMMARY.md`
- FOUND commit `b7767e6` (Task 1 RED, test)
- FOUND commit `ac0e656` (Task 1 GREEN, feat)
- FOUND commit `d811b15` (Task 2, feat)
