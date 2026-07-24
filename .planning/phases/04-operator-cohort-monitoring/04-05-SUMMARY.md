---
phase: 04-operator-cohort-monitoring
plan: 05
subsystem: service
tags: [live-path, broadcast, boot-enablement, guard-rails, retry, esplora, health-strip, honesty]

# Dependency graph
requires:
  - phase: 04-operator-cohort-monitoring
    plan: 04
    provides: "the monitor detail depth + summary()/serviceMetrics() this plan extends with a resolved mode descriptor + esplora-reachability bit, and the attach/broadcast frames the bounded send retry hardens"
provides:
  - "BROADCAST=1 env enablement (requires LIVE=1, refuses at boot otherwise): demo-server passes { live: true, broadcast: true, changeAddress, allowMainnet, fundingWindowMs } into createService, so a real boot can enable live co-sign + on-chain beacon broadcast behind ADR 0010 guard rails; LIVE=1 alone keeps its existing meaning (live esplora for resolve + /v1/tx, fixture co-sign) with no behavior change (D-35)"
  - "LIVE_CHANGE_ADDRESS + FUNDING_WINDOW_MS env passthrough; DEFAULT_FUNDING_WINDOW_MS (12 min); fundingWindowMs threaded into CreateServiceOptions for the 04-06 tx clamp to consume (D-35/D-38)"
  - "A loud live+broadcast boot banner (ADR 0010 idiom) + a THROWAWAY-recovery-key warning on any live+broadcast boot without RECOVERY_KEY, regardless of network (D-40)"
  - "A fail-fast boot invariant: under BROADCAST, phaseTimeoutMs must exceed fundingWindowMs (the phase-timeout leg of D-38, Pitfall 3), else the boot throws naming both values"
  - "A bounded backoff broadcast send retry in broadcastAndConfirm/attachBeaconBroadcast: the retained raw tx is re-sent across bounded attempts; a duplicate-acceptance esplora rejection is treated as success (beacon-broadcast emitted exactly once), and exhaustion throws an honest reason distinguishing network-unreachable-at-send from a node policy rejection (D-41, Pitfall 9)"
  - "ServiceMode ('hermetic'|'live-no-broadcast'|'live') + ServiceHealthDTO on the monitor: serviceHealth() reports the resolved mode + an esploraReachable bit ('n/a' on hermetic), and noteEsploraObservation(ok) flips only the bit so a mid-flight outage freezes every cohort stale-honest (D-17/D-43)"
affects: [04-06-funding-stage-live-mode, 04-08-live-uat]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Env-as-operator-contract layered opt-in: BROADCAST requires LIVE requires (for mainnet) ALLOW_MAINNET; each layer fails fast at boot rather than silently doing the wrong thing, extending the ADR 0010 loud-boot pattern"
    - "Retained-tx bounded send retry: the raw hex is retained in scope and re-sent verbatim (never rebuilt) so the txid stays stable; duplicate-acceptance short-circuits to success via a caller-computed expectedTxid because the rejection carries no id"
    - "Mode/reachability as a pure health projection: the mode is fixed once at construction from the live/broadcast wiring, and the esplora bit is a single flag flipped only by noteEsploraObservation, never by a fold listener, so a failed observation can never mutate cohort state (stale-honest by construction)"

key-files:
  created:
    - packages/service/tests/live-boot.spec.ts
  modified:
    - packages/service/src/demo-server.ts
    - packages/service/src/index.ts
    - packages/service/src/broadcast.ts
    - packages/service/src/broadcast.spec.ts
    - packages/service/src/monitor.ts
    - packages/service/tests/monitor.spec.ts
  deleted: []

key-decisions:
  - "createService's live co-sign is tied to BROADCAST, not to demo-server's LIVE flag. demo-server passes `live: useBroadcast` (not `live: useLive`) into createService, so LIVE=1 alone keeps building the fixture beacon tx (existing meaning preserved) while only BROADCAST=1 switches to a real aggregation beacon tx. DemoServerOptions.live continues to control ONLY the injected Bitcoin connection (offline stub vs real esplora for resolve + the /v1/tx proxy), matching its existing documented semantics."
  - "The send retry always runs the FIRST send; only retries are gated on the abort signal. This preserves the pre-existing contract (an already-aborted signal still commits one send and returns its txid, skipping only the confirm poll) while making retries abort promptly, so no existing broadcast test semantics broke."
  - "A duplicate-acceptance rejection resolves to the caller-computed txid (signedTx.id), not a parsed-from-rawHex txid. attachBeaconBroadcast computes expectedTxid from the finalized tx (guarded) and passes it down; broadcastAndConfirm alone (without expectedTxid) degrades a duplicate to an ordinary retryable failure, which is acceptable since attach always supplies it."
  - "The health-strip DATA is provided on the monitor (serviceHealth + noteEsploraObservation + the mode threaded from index.ts); the RENDER + the funding watch's noteEsploraObservation calls are 04-06's job. The HealthStrip.tsx comment already states it stays hermetic until 04-06 threads the real mode through the monitoring payload, so this plan deliberately stops at the monitor accessor (Task 3's files are service-only)."

patterns-established:
  - "Live+broadcast is the only env-exposed real-money path; the middle mode (live sign, no push) stays reachable only through CreateServiceOptions directly, never via env (D-35)."

requirements-completed: []
requirements-advanced: [LIVE-01]

coverage:
  - id: T1
    description: "BROADCAST=1 boot enablement (requires LIVE=1), LIVE_CHANGE_ADDRESS/FUNDING_WINDOW_MS passthrough, loud live+broadcast banner + RECOVERY_KEY-absent warn, and the phase-timeout > funding-window boot invariant (D-35/D-38/D-40)."
    requirement: LIVE-01
    verification:
      - kind: unit
        ref: "packages/service/tests/live-boot.spec.ts -> 7 passed (BROADCAST-without-LIVE throws, invariant throws + valid ordering boots, LIVE-only still boots with no banner, live+broadcast banner + THROWAWAY warn fire, warn omitted with RECOVERY_KEY, defaults satisfy the invariant)"
        status: pass
      - kind: build
        ref: "pnpm --filter @btcr2-aggregation/service exec tsc -b -> exit 0"
        status: pass
    human_judgment: false
  - id: T2
    description: "Bounded broadcast send retry: transient-then-success emits one beacon-broadcast, duplicate-acceptance is success (no failure frame), exhaustion emits one beacon-broadcast-failed distinguishing network-unreachable, frame shapes byte-unchanged, aborts promptly (D-41, Pitfall 9)."
    requirement: LIVE-01
    verification:
      - kind: unit
        ref: "packages/service/src/broadcast.spec.ts -> 20 passed (retry recovers a transient failure into a single broadcast; duplicate-acceptance -> success via expectedTxid; network-unreachable vs policy exhaustion reasons; abort stops after one attempt; frame shapes unchanged)"
        status: pass
      - kind: build
        ref: "pnpm --filter @btcr2-aggregation/service exec tsc -b -> exit 0"
        status: pass
    human_judgment: false
  - id: T3
    description: "Resolved mode + esplora reachability on the monitor: serviceHealth() reports mode (hermetic/live-no-broadcast/live) + esploraReachable ('n/a' on hermetic), noteEsploraObservation(false) flips the bit without altering any cohort's last-known state (stale-honest, D-17/D-43)."
    requirement: LIVE-01
    verification:
      - kind: unit
        ref: "packages/service/tests/monitor.spec.ts -> 40 passed (+5: hermetic n/a, derived live from broadcaster, explicit live-no-broadcast, stale-honest freeze on noteEsploraObservation(false) with detail deep-equal before/after, hermetic stays n/a after a note call)"
        status: pass
      - kind: build
        ref: "pnpm --filter @btcr2-aggregation/service exec tsc -b -> exit 0"
        status: pass
    human_judgment: false

# Metrics
duration: 15min
completed: 2026-07-24
status: complete
---

# Phase 4 Plan 05: Live-Path Boot Enablement, Bounded Broadcast Retry, and Honest Mode/Esplora Signal Summary

**Wired the live-path boot enablement demo-server never did (RESEARCH confirmed it passed `bitcoin` but never `live`/`broadcast`/`changeAddress` into createService): a new `BROADCAST=1` env (which REQUIRES `LIVE=1`, refusing at boot otherwise) now passes `{ live: true, broadcast: true, changeAddress, allowMainnet, fundingWindowMs }` into createService behind ADR 0010 guard rails, with `LIVE_CHANGE_ADDRESS` + `FUNDING_WINDOW_MS` joining the passthrough, a loud live+broadcast boot banner + a THROWAWAY-recovery-key warning on any live+broadcast boot without RECOVERY_KEY (any network), and a fail-fast `phaseTimeoutMs > fundingWindowMs` boot invariant (the D-38 phase-timeout leg); hardened the one-shot broadcast send into a bounded backoff retry that retains the raw tx, treats a duplicate-acceptance esplora rejection as success (emitting `beacon-broadcast` exactly once) and fails honestly on exhaustion distinguishing network-unreachable-at-send from a node policy rejection (D-41); and surfaced the resolved mode + an esplora-reachability bit on the monitor so the health strip reads honestly, with a mid-flight outage freezing every cohort stale-honest (D-17/D-43). LIVE=1 alone keeps its existing meaning (live esplora, fixture co-sign) unchanged.**

## Performance
- **Duration:** ~15 min
- **Tasks:** 3
- **Files:** 1 created, 6 modified

## Accomplishments
- Added `BROADCAST=1` env enablement in `demo-server.ts`: `useBroadcast = opts.broadcast ?? process.env.BROADCAST === '1'`, a boot throw when `useBroadcast && !useLive` (broadcasting the zero-chain fixture is meaningless), and `live: useBroadcast, broadcast: useBroadcast` threaded into the createService call so a real boot enables live co-sign + on-chain beacon broadcast (D-35).
- Added `LIVE_CHANGE_ADDRESS` + `FUNDING_WINDOW_MS` env passthrough and `DEFAULT_FUNDING_WINDOW_MS = 720_000` (12 min); threaded `fundingWindowMs` into `CreateServiceOptions` (accepted now, consumed by the 04-06 funding-stage tx clamp).
- Added the loud live+broadcast boot banner (mirroring the ADR 0010 mainnet idiom) and the THROWAWAY-recovery-key warning that fires on any live+broadcast boot without RECOVERY_KEY regardless of network (D-40), because funds sent to a below-threshold-failed cohort are unrecoverable on any chain.
- Added the fail-fast boot invariant: under BROADCAST, `phaseTimeoutMs <= fundingWindowMs` throws at boot naming both values (D-38 phase-timeout leg, Pitfall 3), so the funding wait can surface its own "funding never arrived" reason before the phase-stall timer fires.
- Wired the direct-invocation block to read `BROADCAST`/`LIVE`/`LIVE_CHANGE_ADDRESS`/`FUNDING_WINDOW_MS`.
- Hardened `broadcastAndConfirm` with a `sendWithRetry` helper: the first send always runs, transient failures are retried with linear backoff over a bounded attempt budget (`sendRetryAttempts`/`sendRetryBackoffMs`, defaults 5 / 2000ms), a duplicate-acceptance rejection short-circuits to success via the caller-computed `expectedTxid`, and exhaustion throws an honest reason distinguishing "network unreachable at send time" from "the node rejected the transaction" (D-41, Pitfall 9).
- `attachBeaconBroadcast` computes `expectedTxid` from `result.signedTx.id` (guarded), plumbs the retry knobs, keeps `beacon-broadcast` emitted exactly once, and stays silent (no spurious failure frame) when a send is aborted by teardown; the `BeaconAnchorEvents` frame shapes are byte-unchanged.
- Added `ServiceMode` + `ServiceHealthDTO` to `monitor.ts`: `createCohortMonitor` takes an explicit mode (derived in `index.ts` from the live/broadcast wiring), `serviceHealth()` reports mode + `esploraReachable` ('n/a' on hermetic), and `noteEsploraObservation(ok)` flips only the bit so a mid-flight outage leaves every cohort's last-known chip/detail frozen (D-17/D-43). Exported both types from `index.ts`.

## Task Commits
Each task was committed atomically (unsigned per project convention):

1. **Task 1: BROADCAST=1 boot enablement + funding-window knob + banner + invariant** - `ca095b4` (feat)
2. **Task 2: Bounded broadcast send retry with honest exhaustion + duplicate-acceptance** - `2557c95` (feat)
3. **Task 3: Resolved mode + esplora reachability in the monitor (health-strip data)** - `d2ddf09` (feat)

## Files Created/Modified
- `packages/service/tests/live-boot.spec.ts` (created) - hermetic boot-enablement coverage (BROADCAST-without-LIVE throw, the phase-timeout invariant, the banners, and the LIVE-only-still-boots regression).
- `packages/service/src/demo-server.ts` - BROADCAST/LIVE_CHANGE_ADDRESS/FUNDING_WINDOW_MS resolution + guards, the live+broadcast banner + RECOVERY_KEY warn, the boot invariant, the createService passthrough, and the direct-invocation env reads.
- `packages/service/src/index.ts` - `fundingWindowMs` option on CreateServiceOptions; the resolved `mode` threaded into createCohortMonitor; ServiceMode/ServiceHealthDTO exported.
- `packages/service/src/broadcast.ts` - the `sendWithRetry` bounded backoff + duplicate-acceptance/network-unreachable classifiers, the retry knobs on both option interfaces, `expectedTxid` computation + the abort-silent catch in attach.
- `packages/service/src/broadcast.spec.ts` - a per-attempt send sequence in the mock + a fakeTx id; extended to 20 tests (retry recovery, duplicate-acceptance success, exhaustion reasons, prompt abort, single-frame invariants).
- `packages/service/src/monitor.ts` - ServiceMode/ServiceHealthDTO, the mode param + esplora flag, and the serviceHealth()/noteEsploraObservation() accessors.
- `packages/service/tests/monitor.spec.ts` - +5 serviceHealth tests (40 total).

## Decisions Made
- **createService's live co-sign is tied to BROADCAST, not to demo-server's LIVE.** demo-server passes `live: useBroadcast` so LIVE=1 alone keeps the fixture co-sign path (existing deployments unchanged) while BROADCAST=1 switches to a real beacon tx. DemoServerOptions.live keeps its documented meaning (the injected connection: offline stub vs live esplora for resolve + the /v1/tx proxy).
- **The first send always runs; only retries gate on the abort signal.** This preserved the pre-existing "already-aborted signal still commits one send and returns its txid, skipping only the poll" contract while making retries abort promptly, so no existing broadcast test broke on semantics (only the slow policy-rejection test was updated to pass a small retry budget).
- **Duplicate-acceptance resolves to the caller-computed `signedTx.id`, not a parsed rawHex txid.** attach computes it (guarded) and passes it down; a direct broadcastAndConfirm caller without it degrades a duplicate to a retryable failure, acceptable because attach always supplies it and a bare-bytes stand-in has no real txid to parse.
- **Task 3 stops at the monitor accessor (service-only files).** The health-strip render + the funding watch's `noteEsploraObservation` calls are 04-06's job (the HealthStrip.tsx comment already documents it stays hermetic until 04-06 threads the real mode through the monitoring payload), so this plan provides the data seam and defers the HTTP/web wiring.

## Deviations from Plan
None - plan executed as written. The three tasks landed exactly the files and behavior the plan specified; the only test-file adjustments were updating the two pre-existing broadcast tests (the policy-rejection propagation test and the attach send-rejected test) to pass a small retry budget so they still fail fast under the new bounded retry, plus asserting the new honest-classification reason. These are direct consequences of the D-41 retry, not scope changes.

## Known Stubs
None that block the plan goal. Two forward-contract seams (not stubs) are provided for 04-06 to consume:
- `CreateServiceOptions.fundingWindowMs` is accepted + threaded from the env but not yet read by the tx builder; the 04-06 funding stage consumes it inside `onProvideTxData` (clamped per-cohort against the remaining TTL). Documented on the option.
- `CohortMonitor.serviceHealth()` + `noteEsploraObservation()` provide the mode + esplora data; the health-strip render + the funding watch's observation calls land in 04-06. The HealthStrip.tsx already documents this handoff.

## Verification Evidence
- `pnpm vitest run packages/service/tests/live-boot.spec.ts` -> **7 passed**.
- `pnpm vitest run packages/service/src/broadcast.spec.ts` -> **20 passed**.
- `pnpm vitest run packages/service/tests/monitor.spec.ts` -> **40 passed**.
- `pnpm test` (tsc -b + vitest, the committed CI gate) -> **426 passed** (30 files), no regressions (+19 vs 04-04's 407: the new live-boot, broadcast-retry, and serviceHealth tests).
- `pnpm --filter @btcr2-aggregation/web build` -> green.
- `pnpm exec eslint` over all created/modified files -> clean.
- Em-dash scan (U+2014) over all created/modified files -> none.
- Manual (owner, opt-in, non-CI, per plan): a `LIVE=1 BROADCAST=1` boot prints the banner; a bad PHASE_TIMEOUT_MS throws. (The hermetic banner/throw paths are covered by live-boot.spec.ts.)

## Threat Surface
The threat register dispositions hold. T-04-05-01 (BROADCAST enablement elevation) is mitigated by the ADR 0010 layering: BROADCAST requires LIVE (boot throw), mainnet still requires ALLOW_MAINNET (existing guard untouched, allowMainnet now passed through to createService's own assertNetworkAllowed), the loud boot banner + RECOVERY_KEY-absent warn, and the fail-fast phase-timeout > funding-window invariant. T-04-05-02 (retry outcome repudiation) is mitigated by treating duplicate-acceptance as success with `beacon-broadcast` emitted exactly once and an exhaustion reason that distinguishes network-unreachable honestly. T-04-05-03 (boot-banner info disclosure) holds: the banner logs only mode/network + the throwaway-key STATE, never RECOVERY_KEY or the operator password. T-04-05-04 (send-retry DoS) is mitigated by the bounded attempt/backoff budget and the prompt abort on `signal.aborted`; the confirm-poll budget is unchanged. No new HTTP surface, no new anonymous surface: the retry is server-internal and the health data rides the already-gated operator monitor.

## Next Phase Readiness
- 04-06 (funding stage / live mode) consumes `fundingWindowMs` in the tx clamp, calls `monitor.noteEsploraObservation(ok)` from the funding watch / confirm poll, and threads `serviceHealth()` (mode + esplora) through the monitoring payload into the HealthStrip render.
- 04-08 (live UAT) exercises a real `LIVE=1 BROADCAST=1` boot against Polar/regtest, including the boot banner, the funded broadcast path, and the bounded send retry on a genuine esplora.

## Self-Check: PASSED
- `packages/service/tests/live-boot.spec.ts` -> FOUND
- `packages/service/src/broadcast.ts` -> FOUND
- `packages/service/src/monitor.ts` -> FOUND
- `.planning/phases/04-operator-cohort-monitoring/04-05-SUMMARY.md` -> FOUND
- Task 1 commit `ca095b4` -> FOUND
- Task 2 commit `2557c95` -> FOUND
- Task 3 commit `d2ddf09` -> FOUND

---
*Phase: 04-operator-cohort-monitoring*
*Completed: 2026-07-24*
