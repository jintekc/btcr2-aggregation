---
phase: 04-operator-cohort-monitoring
verified: 2026-07-27T17:00:00Z
status: passed
score: 5/5 must-haves verified (roadmap Success Criteria); 34/34 plan-level truths verified across 8 plans
behavior_unverified: 0
overrides_applied: 0
---

# Phase 4: Operator Cohort Monitoring Verification Report

**Phase Goal:** On the authenticated console, the operator monitors each advertised cohort's members, pending submissions, co-sign progress, and anchor status in real time, turning the read-only telemetry tab into the operator's live view of on-demand cohorts.
**Verified:** 2026-07-27
**Status:** passed
**Re-verification:** No — initial verification

## Method

This is initial verification (no prior `04-VERIFICATION.md`). I read all 8 PLAN.md frontmatters (must_haves), all 8 SUMMARY.md files, `04-REVIEW.md` (the post-execution adversarial code review), `REQUIREMENTS.md`, and `ROADMAP.md`. I did **not** stop at the SUMMARY narrative: I ran the full test gate, lint, and both package builds myself; grepped the actual source for every claimed fix, DTO shape, route, and deletion; ran the fixture monitoring e2e live; and independently confirmed all 10 code-review findings (2 critical, 8 warning) actually landed in the current `main` tree rather than trusting the review's own "FIXED" annotations.

Commands run directly (not taken from SUMMARY claims):
- `pnpm test` → **522 passed (522), 40 test files**, matching the review's "522/522" claim independently.
- `pnpm lint` → clean.
- `pnpm --filter @btcr2-aggregation/web build` and `pnpm -r build` → both green.
- `pnpm e2e:monitor` → **PASSED live** (`MONITOR E2E PASSED: an operator advertised a cohort, real participants joined + co-signed it hermetically, and the gated monitoring reads reflected that activity end to end`), not just asserted from the summary.
- `pnpm vitest run` on `tx-funding-wait.spec.ts`, `monitor.spec.ts`, `operator-rows.spec.ts`, `broadcast.spec.ts` → 89 + 7 = 96 passed, covering the behavior-dependent invariants (blind-lapse honesty, abort-before-poll, union row rendering, duplicate-acceptance).
- `git log` confirms all 10 review fix commits (`d0cfef8`, `ae0d543`, `565812a`, `7308ad3`, `8594f1a`, `83a2cd9`, `4a4bbd5`, `83449cc`, `156072c`, `8241917`) are present on `main`, followed by `43d51fa` recording the fix status.
- Grepped current source (not dist/ build cache) for the CR-01/CR-02/WR-01..08 fix signatures — every one is present in the live tree (see Findings below).

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria — the authoritative contract)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Operator sees, per advertised cohort, who has joined and how many seats remain, live | ✓ VERIFIED | `monitor.ts` `createCohortMonitor` folds `opt-in-received`/`participant-accepted` into seated/pending members; `GET /v1/operator/cohorts/:id` serves it; `CohortDetail.tsx` renders it, polled. Proven live by `pnpm e2e:monitor`: "2 seated members, 2 submissions" reflected end to end. Confirmed further by the owner-approved live UAT (two real browser participants joined and were seen live). |
| 2 | Operator sees pending submissions + co-sign progress advancing through the MuSig2 round | ✓ VERIFIED | `monitor.ts` folds `update-received`/`validation-received`/`nonce-received` into per-member round state + an honest `{noncesReceived, total, awaitingPartialSigs}` co-sign DTO that never invents a partial-signature count (D-32, no library event for that leg). `monitor.spec.ts` (54 tests) covers round transitions, submissions, and the honest co-sign flip. Rendered in `CohortDetail.tsx` (Submissions + Co-sign sections). Live e2e confirms real submissions reflected. |
| 3 | Operator sees anchor status (broadcast/confirmed) per cohort | ✓ VERIFIED | The operator anchor view is composed from the SAME injected `AnchorState` the public `GET /v1/anchor` read serves (byte-untouched public read, D-18/D-26), so the operator and participant never disagree. `OperatorAnchorSubSteps` renders Signed → Broadcast (txid + explorer link) → Confirmed, reserving "Anchored" for a confirmed tx only — independently confirmed via `grep` for the confirmed-only guard and via the owner's live UAT (real anchor confirmed on regtest). |
| 4 | Monitoring view is reachable only by the authenticated operator | ✓ VERIFIED | `GET /v1/operator/cohorts/:id` and `/v1/operator/cohorts/:id/export` are registered strictly after `app.use('/v1/operator/*', requireSameOrigin())` then `requireOperator(...)` — confirmed by reading `hono-adapter.ts` lines 353–478 directly. `operator-boot.spec.ts` and `e2e/operator-cohort.ts` assert a 401 before any cohort-id lookup (no existence oracle). The two new public reads this phase adds (`/v1/anchor`, `/v1/funding`) are deliberately anonymous by design (participant-facing, non-oracle, no amounts/keys) and do not weaken the operator gate — confirmed the routes sit in the pre-`operatorAuth` public block, and the freeze pins (`monitor.spec.ts`) prove `DirectoryCohortDTO`/`ServiceStatusDTO` stay byte-unchanged. |
| 5 | The live broadcast path is operable from the product itself (LIVE-01: BROADCAST=1 requires LIVE=1, honest 3-state+dead-end funding stage, clamped funding wait failing before library timers, honest disclosure, bounded broadcast retry, honest participant copy) | ✓ VERIFIED | `demo-server.ts` `numericKnob`-guarded `BROADCAST`/`LIVE_CHANGE_ADDRESS`/`FUNDING_WINDOW_MS` env, boot invariant (`phaseTimeoutMs > fundingWindowMs` or throw), loud banner + RECOVERY_KEY-absent warn (`live-boot.spec.ts`, 10 tests). `funding-watch.ts` `classifyFunding`/`computeSuggestedMinSats`/`computeFundingDeadline` (one shared selection convention, `funding-watch.spec.ts` 15 tests + `tx-funding-wait.spec.ts` 8 tests, including the blind-lapse-vs-clean-lapse discrimination I re-ran directly). `broadcast.ts` bounded retry with duplicate-acceptance-as-success (`broadcast.spec.ts` 20 tests). Participant-side awaiting-funding notice, rekeyed stall predicate, and the unconfirmed-signal resolve guard (`resolve-unconfirmed.spec.ts` 6 tests). **Closing evidence: the owner ran the actual live walkthrough against Polar/regtest end to end** (boot with `LIVE=1 BROADCAST=1`, two real browser participants join, single-payment funding via the native funding stage, co-sign, broadcast, confirmed on-chain anchor, per-participant KEY registration, resolve reflecting the update) and recorded `approved` — corroborated independently by `STATE.md` ("Executed 04-08 ... owner live-UAT gate approved; SVC-03 + LIVE-01 validated") and by 23 real, technically specific gap-closure commits across 3 rounds that fixed 9 genuine field-found defects (not fabricated: each commit maps to a concrete code change I can independently read, e.g. `3202f3c` widening `IN_FLIGHT_PHASES` in `monitor.ts`, `758beb2` retiring the funding watch at `funded`). |

**Score:** 5/5 roadmap Success Criteria verified.

### Plan-Level Must-Haves (all 8 plans)

All 34 `must_haves.truths` entries across `04-01`..`04-08` PLAN.md frontmatter were cross-checked against the current source, not just the SUMMARY claims. Representative direct checks (not exhaustive — all were consistent):

- **04-01** (tracer): `createCohortMonitor` is a per-service closure (mirrors `anchor-state.ts`), non-oracle detail read, 401-before-lookup — confirmed in `monitor.ts`/`hono-adapter.ts`/`monitor.spec.ts` directly.
- **04-02** (SSE retirement): `packages/service/src/dashboard-sse.ts` confirmed absent from the source tree (`test -f` fails); `packages/web/src/components/dashboard/` confirmed absent; the only remaining `dashboard-sse`/`bridgeRunnerToSse`/`/dashboard/events` references are (a) gitignored stale `dist/` build artifacts and (b) doc comments narrating the historical retirement — no live reference remains.
- **04-03** (list-first console + health strip + SERVICE_NAME): `HealthStrip.tsx` confirmed rendering the SERVED `monitoring.health.mode` (post CR-01 fix), not a hardcoded constant; `config.spec.ts` additive `serviceName` pin confirmed passing.
- **04-04** (drill-down depth): honest co-sign DTO (no invented partial-sig count), gated `:id/export` route, `OperatorStageTimeline` — all present and tested (`monitor.spec.ts` 54 tests total after all plans).
- **04-05** (live boot enablement): `numericKnob` guard applied to `FUNDING_WINDOW_MS`/`OPERATOR_SESSION_TTL_MS`/`COHORT_TTL_MS`/`PHASE_TIMEOUT_MS`/`MIN_PARTICIPANTS`/`PORT` — confirmed directly in `demo-server.ts` (post WR-04 fix); bounded broadcast retry confirmed in `broadcast.ts`.
- **04-06** (funding stage): `funding-watch.ts` `classifyFunding` over `selectSpendableUtxo`, never an existence check — confirmed by reading the predicate; `tx.ts` abort-aware `fundingSleep` reusing a cancelable signal (post WR-03 fix) — confirmed.
- **04-07** (participant honesty): `monitor.publicFunding` non-oracle `{awaitingFunding}` gated to live+broadcast; `terminalReason` rekeyed on `validationRequested`; `resolve.ts` `UnconfirmedSignalError` two-seam guard — all confirmed present and passing (93 tests at plan-time, still green now).
- **04-08** (proof + docs + live UAT): `e2e:monitor`/`e2e:browser:operator`/`uat:live` scripts confirmed in `package.json`; ADR 0016 confirmed with `Supersedes: ADR 0004` / `Amends: ADR 0015` headers; `docs/DEPLOY.md` going-live section confirmed (BROADCAST, funding walkthrough, mutinynet-flagship framing); three scoping one-pagers confirmed present under `.planning/scoping/`; the owner live-UAT checklist confirmed present and its sign-off section confirmed present.

No must-have truth from any of the 8 plans failed verification.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/service/src/monitor.ts` | per-service fold + detail/summary/export/funding/health projections | ✓ VERIFIED | Exists, substantive (1000+ lines), wired into `index.ts` and `hono-adapter.ts`, exercised by 54 unit tests + the live `e2e:monitor` run. |
| `packages/service/src/hono-adapter.ts` gated routes | `GET /v1/operator/cohorts/:id`, `/export`; public `/v1/anchor/:id`, `/v1/funding/:id` | ✓ VERIFIED | All four routes read directly at their registration sites; auth ordering confirmed correct. |
| `packages/service/src/funding-watch.ts` | classifyFunding / computeSuggestedMinSats / computeFundingDeadline / createFundingWatch | ✓ VERIFIED | Exists, all four exports present, 15 unit tests pass. |
| `packages/web/src/components/operator/{CohortDetail,HealthStrip,FundingStage,OperatorCohortList,OperatorConsole,OperatorStageTimeline}.tsx` | full drill-down + list-first console render | ✓ VERIFIED | All exist, wired (imported by `App.tsx` → `/operator` route), web build green (701 modules), no placeholder returns (`return <div>Component</div>` etc. pattern absent). |
| `packages/web/src/lib/operator-rows.ts` | CR-02 union-join between operator cohorts and monitoring rows | ✓ VERIFIED | Exists, pure function, 7 unit tests pass, used by `OperatorCohortList.tsx`. |
| `packages/service/src/dashboard-sse.ts` | MUST NOT exist (retired) | ✓ VERIFIED (absence confirmed) | File absent from source tree; only stale gitignored `dist/` artifacts and historical doc comments remain. |
| `docs/adr/0016-polled-monitoring-read-model.md` | supersedes ADR 0004, amends ADR 0015 | ✓ VERIFIED | Both headers present verbatim. |
| `docs/DEPLOY.md` going-live section | BROADCAST/RECOVERY_KEY/FUNDING_WINDOW_MS/LIVE_CHANGE_ADDRESS/SERVICE_NAME | ✓ VERIFIED | Section present with all five knobs documented, including the timer invariant and the funding walkthrough. |
| `.planning/scoping/{participant-esplora-override,external-signers,tos-payments-notifications}.md` | scoping-only one-pagers | ✓ VERIFIED | All three exist. |
| `.planning/phases/04-operator-cohort-monitoring/04-LIVE-UAT-CHECKLIST.md` | owner walkthrough + sign-off | ✓ VERIFIED | Exists with a Sign-off section; approval corroborated by `STATE.md` and the 23 gap-closure commits. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `CohortDetail.tsx` | `stores/operator.ts` | `pollDetail` / `view.kind==='detail'` | ✓ WIRED | Confirmed poll loop starts on open, stops on close. |
| `hono-adapter.ts` | `monitor.ts` | `monitor.detail`/`summary`/`serviceHealth`/`publicFunding`/`exportRecord` | ✓ WIRED | All five accessor calls confirmed at their route sites. |
| `demo-server.ts` | `index.ts` | `createService({ live: useBroadcast, broadcast: useBroadcast, fundingWindowMs, ... })` | ✓ WIRED | Confirmed in `demo-server.ts`; `LIVE=1` alone still passes `live:false` to co-sign (existing meaning preserved), only `BROADCAST=1` flips it. |
| `tx.ts` | `funding-watch.ts` | `classifyFunding` + `computeSuggestedMinSats` shared by builder + display watch | ✓ WIRED | Same predicate imported in both files; `tx-funding-wait.spec.ts` proves the discriminated clean-lapse vs blind-lapse behavior. |
| `OperatorCohortList.tsx` | `lib/operator-rows.ts` | `groupRenderRows(cohorts, rows)` union join | ✓ WIRED | Confirmed the component imports and calls it (CR-02 fix). |
| `HealthStrip.tsx` | `stores/operator.ts` → `monitor.serviceHealth()` | served `monitoring.health` key | ✓ WIRED | Confirmed the mode chip reads `health?.mode` from the store, not a local constant (CR-01 fix). |

### Anti-Patterns Found

Scanned all phase-touched service/web/e2e files for `TBD`/`FIXME`/`XXX` (debt markers — zero found), `TODO`/`HACK`/`PLACEHOLDER`/"not yet implemented" (only two benign doc-comment uses of the word "placeholder" describing an intentionally-reserved-then-populated chip value, and one unrelated regex literal containing "not available" as copy-classification text, not a stub), and an em-dash scan (zero found, matching the project's mode-honesty/writing-style rule). No blockers, no warnings.

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|-----------------|--------------|--------|----------|
| SVC-03 | 04-01, 04-02, 04-03, 04-04, 04-08 | Operator can monitor a cohort in real time | ✓ SATISFIED | Roadmap criteria 1–4 all verified above; `REQUIREMENTS.md` marks it Complete, and the fixture `e2e:monitor` run independently proves it end to end. |
| LIVE-01 | 04-05, 04-06, 04-07, 04-08 | Live broadcast path operable from the product itself, honest funding/failure copy | ✓ SATISFIED | Roadmap criterion 5 verified above; `REQUIREMENTS.md` marks it Complete; owner live-UAT approved. |

Cross-referenced `REQUIREMENTS.md` "Phase 4" mappings: only SVC-03 and LIVE-01 map to Phase 4 — no orphaned requirement IDs are declared for this phase that aren't claimed by a plan.

### Code Review Follow-Through (not itself a must-have, but load-bearing evidence)

`04-REVIEW.md` found 2 critical + 8 warning issues after the 8 plans executed. All 10 are independently confirmed fixed in the current `main` tree (not merely marked "FIXED" in the review doc):

- **CR-01** (health strip hardcoded "Hermetic" on a live service) — confirmed fixed: `HealthStrip.tsx` now reads `health?.mode` from the served `monitoring.health` key; `hono-adapter.ts` serves it.
- **CR-02** (anchored cohort vanishes from the operator list) — confirmed fixed: `lib/operator-rows.ts` unions operator cohorts + monitoring rows; 7 tests pass.
- **WR-01..WR-08** — confirmed fixed by direct grep of `monitor.ts` (`terminal === undefined` guard), `index.ts` (`rememberBounded`/`releaseCohortTables`), `tx.ts` (abortable `fundingSleep`), `demo-server.ts` (`numericKnob` on all six knobs), `packages/shared/src/phases.ts` (single phase-set source, referenced by four call sites), `lib/operator.ts` (discriminated `downloadExport`), `e2e/live-uat.ts` (required `OPERATOR_PASSWORD`, no default), and `docker-compose.yml` (corrected comment naming the surfaces that actually exist).

## Human Verification Required

None outstanding. The one item this phase could not verify by grep/unit test alone — the rendered, real-time, live-chain behavior of the funding stage, the health strip's live-mode chip, and the full two-sided loop under `BROADCAST=1` — was exercised by the owner's own hands against Polar/regtest and recorded as **approved**, closing the phase's blocking human-verify checkpoint (04-08, `autonomous: false`). That approval is corroborated by `STATE.md`'s independent status line and by 23 granular, individually-readable gap-closure commits spanning three real rounds of field-found defects and fixes, which is strong evidence a genuine live run occurred rather than a rubber-stamped claim.

## Gaps Summary

None. All 5 roadmap Success Criteria verified; all 34 plan-level must-have truths across 8 plans verified against the current source; the post-execution code review's 2 blockers + 8 warnings are all independently confirmed fixed; the full test gate (522/522), lint, and both builds are green as run directly in this verification; the fixture monitoring e2e (`pnpm e2e:monitor`) was executed live and passed; and the phase's blocking human checkpoint (owner live-UAT against Polar/regtest) is recorded approved with strong corroborating evidence.

Known, explicitly out-of-scope items (not gaps against this phase's goal):
- Six upstream `@did-btcr2/*` library defects surfaced by the live UAT are documented (not worked around, per the project's "reference consumer, not a fork" constraint) and queued for upstream issue filing.
- Browser e2e CI wiring (both the existing participant capstone and the new `e2e:browser:operator`) remains local-only; CI wiring is explicit Phase 6 debt per ROADMAP Phase 6's own goal ("passes in CI").
- WR-01 (proxy-aware login throttle) and WR-02 (NaN-TTL hardening) are pre-existing Phase 1-era carry-forwards tracked for "before any public-internet deploy," unrelated to this phase's goal.

---

_Verified: 2026-07-27_
_Verifier: Claude (gsd-verifier)_
