---
status: testing
phase: 02-participant-discovery-browse-and-pick-join
source: [02-VERIFICATION.md]
started: 2026-07-14T21:30:00Z
updated: 2026-07-15T19:20:00Z
---

## Current Test

number: 1
name: F1a/F1b directory-honesty visual re-confirm
expected: |
  At /operator (signed in) the create form shows a single `Cohort size (n-of-n)` field (no
  separate capacity input). Create a size-2 CAS cohort and advertise it; in an anonymous tab the
  directory row reads `2/2 seats` (or `0/2 seats, 2 open` before anyone joins) and `Co-sign:
  2-of-2`, with no seat that never fills.
awaiting: user response

## Tests

The three gap-closure plans (02-05 F1a/F1b, 02-06 F2, 02-07 F1c) have all landed and the hermetic
gate is green (286/286 unit, e2e:operator + e2e:browse + e2e:fallback all pass). The wire behavior
behind each item below is proven by the automated e2e suite; these three tests re-confirm the
rendered click path a human eye must judge (packages/web has no DOM render harness, deliberately,
T-02-SC).

### 1. F1a/F1b directory-honesty visual re-confirm (from 02-VERIFICATION.md; deferred from PLAN 02-05 Task 2)
expected: |
  At /operator (signed in) the create form shows a single `Cohort size (n-of-n)` field (no separate
  capacity input). Create a size-2 CAS cohort and advertise it; in an anonymous tab the directory row
  reads `2/2 seats` (or `0/2 seats, 2 open` before anyone joins) and `Co-sign: 2-of-2`, with no seat
  that never fills.
why_human: |
  Visual fidelity of the collapsed create form and the directory row's truthfulness cannot be asserted
  by grep/unit tests; packages/web has no DOM render harness. This is the direct re-confirmation of the
  UAT F1a/F1b finding after the code-level fix (min == max == n is now unrepresentable server-side).
result: pending

### 2. F2 expiry-surfacing visual re-confirm (from 02-VERIFICATION.md; deferred from PLAN 02-06 Task 3)
expected: |
  At /operator, advertise a cohort and let it sit unjoined past the discovery window (or run with a
  short PHASE_TIMEOUT_MS env override for a faster check): the row flips to a bad-tone `Expired` badge
  with a reason, instead of silently vanishing. Clicking `Re-advertise` puts a fresh cohort back into
  the directory.
why_human: |
  Visual fidelity + interaction (badge tone, reason placement, accent scarcity of the Re-advertise
  button) needs a human eye; the e2e (`pnpm e2e:operator` F2 leg) proves the wire behavior but not the
  rendered operator surface. This is the direct re-confirmation of the UAT F2 finding after the fix.
result: pending

### 3. Pick to join to seated click flow (PLAN 02-04; re-run now that gaps are closed)
expected: |
  As operator at /operator advertise a 2-of-2 cohort; in a second anonymous tab at /, click Join on
  the Open row, Cancel once before generating a key, then Generate a KEY identity and click Join cohort
  while a second participant fills the cohort; separately, advertise a 1-of-1 that fills before
  confirming and try to join it; then use Leave cohort from a seated state.
  A joinable row shows an enabled Join; a Filling/Full row shows Join disabled. Clicking Join reveals
  the inline identity step (KEY/import choice + custody note); Cancel returns to the directory having
  minted no key. Confirming Join cohort with a filling partner reaches the seated confirmation
  `You're seated in cohort ...`, and the existing co-sign/resolve tail proceeds to a 64-byte signature
  + resolve. Trying to join an already-filled cohort yields `That cohort just filled or closed. Pick
  another from the directory.` and returns to browse with no dead spinner. Leave cohort returns to the
  directory with no confirmation dialog.
why_human: |
  Visual fidelity + interaction sequencing cannot be asserted without a DOM harness; the headless
  equivalent (join-by-filter selectivity, deterministic no-seat, 64-byte co-sign) is proven by the
  automated `pnpm e2e:browse` capstone, but the in-browser click path is not driven by any automated
  test. Originally skipped in Test 1's pass pending gap closure; the 30-minute discovery window (02-06)
  now makes this two-tab flow reliable to run.
result: pending

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps

The two gaps found on the first UAT pass are now resolved by the gap-closure plans; retained here for
traceability.

- truth: "The participant directory faithfully represents the cohort's signing set and seat expectations (Co-sign N-of-N and seats)."
  status: resolved
  resolved_by: [02-05-PLAN.md, 02-07-PLAN.md]
  reason: "Closed by 02-05 (single Cohort size n; validateDraft accepts only { beaconType, size }; createDraft forces min == max == n, so a phantom unfillable seat is unrepresentable server-side, F1a/F1b) and 02-07 (the ADR-042 k-of-n script-path fallback is now activated for signing-stall liveness while n-of-n stays the primary spend, F1c). Awaiting the Test 1 visual re-confirm above."
  severity: minor
  verdict: expected-but-confusing
  test: 1
  artifacts: [packages/service/src/operator-cohorts.ts, packages/web/src/components/operator/CreateCohortForm.tsx, packages/shared/src/index.ts, packages/service/src/index.ts]

- truth: "An operator-advertised cohort stays discoverable long enough for a stranger to browse and join it by choice over time (the two-sided core loop)."
  status: resolved
  resolved_by: [02-06-PLAN.md]
  reason: "Closed by 02-06: the discovery-window defaults are now 30 minutes (env-tunable via PHASE_TIMEOUT_MS/COHORT_TTL_MS), and an expired cohort is retained as a bounded terminal record surfaced to the operator as state:'expired' + reason with a gated re-advertise route, never silently deleted and never shown to participants. Awaiting the Test 2 visual re-confirm above."
  severity: major
  verdict: gap
  test: 1
  artifacts: [packages/service/src/demo-server.ts, packages/service/src/index.ts, packages/service/src/operator-cohorts.ts]
