---
created: 2026-07-29T15:20:00.000Z
title: Reserve the Anchored chip for confirmed anchors
area: service
severity: medium (honesty, likely predates Phase 5)
source: .planning/phases/05-operator-cohort-lifecycle-control/05-AUDIT.md
files:
  - packages/service/src/monitor.ts:1209
  - packages/service/src/monitor.ts:1618
  - packages/web/src/components/operator/OperatorCohortList.tsx:42
---

## Problem

The monitor `signing-complete` handler records `chip: anchored` or `chip: fallback` unconditionally, and a `beacon-anchored` frame carrying `confirmed: false` is deliberately ignored. So the operator console shows a good-tone Anchored chip, and `serviceMetrics().anchored` increments, for cohorts with no confirmed anchor.

The finder framed this as a kill-switch consequence (a stood-down cohort publishes nothing yet reads as Anchored). The second skeptic established it is BROADER and not kill-switch specific: on the mainline live path, a beacon tx that was broadcast but did not confirm inside `confirmTimeoutMs` also reads as Anchored. That means this most likely predates Phase 5 and came in with the Phase 4 monitor, so it should be triaged against 04-02 rather than blamed on this phase.

It contradicts the rule the rest of the console follows, stated in OperatorStageTimeline.tsx itself: Anchored is reserved for a CONFIRMED anchor only (D-18). Phase 3 did this same work on the participant side (03-09, Truth 8); the operator side was never brought into line.

## Solution

Stop letting `signing-complete` mint an on-chain claim. Add a fourth non-failure ended chip (the skeptics suggested `co-signed`) recorded at `signing-complete`, and promote to `anchored` or `fallback` only inside the `beacon-anchored` handler, which already gates on `confirmed === true`. Count the new chip in neither the anchored nor the failed column of `serviceMetrics()`, exactly as `canceled` is handled today, so the counter only ever reports confirmed anchors. Note this also fixes the related UAT-checklist defect where the owner is asked to confirm a hermetic cohort ends Anchored.

## Provenance

Found by the Phase 5 adversarial audit (2026-07-29) and CONFIRMED: both independent skeptics, whose instructions were to refute it, failed to do so. Full finder report, both skeptic verdicts, their corrections and their suggested fixes are in `.planning/phases/05-operator-cohort-lifecycle-control/05-AUDIT.md`.
