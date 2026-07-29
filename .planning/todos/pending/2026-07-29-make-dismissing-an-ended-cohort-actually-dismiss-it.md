---
created: 2026-07-29T15:20:00.000Z
title: Make dismissing an ended cohort actually dismiss it
area: web
severity: high (honesty)
source: .planning/phases/05-operator-cohort-lifecycle-control/05-AUDIT.md
files:
  - packages/service/src/monitor.ts:1485
  - packages/web/src/stores/operator.ts:242
  - packages/web/src/lib/operator-rows.ts
---

## Problem

`DISMISS_BODY` tells the operator that dismissing clears the ended cohort record from the console for this session, with no undo. The console Ended group is actually a union of two independent sources (the monitor `ended` record and the operator-cohorts `terminal` record), and `DELETE /v1/operator/ended/:id` deletes only the monitor copy. The row is re-served by `listCohorts()` on the next poll.

Found independently by two agents. Both skeptics confirmed and both corrected the scope in the same direction: the defect holds for any cohort still carrying an operator terminal record (fate `canceled` or `expired`, including a plain TTL lapse). For a canceled cohort the DELETE returns 200 and the row simply comes back; for an expired one whose monitor record is absent the DELETE 404s, so the operator sees the action-failed line AND the row persists. It does NOT hold for `failed`, which `groupForChip` buckets into "Needs attention" where no Dismiss button renders at all.

So the product currently promises an irreversible action and then does nothing observable.

## Solution

Either dismiss both sources (delete the operator terminal record alongside the monitor ended record, which makes the copy true), or narrow the copy and hide the control for rows the dismiss path cannot actually remove. The first is the better product answer; the second is acceptable only if there is a reason a terminal record must survive. Whichever is chosen, add a route or store test that asserts the row is gone from a SUBSEQUENT list read, not merely that the DELETE returned 200: the existing coverage passes precisely because it never re-reads.

## Provenance

Found by the Phase 5 adversarial audit (2026-07-29) and CONFIRMED: both independent skeptics, whose instructions were to refute it, failed to do so. Full finder report, both skeptic verdicts, their corrections and their suggested fixes are in `.planning/phases/05-operator-cohort-lifecycle-control/05-AUDIT.md`.
