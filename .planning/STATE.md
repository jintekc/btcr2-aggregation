---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
current_phase: 3
status: planning
stopped_at: Phase 3 context gathered
last_updated: "2026-07-17T15:28:11.352Z"
last_activity: 2026-07-16
last_activity_desc: Phase 02 complete, transitioned to Phase 3
progress:
  total_phases: 3
  completed_phases: 2
  total_plans: 13
  completed_plans: 13
current_phase_name: Participant Submit, Co-Sign, Track, and Resolve
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-16)

**Core value:** A stranger can self-host a real aggregation service that advertises cohorts, and another stranger can point a participant at that service's URL, browse its cohorts, join, co-sign, and resolve - a genuinely two-sided, self-hostable product, not a demo.
**Current focus:** Phase 3 - Participant Submit, Co-Sign, Track, and Resolve

## Current Position

Phase: 3 - Participant Submit, Co-Sign, Track, and Resolve
Plan: Not started
Status: Ready to plan
Last activity: 2026-07-16 - Phase 02 complete, transitioned to Phase 3

Progress: [███░░░░░░░] 33% (Phase 2 of 6 complete)

## Performance Metrics

**Velocity:**

- Total plans completed: 13
- Average duration: - min
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1 | 4 | - | - |
| 02 | 9 | - | - |

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
**Per-Plan Metrics:**

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 02 P05 | 6min | 3 tasks | 7 files |
| Phase 02 P06 | 18min | 3 tasks | 9 files |
| Phase 02 P07 | 10min | 2 tasks | 7 files |
| Phase 02 P08 | 12min | 3 tasks | 16 files |
| Phase 02 P09 | 7min | 2 tasks | 3 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work (Phase 2):

- [Phase 02] Two-field k-of-n cohort shape: n seats that ALL join before start (min == max == n, no phantom seat), k = the ADR-042 script-path fallbackThreshold (1 <= k <= n, default k = n); DTO flipped threshold=k / capacity=n at all four emit sites; honest cosignValue/cosignCaption copy (02-05/02-08).
- [Phase 02] The ADR-042 k-of-n script-path fallback is ACTIVATED for signing liveness (createService.autoFallbackOnStall; demo-server default ON via AUTO_FALLBACK); n-of-n MuSig2 stays the primary spend; validateDraft refuses k < n when the fallback is off (02-07).
- [Phase 02] Advertised cohorts get a 30-min discovery window (env-tunable); expiry surfaces to the operator as a bounded 'expired' record + reason behind the gated re-advertise route (second operator-driven advertiseCohort caller, D-17 preserved); never shown to participants (02-06).
- [Phase 02] Join-seat grace arms at the picked cohort's FIRST OBSERVED DEPARTURE from the Advertised set (directory poll), not at opt-in; while still Advertised the participant waits with the truthful awaitingSeats `joined/capacity` line (02-09).
- [Phase 02] Hermetic capstones gate the phase: e2e:browse + e2e:kofn (n=4/k=2, chosen because k = n-1 is a false green vs the library default) + e2e:operator + e2e:fallback, all green alongside 302 unit tests.

### Pending Todos

[From .planning/todos/pending/ - ideas captured during sessions]

None yet.

### Blockers/Concerns

[Issues that affect future work]

- ✓ [Phase 1] Operator authentication shipped (ADR 0015) - the control plane is no longer unauthenticated; this must stay green in every later phase. Non-blocking follow-up before public-internet deploy: T-01-06 login-throttle-per-proxy + WR-02 NaN-TTL hardening (see 01-SECURITY.md / 01-REVIEW.md).
- Cohort state is single-process and in-memory; durability/crash-recovery is deferred to v2 (DUR-01). The boot-time auto-advertise loop that used to drive cohorts was removed in Phase 1 - cohorts now exist only on operator action.
- [Phase 2] No distinct participant feedback when the service goes down mid-join (a directory-poll failure looks like a slow directory) - 02-09 review WR-02, non-blocking; candidate to fold into Phase 3's status/tracking surface.

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| Durability | DUR-01: cohort state survives process restart | v2 | 2026-07-07 |
| Participant mgmt | PMG-01: richer multi-cohort management view | v2 | 2026-07-07 |
| Operator access | OACC-01: multiple operators / role granularity | v2 | 2026-07-07 |
| CI / test debt | Rewire `e2e:browser` + `e2e:browser:prod` (booth-topology, broke when the auto-advertise loop was removed in 01-03) and add `e2e:operator` to CI; those 2 CI jobs stay red until then | Phase 6 | 2026-07-08 |

## Session Continuity

Last session: 2026-07-17T15:28:11.347Z
Stopped at: Phase 3 context gathered
Resume file: .planning/phases/03-participant-submit-co-sign-track-and-resolve/03-CONTEXT.md
Next command: /gsd-discuss-phase 3
