---
status: testing
phase: 02-participant-discovery-browse-and-pick-join
source: [02-VERIFICATION.md]
started: 2026-07-14T21:30:00Z
updated: 2026-07-15T20:10:00Z
---

## Current Test

number: 1
name: F1a/F1b directory-honesty visual re-confirm
expected: |
  Test 1 returned an ISSUE (not a display nit): the F1a/F1b fix collapsed the cohort to a single
  n-of-n number and removed the operator's signing-threshold control. The user's intended model is
  a two-field k-of-n cohort - n seats that all join (cohort starts only when n join) and a separate
  signing threshold k (k required to sign). Gap G-02-1 recorded; Tests 2 and 3 pending, to be
  re-run after the k-of-n fix lands (the fix changes the directory + operator-list surfaces they
  cover). Diagnosis + design in progress.
awaiting: gap-closure plan (see ## Gaps G-02-1)

## Tests

The three gap-closure plans (02-05 F1a/F1b, 02-06 F2, 02-07 F1c) landed and the hermetic gate is
green, but the Test 1 visual re-confirm surfaced a modeling error in the F1a/F1b fix (see G-02-1).
Tests 2 and 3 are held pending until the k-of-n correction lands, because it changes the directory
row and operator-list surfaces those tests exercise.

### 1. F1a/F1b directory-honesty visual re-confirm (from 02-VERIFICATION.md; deferred from PLAN 02-05 Task 2)
expected: |
  At /operator (signed in) the create form shows a single `Cohort size (n-of-n)` field (no separate
  capacity input). Create a size-2 CAS cohort and advertise it; in an anonymous tab the directory row
  reads `2/2 seats` (or `0/2 seats, 2 open` before anyone joins) and `Co-sign: 2-of-2`, with no seat
  that never fills.
result: issue
reported: |
  "i dont understand. why did we eliminate the bottom number? the point here is to have a k-of-n
  cohort where k are required to sign but n can join. the cohort does not start until we have n
  participants."
severity: major
target_model: |
  Confirmed by the user (two-field k-of-n): the operator sets TWO numbers - Cohort size n (the seats;
  the cohort does NOT finalize/start until all n join) and Signing threshold k (1 <= k <= n; the
  minimum signers required for the cohort to anchor). Library-constrained mechanism: keep
  minParticipants == maxParticipants == n (finalize only when full, already done by 02-05); the
  optimistic primary spend stays n-of-n MuSig2 (all n sign the cheap key path); if that round stalls
  the ADR-042 k-of-n script-path fallback (fallbackThreshold = k, activated by 02-07) completes as
  long as at least k of the n sign. The directory + operator list must show `joined/n seats` and
  `Co-sign: k-of-n` (threshold = k, capacity = n) honestly. There is NO genuine k-of-n PRIMARY in
  @did-btcr2/aggregation@0.4.0; k is the fallback floor. This RESTORES a second number that 02-05
  removed, but with correct semantics (the second number is the signing threshold k, not the old
  phantom maxParticipants ceiling).

### 2. F2 expiry-surfacing visual re-confirm (from 02-VERIFICATION.md; deferred from PLAN 02-06 Task 3)
expected: |
  At /operator, advertise a cohort and let it sit unjoined past the discovery window (or run with a
  short PHASE_TIMEOUT_MS env override for a faster check): the row flips to a bad-tone `Expired` badge
  with a reason, instead of silently vanishing. Clicking `Re-advertise` puts a fresh cohort back into
  the directory.
why_human: |
  Visual fidelity + interaction (badge tone, reason placement, accent scarcity of the Re-advertise
  button) needs a human eye; the e2e (`pnpm e2e:operator` F2 leg) proves the wire behavior but not the
  rendered operator surface. Held pending the k-of-n fix (the operator-list row it covers changes).
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
  equivalent is proven by `pnpm e2e:browse`, but the in-browser click path is not driven by any
  automated test. Held pending the k-of-n fix (the seats/co-sign labels it observes change).
result: pending

## Summary

total: 3
passed: 0
issues: 1
pending: 2
skipped: 0
blocked: 0

## Gaps

- gap_id: G-02-1
  truth: "The operator can shape a k-of-n cohort: n seats that all join (the cohort starts only when n join) with a separate signing threshold k (k required to sign), and the participant directory shows `joined/n seats` + `Co-sign: k-of-n` honestly."
  status: failed
  reason: "User reported the F1a/F1b fix (02-05) over-corrected: it collapsed the cohort to a single n-of-n number and deleted the operator's signing-threshold control. The user wants a two-field k-of-n model (n seats + signing threshold k). The plumbing for k already exists (02-07's fallbackThreshold + the k-of-n script-path fallback leaf in beacon-address.ts) but is not exposed on the operator create form, not carried as a distinct k in the DTOs, and not displayed (CohortRow shows `Co-sign: {threshold}-of-{threshold}` = n-of-n)."
  severity: major
  verdict: gap
  test: 1
  artifacts: [packages/service/src/operator-cohorts.ts, packages/service/src/hono-adapter.ts, packages/shared/src/index.ts, packages/web/src/components/operator/CreateCohortForm.tsx, packages/web/src/lib/operator.ts, packages/web/src/components/browse/CohortRow.tsx, e2e/browse-join-cohort.ts, e2e/operator-cohort.ts]
  missing: ["a Signing threshold k input on the operator create form (1 <= k <= n)", "createDraft/validateDraft accept { beaconType, size, threshold } and set fallbackThreshold = k with min == max == n", "DTO mapping capacity = n, threshold = k (co-sign), including the F2 expired-record DTO", "CohortRow + operator list display `Co-sign: k-of-n` (threshold-of-capacity), honestly, with the n-of-n-optimistic / k-of-n-fallback semantics", "a hermetic proof of an advertised n-seat, k-threshold cohort that fills n, completes k-of-n on a drop, and shows Co-sign: k-of-n in the directory"]

The two gaps from the first UAT pass remain resolved by the earlier gap-closure plans (retained for traceability):

- gap_id: G-02-F1-legacy
  truth: "The participant directory faithfully represents the cohort's signing set and seat expectations (Co-sign N-of-N and seats)."
  status: resolved
  resolved_by: [02-05-PLAN.md, 02-07-PLAN.md]
  reason: "The phantom unfillable seat is gone (the cohort now finalizes at n, filling all seats). NOTE: G-02-1 supersedes the single-n-of-n modeling choice with a two-field k-of-n model - the phantom-seat fix stands, but the signing-threshold control is being restored."
  severity: minor
  verdict: expected-but-confusing
  test: 1

- gap_id: G-02-F2-legacy
  truth: "An operator-advertised cohort stays discoverable long enough for a stranger to browse and join it by choice over time (the two-sided core loop)."
  status: resolved
  resolved_by: [02-06-PLAN.md]
  reason: "Closed by 02-06: 30-min discovery-window defaults (env-tunable), expiry surfaced to the operator as state:'expired' + reason with a gated re-advertise route, never silently deleted and never shown to participants."
  severity: major
  verdict: gap
  test: 1
