---
phase: 01-authenticated-operator-console-on-demand-cohort-creation
verified: 2026-07-08T00:00:00Z
status: human_needed
score: 4/4 must-haves verified
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Run `pnpm demo` with OPERATOR_PASSWORD set, open /operator: confirm the login screen visually matches the UI-SPEC (dark-slate, accent reserved to the Sign in CTA); wrong password shows the exact invalid-password copy; correct password reveals the console shell with a Sign out button; open / (root) shows the anonymous participant surface."
    expected: "Visual fidelity to 01-UI-SPEC.md; accent color reserved to the Sign in CTA / active nav / wordmark."
    why_human: "Visual/design fidelity cannot be verified by grep or automated tests (plan 01-01 Task 3 human-check, marked non-blocking)."
  - test: "With OPERATOR_PASSWORD set, sign in at /operator, create a CAS 2-of-2 capacity-2 draft: confirm it appears in `Your cohorts` with a neutral Draft badge and the active network; entering capacity below threshold shows the exact validation copy; discarding removes it."
    expected: "Visual fidelity to 01-UI-SPEC.md copy/badge-tone requirements."
    why_human: "Visual/design fidelity cannot be verified by grep or automated tests (plan 01-02 Task 2 human-check, marked non-blocking)."
  - test: "Sign in at /operator, advertise a draft: confirm its row flips to the accent Advertised badge and the transient success copy shows; open / (anonymous): PublicStatus shows Service online, the active network, and '1 open cohorts' (or 'No open cohorts right now' before advertising). Confirm accent appears only on the Advertise cohort CTA / active nav / wordmark."
    expected: "Visual fidelity to 01-UI-SPEC.md; accent-color discipline held."
    why_human: "Visual/design fidelity cannot be verified by grep or automated tests (plan 01-03 Task 3 human-check, marked non-blocking)."
---

# Phase 1: Authenticated Operator Console + On-Demand Cohort Creation Verification Report

**Phase Goal:** An authenticated operator can create, configure, and advertise a cohort on demand from a protected console, replacing the boot-time `while (running)` auto-advertise loop as the only way a cohort comes into existence.
**Verified:** 2026-07-08
**Status:** human_needed
**Re-verification:** No — initial verification

## Process Note: ROADMAP `Mode: mvp` vs. task-shaped Goal text

ROADMAP.md marks Phase 1 `Mode: mvp`, but the Goal line itself is task-shaped ("An authenticated operator can create, configure, and advertise..."), not phrased as the `As a ___, I want to ___, so that ___.` user-story format the MVP-mode verification path expects (`gsd_run query user-story.validate` returns `valid: false` for this text). Plan `01-01-PLAN.md` explicitly documents why: `/gsd mvp-phase` was not run for this phase because it was already deeply pre-discussed (`/gsd-discuss-phase` + `/gsd-ui-phase`) before `Mode: mvp` was set. Since ROADMAP.md nonetheless supplies four explicit, well-formed, testable Success Criteria (the Option-A path), this report verifies against those Success Criteria directly rather than forcing a low-quality User-Flow-Coverage table onto goal text that isn't a user story. This is a documentation/process inconsistency worth fixing (retitle the Goal line or drop `Mode: mvp` for phases planned via the standard discuss->plan path), but it does not block verification and is not scored as a gap.

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | An operator authenticates with an operator credential and reaches the operator console; an unauthenticated visitor is denied the console and any operator-only telemetry (no mutating operator route reachable without auth) | ✓ VERIFIED | `operator-auth.ts` (`requireOperator`, `passwordMatches` w/ `timingSafeEqual`, `createSessionStore`); mounted in `hono-adapter.ts` on `/v1/operator/*` and `/dashboard/*` BEFORE the gated routes (read at lines 299-311, 364-371). 19 unit tests in `operator-auth.spec.ts` (wrong password -> 401 no Set-Cookie, no/invalid/expired cookie -> 401 on gated routes AND `/dashboard/events`, logout-then-401, password never logged (spy-asserted), fresh id per login, throttle 429). 8 tests in `operator-boot.spec.ts` confirm fail-closed boot (no `OPERATOR_PASSWORD` -> operator routes 404, public `/v1/config` still 200). Independently re-run: `pnpm vitest run packages/service` = 241/241 pass (includes these). Independently re-run `pnpm e2e:operator`: asserts wrong-password 401 no-cookie + no-cookie 401 on `/v1/operator/cohorts` and `/dashboard/events` — passed. |
| 2 | From the console, the operator creates and configures a cohort on demand — beacon type (CAS or SMT), Bitcoin network, n-of-n threshold, capacity/roster — without editing env vars or restarting | ✓ VERIFIED (with documented interpretation, see below) | `operator-cohorts.ts` `createDraft`/`validateDraft`: beacon-type set-membership (CASBeacon/SMTBeacon), integer threshold >= 1, capacity >= threshold, all validated app-side with no restart. `CreateCohortForm.tsx` exposes a beacon-type `Select`, threshold/capacity `Input`s, and the active network as a read-only `Badge`. 12 tests in `operator-cohorts.spec.ts` cover create/validate/discard/list + gated-401. |
| 3 | The operator advertises the configured cohort and it appears as an open, joinable entry in that service's cohort directory | ✓ VERIFIED | `advertiseDraft` in `operator-cohorts.ts` is the sole caller of `runner.advertiseCohort` (`grep -c 'advertiseCohort(' operator-cohorts.ts` = 1); `directory()` derives from live `runner.session.cohorts` filtered to `OPEN_PHASES`, enriched from the `advertised` Map, pruned on `completion.finally`. `GET /v1/directory` + `GET /v1/status` mounted publicly (unconditionally, empty-safe) in `hono-adapter.ts`. 5 additional tests in `operator-cohorts.spec.ts` (advertise-moves-to-directory, advertiseCohort-called-once, directory/status derive from live set, prune-after-completion, advertise gated/directory-public). Independently re-run `pnpm e2e:operator`: after advertise, `GET /v1/directory` contains the entry and `GET /v1/status` reports `openCohorts >= 1` — confirmed in the captured run output (`[ok] directory: cohort ... is an open entry; status openCohorts=1`). |
| 4 | The full lifecycle still completes end to end for an operator-advertised cohort (co-sign -> anchor -> resolve), now driven by the operator's on-demand action, not the perpetual loop | ✓ VERIFIED | `demo-server.ts` has NO `while (running)` loop, NO `advertiseCohort` call, and NO boot-path filler spawn (confirmed by direct grep: zero matches for `advertiseCohort`, `while (running)` in the file). `e2e/operator-cohort.ts` (registered as `pnpm e2e:operator`) independently re-run by this verifier: boots a real service, asserts `session.cohorts.length === 0` at boot, logs in, creates a draft, advertises it, confirms the directory entry, spawns 2 real headless `createParticipant` peers that discover the cohort via the advert cache, join, and co-sign to a 64-byte aggregated Taproot signature; asserts the signing cohort id equals the operator-advertised cohort id. Exit 0, `E2E PASSED`. |

**Score:** 4/4 truths verified, 0 present-but-behavior-unverified.

**Evidence/interpretation note on Truth 2 (network + roster wording):** The literal ROADMAP SC2 text lists "Bitcoin network" and "capacity/roster" among the things an operator "chooses." The actual implementation shows the active network as a **read-only** badge (not operator-selectable per cohort) and implements only **capacity** (not a roster/pre-provisioning mechanism). This was a deliberate, pre-planning decision captured in `01-CONTEXT.md` (D-10, D-11), made during `/gsd-discuss-phase` before any of the 4 plans were written — not a shortcut taken during execution. D-10's reasoning is grounded in a **hard, top-level project constraint** ("Config-driven network, never hardcoded... resolved once at boot," `.claude/CLAUDE.md`): letting an operator pick a *different* network per cohort at runtime would contradict that constraint and open the door to unintended simultaneous multi-network cohorts, which is explicitly out of scope (deferred). D-11 treats "capacity/roster" as alternative bounding mechanisms and picks capacity as the MVP one, deferring roster/pre-provisioning (baked-genesis machinery) to a later phase. Both decisions are documented, reasoned, and made before planning began — not accepted here as post-hoc overrides but reported transparently so the discrepancy against the literal roadmap wording is visible rather than silently absorbed.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/service/src/operator-auth.ts` | SessionStore, requireOperator, constant-time login, throttle | ✓ VERIFIED | 283 lines; `timingSafeEqual` x1, `randomBytes` x1, `createMiddleware` used for the guard; substantive, wired into hono-adapter.ts |
| `packages/service/src/operator-auth.spec.ts` | Negative + positive auth tests | ✓ VERIFIED | 19 tests, all passing (re-run independently) |
| `packages/service/src/operator-boot.spec.ts` | Fail-closed boot test | ✓ VERIFIED | 8 tests, all passing |
| `docs/adr/0015-operator-authentication.md` | ADR superseding ADR 0004 | ✓ VERIFIED | Status: Accepted; explicitly states "Supersedes: ... ADR 0004" |
| `packages/web/src/stores/operator.ts` | Zustand auth+cohort store | ✓ VERIFIED | Session state driven only by `sessionProbe`; `document.cookie` grep = 0 matches |
| `packages/web/src/components/operator/LoginPanel.tsx` | Login screen | ✓ VERIFIED | 55 lines, wired to `useOperator` store |
| `packages/service/src/operator-cohorts.ts` | drafts Map + createDraft/discardDraft/listCohorts/advertiseDraft/directory/status | ✓ VERIFIED | 297 lines; `buildCohortConfig(` x1, `maxParticipants` present, `advertiseCohort(` x1, `session.cohorts` used, `completion.finally` used |
| `packages/service/src/operator-cohorts.spec.ts` | Create/validate/discard/list/advertise/directory/status tests | ✓ VERIFIED | 17 tests, all passing |
| `packages/web/src/components/operator/CreateCohortForm.tsx` | Beacon type/threshold/capacity form | ✓ VERIFIED | CASBeacon + SMTBeacon options present; network is a read-only Badge, not a Select |
| `packages/web/src/components/operator/OperatorCohortList.tsx` | Operator cohort list w/ Draft/Advertised rows | ✓ VERIFIED | Draft (neutral) + Advertised (accent) badges, Advertise/Discard actions wired to store |
| `packages/web/src/components/operator/PublicStatus.tsx` | Anonymous public status element | ✓ VERIFIED | Polls `GET /v1/status` with `credentials: 'omit'`; renders `Service online` / open-count copy; real data flow confirmed via live e2e:browser run output |
| `e2e/operator-cohort.ts` | Hermetic full-lifecycle e2e | ✓ VERIFIED | Independently re-run: exit 0, `E2E PASSED` |
| `package.json` `e2e:operator` script | Registers the harness | ✓ VERIFIED | `"e2e:operator": "tsc -b && tsx e2e/operator-cohort.ts"` present |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `hono-adapter.ts` | `operator-auth.ts` | `app.use('/v1/operator/*', requireOperator)` + `app.use('/dashboard/*', requireOperator)` mounted before gated routes | ✓ WIRED | Confirmed at hono-adapter.ts lines 299-311, 364-371; registration ORDER verified correct (guard before routes) |
| `App.tsx` | `OperatorConsole.tsx` | pathname `/operator` renders console | ✓ WIRED | `const isOperator = pathname === '/operator'` confirmed |
| `stores/operator.ts` | `hono-adapter.ts` | `GET /v1/operator/session` probe | ✓ WIRED | `sessionProbe` in lib/operator.ts calls the route; store never reads `document.cookie` |
| `operator-cohorts.ts` | `@btcr2-aggregation/shared` | `buildCohortConfig(...)` then `maxParticipants = capacity` | ✓ WIRED | Confirmed in `createDraft` |
| `hono-adapter.ts` | `operator-cohorts.ts` | gated `/v1/operator/cohorts` routes | ✓ WIRED | POST/GET/DELETE + advertise all registered inside the `if (operatorAuth)` block after guards |
| `operator-cohorts.ts` | `@did-btcr2/aggregation` runner | `advertiseDraft` calls `advertiseCohort` once | ✓ WIRED | Sole call site confirmed by grep + code read |
| `App.tsx` | `PublicStatus.tsx` | anonymous surface renders it | ✓ WIRED | `<PublicStatus />` rendered; real-time data confirmed live via browser e2e run |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|---------------------|--------|
| `PublicStatus.tsx` | `status` (ServiceStatus) | `fetchStatus` -> `GET /v1/status` -> `operatorCohorts.status()` -> `directory().length` | Yes | ✓ FLOWING (confirmed live in the actual `pnpm e2e:browser` dashboard-visible-state capture: "Service online" / "No open cohorts right now" rendered from real fetched data) |
| `OperatorCohortList.tsx` | `cohorts` (OperatorCohortDTO[]) | `refreshCohorts` -> `listCohorts` -> `GET /v1/operator/cohorts` -> `operatorCohorts.listCohorts()` | Yes | ✓ FLOWING (confirmed live via `pnpm e2e:operator`: real draft created, advertised, and directory-visible) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full unit suite green | `pnpm test` | 241/241 tests pass, 23 files | ✓ PASS |
| Service+web typecheck clean | `pnpm typecheck` | exit 0 | ✓ PASS |
| Lint clean | `pnpm lint` | exit 0 | ✓ PASS |
| Full operator-driven lifecycle e2e | `pnpm e2e:operator` | exit 0, `E2E PASSED`, 64-byte aggregated signature, both participants `cohort-complete` | ✓ PASS |
| Loop truly removed | `grep -c 'while (running)' demo-server.ts` = 0, `grep -c 'advertiseCohort' demo-server.ts` = 0 | both 0 | ✓ PASS |

### Probe Execution

No probe scripts (`scripts/*/tests/probe-*.sh`) exist in this repository and none are declared by the Phase 1 plans — this is not a migration/tooling phase. Skipped (N/A).

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|--------------|-------------|--------------|--------|----------|
| HOST-01 | 01-01, 01-04 | Operator control/telemetry surface requires auth; no unauthenticated client can perform operator actions or view operator-only telemetry | ✓ SATISFIED | `requireOperator` guard on both gated prefixes; e2e negative-auth assertions pass |
| SVC-01 | 01-02, 01-04 | Operator can create/configure a cohort on demand without env edits/restart | ✓ SATISFIED | `createDraft` + `CreateCohortForm.tsx`; e2e create step passes |
| SVC-02 | 01-03, 01-04 | Operator can advertise a cohort so it becomes visible/joinable in the directory | ✓ SATISFIED | `advertiseDraft` + public `/v1/directory`; e2e advertise + directory steps pass |

No orphaned requirements: REQUIREMENTS.md maps only HOST-01/SVC-01/SVC-02 to Phase 1, and all three are claimed by at least one plan's frontmatter `requirements:` field.

### Anti-Patterns Found

None. Scanned all 15 files touched across the 4 plans (`operator-auth.ts`, `operator-cohorts.ts`, `hono-adapter.ts`, `index.ts`, `demo-server.ts`, `App.tsx`, `primitives.tsx`, `lib/operator.ts`, `stores/operator.ts`, `LoginPanel.tsx`, `OperatorConsole.tsx`, `CreateCohortForm.tsx`, `OperatorCohortList.tsx`, `PublicStatus.tsx`, `e2e/operator-cohort.ts`) for `TBD|FIXME|XXX`, `TODO|HACK|PLACEHOLDER`, "not yet implemented"/"coming soon", and empty-implementation patterns. Zero matches other than benign HTML `placeholder` input attributes and standard `quiet ? () => {} : ...` no-op logger idioms (also used identically in pre-existing files like `headless-cohort.ts`).

## Known Cross-Wave Regression: `e2e:browser` / `e2e:browser:prod` now fail (CI-gate impact, not a Phase 1 goal blocker)

This was flagged explicitly for assessment and independently reproduced (not just taken from SUMMARY claims):

- `packages/service/src/demo-server.ts`'s `while (running)` auto-advertise loop and boot-path filler spawning were removed in plan 01-03 (D-17/D-18), which is exactly the phase's success criterion 4 intent — a fresh service must advertise nothing until the operator acts.
- `e2e/browser-cohort.ts` and `e2e/browser-prod-cohort.ts` (both registered in `.github/workflows/ci.yml` as `pnpm e2e:browser` / `pnpm e2e:browser:prod`, part of the pre-existing "hermetic 16 checks" CI job) call `startDemoServer({...})` **without** `operatorPassword` and then drive `runCohortScenario`, which expects the old two-tab UI (a `Coordinator` button) and an auto-advertised cohort to auto-join.
- **I independently ran `pnpm e2e:browser`** (built the workspace, launched headless Chromium) rather than trusting the SUMMARY's claim. It fails: `locator.click: Timeout 30000ms exceeded ... waiting for getByRole('button', { name: 'Coordinator' })`. Confirmed the root cause in source: `App.tsx` no longer contains the string `"Coordinator"` anywhere (the two-tab toggle was replaced by pathname routing in plan 01-01), and even past that, `demo-server.ts` no longer auto-advertises anything for the harness's attendee pages to join.
- **Disposition: this does NOT block the Phase 1 goal or its 4 success criteria.** All four are proven by the NEW `e2e:operator` harness (registered in package.json, deliberately **not** wired into CI yet per plan 01-04's explicit note "CI is a Phase-6 / separate concern"), which is the correct regression guard for the new on-demand path. The legacy browser harnesses test the OLD booth/attendee topology that this phase intentionally retires.
- **It IS a real, currently-active CI regression** for the two `e2e:browser*` jobs already registered in `.github/workflows/ci.yml`, independent of Phase 1's own declared plan-level gates (none of the 4 plans list these files in `files_modified`, and none of the plans' `<verification>` blocks include them).
- **Deferred, not orphaned:** ROADMAP.md's Phase 6 ("Two-Stranger End-to-End + Real-Aggregator Framing") goal is "Automated stranger-to-stranger loop passes in CI and the booth/attendee framing is retired" — this is a direct, specific match: Phase 6 is exactly where these booth-framed browser harnesses would be rewired or replaced, and where CI would be updated to add `e2e:operator` alongside them (as plan 01-04's SUMMARY itself notes as a to-do for "a later phase that touches CI"). Filed as a `deferred` item below rather than a `gap`, per Step 9b.
- **Recommendation for the team:** since this leaves CI red on `main` for `e2e:browser`/`e2e:browser:prod` until Phase 6 lands (potentially several phases away), consider either (a) fixing/skipping those two CI jobs now as a small out-of-band task, or (b) accepting red CI on those two specific jobs as a known, tracked condition until Phase 6. This is a judgment call for the developer, not something this verifier can resolve.

### Deferred Items

| # | Item | Addressed In | Evidence |
|---|------|--------------|----------|
| 1 | `e2e:browser` / `e2e:browser:prod` rewired to the operator-driven flow; `e2e:operator` added to CI | Phase 6 | ROADMAP Phase 6 goal: "Automated stranger-to-stranger loop passes in CI and the booth/attendee framing is retired." Plan 01-03/01-04 SUMMARYs both explicitly note these browser e2es are now stale and "a future phase (or the Phase-6 booth-retirement sweep) should rewire them." |

### Human Verification Required

Three visual-fidelity checks were explicitly deferred from mid-phase `checkpoint:human-verify` to end-of-phase per this project's `workflow.human_verify_mode = end-of-phase`, harvested from each plan's `<human-check>` block (all marked non-blocking in the plans themselves). None of these affect the pass/fail of the 4 ROADMAP success criteria — the underlying behavior for each is independently confirmed by automated tests and the two live e2e runs performed during this verification — but visual/design fidelity to `01-UI-SPEC.md` cannot be confirmed by grep or automated tooling.

### 1. Login screen visual fidelity (plan 01-01)

**Test:** Run `pnpm demo` with `OPERATOR_PASSWORD` set, open `/operator`.
**Expected:** Login screen matches the UI-SPEC (dark-slate, accent reserved to the Sign in CTA); wrong password shows the exact invalid-password copy; correct password reveals the console shell with a Sign out button; `/` (root) shows the anonymous participant surface.
**Why human:** Visual/design fidelity is not machine-checkable.

### 2. Create-cohort form + list visual fidelity (plan 01-02)

**Test:** With `OPERATOR_PASSWORD` set, sign in at `/operator`, create a CAS 2-of-2 capacity-2 draft.
**Expected:** Appears in `Your cohorts` with a neutral `Draft` badge and the active network; capacity below threshold shows the exact validation copy; discarding removes it.
**Why human:** Visual/design fidelity is not machine-checkable.

### 3. Advertise + public status visual fidelity (plan 01-03)

**Test:** Sign in at `/operator`, advertise a draft; separately open `/` (anonymous).
**Expected:** Draft row flips to the accent `Advertised` badge with transient success copy; `PublicStatus` shows `Service online`, the active network, and the correct open-cohort copy; accent color appears only on the `Advertise cohort` CTA / active nav / wordmark.
**Why human:** Visual/design fidelity (accent-color discipline) is not machine-checkable.

### Gaps Summary

No blocking gaps. All four ROADMAP success criteria are verified against the actual codebase (not just SUMMARY claims): I independently re-ran the full unit suite (241/241), typecheck, lint, and the `e2e:operator` hermetic capstone (which itself asserts the auth boundary, the loop-removed boot state, and the full create->advertise->co-sign lifecycle) — all green. I also independently reproduced the known cross-wave regression against `e2e:browser` by actually running it, confirming it is real and understanding its root cause, and assessed it as out-of-scope debt for Phase 6 rather than a Phase 1 blocker. The only open items are three explicitly non-blocking visual-fidelity checks deferred to end-of-phase human review, and one process note about the ROADMAP `Mode: mvp` / non-user-story Goal-text mismatch (informational, not a gap).

---

_Verified: 2026-07-08_
_Verifier: Claude (gsd-verifier)_
