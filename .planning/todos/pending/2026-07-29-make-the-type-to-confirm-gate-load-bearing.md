---
created: 2026-07-29T15:20:00.000Z
title: Make the type-to-confirm gate load-bearing
area: web
severity: low (test coverage)
source: .planning/phases/05-operator-cohort-lifecycle-control/05-AUDIT.md
files:
  - packages/web/src/ui/primitives.tsx:309
  - packages/web/src/lib/lifecycle.ts:172
  - packages/web/tests/lifecycle.spec.ts:201
---

## Problem

`typeToConfirmMatches` is never called by any component. The shipped rung-4 gate (cancelling a FUNDED cohort, the highest-friction confirmation in the product) is a separate inline comparison in ConfirmPanel. The seven assertions in the lifecycle spec that claim a near-miss value can never arm the confirm button all test the uncalled function, so they would stay green if the shipped gate were weakened to case-insensitive or prefix matching.

Both skeptics confirmed, and both were careful to say this is a coverage and duplication defect, not a live bug: the inline gate is behaviorally identical for every value the app can pass (the single call site passes an 8-character cohort-id prefix). The only divergence is an empty or whitespace-only expected value, where the inline version arms immediately, which is unreachable today.

One skeptic noted the deeper cause: the web package has no DOM test harness at all (no jsdom, no testing-library), so nothing renders any component. That is the same gap every plan from 05-06 onward recorded.

05-02-PLAN.md explicitly required the component to call the predicate.

## Solution

Have ConfirmPanel call `typeToConfirmMatches` so the existing spec becomes load-bearing. If keeping ui/primitives.tsx dependency-free matters, move the predicate to a dependency-free module imported by both and re-exported from lib/lifecycle.ts so the spec keeps passing unchanged. Either way the empty-expected divergence closes too. The broader missing-DOM-harness gap is a separate, larger decision worth taking on its own.

## Provenance

Found by the Phase 5 adversarial audit (2026-07-29) and CONFIRMED: both independent skeptics, whose instructions were to refute it, failed to do so. Full finder report, both skeptic verdicts, their corrections and their suggested fixes are in `.planning/phases/05-operator-cohort-lifecycle-control/05-AUDIT.md`.
