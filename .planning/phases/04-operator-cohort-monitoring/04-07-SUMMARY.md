---
phase: 04-operator-cohort-monitoring
plan: 07
subsystem: live-path
tags: [live-path, funding, honesty, participant, resolve, unconfirmed-signal, stall-copy, D-44, D-45, D-46, LIVE-01]

# Dependency graph
requires:
  - phase: 04-operator-cohort-monitoring
    plan: 06
    provides: "the monitor FundingView + noteFunding funding state (waiting/awaiting-confirmation/funded/dead-end) this plan projects to participants via publicFunding; FundingStateName; the live+broadcast serviceMode gate"
provides:
  - "monitor.publicFunding(cohortId): a NON-oracle awaiting-funding boolean projection of the funding state, gated to live+broadcast (hermetic/unknown read false); the anonymous participant vehicle for the mid-round funding signal"
  - "GET /v1/funding/:cohortId: a NEW additive public read mounted beside the frozen /v1/anchor read (D-26 byte-untouched); shape-guarded, fail-open, serves last-known funding-watch state (no chain I/O)"
  - "packages/web/src/lib/funding.ts fetchFunding: the anonymous (credentials omit) browser client mirroring anchor.ts"
  - "participant store: a post-seat funding poll recording an awaitingFunding fact + a latched liveCohort fact; the join-time on-chain notice + honest awaiting-funding wait copy (D-44)"
  - "participant store: the validationRequested per-round fact + an exported, unit-tested terminalReason rekeyed on it (D-45): submitted+!validation-requested -> positive stall copy; submitted+validation-requested+unsigned -> uncertainty-honest 'could not complete'"
  - "resolve.ts UnconfirmedSignalError + a NeedBeaconSignals seam guard (mempool-resident signal, no block_time) + a driveResolution Invalid-Date mapping; hono-adapter answers a distinguishable retryable 503 (D-46), no library fork"
affects: [04-08-live-uat]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Additive public sibling read: the mid-round funding signal ships as a NEW /v1/funding/:cohortId beside /v1/anchor, so the frozen public anchor read + DirectoryCohortDTO stay byte-untouched (D-26); the participant vehicle never widens the frozen surface"
    - "Non-oracle projection: publicFunding strips the rich operator FundingView to a single awaiting-funding bit gated to live+broadcast, so the anonymous read leaks no amount, key, or cohort existence (T-04-07-01)"
    - "Latched liveness from a non-oracle read: the participant latches liveCohort true the first time the funding read reports awaitingFunding, so a hermetic cohort (always false) surfaces neither the on-chain notice nor the wait copy, and a live cohort keeps the notice after funding"
    - "Positive-fact stall discrimination: the stall copy keys on the ABSENCE of the validation-requested fact (which fires only after ALL updates are collected), not on submitted-but-unsigned alone (the UAT misfire predicate), so an unexplained co-signing death gets honest 'could not complete' copy instead of a false collection-stall claim (D-45)"
    - "Two-seam guard, no fork: the D-46 unconfirmed-signal condition is caught proactively at the NeedBeaconSignals seam (signal-shape detection) AND belt-and-suspenders in driveResolution (Invalid-Date message mapping), both normalizing to one distinguishable retryable outcome"

key-files:
  created:
    - packages/web/src/lib/funding.ts
    - packages/service/tests/resolve-unconfirmed.spec.ts
  modified:
    - packages/service/src/monitor.ts
    - packages/service/src/hono-adapter.ts
    - packages/service/src/resolve.ts
    - packages/web/src/stores/participant.ts
    - packages/web/src/components/cohort/CohortPage.tsx
    - packages/web/src/stores/participant.spec.ts
  deleted: []

key-decisions:
  - "liveCohort is LATCHED from the funding read, not read from an anchor/directory bit. The DirectoryCohortDTO carries no live/anchor bit and the anchor poll only runs post-complete, so there is no live signal available during the seated/co-signing window except the funding read itself. publicFunding returns awaitingFunding:true ONLY for a live+broadcast cohort still awaiting funding, so latching liveCohort on the first true reading is a sound, non-oracle liveness signal: a hermetic cohort always reads false and surfaces neither notice, and a live cohort keeps the on-chain notice after funding (awaitingFunding flips false, liveCohort stays true). This is honest and needs no extra read."
  - "The funding poll starts at cohort-ready (seat), not at join. The funding wait is meaningful only after keygen completes (the beacon address exists and the operator funds it after seats fill, D-44), and the server-side funding watch itself starts at keygen-complete, so a pre-keygen poll would only ever read false. Polling from the seat mirrors the sibling post-seat poll and is cleared with it in teardownLive."
  - "terminalReason moved from CohortPage into the store as an exported pure function keyed on { error, steps, validationRequested }. The old local predicate fired the stall copy on submitted-but-unsigned + unexplained REGARDLESS of validation-requested, which mis-narrated an unexplained co-signing death (which happens AFTER validation-requested) as a collection stall. Making it a store function let the rekey be unit-tested (TDD) and let CohortPage render it unchanged. The stall copy strings were updated to the D-45 UI-SPEC wording ('This service stalled while collecting updates.' / 'Co-signing could not complete, and this service didn't say why.')."
  - "validationRequested is a per-round fact reset via INITIAL_OUTCOME (join/leave/adopt/start-over), NOT cleared in fail(). fail() must preserve the round facts so the terminal render can read validationRequested to choose between the two death copies; like fallbackObserved/nonInclusionReason it survives into the failed state and resets only on the next round."
  - "D-46 uses TWO guard seams. The proactive NeedBeaconSignals seam detects a mempool-resident signal (blockMetadata.time not finite) BEFORE provide() reaches the upstream Invalid-Date throw; the belt-and-suspenders driveResolution catch maps the upstream 'Invalid date: Invalid Date' message (verified in @did-btcr2/common@9.1.0 DateUtils) to the same UnconfirmedSignalError in case a signal shape slips past detection. Every other error propagates unchanged so the route keeps its generic 502."
  - "The retryable outcome is a 503 (not a 4xx or 200-with-status). 503 is honest (the service is temporarily unable to complete the resolution until the signal confirms) and distinguishable from the generic 502; the browser resolveDid already surfaces a non-2xx body.error as the ResolveError message, so the exact retryable copy reaches the resolve UI with no web-side change (Task 3 stayed service-only)."

patterns-established:
  - "A participant-facing public read never touches the frozen public reads: new honesty signals ride additive sibling routes (/v1/funding beside /v1/anchor), keeping the D-26 freeze pins intact."

requirements-completed: []
requirements-advanced: [LIVE-01]

coverage:
  - id: T1
    description: "Public funding read + participant awaiting-funding + join-time live notice (D-44): monitor.publicFunding non-oracle projection, GET /v1/funding/:cohortId additive public read, fetchFunding client, post-seat funding poll -> awaitingFunding + latched liveCohort facts, CohortPage on-chain notice + wait copy."
    requirement: LIVE-01
    verification:
      - kind: build
        ref: "pnpm --filter @btcr2-aggregation/web build -> green (tsc --noEmit + vite build)"
        status: pass
      - kind: build
        ref: "pnpm --filter @btcr2-aggregation/service exec tsc -b -> exit 0"
        status: pass
      - kind: manual
        ref: "publicFunding gated to serviceMode==='live'; unknown/hermetic ids read {awaitingFunding:false}; /v1/funding mounted in the PUBLIC block before operatorAuth, 400 on bad id shape; /v1/anchor + DirectoryCohortDTO handlers byte-untouched (freeze pins in config.spec/operator.spec/monitor.spec still green)"
        status: pass
    human_judgment: false
  - id: T2
    description: "Stall-copy fix keyed on the validation-requested store fact (D-45): validationRequested recorded in the listener, exported terminalReason rekeyed so submitted+!validation-requested -> positive stall copy and submitted+validation-requested+unsigned -> uncertainty-honest copy; stall copy never from submitted-but-unsigned alone."
    requirement: LIVE-01
    verification:
      - kind: unit
        ref: "packages/web/src/stores/participant.spec.ts -> 65 passed (+6: positive stall on !validation-requested, uncertainty-honest on validation-requested, no stall from submitted-but-unsigned alone, concrete reason not swallowed, explicit stall reason preserved, validationRequested resets on leave)"
        status: pass
      - kind: build
        ref: "pnpm --filter @btcr2-aggregation/web build -> green"
        status: pass
    human_judgment: false
  - id: T3
    description: "Unconfirmed-signal resolve guard returning a retryable outcome (D-46): UnconfirmedSignalError + NeedBeaconSignals seam guard + driveResolution Invalid-Date mapping; hono-adapter answers a 503 retryable body; 400/502 branches preserved; no library fork."
    requirement: LIVE-01
    verification:
      - kind: unit
        ref: "packages/service/tests/resolve-unconfirmed.spec.ts -> 6 passed (seam raises UnconfirmedSignalError on a mempool-resident signal; Invalid-Date throw mapped; genuine failure propagates unchanged; route 503 with the exact copy + retryable:true; genuine fault still 502; bad DID still 400)"
        status: pass
      - kind: unit
        ref: "packages/service/src/resolve.spec.ts -> 22 passed (existing driver + route coverage unchanged)"
        status: pass
      - kind: build
        ref: "pnpm --filter @btcr2-aggregation/service exec tsc -b -> exit 0"
        status: pass
    human_judgment: false

# Metrics
duration: 22min
completed: 2026-07-24
status: complete
---

# Phase 4 Plan 07: Participant-Side Live-Path Honesty (Funding Notice, Stall Copy, Unconfirmed-Signal Resolve) Summary

**Closed the three participant-surface honesty gaps the Phase 3 live UAT surfaced, all without touching the frozen public anchor read: (1) a NEW additive public `GET /v1/funding/:cohortId` non-oracle read (monitor.publicFunding projects the 04-06 funding state to a single awaiting-funding bit, gated to live+broadcast so a hermetic/unknown id reads false and leaks no amount, key, or existence, T-04-07-01) that a seated participant polls post-seat to drive an honest `Waiting for the operator to fund this cohort's beacon address.` wait line plus a latched-liveCohort join-time `This cohort anchors on-chain. The operator funds its beacon address after seats fill, so keep this tab open.` notice (D-44); (2) the stall-copy fix keyed on the newly-recorded `validation-requested` store fact (which fires only after the service has collected EVERY update): a signing-window death with the update submitted but that fact NEVER recorded is the genuinely positive `This service stalled while collecting updates.`, while a death AFTER it fired gets the uncertainty-honest `Co-signing could not complete, and this service didn't say why.` - the stall copy no longer fires from submitted-but-unsigned alone, the predicate that misfired in UAT (D-45); and (3) a service-side unconfirmed-signal guard (a NeedBeaconSignals seam detecting a mempool-resident signal with no block_time PLUS a belt-and-suspenders driveResolution catch mapping the upstream `Invalid date: Invalid Date` throw) that normalizes to one distinguishable UnconfirmedSignalError, so the resolve route answers a retryable `A beacon signal is awaiting confirmation. Resolve again after it confirms.` 503 instead of a generic 500/502, no @did-btcr2/method fork (D-46). Copy is verbatim from 04-UI-SPEC.md and em-dash-free; the frozen /v1/anchor + DirectoryCohortDTO stay byte-untouched (D-26).**

## Performance
- **Duration:** ~22 min
- **Tasks:** 3 (Task 2 via TDD)
- **Files:** 2 created, 6 modified

## Accomplishments
- `monitor.ts`: `publicFunding(cohortId)` - a non-oracle `{ awaitingFunding }` projection of the funding state, `true` ONLY for a live+broadcast cohort in `waiting`/`awaiting-confirmation`, `false` for hermetic/funded/dead-end/unknown.
- `hono-adapter.ts`: mounted `GET /v1/funding/:cohortId` in the PUBLIC block beside `/v1/anchor` and BEFORE the operatorAuth gate (anonymous, shape-guarded 400, fail-open `false` when no monitor is wired); the frozen anchor read + directory DTO are untouched.
- `packages/web/src/lib/funding.ts`: `fetchFunding` - the anonymous (`credentials: 'omit'`) browser client mirroring `anchor.ts`.
- `stores/participant.ts`: a post-seat funding poll (started at cohort-ready, cleared in teardownLive) that records an `awaitingFunding` fact and latches `liveCohort` on the first awaiting reading; the `validationRequested` fact recorded in the existing `validation-requested` listener; an exported pure `terminalReason({ error, steps, validationRequested })` rekeyed per D-45.
- `CohortPage.tsx`: renders the D-44 join notice + wait copy on live cohorts, and the D-45 rekeyed terminal copy (the local `terminalReason` was removed in favor of the store's tested one).
- `resolve.ts`: `UnconfirmedSignalError` + `hasUnconfirmedSignal` seam guard + `isUpstreamInvalidDateThrow` mapping wrapped around `driveResolution`; genuine faults propagate unchanged.
- `tests/resolve-unconfirmed.spec.ts`: 6 tests covering both guard seams, the retryable 503 route outcome (exact copy + `retryable: true`), the preserved generic 502, and the preserved 400.

## Task Commits
Each task was committed atomically (unsigned per project convention):

1. **Task 1: public funding read + participant awaiting-funding notice (D-44)** - `b674d5d` (feat)
2. **Task 2 RED: failing stall-copy tests keyed on validation-requested (D-45)** - `843b76d` (test)
3. **Task 2 GREEN: rekey stall copy on the validation-requested fact (D-45)** - `66e3d1d` (feat)
4. **Task 3: unconfirmed-signal resolve guard returns a retryable outcome (D-46)** - `4a2e2d3` (feat)

## Decisions Made
- **liveCohort is latched from the non-oracle funding read**, not from an anchor/directory bit (none exists during the seated window). A hermetic cohort always reads `false`, so neither the notice nor the wait copy ever surfaces there; a live cohort keeps the on-chain notice after funding.
- **The funding poll starts at the seat (cohort-ready)**, matching the server-side funding watch that starts at keygen-complete; a pre-keygen poll would only read false.
- **terminalReason moved into the store as a tested pure function** keyed on `validationRequested`, so the rekey is unit-testable and CohortPage renders it unchanged; the stall strings were updated to the D-45 UI-SPEC wording.
- **The retryable outcome is a distinguishable 503** carrying the exact copy; the browser's existing `resolveDid` surfaces a non-2xx `body.error` as the resolve UI message, so Task 3 stayed service-only.
- **Two D-46 seams, no fork:** proactive signal-shape detection at NeedBeaconSignals plus a belt-and-suspenders Invalid-Date message mapping in driveResolution, both normalizing to one UnconfirmedSignalError.

## Deviations from Plan
- **None.** The plan executed as written across all three tasks. Task 3's guard used BOTH seams the plan offered as alternatives (`NeedBeaconSignals` detection OR a driveResolution catch) rather than only one, because the exact upstream throw site was `[ASSUMED]` in RESEARCH (A1); running both makes the guard robust whether the mempool signal is caught by shape or by the Invalid-Date message, at negligible cost.

## Known Stubs
None. The funding read, the participant poll/notice/wait copy, the rekeyed stall predicate, and the unconfirmed-signal guard all exercise real behavior under the hermetic gate. The live end-to-end proof against a real chain (a genuinely unconfirmed signal, a real funding wait) is 04-08's blocking UAT.

## Verification Evidence
- `pnpm vitest run packages/service/tests/resolve-unconfirmed.spec.ts packages/web/src/stores/participant.spec.ts packages/service/src/resolve.spec.ts` -> **93 passed**.
- `pnpm test` (tsc -b + vitest, the committed CI gate) -> **464 passed** (33 files), no regressions (+12 vs 04-06's 452).
- `pnpm --filter @btcr2-aggregation/web build` -> green (tsc --noEmit + vite build).
- `pnpm --filter @btcr2-aggregation/service exec tsc -b` -> exit 0.
- Freeze pins for `/v1/anchor` + `DirectoryCohortDTO` (config.spec / operator.spec / monitor.spec) still green: the funding read is an additive sibling, the anchor handler + directory DTO are byte-untouched (D-26).
- `pnpm exec eslint` over all created/modified files -> clean.
- Em-dash scan (U+2014) over all created/modified files -> none.
- Dirty-tree guard honored: `package.json` and `e2e/live-uat.ts` never staged (verified before each commit).

## Threat Surface
The plan's threat register dispositions hold. T-04-07-01 (funding read disclosure): `publicFunding` returns only a boolean, gated to live+broadcast, `false` for unknown/hermetic ids, shape-guarded, and never drives chain I/O (it serves last-known funding-watch state). T-04-07-02 (resolve retryable body): the retryable message is a fixed generic string; the raw upstream error stays server-side logged, mirroring the 502-generic convention. T-04-07-03 (stall honesty): the stall copy is keyed on the positive validation-requested fact, so an unexplained co-signing death is never misattributed as a collection stall. T-04-07-04 (frozen public reads): `/v1/anchor` + `DirectoryCohortDTO` are byte-untouched; `/v1/funding` is an additive sibling read (D-26). No new threat surface beyond the one additive anonymous read, which is non-oracle by construction.

## Next Phase Readiness
- 04-08 (live UAT) exercises a real `LIVE=1 BROADCAST=1` boot against Polar/regtest: the participant sees the on-chain join notice + honest funding wait while the operator funds the beacon, the stall copy fires only on a genuine collection stall, and a resolve against a genuinely mempool-resident signal returns the retryable outcome, closing LIVE-01 with the blocking human checkpoint.

## Self-Check: PASSED
- `packages/web/src/lib/funding.ts` -> FOUND
- `packages/service/tests/resolve-unconfirmed.spec.ts` -> FOUND
- Task 1 commit `b674d5d` -> FOUND
- Task 2 RED commit `843b76d` -> FOUND
- Task 2 GREEN commit `66e3d1d` -> FOUND
- Task 3 commit `4a2e2d3` -> FOUND

---
*Phase: 04-operator-cohort-monitoring*
*Completed: 2026-07-24*
