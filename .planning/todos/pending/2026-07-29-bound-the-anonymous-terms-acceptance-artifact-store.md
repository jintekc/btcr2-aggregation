---
created: 2026-07-29T15:20:00.000Z
title: Bound the anonymous terms-acceptance artifact store
area: service
severity: high (denial of service)
source: .planning/phases/05-operator-cohort-lifecycle-control/05-AUDIT.md
files:
  - packages/service/src/hono-adapter.ts:722
  - packages/service/src/store.ts
---

## Problem

`POST /v1/terms/acceptance` is the only unauthenticated write path this phase added. It stores a new artifact per accepted record with no cap on the store, no eviction, no per-caller throttle and no per-DID cap, on a single-box coordinator (ADR 0014) whose cohort state is already in-memory only.

Found independently by two agents working different dimensions, and confirmed by both skeptics. One measured roughly 430 accepted writes per second in-process, with the server-side schnorr verify as the practical limiter; the store is unbounded at any rate and records are never evicted.

Both skeptics narrowed the precondition usefully: with no terms configured the handler refuses at its first dependency guard before touching the store, so a default self-host is NOT exposed. Growth begins only once the operator sets TERMS_TEXT or sets terms through the runtime settings surface, which is the intended production posture for SVC-05. One skeptic also noted the disk-filling variant is conditional on which artifact store the deployment wires.

Every other structure this phase added is explicitly bounded, which is what makes this one stand out.

## Solution

Give the acceptance store the same treatment as the other bounded structures in this phase: a cap with oldest-first eviction, or a per-DID replace-in-place (a participant re-accepting the same terms should not mint a second record). Consider a cheap per-IP or per-DID rate limit, keeping in mind the existing WR-01 note that the login throttle is not proxy-aware. Whatever bound is chosen, the refusal must stay byte-identical to the existing uniform refusal so the route does not become an enumeration oracle.

## Provenance

Found by the Phase 5 adversarial audit (2026-07-29) and CONFIRMED: both independent skeptics, whose instructions were to refute it, failed to do so. Full finder report, both skeptic verdicts, their corrections and their suggested fixes are in `.planning/phases/05-operator-cohort-lifecycle-control/05-AUDIT.md`.
