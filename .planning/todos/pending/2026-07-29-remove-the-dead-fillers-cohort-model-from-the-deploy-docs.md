---
created: 2026-07-29T15:20:00.000Z
title: Remove the dead FILLERS cohort model from the deploy docs
area: docs
severity: high (a stranger cannot follow the runbook)
source: .planning/phases/05-operator-cohort-lifecycle-control/05-AUDIT.md
files:
  - docs/DEPLOY.md:30
  - docs/DEPLOY.md:460
  - docker-compose.yml:95
---

## Problem

DEPLOY.md quick start, its env reference table, and docker-compose.yml all document `FILLERS` and `MIN_PARTICIPANTS` as the working cohort model. No code path reads `process.env.FILLERS` at all; the surviving `fillers?: number` option is documented in-source as inert residue. Phase 1 replaced that model with operator-triggered advertising, and `MIN_PARTICIPANTS` no longer determines what completes a cohort.

This matters more than a stale line because it is the FIRST instruction a self-hosting stranger follows, and it promises an out-of-the-box cohort the shipped service cannot produce. That cuts directly against the projects core value.

One skeptic tightened the framing fairly: DEPLOY.md does document the correct path further down (OPERATOR_PASSWORD, the operator runtime controls section, the console at /operator), so a reader is not stranded, they are misdirected. The other confirmed the specific lines and that FILLERS is entirely dead.

## Solution

Delete FILLERS from DEPLOY.md and docker-compose.yml, correct the MIN_PARTICIPANTS description to what it actually still does, and make the quick start end at the operator console rather than at a cohort that will never appear. While in there, three lower-severity doc defects from the same audit are worth folding in: AUTO_FALLBACK is read and behavior-changing but documented nowhere an operator would look; ADR 0017 cites a spec file path that does not exist; and DEPLOY.md names a test-peers control by a label the console does not use and shows a stale /v1/config sample.

## Provenance

Found by the Phase 5 adversarial audit (2026-07-29) and CONFIRMED: both independent skeptics, whose instructions were to refute it, failed to do so. Full finder report, both skeptic verdicts, their corrections and their suggested fixes are in `.planning/phases/05-operator-cohort-lifecycle-control/05-AUDIT.md`.
