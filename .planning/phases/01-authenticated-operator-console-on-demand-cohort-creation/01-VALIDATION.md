---
phase: 1
slug: authenticated-operator-console-on-demand-cohort-creation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-08
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from 01-RESEARCH.md `## Validation Architecture` + `## Security Domain`.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest ^2 (co-located `*.spec.ts` unit tests) + tsx e2e harnesses (real service, real HTTP) |
| **Config file** | none dedicated - unit via root `vitest run`; e2e via `tsx e2e/*.ts` scripts declared in root `package.json` |
| **Quick run command** | `pnpm vitest run packages/service` |
| **Full suite command** | `pnpm test` (`tsc -b && vitest run`) then the e2e gate incl. new `pnpm e2e:operator` |
| **Estimated runtime** | ~5-15s unit slice; full gate is the existing 16-check gate + `e2e:operator` |

---

## Sampling Rate

- **After every task commit:** Run `pnpm vitest run packages/service` (fast unit slice on the auth + cohort modules)
- **After every plan wave:** Run `pnpm test` (full typecheck + all unit) + `pnpm e2e:operator`
- **Before `/gsd-verify-work`:** Full hermetic gate green (existing 16 checks + new `e2e:operator`) and web `tsc --noEmit` + `vite build` clean
- **Max feedback latency:** ~15 seconds (unit slice)

---

## Per-Task Verification Map

> Task IDs are assigned by the planner (`{N}-{plan}-{task}`). Rows below are the requirement-to-test contract the planner must honor; the nyquist-auditor reconciles Task IDs after PLAN.md exists.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| planner-assigned | auth | 1 | HOST-01 | T-cred-timing / T-cred-logging | Correct password -> session cookie; wrong password -> 401, no cookie, password never logged, constant-time compare | unit | `pnpm vitest run packages/service/src/operator-auth.spec.ts` | ❌ W0 | ⬜ pending |
| planner-assigned | auth | 1 | HOST-01 | T-missing-auth / T-session-fixation | No/invalid/expired session -> 401 on every gated route (`/v1/operator/*`, `/dashboard/events`); new session id per login | unit | `pnpm vitest run packages/service/src/operator-auth.spec.ts` | ❌ W0 | ⬜ pending |
| planner-assigned | auth | 1 | HOST-01 | T-session-theft | Logout destroys session server-side -> subsequent request 401 | unit | `pnpm vitest run packages/service/src/operator-auth.spec.ts` | ❌ W0 | ⬜ pending |
| planner-assigned | boot | 1 | HOST-01 | T-open-by-default | Fail-closed: boot without `OPERATOR_PASSWORD` disables operator routes + gated telemetry, public surface still serves, loud boot warning | unit | `pnpm vitest run packages/service/src/operator-boot.spec.ts` | ❌ W0 | ⬜ pending |
| planner-assigned | cohorts | 2 | SVC-01 | T-input-validation | Create draft validates (capacity >= threshold; threshold >= 1) and stores config; discard removes an un-advertised draft | unit | `pnpm vitest run packages/service/src/operator-cohorts.spec.ts` | ❌ W0 | ⬜ pending |
| planner-assigned | cohorts | 2 | SVC-02 | - | Advertise calls `runner.advertiseCohort` once; cohort appears in `GET /v1/directory` as open | unit | `pnpm vitest run packages/service/src/operator-cohorts.spec.ts` | ❌ W0 | ⬜ pending |
| planner-assigned | directory | 2 | SVC-02 | - | `GET /v1/directory` + `/v1/status` derive from live `session.cohorts` (no drift after completion) | unit | `pnpm vitest run packages/service/src/operator-cohorts.spec.ts` | ❌ W0 | ⬜ pending |
| planner-assigned | e2e | 3 | HOST-01 / SVC-01 / SVC-02 (success crit. 4) | T-missing-auth | login -> create -> advertise -> headless participants join -> co-sign -> anchor -> resolve, hermetic; a fresh service advertises nothing until the operator advertises (`session.cohorts.length === 0` at boot) | e2e | `pnpm e2e:operator` (new: `tsc -b && tsx e2e/operator-cohort.ts`) | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/service/src/operator-auth.spec.ts` — login success/fail, cookie flags, session validate/expire/logout, timing-safe compare, no-password-logging (HOST-01)
- [ ] `packages/service/src/operator-boot.spec.ts` — fail-closed boot when `OPERATOR_PASSWORD` unset (D-07)
- [ ] `packages/service/src/operator-cohorts.spec.ts` — draft create/validate/discard, advertise, directory/status derivation (SVC-01/SVC-02)
- [ ] `e2e/operator-cohort.ts` + `e2e:operator` root script — full authed lifecycle incl. the mandatory negative auth assertions (success criterion 4)
- [ ] (web, if the slice warrants a unit) `packages/web/src/stores/operator.spec.ts` mirroring `stores/participant.spec.ts` — login-state probe + create-form validation
- [ ] Framework install: none needed (vitest ^2 + tsx already present)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Operator login + console visuals against the UI-SPEC (`/operator` route, dark-slate 60/30/10, orange reserved to primary CTA/active-nav) | HOST-01 / SVC-01 | Visual/interaction fidelity is not asserted by unit/e2e; covered structurally by the browser e2e idiom but final look is eyeballed | `pnpm demo`, open `/operator`, log in with `OPERATOR_PASSWORD`, create+advertise a draft, confirm it appears in the directory and the public status count increments |

*All functional behaviors have automated verification; the row above is visual-fidelity only (non-blocking for the goal gate).*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
