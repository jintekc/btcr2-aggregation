---
created: 2026-07-29T15:20:00.000Z
title: Apply the discovery-window ceiling to the env seed path
area: service
severity: high
source: .planning/phases/05-operator-cohort-lifecycle-control/05-AUDIT.md
files:
  - packages/service/src/runtime-settings.ts:321
  - docs/adr/0017-runtime-lifecycle-control.md
  - docs/DEPLOY.md
---

## Problem

`createRuntimeSettings` applies only the 60 second floor to the `defaultDiscoveryWindowMs` seed and never compares it against `discoveryWindowCeilingMs`, which is consulted only inside `applySettings`. `demo-server.ts` adds no boot check either.

So a `DEFAULT_DISCOVERY_WINDOW_MS` above `COHORT_TTL_MS` is silently accepted as an unenforceable default, directly contradicting ADR 0017, DEPLOY.md and docker-compose.yml, which all state that a larger value is refused at save with the real maximum named and never silently ignored. Worse, once seeded over the ceiling, `applySettings` then rejects EVERY subsequent settings save, including saves of completely unrelated fields, so the operator settings surface is bricked for the session.

Both skeptics confirmed. One corrected a mechanism detail in the original write-up: `armWindowTimer` returns early when `windowMs >= cohortTtlMs`, so no app timer is armed at all; the cohort lapses on the library own TTL instead, which reaches the same bad outcome by a different route.

## Solution

Apply the ceiling at seed time exactly as `applySettings` does, and decide the boot behaviour deliberately: either clamp with a loud warning, or refuse to boot with the real maximum named. Clamping matches the projects existing posture for the NaN-guarded knobs; refusing matches the docs wording more literally. Whichever is chosen, make the docs and the code agree, and add a spec that seeds over the ceiling and asserts both the seed outcome and that a later unrelated save still succeeds.

## Provenance

Found by the Phase 5 adversarial audit (2026-07-29) and CONFIRMED: both independent skeptics, whose instructions were to refute it, failed to do so. Full finder report, both skeptic verdicts, their corrections and their suggested fixes are in `.planning/phases/05-operator-cohort-lifecycle-control/05-AUDIT.md`.
