---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
current_phase: 02
current_phase_name: participant-discovery-browse-and-pick-join
status: gap_closure
stopped_at: Phase 2 UAT found 2 gaps (F1 cohort-size/label, F2 cohort expiry) + k-of-n fallback; 3 gap plans (02-05/06/07) planned + plan-check PASSED; ready for /gsd-execute-phase 2 --gaps-only
last_updated: "2026-07-15T00:30:00.000Z"
last_activity: 2026-07-15
last_activity_desc: Phase 02 UAT diagnosed F1/F2 + wired k-of-n direction; 3 gap-closure plans created and verified
progress:
  total_phases: 6
  completed_phases: 2
  total_plans: 8
  completed_plans: 8
  percent: 33
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-08)

**Core value:** A stranger can self-host a real aggregation service that advertises cohorts, and another stranger can point a participant at that service's URL, browse its cohorts, join, co-sign, and resolve - a genuinely two-sided, self-hostable product, not a demo.
**Current focus:** Phase 02 - participant-discovery-browse-and-pick-join

## Current Position

Phase: 02 (participant-discovery-browse-and-pick-join) - GAP CLOSURE PENDING
Plan: 4 of 4 executed + verified (human_needed); UAT Test 1 found F1 (cohort-size/label) + F2 (cohort expiry); 3 gap plans 02-05/06/07 created + plan-check PASSED; UAT Test 2 deferred to post-gap re-verify
Status: Run /gsd-execute-phase 2 --gaps-only to build the fixes (F1a/F1b single cohort-size, F2 lifetime+expiry, F1c k-of-n script-path fallback), then re-verify Test 2.
Last activity: 2026-07-15 - Phase 02 gap-closure planned (F1/F2 + k-of-n fallback), plan-check passed

Progress: [██░░░░░░░░] 17% (Phase 1 of 6 complete)

## Performance Metrics

**Velocity:**

- Total plans completed: 4
- Average duration: - min
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1 | 4 | - | - |

**Recent Trend:**

- Last 5 plans: -
- Trend: -

*Updated after each plan completion*
| Phase 01 P01 | 11 | 3 tasks | 15 files |
| Phase 01 P02 | 6min | 2 tasks | 9 files |
| Phase 01 P03 | 13 min | 3 tasks | 10 files |
| Phase 01 P04 | 8m | 1 tasks | 2 files |
| Phase 02 P01 | 14 min | 2 tasks | 4 files |
| Phase 02 P02 | 5 min | 3 tasks | 8 files |
| Phase 02 P03 | 12min | 1 tasks | 3 files |
| Phase 02 P04 | 2 min | 2 tasks | 4 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Roadmap: Two-sided product realignment - services advertise/manage cohorts, participants discover/join/participate (not a single demo flow).
- Roadmap: Discovery is a per-service cohort directory (not federated, not invite-only).
- Roadmap: Operator auth (HOST-01) bundled with the first operator control action (Phase 1) so no unauthenticated mutating operator route ever ships.
- [Phase ?]: Phase 1: operator auth = httpOnly opaque server-tracked session cookie (only scheme that gates the EventSource SSE feed); fail-closed boot when OPERATOR_PASSWORD unset (ADR 0015, supersedes ADR 0004)
- [Phase 01]: Phase 1 P02: a cohort draft is app-level config only (never touches the runner until advertise, plan 03); active network is the service's resolved network, never a form value (D-10); capacity applied app-side as maxParticipants (D-11/D-19)
- [Phase ?]: 01-03: advertiseDraft is the sole runner.advertiseCohort caller; the boot-time auto-advertise loop + boot-path fillers removed (D-17/D-18)
- [Phase ?]: 01-03: public /v1/directory + /v1/status derive from live runner.session.cohorts filtered to pre-signing OPEN_PHASES; enrichment pruned on completion.finally so the open-count cannot drift (D-09/D-15)
- [Phase ?]: Phase-1 e2e (e2e:operator) never calls runner.run(); the operator advertise route self-drives the cohort and the harness observes the 64-byte signature off signing-complete
- [Phase ?]: e2e:operator registered but intentionally NOT wired into CI (deferred to a Phase-6 / CI concern)

### Pending Todos

[From .planning/todos/pending/ - ideas captured during sessions]

None yet.

### Blockers/Concerns

[Issues that affect future work]

- ✓ [Phase 1] Operator authentication shipped (ADR 0015) - the control plane is no longer unauthenticated; this must stay green in every later phase. Non-blocking follow-up before public-internet deploy: T-01-06 login-throttle-per-proxy + WR-02 NaN-TTL hardening (see 01-SECURITY.md / 01-REVIEW.md).
- Cohort state is single-process and in-memory; durability/crash-recovery is deferred to v2 (DUR-01). The boot-time auto-advertise loop that used to drive cohorts was removed in Phase 1 - cohorts now exist only on operator action.

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| Durability | DUR-01: cohort state survives process restart | v2 | 2026-07-07 |
| Participant mgmt | PMG-01: richer multi-cohort management view | v2 | 2026-07-07 |
| Operator access | OACC-01: multiple operators / role granularity | v2 | 2026-07-07 |
| CI / test debt | Rewire `e2e:browser` + `e2e:browser:prod` (booth-topology, broke when the auto-advertise loop was removed in 01-03) and add `e2e:operator` to CI; those 2 CI jobs stay red until then | Phase 6 | 2026-07-08 |

## Session Continuity

Last session: 2026-07-15T00:30:00.000Z
Stopped at: Phase 2 UAT diagnosed F1/F2; 3 gap-closure plans (02-05/06/07) created + plan-check PASSED
Resume file: .planning/phases/02-participant-discovery-browse-and-pick-join/02-05-PLAN.md
Next command: /gsd-execute-phase 2 --gaps-only
