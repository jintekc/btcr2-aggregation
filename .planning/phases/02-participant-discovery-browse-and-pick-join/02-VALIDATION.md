---
phase: 2
slug: participant-discovery-browse-and-pick-join
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-14
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `02-RESEARCH.md` `## Validation Architecture`. `e2e:browser` / `e2e:browser:prod`
> are RED since Phase 1 (booth topology, deferred to Phase 6). Phase 2 needs a FRESH hermetic
> browse -> pick -> join -> seated proof, modeled on `e2e/operator-cohort.ts`.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest `^2` (`*.spec.ts` co-located); `pnpm test` = `tsc -b && vitest run` |
| **E2E harness** | tsx scripts booting a real `createService` + real `createParticipant`(s) over real HTTP (hermetic offline/fixture default) |
| **Config file** | none dedicated — vitest config is per-package; new e2e = `e2e/browse-join-cohort.ts` + `e2e:browse` package script (model: `e2e/operator-cohort.ts`) |
| **Quick run command** | `pnpm vitest run packages/web packages/participant` |
| **Full suite command** | `pnpm test && pnpm e2e:operator && pnpm e2e:browse` (plus web `tsc --noEmit` + `vite build`) |
| **Estimated runtime** | unit ~seconds; hermetic e2e ~10–30s each |

---

## Sampling Rate

- **After every task commit:** Run `pnpm vitest run <touched package>` (quick)
- **After every plan wave:** Run `pnpm test && pnpm e2e:operator && pnpm e2e:browse` + web `tsc --noEmit` + `vite build`
- **Before `/gsd-verify-work`:** Full hermetic gate green (minus the pre-existing red `e2e:browser*`, still deferred to Phase 6)
- **Max feedback latency:** ~30 seconds (unit); ~60s including hermetic e2e

---

## Per-Task Verification Map

> Task IDs are assigned by the planner. Each phase requirement below MUST map to at least one plan task's `<automated>` verify. The planner/nyquist-auditor fills the Task ID column as plans are written.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | — | PART-01 | T-02-V9 (no member DIDs in DTO) | Browse lists advertised open cohorts w/ beacon type / network / seats / status; DTO exposes only counts | e2e + unit | `tsx e2e/browse-join-cohort.ts` ; `vitest run` | ❌ W0 | ⬜ pending |
| TBD | TBD | — | PART-02 | T-02-V5 (pick only directory-listed cohortId) | Participant joins the PICKED cohort, not whatever arrives; a concurrently-advertised second cohort is NOT joined | e2e + unit (`shouldJoin` predicate) | `tsx e2e/browse-join-cohort.ts` ; `vitest run` | ❌ W0 | ⬜ pending |
| TBD | TBD | — | Criterion 3 (positive) | — | Joined participant is seated (`cohort-ready`) + counts against capacity; cohort forms + co-signs (64-byte sig) | e2e (`threshold===capacity===2`) | `tsx e2e/browse-join-cohort.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | — | Criterion 3 (negative) | T-02-V5 | A full/closed (non-`Advertised`) cohort cannot be joined; `shouldJoin` never fires -> deterministic reject, no dead spinner | e2e + unit | `tsx e2e/browse-join-cohort.ts` ; `vitest run` | ❌ W0 | ⬜ pending |
| TBD | TBD | — | D-12 | — | Empty / unreachable / failed-join states distinct; failed-join returns to browse | unit (BrowseView + store) | `vitest run` | ❌ W0 | ⬜ pending |
| TBD | TBD | — | D-15/D-16 | T-02-DoS (TTL reclaim) | `leave()` tears down client; abandoned seat reclaims via `cohortTtlMs`/`phaseTimeoutMs` | unit + note (TTL reclaim bounded by phase timeout) | `vitest run` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `e2e/browse-join-cohort.ts` — the hermetic browse -> pick -> join -> seated + co-sign proof, plus the full/closed-negative leg (covers PART-01 / PART-02 / criterion 3). Add `e2e:browse` to `package.json` scripts (register locally like `e2e:operator`; NOT wired into CI in Phase 2 — CI wiring + the red `e2e:browser*` rewrite are Phase 6 CI debt).
- [ ] `packages/participant/src/index.spec.ts` (or extend) — `shouldJoin` filters to the picked cohortId; a non-matching advert is not joined.
- [ ] `packages/web/src/stores/participant.spec.ts` — `join(baseUrl, cohortId)` sets seated/waiting/closed states off runner events + directory; `JOIN_WATCHDOG_MS` removed.
- [ ] `packages/web/src/components/browse/*.spec.ts` — `isJoinable` / `statusLabel`; empty vs unreachable states (D-12).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Visual fidelity of the browse list + service-identity header + inline-identity-at-Join against 02-UI-SPEC.md | PART-01 / PART-02 | Pixel/interaction fidelity is a UAT visual check, not an automated assertion | Run the SPA, advertise a cohort as operator, load `/` as an anonymous participant, confirm the directory list, status header, plain-language labels, and the Join -> inline-identity -> seated flow match 02-UI-SPEC.md |

*Automated coverage exists for all functional behaviors; only visual fidelity is manual (end-of-phase UAT).*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
