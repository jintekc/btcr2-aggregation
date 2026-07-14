---
phase: 2
slug: participant-discovery-browse-and-pick-join
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-14
---

# Phase 2 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `02-RESEARCH.md` `## Validation Architecture` and reconciled against the 4 plans
> (02-01..02-04). `e2e:browser` / `e2e:browser:prod` are RED since Phase 1 (booth topology,
> deferred to Phase 6). Phase 2 uses a FRESH hermetic browse -> pick -> join -> seated proof,
> `e2e/browse-join-cohort.ts`, modeled on `e2e/operator-cohort.ts` (built in plan 02-01).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest `^2` (`*.spec.ts` co-located); `pnpm test` = `tsc -b && vitest run` |
| **E2E harness** | tsx scripts booting a real `createService` + real `createParticipant`(s) over real HTTP (hermetic offline/fixture default) |
| **Config file** | none dedicated, vitest config is per-package; new e2e = `e2e/browse-join-cohort.ts` + `e2e:browse` package script (model: `e2e/operator-cohort.ts`) |
| **Quick run command** | `pnpm vitest run packages/web packages/participant` |
| **Full suite command** | `pnpm test && pnpm e2e:operator && pnpm e2e:browse` (plus web `tsc --noEmit` + `vite build`) |
| **Estimated runtime** | unit ~seconds; hermetic e2e ~10-30s each |

---

## Sampling Rate

- **After every task commit:** Run `pnpm vitest run <touched package>` (quick)
- **After every plan wave:** Run `pnpm test && pnpm e2e:operator && pnpm e2e:browse` + web `tsc --noEmit` + `vite build`
- **Before `/gsd-verify-work`:** Full hermetic gate green (minus the pre-existing red `e2e:browser*`, still deferred to Phase 6)
- **Max feedback latency:** ~30 seconds (unit); ~60s including hermetic e2e

---

## Per-Requirement Verification Map

> Reconciled against the finished plans. Tasks are positional within each plan (no explicit task IDs);
> the exact positional Task ID (e.g. 02-01-01) is confirmed by the nyquist-auditor at execution kickoff.
> Every requirement below maps to at least one plan task carrying an `<automated>` verify.

| Requirement | Plan(s) | Threat Ref | Secure Behavior | Test Type | Automated Command | Status |
|-------------|---------|------------|-----------------|-----------|-------------------|--------|
| PART-01 | 02-02 | T-02-04 (no member DIDs in DTO) | Browse lists advertised open cohorts w/ beacon type / network / seats / status; DTO exposes only counts | unit (`isJoinable`/`statusLabel`/`beaconGloss` + `DirectoryList`) | `pnpm vitest run packages/web` | planned |
| PART-02 | 02-01, 02-03, 02-04 | T-02-05 (pick only directory-listed cohortId) | Participant joins the PICKED cohort, not whatever arrives; a concurrently-advertised second cohort is NOT joined | e2e + unit (`shouldJoin` predicate, `join(baseUrl, cohortId)`) | `tsx e2e/browse-join-cohort.ts` ; `pnpm vitest run` | planned |
| Criterion 3 (positive) | 02-01 | - | Joined participant is seated (`cohort-ready`) + counts against capacity; cohort forms + co-signs (64-byte sig) | e2e (`threshold===capacity===2`) | `tsx e2e/browse-join-cohort.ts` | planned |
| Criterion 3 (negative) | 02-01, 02-03 | T-02-05 | A non-`Advertised` (full/closed) cohort cannot be joined; `shouldJoin` never fires -> deterministic reject, no dead spinner | e2e + unit | `tsx e2e/browse-join-cohort.ts` ; `pnpm vitest run packages/web` | planned |
| D-12 | 02-02, 02-03 | - | Empty / unreachable / failed-join states distinct; failed-join returns to browse | unit (BrowseView + store) | `pnpm vitest run packages/web` | planned |
| D-15/D-16 | 02-01, 02-03 | T-02-DoS (TTL reclaim) | `leave()` tears down client; abandoned seat reclaims via `cohortTtlMs`/`phaseTimeoutMs` | unit + note (TTL reclaim bounded by phase timeout) | `pnpm vitest run packages/web` | planned |

*Status: planned (plan wired) · pending · green · red · flaky*

---

## Wave 0 Requirements

Built in plan 02-01 (Wave 1 backbone) so plans 02-02/02-03/02-04 wire UI onto a mechanism already proven:

- [ ] `e2e/browse-join-cohort.ts` - the hermetic browse -> pick -> join -> seated + co-sign proof, plus the full/closed-negative leg (covers PART-01 / PART-02 / criterion 3). Add `e2e:browse` to `package.json` scripts (register locally like `e2e:operator`; NOT wired into CI in Phase 2, since CI wiring + the red `e2e:browser*` rewrite are Phase 6 CI debt).
- [ ] `packages/participant/src/index.spec.ts` (or extend) - `shouldJoin` filters to the picked cohortId; a non-matching advert is not joined.
- [ ] `packages/web/src/stores/participant.spec.ts` - `join(baseUrl, cohortId)` sets seated/waiting/closed states off runner events + directory; `JOIN_WATCHDOG_MS` removed.
- [ ] `packages/web/src/lib/directory.spec.ts` + `packages/web/src/components/browse/DirectoryList.spec.ts` - `isJoinable` / `statusLabel` / `beaconGloss`; empty vs unreachable states (D-12).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Visual fidelity of the browse list + service-identity header + inline-identity-at-Join against 02-UI-SPEC.md | PART-01 / PART-02 | Pixel/interaction fidelity is a UAT visual check, not an automated assertion | Run the SPA, advertise a cohort as operator, load `/` as an anonymous participant, confirm the directory list, status header, plain-language labels, and the Join -> inline-identity -> seated flow match 02-UI-SPEC.md |

*Automated coverage exists for all functional behaviors; only visual fidelity is manual (end-of-phase UAT).*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (checker verified Nyquist Dimension 8)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (hermetic capstone in 02-01)
- [x] No watch-mode flags
- [x] Feedback latency < 60s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-14 (reconciled with plans 02-01..02-04; Wave 0 test files are created during execution)
