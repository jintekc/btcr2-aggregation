---
phase: 04-operator-cohort-monitoring
plan: 06
subsystem: service
tags: [live-path, funding, watch-only, honesty, selectSpendableUtxo, clamp, blind-lapse, recovery-key, monitor, web]

# Dependency graph
requires:
  - phase: 04-operator-cohort-monitoring
    plan: 05
    provides: "BROADCAST=1 boot enablement, the fundingWindowMs knob threaded into CreateServiceOptions, and monitor serviceHealth()/noteEsploraObservation() that this plan's funding watch feeds; the phase-timeout > funding-window boot invariant (the D-38 phase-timeout leg)"
provides:
  - "classifyFunding: the ONE funding predicate (waiting/awaiting-confirmation/funded/dead-end) over the library's selectSpendableUtxo, shared by the operator display watch AND the authoritative onProvideTxData wait so they can never disagree (D-36); never an existence check"
  - "computeSuggestedMinSats: one consistent minimum = max(MIN_LIVE_FUNDING_SATS 2000, fee-derived need); the displayed ask, watch threshold, pre-flight floor, and dead-end band are one number (D-37)"
  - "computeFundingDeadline: the clamp min(configuredWindow, remainingTtl - slack) + the truncated-window disclosure (D-38); shared by tx.ts (the throw) and index.ts (the display truncatedWindowMin)"
  - "The D-38 funding WAIT inside makeProvideTxData's live branch (engaged only when fundingWindowMs is set; the single-shot pre-flight is preserved byte-identical otherwise): polls until funded, throws the dead-end message on a below-min selected UTXO, throws the specific 'funding never arrived' reason on a clean lapse, and the uncertainty-honest reason on a blind lapse (D-39), all from inside the callback before either library timer"
  - "FundingView on the monitor detail (state, suggestedMinSats, beaconAddress + explorerUrl, recoveryKeyState, mainnet, changeAddressRedirected, truncatedWindowMin, esploraStale, terminal) via noteFunding; present only for live+broadcast cohorts, absent on hermetic"
  - "The needs-funding attention chip on the summary list the moment keygen completes, until the cohort is funded (D-44)"
  - "createFundingWatch: a watch-only, abortable, unref'd poll loop started at keygen-complete that feeds the monitor funding view + the health-strip esplora bit (D-43); the terminal window-closed/blind-lapse verdict folded on cohort-failed"
  - "FundingStage.tsx: the operator funding surface (beacon address copy + explorer link, one minimum, fixed-tone state copy, always-shown recovery-key disclosure, mainnet real-money + change-routing lines, stacked truncated-window + esplora-stale disclosures), inserted between co-signing and anchor in the drill-down + the OperatorStageTimeline for live cohorts"
  - "e2e/live-mock-cohort.ts stateful []-then-funded leg proving awaiting-funding -> funded auto-advance + sign + broadcast on the mock (D-47)"
  - "createService options: fundingPollIntervalMs + recoveryKeyOperatorHeld (demo-server passes recoveryKeyOperatorHeld from RECOVERY_KEY so the funding stage discloses operator-held vs throwaway honestly)"
affects: [04-08-live-uat]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "One selection convention shared by watch + builder: both the display watch and the authoritative wait run the library's selectSpendableUtxo over the SELECTED deepest-confirmed-non-dust UTXO against ONE suggested minimum, so the operator can never fund against a threshold the builder disagrees with (D-36/D-37)"
    - "Throw-before-the-timer clamp: the wait's deadline is min(window, remainingTtl - slack), computed from the cohort's advertise-time stamp (the cohort-advertised event), so the specific 'funding never arrived' reason settles the cohort BEFORE cohortTtlMs/phaseTimeoutMs fires with a generic reason (Pitfall 3)"
    - "Blind-lapse honesty gated on observation success: a terminal 'funding never arrived' verdict is claimed ONLY when the last read succeeded; an esplora gap over the lapse gets uncertainty-honest copy (prohibition, D-39). The same discriminator drives the window-closed vs blind-lapse terminal funding-view marker on cohort-failed"
    - "Watch-only, opt-in-gated live surface: the funding watch is fire-and-forget, abortable, unref'd, and NEVER runs off the live+broadcast path (the funding stage cannot exist without a real on-chain beacon)"

key-files:
  created:
    - packages/service/src/funding-watch.ts
    - packages/service/tests/funding-watch.spec.ts
    - packages/service/tests/tx-funding-wait.spec.ts
    - packages/web/src/components/operator/FundingStage.tsx
  modified:
    - packages/service/src/tx.ts
    - packages/service/src/monitor.ts
    - packages/service/src/index.ts
    - packages/service/src/demo-server.ts
    - packages/service/tests/monitor.spec.ts
    - packages/web/src/lib/operator.ts
    - packages/web/src/components/operator/CohortDetail.tsx
    - packages/web/src/components/operator/OperatorStageTimeline.tsx
    - e2e/live-mock-cohort.ts
  deleted: []

key-decisions:
  - "The D-38 funding WAIT engages ONLY when fundingWindowMs is configured. Without a window, makeProvideTxData's live branch keeps its original single-shot pre-flight byte-for-byte, so every existing live-tx.spec test (unfunded 'no UTXOs', dust, unconfirmed, funding floor, deepest-selection) passes unchanged. This preserved the exact operator-facing messages while adding the wait only on the product path that threads a window."
  - "The recovery-key state is a NEW recoveryKeyOperatorHeld option, not derived from config.recoveryKey. buildCohortConfig ALWAYS fills config.recoveryKey (auto-deriving a throwaway when none is supplied), so its presence cannot distinguish operator-held from throwaway; the plan's read_first hint ('opts.config.recoveryKey for the recovery-key state') would have produced a dishonest always-operator-held claim. demo-server now passes recoveryKeyOperatorHeld: Boolean(recoveryKey) (env RECOVERY_KEY) so the funding stage mirrors the boot banner honestly (D-40). Default false = throwaway (the conservative warning)."
  - "The window-closed / blind-lapse TERMINAL copy is surfaced via a new optional FundingView.terminal marker, set on cohort-failed (window-closed when the last observation succeeded, blind-lapse when an esplora gap spanned the lapse). This keeps the display verdict consistent with the tx.ts wait's own throw discrimination without inventing a fifth funding state."
  - "The display funding watch (index.ts, started at keygen-complete) is deliberately SEPARATE from the authoritative wait (tx.ts, inside onProvideTxData): they share classifyFunding + the suggested minimum but poll independently, so the operator sees funding progress from the moment keygen completes while the builder's wait is what actually gates signing (D-44 operator surface)."
  - "The beacon-address explorer link is derived from NetworkConfig.explorerTxUrl by swapping the /tx/<sentinel> suffix for /address/<addr> (NetworkConfig exposes only a txid template); the offline network yields an empty template so the link is honestly omitted."

patterns-established:
  - "The funding stage never runs on the fixture/offline path: monitor.noteFunding + the detail funding view + the needs-funding chip are all gated on serviceMode === 'live' (broadcasting), so a hermetic cohort can never surface a funding stage that cannot exist (Pitfall 5)."

requirements-completed: []
requirements-advanced: [LIVE-01]

coverage:
  - id: T1
    description: "funding-watch.ts one selection convention: classifyFunding (waiting/awaiting-confirmation/funded/dead-end over selectSpendableUtxo, never an existence check), computeSuggestedMinSats (one number, only rises above the 2000 floor), computeFundingDeadline (min(window, ttl - slack) + truncation), createFundingWatch (lastObservationOk for blind-lapse/stale honesty) (D-36/D-37/D-38/D-39/D-43)."
    requirement: LIVE-01
    verification:
      - kind: unit
        ref: "packages/service/tests/funding-watch.spec.ts -> 15 passed (empty/all-dust/unconfirmed/funded/dead-end mapping; deepest-selected drives the decision so a shallower larger UTXO does not rescue a dead-end; floor never below 2000; clamp math + truncation; lastObservationOk false after a thrown read)"
        status: pass
      - kind: build
        ref: "pnpm --filter @btcr2-aggregation/service exec tsc -b -> exit 0"
        status: pass
    human_judgment: false
  - id: T2
    description: "Clamped funding wait in onProvideTxData + monitor funding view + recovery-key/mainnet disclosure: the wait proceeds on funded, throws the dead-end message, throws 'funding never arrived' on a clean lapse and the uncertainty-honest reason on a blind lapse (D-39), clamps to min(window, ttl - slack); the monitor detail carries the funding view (absent on hermetic) + the needs-funding chip (D-38/D-40/D-42/D-44)."
    requirement: LIVE-01
    verification:
      - kind: unit
        ref: "packages/service/tests/tx-funding-wait.spec.ts -> 7 passed (empty->funded auto-advance, dead-end message, 'funding never arrived' on a clean lapse, uncertainty-honest on a blind lapse + NOT 'funding never arrived', short-TTL clamp lapses fast, clamp math)"
        status: pass
      - kind: unit
        ref: "packages/service/tests/monitor.spec.ts -> 44 passed (+4: funding view carries recovery-key/mainnet/truncated-window on a live cohort, needs-funding chip until funded, absent before first reading, absent on hermetic even if noteFunding is called)"
        status: pass
      - kind: unit
        ref: "packages/service/src/live-tx.spec.ts -> 13 passed (the single-shot pre-flight convention preserved byte-for-byte)"
        status: pass
      - kind: build
        ref: "pnpm --filter @btcr2-aggregation/service exec tsc -b -> exit 0"
        status: pass
    human_judgment: false
  - id: T3
    description: "FundingStage.tsx render (3 states + dead-end + terminal window-closed/blind-lapse + truncated-window + esplora-stale + recovery-key + mainnet), inserted between co-signing and anchor in the drill-down + the stage timeline for live cohorts; the stateful mock e2e drives awaiting-funding -> funded auto-advance + sign + broadcast (D-36 through D-42, D-47)."
    requirement: LIVE-01
    verification:
      - kind: build
        ref: "pnpm --filter @btcr2-aggregation/web build -> green (tsc --noEmit + vite build)"
        status: pass
      - kind: e2e
        ref: "pnpm exec tsx e2e/live-mock-cohort.ts -> PASSED (CAS + SMT funding legs: getUtxos polled through 3 unfunded reads then the cohort signed + broadcast; plus the pre-existing live + live-broadcast legs)"
        status: pass
    human_judgment: false

# Metrics
duration: 35min
completed: 2026-07-24
status: complete
---

# Phase 4 Plan 06: Cohort-Beacon Funding Stage (Watch-Only, Clamped Wait, Honest Failure) Summary

**Built the honesty-critical live funding surface end to end as ONE selection convention shared by an operator display watch and the authoritative onProvideTxData wait, so they can never disagree: `classifyFunding` runs the library's `selectSpendableUtxo` over the SELECTED deepest-confirmed-non-dust UTXO against ONE suggested minimum (max of the 2000-sat floor and any fee-derived need), never an existence check (D-36/D-37); the D-38 funding WAIT inside `makeProvideTxData`'s live branch (engaged only when a funding window is configured, so the single-shot pre-flight stays byte-identical) polls until funded, throws the dead-end 'topping up cannot fix this' message on a below-minimum selected UTXO, and on a deadline lapse throws either the specific 'funding never arrived' reason (clean lapse, last read succeeded) or an uncertainty-honest reason (blind lapse, D-39) from inside the callback with a deadline clamped to `min(window, remaining TTL - slack)` so it always beats the library timers (Pitfall 3); the monitor gained a `FundingView` (state + one minimum + beacon address/explorer + recovery-key state + mainnet + change-routing + truncated-window + esplora-stale + terminal marker) fed by a watch-only poll started at keygen-complete, plus the `needs-funding` attention chip until a cohort is funded (D-44), all gated to live+broadcast so a hermetic cohort never surfaces a funding stage; and `FundingStage.tsx` renders the whole thing between co-signing and anchor with the recovery-key disclosure always shown and the mainnet real-money + change-routing lines on mainnet (D-40/D-42), verbatim from the UI-SPEC and em-dash-free. A stateful []-then-funded mock e2e proves the awaiting-funding -> funded auto-advance, then sign + broadcast (D-47).**

## Performance
- **Duration:** ~35 min
- **Tasks:** 3
- **Files:** 4 created, 9 modified

## Accomplishments
- `funding-watch.ts`: `classifyFunding` (the single predicate, deepest-selected UTXO vs one minimum, never `utxos.length`/`.some(confirmed)`), `computeSuggestedMinSats` (fee derivation only ever raises the 2000-sat floor), `computeFundingDeadline` (the `min(window, remainingTtl - slack)` clamp + the truncated-window disclosure), and `createFundingWatch` (a watch-only, abortable, unref'd poll loop that tracks `lastObservationOk` so the display freezes stale-honest on an esplora gap).
- `tx.ts`: wrapped the live branch with the D-38 WAIT (only when `fundingWindowMs` is set), reusing `classifyFunding` + the suggested minimum; the dead-end throw preserves the pre-flight's "topping up cannot fix this" wording; the lapse throw is discriminated on `lastObservationOk` (clean "funding never arrived" vs uncertainty-honest blind-lapse, D-39). The single-shot pre-flight is preserved unchanged for callers/tests that never configure a window.
- `monitor.ts`: `FundingView` DTO + `noteFunding`; the funding view rides the gated detail read (gated to `serviceMode === 'live'`); the `needs-funding` summary chip fires while a live cohort is unfunded and clears once funded (D-44); a `terminal` (window-closed/blind-lapse) marker distinguishes the two lapse verdicts.
- `index.ts`: a watch-only funding poll started at `keygen-complete` (broadcast path only) feeds the monitor funding view + `noteEsploraObservation` (D-43); a `cohort-advertised` stamp powers the remaining-TTL clamp; `cohort-failed` folds the terminal window-closed/blind-lapse verdict; new `fundingPollIntervalMs` + `recoveryKeyOperatorHeld` options; the address explorer-URL helper.
- `demo-server.ts`: passes `recoveryKeyOperatorHeld: Boolean(recoveryKey)` so the funding stage discloses operator-held vs throwaway honestly (matching the 04-05 boot banner, D-40).
- `FundingStage.tsx` + `CohortDetail.tsx` + `OperatorStageTimeline.tsx` + `lib/operator.ts`: the operator funding surface (beacon address copy + explorer link, one suggested-minimum line, fixed-tone state copy including the terminal verdicts, always-shown recovery-key disclosure, mainnet real-money + change-routing lines, stacked truncated-window + esplora-stale disclosures), inserted between co-signing and anchor for live cohorts and folded into the stage timeline; absent on hermetic.
- `e2e/live-mock-cohort.ts`: a stateful `[]`-then-confirmed-above-min mock + a new CAS/SMT funding leg that proves the awaiting-funding -> funded auto-advance (getUtxos polled through 3 unfunded reads), then sign + broadcast on the mock (D-47).

## Task Commits
Each task was committed atomically (unsigned per project convention):

1. **Task 1: funding-watch predicate + suggested minimum + clamp helper + watch loop** - `8c62648` (feat)
2. **Task 2: clamped funding wait + monitor funding view + recovery-key disclosure** - `9c06368` (feat)
3. **Task 3: FundingStage render + operator stage insertion + stateful funding e2e** - `de1dfbf` (feat)

## Decisions Made
- **The funding WAIT engages only when `fundingWindowMs` is set.** This preserved the original single-shot pre-flight (and every `live-tx.spec` message) byte-for-byte for direct callers, adding the poll-until-funded wait only on the product path that threads a window.
- **Recovery-key state is a new `recoveryKeyOperatorHeld` option, NOT `config.recoveryKey` presence.** `buildCohortConfig` always fills `config.recoveryKey` (auto-deriving a throwaway), so presence cannot distinguish operator-held from throwaway; the plan's read_first hint would have produced a dishonest always-operator-held claim. `demo-server` now passes the honest bit from the `RECOVERY_KEY` env (a small Rule 2 correctness addition to a file outside the plan's declared set, so the shipped product surface is honest end to end).
- **Window-closed / blind-lapse terminal copy uses a new `FundingView.terminal` marker set on `cohort-failed`,** discriminated identically to the tx.ts wait (window-closed when the last observation succeeded, blind-lapse on an esplora gap), rather than inventing a fifth funding state.
- **Two independent pollers by design:** the display watch (index.ts, from keygen-complete) and the authoritative wait (tx.ts, inside onProvideTxData) share the predicate + minimum but poll separately, so the operator sees funding progress immediately while the builder's wait gates signing.

## Deviations from Plan
- **[Rule 2 - correctness] `demo-server.ts` edited (outside the plan's declared files).** The plan's Task 2 read_first suggested deriving the recovery-key state from `opts.config.recoveryKey`, but that field is always populated by `buildCohortConfig` (auto-derived throwaway), so it cannot distinguish operator-held from throwaway. I added a `recoveryKeyOperatorHeld` option to `createService` and wired `demo-server` to pass `Boolean(recoveryKey)` from the `RECOVERY_KEY` env, so the funding-stage recovery-key disclosure is honest end to end rather than always claiming operator-held. Low-risk, additive, mirrors the existing 04-05 boot banner.
- **[scope] No `e2e:live:mock` script added.** The plan's Task 3 mentioned adding a package.json script, but (a) `e2e:live:mock` already exists and points at `e2e/live-mock-cohort.ts`, and (b) the project dirty-tree guard forbids touching the root `package.json` (it carries the user's uncommitted `uat:live` line). Extending `main()` in the existing e2e file is sufficient; `pnpm e2e:live:mock` already runs the new funding leg.
- **[completeness] Added a `FundingView.terminal` marker + `cohort-failed` fold** (a small extension to the committed Task 2 files) so the FundingStage can honestly render the window-closed / blind-lapse terminal copy the acceptance criteria list, without inventing a fifth funding state.

## Known Stubs
None. The funding stage is fully wired: the predicate, the clamped wait, the monitor view, the render, and the hermetic auto-advance e2e all exercise real behavior. The live end-to-end proof against a real chain (Polar/regtest) is 04-08's blocking UAT.

## Verification Evidence
- `pnpm vitest run packages/service/tests/funding-watch.spec.ts` -> **15 passed**.
- `pnpm vitest run packages/service/tests/tx-funding-wait.spec.ts` -> **7 passed**.
- `pnpm vitest run packages/service/tests/monitor.spec.ts` -> **44 passed** (+4 funding-view/needs-funding).
- `pnpm vitest run packages/service/src/live-tx.spec.ts` -> **13 passed** (single-shot pre-flight preserved).
- `pnpm test` (tsc -b + vitest, the committed CI gate) -> **452 passed** (32 files), no regressions (+26 vs 04-05's 426).
- `pnpm --filter @btcr2-aggregation/web build` -> green.
- `pnpm exec tsx e2e/live-mock-cohort.ts` -> **PASSED** (CAS + SMT funding legs prove awaiting-funding -> funded auto-advance + sign + broadcast).
- `pnpm exec eslint` over all created/modified files -> clean.
- Em-dash scan (U+2014) over all created/modified files -> none.
- Dirty-tree guard honored: `package.json` and `e2e/live-uat.ts` never staged.

## Threat Surface
The plan's threat register dispositions hold. T-04-06-01 (real-funds dead-end): watch and builder share `selectSpendableUtxo` + one suggested minimum; the dead-end names "topping up cannot fix this"; recovery-key state is always disclosed; the mainnet real-money line renders on mainnet. T-04-06-02 (blind-lapse honesty): "funding never arrived" is thrown only when the last read succeeded; an esplora gap gets the uncertainty-honest reason, and the same discriminator drives the terminal window-closed/blind-lapse marker. T-04-06-03 (poll-loop DoS): the watch + wait are bounded (the wait by the clamp deadline), abortable, and unref'd, and never run off the live+broadcast path. T-04-06-04 (funding-view disclosure): the view rides the operator-gated detail read; only the recovery-key STATE is serialized, never the key value. T-04-06-05 (throw timing): the wait throws from inside onProvideTxData with a deadline clamped below the remaining TTL (minus slack), and the 04-05 boot invariant keeps phaseTimeoutMs above the window, so the specific reason wins the settlement race. No new HTTP surface: the funding view rides the already-gated monitor detail, and the watch is server-internal.

## Next Phase Readiness
- 04-08 (live UAT) exercises a real `LIVE=1 BROADCAST=1` boot against Polar/regtest: the operator funds a real cohort beacon and watches the funding stage advance (waiting -> funded), the dead-end and window-closed verdicts, and the recovery-key + mainnet disclosures, closing LIVE-01 with the blocking human checkpoint.

## Self-Check: PASSED
- `packages/service/src/funding-watch.ts` -> FOUND
- `packages/service/tests/funding-watch.spec.ts` -> FOUND
- `packages/service/tests/tx-funding-wait.spec.ts` -> FOUND
- `packages/web/src/components/operator/FundingStage.tsx` -> FOUND
- Task 1 commit `8c62648` -> FOUND
- Task 2 commit `9c06368` -> FOUND
- Task 3 commit `de1dfbf` -> FOUND

---
*Phase: 04-operator-cohort-monitoring*
*Completed: 2026-07-24*
