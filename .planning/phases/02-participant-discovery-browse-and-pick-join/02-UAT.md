---
status: testing
phase: 02-participant-discovery-browse-and-pick-join
source: [02-VERIFICATION.md]
started: 2026-07-14T21:30:00Z
updated: 2026-07-15T22:30:00Z
---

## Current Test

number: 1
name: Two-field k-of-n directory-honesty visual re-confirm
expected: |
  At /operator (signed in) the create form shows TWO fields, `Cohort size (seats)` and
  `Signing threshold (k of n)`, each with a help line, the threshold defaulting to the size.
  Create a size-4 / threshold-2 CAS cohort and advertise it; in an anonymous tab the directory
  row reads 4 seats and a `2-of-4` co-sign figure with the caption
  `all co-sign; anchors if at least 2 of 4 sign`. Separately create a size-2 / threshold-2
  cohort and confirm its row reads `2-of-2` with the caption `all signers required`.
awaiting: user response

## Tests

All four gap-closure plans have landed (02-05 F1a/F1b, 02-06 F2, 02-07 F1c, 02-08 G-02-1
two-field k-of-n). Re-verification: 23/23 must-haves, all gates independently re-run green
(298 unit tests, e2e:kofn both legs + e2e:operator + e2e:browse + e2e:fallback, typecheck,
lint, web build). The wire behavior behind each test below is machine-proven; these three
re-confirm the rendered click path a human eye must judge (no DOM harness, T-02-SC).

### 1. Two-field k-of-n directory-honesty visual re-confirm (supersedes the prior F1a/F1b single-field check; deferred from PLAN 02-08 Task 2 human-check)
expected: |
  At /operator (signed in) the create form shows TWO fields, `Cohort size (seats)` and
  `Signing threshold (k of n)`, each with its help line, with the threshold defaulting to the
  size. Create a size-4 / threshold-2 CAS cohort and advertise it; in an anonymous tab the
  directory row reads 4 seats and a `2-of-4` co-sign figure with the caption
  `all co-sign; anchors if at least 2 of 4 sign`. Separately create a size-2 / threshold-2
  cohort and confirm its row reads `2-of-2` with the caption `all signers required`.
why_human: |
  Visual fidelity of the new two-field form and the rendered k-of-n copy cannot be asserted by
  grep/unit tests; packages/web has no DOM render harness (deliberate, T-02-SC). The string
  logic is unit-proven (DirectoryList.spec.ts cosignValue/cosignCaption assertions) but the
  on-screen rendering and form layout are not automated.
result: pending

### 2. F2 expiry-surfacing visual re-confirm (unchanged from the prior report; deferred from PLAN 02-06 Task 3 human-check)
expected: |
  At /operator, advertise a cohort and let it sit unjoined past the discovery window (or use a
  short PHASE_TIMEOUT_MS override for a faster check). The row flips to a bad-tone `Expired`
  badge with a reason, and `Re-advertise` puts a fresh cohort back into the directory. The row
  now also shows the k-of-n co-sign figure.
why_human: |
  Visual fidelity + interaction cannot be grepped; the e2e proves the wire behavior
  (pnpm e2e:operator F2 leg, independently re-run), not the rendered surface.
result: pending

### 3. Pick to join to seated click flow (UAT Test 2; previously skipped pending gap closure, still due)
expected: |
  As operator advertise a 2-of-2 cohort; from a second anonymous tab click Join on the Open
  row, Cancel once before generating a key, then generate a KEY identity and confirm Join
  cohort while a second participant fills the cohort; separately advertise a 1-of-1 that fills
  before confirming and try to join it; then use Leave cohort from a seated state.
  Non-joinable rows show disabled Join; Cancel mints no key; a successful join reaches the
  seated confirmation `You're seated in cohort ...` and the reused tail proceeds to a 64-byte
  co-sign + resolve; a lost pick shows `That cohort just filled or closed. Pick another from
  the directory.` and returns to browse with no dead spinner; Leave returns to the directory
  with no confirmation dialog. The row's co-sign figure reads `2-of-2` (k == n honest default).
why_human: |
  Same DOM-harness gap; pnpm e2e:browse proves the underlying lifecycle and selectivity
  headlessly (independently re-run, exit 0), but not the rendered click path.
result: pending

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps

All gaps from this phase's UAT are now resolved by executed gap-closure plans; retained for
traceability.

- gap_id: G-02-1
  truth: "The operator can shape a k-of-n cohort: n seats that all join (the cohort starts only when n join) with a separate signing threshold k (k required to sign), and the participant directory shows `joined/n seats` + a `k-of-n` co-sign figure honestly."
  status: resolved
  resolved_by: 02-08-PLAN.md
  resolved_at: 2026-07-15
  reason: "Closed by 02-08: DraftInput { beaconType, size, threshold? } with k = threshold ?? size guarded [1, size] (exact THRESHOLD_ERROR, byte-identical server/client) plus the fallback-off over-promise guard; createDraft always sets fallbackThreshold = k while min == max == n stays pinned; the DTO flipped atomically (threshold = k, capacity = n) at all four emit sites incl. the F2 expired records; cosignValue/cosignCaption drive the honest display; proven by the n=4/k=2 e2e:kofn capstone (drop-2 script-path recovery + drop-3 cohort-failed floor). Re-verified 23/23. Awaiting the Test 1 visual re-confirm above."
  severity: major
  verdict: gap
  test: 1

- gap_id: G-02-F1-legacy
  truth: "The participant directory faithfully represents the cohort's signing set and seat expectations."
  status: resolved
  resolved_by: [02-05-PLAN.md, 02-07-PLAN.md, 02-08-PLAN.md]
  reason: "The phantom unfillable seat is gone (finalize-at-n, 02-05); the fallback is activated (02-07); and the signing-threshold control returned as an honest second number k (02-08, superseding the single-n-of-n over-correction)."
  severity: minor
  verdict: expected-but-confusing
  test: 1

- gap_id: G-02-F2-legacy
  truth: "An operator-advertised cohort stays discoverable long enough for a stranger to browse and join it by choice over time."
  status: resolved
  resolved_by: [02-06-PLAN.md]
  reason: "30-min discovery-window defaults (env-tunable), expiry surfaced to the operator as state:'expired' + reason with a gated re-advertise route, never silently deleted and never shown to participants."
  severity: major
  verdict: gap
  test: 1
