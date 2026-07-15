---
status: diagnosed
phase: 02-participant-discovery-browse-and-pick-join
source: [02-VERIFICATION.md]
started: 2026-07-14T21:30:00Z
updated: 2026-07-15T00:00:00Z
---

## Current Test

[testing complete - issues found on Test 1; Test 2 deferred to post-gap-closure re-verification]

## Tests

### 1. Browse landing appearance (PLAN 02-02, deferred human-check)
expected: |
  Load `/` (anonymous) with no cohorts advertised, then advertise a cohort as operator at
  `/operator` and return to `/`, then stop the service and reload `/`.
  The service-identity header shows the origin, `Service online`, the active network, and
  `No open cohorts right now` when empty; within ~5s of advertising, a row appears showing
  beacon type + gloss, network, `1/1 seats`, `Co-sign: 1-of-1` (or configured threshold), the
  `Open` accent badge, and a copyable Cohort ID; when the service is unreachable, the distinct
  `Can't reach this service` retry banner shows (not the empty copy). Accent appears only on the
  Open badge + the (disabled) Join button + the wordmark/active nav.
why_human: |
  Visual fidelity (focal heading, accent scarcity, live-poll appearance of a new row, distinct
  empty/unreachable banners) cannot be asserted by grep/unit tests; packages/web has no DOM render
  harness (deliberately, to avoid adding a new package, T-02-SC). Deferred from
  checkpoint:human-verify to end-of-phase per PLAN 02-02 Task 3 (non-blocking).
result: issue
severity: major
reported: |
  1) Operator setting 2/3 shows "Co-sign: 2-of-2" on the participant side. Are we not allowing
     k-of-n ever, or a keypath spend fallback? The aggregation package should support it.
  2) Both cohorts disappear after some time period despite no one joining.
findings:
  - id: F1-cosign-and-kofn
    severity: minor
    verdict: expected-but-confusing
    root_cause: |
      Operator "2/3" = minParticipants(2, floor) / maxParticipants(3, ceiling), not a k-of-n ratio.
      The library's default onReadyToFinalize finalizes at minParticipants and the app never overrides
      it, so a 2/3 cohort locks at the 2nd seat and MuSig2 keypath-signs a genuine 2-of-2. "Co-sign:
      2-of-2" (CohortRow.tsx:71, hardwired {threshold}-of-{threshold}) is therefore CORRECT for what
      signs; the misleading part is the "0/3 seats, 3 open" caption advertising a 3rd seat that can
      never fill. Genuine k-of-n PRIMARY signing is not offered by @did-btcr2/aggregation@0.4.0; a
      k-of-n SCRIPT-PATH fallback IS (ADR-042: CHECKSIGADD tapleaf, autoFallbackOnStall/triggerFallback/
      approveFallback) but this app only passively commits the fallback leaf into the beacon address and
      never activates it (autoFallbackOnStall unset, triggerFallback never called, fallbackThreshold not
      operator-configurable), so a stalled cohort fails instead of falling back.
    artifacts: [packages/web/src/components/browse/CohortRow.tsx, packages/service/src/operator-cohorts.ts, packages/shared/src/index.ts, packages/service/src/beacon-address.ts]
  - id: F2-cohort-expiry
    severity: major
    verdict: gap
    root_cause: |
      An advertised, unjoined cohort is torn down after ~60s by the library's per-phase STALL timer
      (phaseTimeoutMs default 60000, demo-server.ts:144-145 -> index.ts:394-395), not the 3-min
      cohortTtlMs. An idle cohort never leaves the "Advertised" phase, so the stall timer fires,
      emits cohort-failed ("stalled in phase Advertised for 60000ms"), and session.removeCohort() FULLY
      deletes the cohort; completion.finally then prunes the enrichment map (operator-cohorts.ts:243-253).
      The cohort is truly gone and unjoinable afterward. The 60s default was tuned for the old booth
      topology (in-process fillers joined within seconds); it defeats the two-sided discover-over-time
      loop. Expiry is surfaced only on the read-only /dashboard/events SSE, never in the participant
      directory or the operator cohort list.
    artifacts: [packages/service/src/demo-server.ts, packages/service/src/index.ts, packages/service/src/operator-cohorts.ts]

### 2. Pick to join to seated click flow (PLAN 02-04, deferred human-check)
expected: |
  As operator at `/operator` advertise a 2-of-2 cohort; in a second anonymous tab at `/`, click
  Join on the Open row, Cancel once before generating a key, then Generate a KEY identity and click
  Join cohort while a second participant fills the cohort; separately, advertise a 1-of-1 that fills
  before confirming and try to join it; then use Leave cohort from a seated state.
  A joinable row shows an enabled Join; a Filling/Full row shows Join disabled. Clicking Join reveals
  the inline identity step (KEY/import choice + custody note); Cancel returns to the directory having
  minted no key. Confirming Join cohort with a filling partner reaches the seated confirmation
  `You're seated in cohort ...`, and the existing co-sign/resolve tail proceeds to a 64-byte signature
  + resolve. Trying to join an already-filled cohort yields `That cohort just filled or closed. Pick
  another from the directory.` and returns to browse with no dead spinner. Leave cohort returns to the
  directory with no confirmation dialog.
why_human: |
  Visual fidelity + interaction sequencing (disabled-Join appearance, Cancel-mints-nothing, the
  seated-to-tail visual transition, the filled/closed banner) cannot be asserted without a DOM
  harness; the headless equivalent (join-by-filter selectivity, deterministic no-seat, 64-byte
  co-sign) is proven by the automated `pnpm e2e:browse` capstone, but the in-browser click path itself
  is not driven by any automated test. Deferred from checkpoint:human-verify to end-of-phase per PLAN
  02-04 Task 2 (non-blocking).
result: skipped
reason: |
  Deferred to a post-gap-closure re-verification. The pick -> inline-identity -> seated -> tail surface
  this exercises is being changed by the accepted gap fixes (F1a honest seats label, F1b capacity
  semantics, F2 cohort lifetime), and F2's ~60s expiry makes the manual two-tab flow unreliable to run
  today. Re-run this check after the Phase 2 gap-closure lands.

## Summary

total: 2
passed: 0
issues: 1
pending: 0
skipped: 1
blocked: 0

## Gaps

- truth: "The participant directory faithfully represents the cohort's signing set and seat expectations (Co-sign N-of-N and seats)."
  status: failed
  reason: "User reported: operator 2/3 shows 'Co-sign: 2-of-2'. Investigation: correct value (cohort locks at threshold, signs 2-of-2), but the '0/3 seats, 3 open' caption advertises a seat that can never fill; genuine k-of-n primary is not offered by the package, and the ADR-042 k-of-n script-path fallback the package DOES support is only passively committed, never activated by the service."
  severity: minor
  verdict: expected-but-confusing
  test: 1
  artifacts: [packages/web/src/components/browse/CohortRow.tsx, packages/service/src/operator-cohorts.ts, packages/shared/src/index.ts, packages/service/src/beacon-address.ts]
  missing: ["honest seats/capacity display (locks-at-threshold)", "product decision on capacity>threshold semantics", "optional: wire/surface the ADR-042 k-of-n script-path fallback + configurable fallbackThreshold"]

- truth: "An operator-advertised cohort stays discoverable long enough for a stranger to browse and join it by choice over time (the two-sided core loop)."
  status: failed
  reason: "User reported: both cohorts disappear after some time despite no one joining. Investigation: the library per-phase stall timer (phaseTimeoutMs default 60s) fires on an idle Advertised cohort and session.removeCohort() fully deletes it; it becomes unjoinable and vanishes silently from the directory/operator list. The 60s default is a booth-era holdover that defeats discover-over-time."
  severity: major
  verdict: gap
  test: 1
  artifacts: [packages/service/src/demo-server.ts, packages/service/src/index.ts, packages/service/src/operator-cohorts.ts]
  missing: ["two-sided-appropriate cohort lifetime default (phaseTimeoutMs/cohortTtlMs)", "operator-visible expired/failed state + re-advertise, instead of silent deletion"]
