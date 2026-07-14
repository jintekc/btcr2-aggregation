---
status: testing
phase: 02-participant-discovery-browse-and-pick-join
source: [02-VERIFICATION.md]
started: 2026-07-14T21:30:00Z
updated: 2026-07-14T21:30:00Z
---

## Current Test

number: 1
name: Browse landing appearance (service-identity header, live directory poll, empty vs unreachable states)
expected: |
  The service-identity header shows the origin, `Service online`, the active network, and
  `No open cohorts right now` when empty; within ~5s of advertising, a row appears showing
  beacon type + gloss, network, `1/1 seats`, `Co-sign: 1-of-1` (or configured threshold), the
  `Open` accent badge, and a copyable Cohort ID; when the service is unreachable, the distinct
  `Can't reach this service` retry banner shows (not the empty copy). Accent appears only on the
  Open badge + the (disabled) Join button + the wordmark/active nav.
awaiting: user response

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
result: [pending]

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
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
