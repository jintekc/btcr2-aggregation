---
phase: 02-participant-discovery-browse-and-pick-join
plan: 07
subsystem: api
tags: [aggregation, musig2, taproot, adr-042, cohort-lifecycle, liveness, fallback]

# Dependency graph
requires:
  - phase: 02-participant-discovery-browse-and-pick-join
    provides: 30-min discovery-window timer defaults + de-boothed timer JSDoc in index.ts/demo-server.ts (02-06)
  - phase: 02-participant-discovery-browse-and-pick-join
    provides: single cohort-size ({ beaconType, size }) operator create shape (02-05)
  - phase: 01
    provides: operator auth + on-demand advertiseDraft (sole runner.advertiseCohort caller) + fixture co-sign path
provides:
  - CreateServiceOptions.autoFallbackOnStall threaded to the AggregationServiceRunner (default off = library parity)
  - demo-server AUTO_FALLBACK opt-in (default ON) forwarding autoFallbackOnStall to createService
  - buildCohortConfig optional fallbackThreshold (validated integer in [1, participants]; omitted => library n-1)
  - fixture beacon tx now spends the real beacon-address output (commits the ADR 042 recovery + k-of-n fallback tapleaf)
  - e2e/fallback-cohort.ts hermetic capstone + e2e:fallback script (key-path default + forced-stall script-path)
affects: [phase-4-monitoring, phase-5-lifecycle-control, phase-6-ci-rewire]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "autoFallbackOnStall threaded straight through createService -> AggregationServiceRunner (undefined = library default off)"
    - "fixture prevout = OutScript.encode(Address(network).decode(beaconAddress)) so key path AND script path validate hermetically"
    - "two-leg e2e: synchronize on the hard terminal service event (signing-complete raced against cohort-failed), never a bare timeout"

key-files:
  created:
    - e2e/fallback-cohort.ts
  modified:
    - packages/service/src/index.ts
    - packages/service/src/demo-server.ts
    - packages/service/src/tx.ts
    - packages/service/src/live-tx.spec.ts
    - packages/shared/src/index.ts
    - packages/shared/src/cohort-config.spec.ts
    - package.json

key-decisions:
  - "n-of-n MuSig2 stays the PRIMARY, cheaper, more private spend and the deterministic default outcome; the ADR 042 k-of-n script-path fallback is a liveness backstop that only fires on a SIGNING-phase stall."
  - "autoFallbackOnStall defaults OFF in createService (library parity, existing callers byte-identical) and ON in the demo server (env AUTO_FALLBACK=0 disables), so the self-hosted product recovers liveness while tests stay unchanged."
  - "The fixture beacon tx must spend the real beacon-address output: a bare aggregate-key prevout co-signs the optimistic key path but the library REJECTS the script-path fallback ('Reconstructed beacon output script does not match the spent prevout script'). This was the finding the plan anticipated; fixed rather than surfaced-and-skipped."

patterns-established:
  - "Pattern 1: fallback activation is pure threading - createService forwards autoFallbackOnStall to the runner, demo-server owns the env default; no new call site, no new dependency."
  - "Pattern 2: the fixture prevout is derived from the runner's beaconAddress (decoded on the cohort's resolved network), so the offline path exercises the exact Taproot output the live beacon address commits - both spend paths."

requirements-completed: [PART-01]

coverage:
  - id: F1c-1
    description: "n-of-n MuSig2 stays the deterministic default: with no stall, an advertised cohort co-signs the optimistic key path and signing-complete reports a 64-byte aggregated signature with path key-path (or absent)."
    requirement: "PART-01"
    verification:
      - kind: e2e
        ref: "e2e/fallback-cohort.ts Leg A (pnpm e2e:fallback exit 0): 64-byte key-path signature, fallback never fired"
        status: pass
    human_judgment: false
  - id: F1c-2
    description: "A forced signing-phase stall recovers via the k-of-n script-path fallback instead of failing the cohort: fallback-started fires and signing-complete reports path === 'script-path'."
    requirement: "PART-01"
    verification:
      - kind: e2e
        ref: "e2e/fallback-cohort.ts Leg B (pnpm e2e:fallback exit 0): 2-of-3 script-path fallback after one participant drops on signing-requested"
        status: pass
    human_judgment: false
  - id: F1c-3
    description: "fallbackThreshold is configurable (default n-1): set when a valid k is provided, omitted otherwise, and rejected out of range."
    requirement: "PART-01"
    verification:
      - kind: unit
        ref: "packages/shared/src/cohort-config.spec.ts (10 tests pass; set / k==n boundary / omitted / <1 / >n / non-integer)"
        status: pass
      - kind: other
        ref: "grep autoFallbackOnStall in index.ts (2) + demo-server.ts (3); AUTO_FALLBACK in demo-server.ts; fallbackThreshold in shared/index.ts; tsc -b exit 0"
        status: pass
    human_judgment: false
  - id: F1c-4
    description: "F1c does not change the F2 timer semantics: autoFallbackOnStall only converts a SIGNING-phase stall into a fallback; an idle Advertised cohort still expires (02-06)."
    requirement: "PART-01"
    verification:
      - kind: e2e
        ref: "e2e:operator F2 expiry leg still green (idle-Advertised expiry unchanged); Leg B uses a distinct SIGNING-phase stall"
        status: pass
    human_judgment: false

status: complete
---

# Phase 2 Plan 07: Activate the ADR 042 k-of-n Script-Path Fallback (F1c) Summary

Closes the F1c item of UAT finding F1: keep n-of-n MuSig2 as the primary spend and ACTIVATE the ADR 042 k-of-n script-path fallback for signing liveness, so a single mid-round defector can no longer deny the whole cohort its anchor. The app already committed the fallback tapleaf into every beacon address and already renders the `fallback`/`script-path` telemetry; what was missing was pure activation, and the offline fixture prevout that blocked the fallback from validating hermetically.

## What shipped

- **`autoFallbackOnStall` on `CreateServiceOptions`** (`packages/service/src/index.ts`), threaded straight into the `AggregationServiceRunner` construction alongside `cohortTtlMs`/`phaseTimeoutMs`. Default off (library parity), so every existing caller and test is byte-identical. When true, a stalled optimistic signing round falls back to the k-of-n script path instead of emitting `cohort-failed`.
- **`AUTO_FALLBACK` opt-in in the demo server** (`packages/service/src/demo-server.ts`): `opts.autoFallbackOnStall ?? process.env.AUTO_FALLBACK !== '0'` (default ON), forwarded to `createService`. The env resolution lives inside `startDemoServer` (mirroring the `operatorPassword` pattern), so it covers both the programmatic and the `invokedDirectly` CLI paths.
- **Configurable `fallbackThreshold` on `buildCohortConfig`** (`packages/shared/src/index.ts`): an optional fifth param, validated as an integer in `[1, participants]` (guard-clause house style), set on the returned `CohortConfig` when provided. Omitted, the library derives n-1 floored at 1. It flows onto the already-committed ADR 042 fallback tapleaf via `beacon-address.ts` with no further wiring.
- **Hermetic capstone** `e2e/fallback-cohort.ts` + `e2e:fallback` script (registered locally, NOT in CI).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] Fixture beacon tx must spend the real beacon-address output**
- **Found during:** Task 2 (first `pnpm e2e:fallback` run).
- **Issue:** The offline/fixture beacon tx (`buildFixtureTxData`) locked its prevout to a bare aggregate-key P2TR output (key path only). The optimistic n-of-n key path co-signs fine over that, but the library REJECTS the k-of-n script-path fallback with `Reconstructed beacon output script does not match the spent prevout script`, because a bare key-path prevout does not commit the fallback tapleaf. Leg B saw `fallback-started` fire and the survivors sign, but the service never reached `signing-complete` (it never settled), so the harness timed out. This is exactly the finding the plan's domain caution anticipated ("if the library rejects a script-path spend over the bare key-path fixture prevout, surface that as a finding ... it would mean the fixture tx must commit the same fallback tapleaf as the real beacon address").
- **Fix:** `buildFixtureTxData` now derives the prevout from the cohort's real beacon address (`OutScript.encode(Address(network).decode(beaconAddress))`), which commits both the key path (MuSig2 aggregate internal key) and the recovery + k-of-n fallback script tree. `tx.ts` passes the runner's `beaconAddress` and the cohort's resolved network on the fixture path. Fixed rather than surfaced-and-skipped, so the hermetic proof genuinely passes.
- **Files modified:** `packages/shared/src/index.ts`, `packages/service/src/tx.ts`, `packages/service/src/live-tx.spec.ts` (fixture spec updated to assert the prevout is the beacon address's own scriptPubKey).
- **Commit:** `41d0728`
- **Blast-radius check:** every fixture-path e2e that co-signs stayed green (`e2e`, `e2e:smt`, `e2e:x1`, `e2e:mixed`, `e2e:x1:negative`, `e2e:operator`, `e2e:browse`, `e2e:persist`, `e2e:resolve`, `e2e:config`, `e2e:baked`, `e2e:live:mock`, `e2e:ipfs`), 286/286 unit tests pass, web tsc + vite build clean.

Otherwise the plan executed as written. No architectural (Rule 4) changes; zero new packages.

## Verification

- `pnpm vitest run packages/shared/src/cohort-config.spec.ts`: 10 tests pass (fallbackThreshold set / k==n boundary / omitted / <1 / >n / non-integer).
- `pnpm e2e:fallback`: exit 0. Leg A = 64-byte key-path aggregated signature, no fallback (deterministic default). Leg B = `fallback-started` + `path === 'script-path'` after a forced 2-of-3 signing-phase stall.
- `pnpm typecheck` (tsc -b), `pnpm lint` (eslint), `pnpm test` (286 unit tests), web `tsc --noEmit` + `vite build`: all clean.
- Full fixture-path e2e regression suite (12 co-signing scenarios + ipfs): all green.
- Threat register: T-07-01 (k-of-n fallback) mitigated (n-of-n primary + n-1 fallback bound validated `<= participants` + committed leaf); T-07-02 DoS mitigated positively (liveness recovery); T-07-03 real-funds accept (inert on fixture path); zero new packages (T-07-SC).

## Known Stubs

None. All wiring is live: the fallback activates on a real signing-phase stall and completes over the real HTTP transport; the fixture prevout commits the real beacon output.

## Notes for later phases

- **CI debt (Phase 6):** `e2e:fallback` is registered locally but intentionally NOT wired into CI, consistent with `e2e:operator` / `e2e:browse`. The Phase-6 CI rewire should add it alongside re-wiring the two red booth-topology browser jobs.
- The `fallback` status + `script-path` badge already render in the dashboard (`dashboard.ts`, `CohortCard.tsx`, `web/src/lib/types.ts`), so a live fallback outcome is already surfaced to the operator; no telemetry change was needed.

## Self-Check: PASSED

- Created file present: `e2e/fallback-cohort.ts` (FOUND).
- Modified files present: `packages/shared/src/index.ts`, `packages/service/src/index.ts`, `packages/service/src/demo-server.ts`, `packages/service/src/tx.ts`, `packages/shared/src/cohort-config.spec.ts`, `packages/service/src/live-tx.spec.ts`, `package.json` (all FOUND).
- Commits present: `018233e` (test RED), `5b4b263` (feat activation), `41d0728` (fix fixture prevout), `c216b9b` (test capstone) - all FOUND.
