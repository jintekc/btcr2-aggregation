---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
current_phase: 02
current_phase_name: participant-discovery-browse-and-pick-join
status: security_gate
stopped_at: Phase 2 UAT COMPLETE 3/3 passed, 0 issues, all gaps (F1/F2/F1c/G-02-1/G-02-2) resolved; blocked only on the security capability gate (no 02-SECURITY.md yet)
last_updated: "2026-07-16T18:45:00.000Z"
last_activity: 2026-07-16
last_activity_desc: UAT 3/3 passed (two-field k-of-n form, expiry surface, join click-path incl. waiting line); seated-card stale-snapshot copy fixed (faa3922); form label/order tweaks (2c5c285)
progress:
  total_phases: 2
  completed_phases: 1
  total_plans: 13
  completed_plans: 13
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-08)

**Core value:** A stranger can self-host a real aggregation service that advertises cohorts, and another stranger can point a participant at that service's URL, browse its cohorts, join, co-sign, and resolve - a genuinely two-sided, self-hostable product, not a demo.
**Current focus:** Phase 02 - participant-discovery-browse-and-pick-join

## Current Position

Phase: 02 (participant-discovery-browse-and-pick-join) - UAT COMPLETE, SECURITY GATE PENDING
Plan: all 9 plans executed (02-01..04 + gap plans 02-05 F1a/F1b, 02-06 F2, 02-07 F1c, 02-08 G-02-1 two-field k-of-n, 02-09 G-02-2 join-grace rearm). UAT 3/3 PASSED 2026-07-16 (b9a15d2), 0 issues, all gaps resolved. Re-verification 28/28 must-haves; 02-09 review 0 blocker/3 warn/3 info, all findings fixed except WR-02 (deferred: service-down-mid-join feedback). Two UAT-driven inline fixes landed post-verification: create-form labels/order (Signing threshold (k) first, Cohort size (n) second, 2c5c285) + truthful seated-card copy (stale pick-time snapshot dropped, faa3922).
Status: RESUME HERE - (1) run /gsd-secure-phase 2 (the active security capability blocks phase advancement until 02-SECURITY.md exists with threats_open=0; Phase 2 added the gated readvertise route + the k-of-n surface; threat models to verify: T-05-*, T-06-*, T-07-*, T-KOFN-* across the 5 gap PLANs). (2) When threats_open=0: set 02-VERIFICATION.md frontmatter status human_needed -> passed (gsd-tools query frontmatter.set <file> --field status --value passed), then `gsd-tools phase uat-passed 2 --require-verification` must return passed=true, then run the transition (phase.complete) to mark Phase 2 done and route to Phase 3 (/gsd-discuss-phase 3 or /gsd-plan-phase 3). NOTE: git signing was restored to the user's default; GSD commits must use `git -c commit.gpgsign=false commit` or re-set `git config --local commit.gpgsign false` for the session (YubiKey cannot sign non-interactively).
Last activity: 2026-07-16 - Phase 2 UAT completed 3/3 (all visual tests passed); awaiting security gate only

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
- [Phase ?]: 02-05 (F1a/F1b): collapse operator cohort size to one n (min == max == n); capacity > threshold unrepresentable server-side; directory rows honest with zero display change
- [Phase 02]: 02-06 (F2): raise the single stall/TTL timer defaults to a 30-min discovery window (env-tunable); retain a bounded operator-only 'expired' terminal record on completion rejection (surfaced via listCohorts, never directory/status); readvertiseExpired is a second operator-driven advertiseCohort caller (D-17 preserved) behind the gated POST /v1/operator/cohorts/:id/readvertise
- [Phase ?]: 02-07 (F1c): n-of-n MuSig2 stays the primary spend; the ADR 042 k-of-n script-path fallback is ACTIVATED for signing liveness (createService.autoFallbackOnStall threaded to the runner; demo-server default ON via AUTO_FALLBACK). buildCohortConfig gains an optional fallbackThreshold (default n-1). The fixture beacon tx now spends the real beacon-address output so the script-path fallback validates hermetically (fixed 'Reconstructed beacon output script' rejection).
- [Phase 02]: 02-08 (G-02-1): restore the operator signing threshold k as a SECOND honest number. size n = seats (min == max == n, verbatim from 02-05); threshold k = fallbackThreshold (the ADR-042 script-path floor, 1 <= k <= n). Wire body { beaconType, size, threshold? } with threshold OPTIONAL defaulting to size (k = n); createDraft ALWAYS sets fallbackThreshold = k explicitly (so a default cohort's committed beacon leaf moves n-1 -> n, deliberate + safe). DTO flip threshold=k/capacity=n atomic at all four emit sites. Decision 4: validateDraft refuses k < size when autoFallbackOnStall is off (FALLBACK_OFF_ERROR). New e2e/kofn-cohort.ts n=4/k=2 capstone (distinguishable from the library n-1 default) proves k reaches the gate (drop 2 -> script-path) + gates anchoring (drop 3 -> cohort-failed). Empirical: 1-survivor fallback stalls in FallbackRequested phase rather than emitting 'Not enough valid fallback signatures'.
- [Phase 02]: 02-09 (G-02-2): under wait-for-n (min == max == n, no fillers, 30-min discovery window) the 90s join-seat grace timer must arm at the FIRST OBSERVED DEPARTURE of the picked cohort from the Advertised set (handleDirectorySnapshot opted-in branch), NOT at opt-in (cohort-joined). cohort-joined now records optedIn/steps/log and arms nothing; the poll arms the grace once (joinGraceLogged one-shot). So an opted-in participant whose picked cohort is still Advertised is never falsely failed at 90s and captures the polled joined/capacity into a new awaitingSeats field (rendered as `Waiting for the cohort to fill ({joined}/{capacity} seats)`). awaitingSeats resets in adopt/join/leave/cohort-ready/fail. CR-01 preserved (the bounded window still protects a genuine member forming mid-keygen, now armed at departure). Browser-store-only, zero new packages, zero e2e/Node-participant changes; the four hermetic capstones (browse/operator/kofn/fallback) re-run green.

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

Last session: 2026-07-16T13:25:00.000Z
Stopped at: Completed 02-09-PLAN.md (G-02-2 join-grace rearm for wait-for-n; awaitingSeats waiting line)
Resume file: None
Next command: /gsd-verify-work 2
