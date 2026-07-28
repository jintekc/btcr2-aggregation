---
phase: 5
slug: operator-cohort-lifecycle-control
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-28
---

# Phase 5 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^2 (unit), plus tsx-driven in-process e2e harnesses under `e2e/` and `eslint ^9` |
| **Config file** | none - `vitest run` from the repo root discovers `**/*.spec.ts` across the workspace |
| **Quick run command** | `pnpm vitest run <spec files the task touched>` |
| **Full suite command** | `pnpm test` (= `tsc -b && vitest run`) |
| **Estimated runtime** | ~1 s for a single spec file; ~8.3 s for the whole `vitest run` leg (522 tests across 40 spec files, measured during Phase 5 research on 2026-07-28; the 40 spec files were re-confirmed present on disk when this contract was written), plus the composite `tsc -b` gate `pnpm test` runs ahead of it |

Supporting gates used by task verifies in this phase, all already present and green:

| Gate | Command | Role |
|------|---------|------|
| Composite typecheck | `pnpm typecheck` (= `tsc -b`) | gates every server-side task; also runs first inside `pnpm test` |
| Web typecheck | `pnpm --filter @btcr2-aggregation/web exec tsc --noEmit` | the web package builds separately from the project-references graph |
| Web production build | `pnpm --filter @btcr2-aggregation/web build` | vite build cleanliness is not covered by vitest |
| Lint | `pnpm lint` (= `eslint .`) | repo-wide |
| Hermetic e2e | `pnpm e2e:*` (tsx harnesses, fixture chain, no network) | boots a real service and real participants in-process |
| Authored-copy guard | `! grep -rlP '\x{2014}' <paths>` | em-dash in authored copy propagates into shipped UI strings |

This phase adds four e2e legs to that set: `e2e:cancel` (05-01), `e2e:fallback:operator` (05-03), `e2e:pause` (05-05), and `e2e:testpeers` (05-09).

---

## Sampling Rate

- **After every task commit:** Run that task's own `<automated>` line from the Per-Task Verification Map below (the quick loop is `pnpm vitest run <spec files the task touched>` plus the typecheck or build gate the task names).
- **After every plan wave:** Run `pnpm test` plus `pnpm lint` plus `pnpm --filter @btcr2-aggregation/web build`. Waves are one plan wide in this phase (05-01 through 05-14 run strictly in sequence, wave 1 through wave 14), so this is a per-plan gate.
- **Before `/gsd-verify-work`:** Full suite must be green, plus every hermetic e2e leg listed in 05-14 task 2.
- **Max feedback latency:** 60 seconds for the per-task unit and typecheck loop. Six task lines deliberately exceed that because they carry a hermetic e2e leg or a whole-gate run: 05-01-02, 05-03-01, 05-05-02, 05-09-01, 05-10-01, and 05-14-02. Those are bounded by their harness timeouts, not by the sampling target, and each is preceded in the same plan by a sub-60 s unit line.

---

## Per-Task Verification Map

Commands are lifted verbatim from each plan's `<verify><automated>` element.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 05-01-01 | 01 | 1 | SVC-04 | T-05-01-01, -02, -03, -05 | Anonymous cancel 401s before any cohort-id lookup; unknown, never-existed and already-settled ids share one 404 body; the intent registry is bounded at 24 with oldest-first eviction | unit | `pnpm vitest run packages/service/tests/cohort-cancel.spec.ts packages/service/src/operator-cohorts.spec.ts && pnpm typecheck` | 🆕 in-task | ⬜ pending |
| 05-01-02 | 01 | 1 | SVC-04 | T-05-01-04 | The advert re-publish takes no caller input and is swallow-and-log wrapped, so it can never disturb the protocol | e2e | `pnpm e2e:cancel && pnpm vitest run packages/service/tests/cohort-cancel.spec.ts` | 🆕 in-task | ⬜ pending |
| 05-02-01 | 02 | 2 | SVC-04 | T-05-02-02 | The Canceled chip derives from the served `OperatorCohortDTO.state`, never set optimistically | unit | `pnpm vitest run packages/web/tests/lifecycle.spec.ts packages/web/tests/operator-rows.spec.ts && pnpm --filter @btcr2-aggregation/web exec tsc --noEmit` | 🆕 in-task | ⬜ pending |
| 05-02-02 | 02 | 2 | SVC-04 | T-05-02-01, -03, -04 | Cancel rides the same-origin gated route; the confirm shows recovery-key state only, never the key value; a 401 routes through the single expiry path to an honest re-login | build | `pnpm --filter @btcr2-aggregation/web exec tsc --noEmit && pnpm --filter @btcr2-aggregation/web build && ! grep -rlP '\x{2014}' packages/web/src/components/operator/LifecycleActions.tsx packages/web/src/stores/operator.ts packages/web/src/ui/primitives.tsx` | ✅ exists | ⬜ pending |
| 05-03-01 | 03 | 3 | SVC-04 | T-05-03-01, -02, -03, -04 | Anonymous finalize 401s before lookup; the 409 refusal body is app-authored, never the library throw; repeat finalize is idempotent and server-stamped | unit + e2e | `pnpm vitest run packages/service/tests/lifecycle-routes.spec.ts && pnpm e2e:fallback:operator && pnpm e2e:fallback` | 🆕 in-task | ⬜ pending |
| 05-03-02 | 03 | 3 | SVC-04 | - | N/A (presentation over the already-gated finalize route; no new trust boundary) | unit + build | `pnpm vitest run packages/web/tests/lifecycle.spec.ts packages/web/tests/operator-stage.spec.ts && pnpm --filter @btcr2-aggregation/web build && ! grep -rlP '\x{2014}' packages/web/src/components/operator packages/web/src/lib/lifecycle.ts` | ✅ exists | ⬜ pending |
| 05-04-01 | 04 | 4 | SVC-04 | T-05-04-03, -04, -05 | Malformed numeric env seeds warn and fall back through the NaN-guarded knob helper; the holder is per-`createService` closure state; the operator service name is length-bounded and served as plain text | unit | `pnpm vitest run packages/service/tests/runtime-settings.spec.ts packages/service/src/config.spec.ts && pnpm typecheck` | 🆕 in-task | ⬜ pending |
| 05-04-02 | 04 | 4 | SVC-04 | T-05-04-01, -02 | Anonymous pause and resume 401 before any work; the public paused bit is the only holder field an anonymous reader can see | unit | `pnpm vitest run packages/service/tests/pause.spec.ts packages/service/tests/monitor.spec.ts packages/service/src/operator-cohorts.spec.ts && pnpm test` | 🆕 in-task | ⬜ pending |
| 05-05-01 | 05 | 5 | SVC-04 | T-05-05-01, -03, -04 | Paused state renders only from the served bit with no optimistic set; the client calls the gated routes with same-origin credentials; the service name renders as auto-escaped React text | unit + build | `pnpm vitest run packages/web/tests/service-controls.spec.ts && pnpm --filter @btcr2-aggregation/web build && ! grep -rlP '\x{2014}' packages/web/src/components/operator packages/web/src/stores/operator.ts` | 🆕 in-task | ⬜ pending |
| 05-05-02 | 05 | 5 | SVC-04 | T-05-05-01, -02 | The public notice carries exactly one deliberate operator-chosen fact and adds no draft, member, count, or settings value to an anonymous surface | unit + e2e | `pnpm vitest run packages/web/tests/directory-labels.spec.ts && pnpm e2e:pause && pnpm --filter @btcr2-aggregation/web build` | 🆕 in-task | ⬜ pending |
| 05-06-01 | 06 | 6 | SVC-04 | T-05-06-01, -02, -03 | Anonymous PATCH 401s before lookup; edit reuses the single create validation chain so no rule is enforced on create and skipped on edit; the 4 KiB body limit carries a 413 handler | unit | `pnpm vitest run packages/service/tests/draft-edit.spec.ts packages/service/src/operator-cohorts.spec.ts && pnpm typecheck` | 🆕 in-task | ⬜ pending |
| 05-06-02 | 06 | 6 | SVC-04 | T-05-06-04, -05 | One unref'd timer per advertised cohort in a bounded map, aborted on the stop controller and cleared on every settle path, so a late fire cannot mislabel a reused cohort id | unit | `pnpm vitest run packages/service/tests/discovery-window.spec.ts packages/service/tests/funding-watch.spec.ts packages/service/tests/tx-funding-wait.spec.ts && pnpm typecheck` | 🆕 in-task | ⬜ pending |
| 05-06-03 | 06 | 6 | SVC-04 | - | N/A (form rendering over the already-guarded PATCH route) | build | `pnpm --filter @btcr2-aggregation/web exec tsc --noEmit && pnpm --filter @btcr2-aggregation/web build && pnpm lint` | ✅ exists | ⬜ pending |
| 05-07-01 | 07 | 7 | SVC-04, SVC-05 | T-05-07-01, -03, -04, -05 | Anonymous settings read and write 401 before lookup; terms text and service name are length-bounded server-side; a rejected save applies no field | unit | `pnpm vitest run packages/service/tests/runtime-settings.spec.ts packages/service/tests/lifecycle-routes.spec.ts packages/service/src/config.spec.ts && pnpm typecheck` | ✅ exists | ⬜ pending |
| 05-07-02 | 07 | 7 | SVC-04, SVC-05 | T-05-07-02 | Terms text and service name render as auto-escaped React text content only: no dangerous HTML prop, no link target, asserted by a repository-wide grep | unit + build | `pnpm vitest run packages/web/tests/settings.spec.ts && pnpm --filter @btcr2-aggregation/web build && pnpm lint` | 🆕 in-task | ⬜ pending |
| 05-07-03 | 07 | 7 | SVC-04 | T-05-07-02 | Operator-supplied strings stay escaped text at every new render site, with the constraint recorded at each site | unit + build | `pnpm vitest run packages/web/tests/settings.spec.ts && pnpm --filter @btcr2-aggregation/web build` | ✅ exists | ⬜ pending |
| 05-08-01 | 08 | 8 | SVC-04 | T-05-08-01, -02, -03 | The holder exposes only a set-true mutator and no route resets it, so a session can stand the service down but never up; the cached boot mode is never re-derived | unit | `pnpm vitest run packages/service/tests/kill-switch.spec.ts packages/service/tests/live-boot.spec.ts && pnpm typecheck` | 🆕 in-task | ⬜ pending |
| 05-08-02 | 08 | 8 | SVC-04 | T-05-08-04, -05, -06 | Dismiss is gated and id-shape-guarded before any lookup, scoped to the bounded telemetry map only, and appends a server-stamped entry to a bounded oldest-first ring | unit | `pnpm vitest run packages/service/tests/monitor.spec.ts packages/service/tests/lifecycle-routes.spec.ts && pnpm typecheck` | ✅ exists | ⬜ pending |
| 05-08-03 | 08 | 8 | SVC-04 | T-05-08-03 | The disabled state renders as a separate chip beside the boot mode, so the health strip cannot misreport how the service booted | build | `pnpm --filter @btcr2-aggregation/web exec tsc --noEmit && pnpm --filter @btcr2-aggregation/web build && pnpm lint` | ✅ exists | ⬜ pending |
| 05-09-01 | 09 | 9 | SVC-04 | T-05-09-01, -02, -03, -05 | Peer count is capped at the cohort's remaining seats and a zero-seat cohort is refused 409; peer keys never leave the process; badges derive from a server-side DID set, never an inferred protocol field | unit + e2e | `pnpm vitest run packages/service/tests/test-peers.spec.ts packages/service/tests/lifecycle-routes.spec.ts && pnpm e2e:testpeers` | 🆕 in-task | ⬜ pending |
| 05-09-02 | 09 | 9 | SVC-04 | T-05-09-04 | The live-mode confirm states before the action that peers co-sign for real and their DIDs are anchored on the named network | build | `pnpm --filter @btcr2-aggregation/web exec tsc --noEmit && pnpm --filter @btcr2-aggregation/web build && pnpm lint` | ✅ exists | ⬜ pending |
| 05-10-01 | 10 | 10 | SVC-04 | T-05-10-01, -02, -03 | Unknown, evicted and never-existed ids answer a byte-identical 200 body carrying one boolean, so the route is no existence oracle and needs no new poll loop | unit + e2e | `pnpm vitest run packages/service/tests/cohort-fate.spec.ts && pnpm e2e:cancel && pnpm typecheck` | 🆕 in-task | ⬜ pending |
| 05-10-02 | 10 | 10 | SVC-04 | T-05-10-04 | Cancel copy renders only when the service itself reports the canceled fact; an unreachable or false read falls back to the honest line rather than fabricating an accusation | unit + build | `pnpm vitest run packages/web/tests/terminal-reason.spec.ts packages/web/src/stores/participant.spec.ts && pnpm --filter @btcr2-aggregation/web build` | 🆕 in-task | ⬜ pending |
| 05-11-01 | 11 | 11 | PART-05 | T-05-11-01, -03, -04 | https-only scheme validation and a genesis-hash chain probe run before any UTXO read; the verdict is cached so a dead endpoint is not re-probed in a loop | unit | `pnpm vitest run packages/web/tests/tx-client.spec.ts packages/shared/src/networks.spec.ts && pnpm typecheck` | 🆕 in-task | ⬜ pending |
| 05-11-02 | 11 | 11 | PART-05 | T-05-11-02, -05 | The endpoint threads as a parameter into the single existing register and broadcast call sites, so every ADR 0010 real-funds gate fires identically and there is no second flow | unit | `pnpm vitest run packages/web/tests/tx-client.spec.ts packages/web/src/stores/participant.spec.ts && pnpm --filter @btcr2-aggregation/web exec tsc --noEmit` | ✅ exists | ⬜ pending |
| 05-11-03 | 11 | 11 | PART-05 | T-05-11-05 | Broadcast through a custom endpoint is a second explicit opt-in, off by default, and a failure reports its specific verdict rather than silently rerouting | build | `pnpm --filter @btcr2-aggregation/web exec tsc --noEmit && pnpm --filter @btcr2-aggregation/web build && pnpm lint` | ✅ exists | ⬜ pending |
| 05-12-01 | 12 | 12 | PART-06 | T-05-12-01 | The template is exported witness-free so a returned PSBT can be compared byte for byte against the exact transaction this app created | unit | `pnpm vitest run packages/shared/tests/psbt.spec.ts packages/shared/src/registration.spec.ts && pnpm typecheck` | 🆕 in-task | ⬜ pending |
| 05-12-02 | 12 | 12 | PART-06 | T-05-12-01, -04, -05 | Any altered input, output, amount or data payload is rejected before broadcast is offered; an unparseable blob returns a verdict rather than throwing; success copy is derived from the returned transaction itself | unit | `pnpm vitest run packages/web/tests/psbt.spec.ts && pnpm --filter @btcr2-aggregation/web exec tsc --noEmit` | 🆕 in-task | ⬜ pending |
| 05-12-03 | 12 | 12 | PART-06 | T-05-12-02, -03 | Nothing from the round trip reaches browser storage (grep-asserted over the touched files) and the validated hex feeds the same guarded broadcast path the browser flow uses | build | `pnpm --filter @btcr2-aggregation/web exec tsc --noEmit && pnpm --filter @btcr2-aggregation/web build && pnpm lint` | ✅ exists | ⬜ pending |
| 05-13-01 | 13 | 13 | SVC-05 | T-05-13-02 | The record binds the hash of the terms shown rather than the text, so a later terms edit cannot change what a stored acceptance means | unit | `pnpm vitest run packages/shared/tests/tos.spec.ts && pnpm typecheck` | 🆕 in-task | ⬜ pending |
| 05-13-02 | 13 | 13 | SVC-05 | T-05-13-01, -04, -05, -06 | The signature verifies server-side against the key resolved from the claimed DID before anything is stored; every refusal returns the same caller-facing shape, so the route is no existence oracle | unit | `pnpm vitest run packages/service/tests/tos.spec.ts packages/service/src/store.spec.ts && pnpm typecheck` | 🆕 in-task | ⬜ pending |
| 05-13-03 | 13 | 13 | SVC-05 | T-05-13-03 | Terms render as auto-escaped React text inside a scroll-capped container, with no dangerous HTML prop anywhere in the web source | unit + build | `pnpm vitest run packages/web/tests/terms.spec.ts && pnpm --filter @btcr2-aggregation/web build && pnpm lint` | 🆕 in-task | ⬜ pending |
| 05-14-01 | 14 | 14 | SVC-04, SVC-05, PART-05, PART-06 | T-05-14-01, -02, -04 | Every new control and environment variable is documented with its default and effect; no external wallet is named as compatible; secrets are described by role and never by example value | static | `test -f docs/adr/0017-runtime-lifecycle-control.md && test -f docs/UPSTREAM-LIMITS.md && grep -q 'TERMS_TEXT' docs/DEPLOY.md && grep -q 'TERMS_TEXT' docker-compose.yml && ! grep -rilE 'coldcard\|sparrow\|ledger' docs/DEPLOY.md` | 🆕 in-task | ⬜ pending |
| 05-14-02 | 14 | 14 | SVC-04, SVC-05, PART-05, PART-06 | T-05-14-03 | No assertion is weakened, skipped or marked pending to reach a green gate; the verify runs the full suite plus every hermetic e2e leg rather than a subset | gate | `pnpm test && pnpm lint && pnpm --filter @btcr2-aggregation/web build && pnpm e2e:operator && pnpm e2e:monitor && pnpm e2e:cancel && pnpm e2e:pause && pnpm e2e:testpeers && pnpm e2e:fallback && pnpm e2e:fallback:operator && pnpm e2e:browse && pnpm e2e:kofn && pnpm e2e:live:mock` | ✅ exists | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*File Exists legend: ✅ exists = every spec file and script the command needs is already on disk before the task starts. 🆕 in-task = the task's own `<files>` creates the missing spec file or `package.json` script, so the command is runnable the moment the task closes. ❌ W0 = would need a Wave 0 scaffold (none in this phase).*

*The 05-14-01 command is reproduced with the alternation pipes escaped (`coldcard\|sparrow\|ledger`) so the markdown table renders; the plan carries the unescaped `-rilE 'coldcard|sparrow|ledger'` form, which is the one to run.*

*Supply-chain threat T-05-01-SC is phase-wide and dispositioned `accept`: this phase installs no packages, so there is no per-task legitimacy gate to sample. If any task proposes a dependency, the legitimacy gate runs first and this contract gains a row.*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. No Wave 0 wave is needed.

This is a deliberate divergence from the RESEARCH `## Validation Architecture` "Wave 0 Gaps" list: the planner absorbed each listed gap into the task whose `<automated>` command runs it, rather than front-loading a scaffold wave. Every one of the 18 new spec files and 4 new e2e scripts appears in the `<files>` of the task that first needs it, so no task carries a `MISSING` verify marker and no task's command depends on a file another wave was supposed to create:

| New test artifact | Created by |
|-------------------|------------|
| `packages/service/tests/cohort-cancel.spec.ts` | 05-01-01 |
| `e2e:cancel` leg on `e2e/operator-cohort.ts` + script | 05-01-02 |
| `packages/web/tests/lifecycle.spec.ts` | 05-02-01 |
| `packages/service/tests/lifecycle-routes.spec.ts` | 05-03-01 |
| `e2e:fallback:operator` leg on `e2e/fallback-cohort.ts` + script | 05-03-01 |
| `packages/service/tests/runtime-settings.spec.ts` | 05-04-01 |
| `packages/service/tests/pause.spec.ts` | 05-04-02 |
| `packages/web/tests/service-controls.spec.ts` | 05-05-01 |
| `e2e:pause` leg on `e2e/operator-cohort.ts` + script | 05-05-02 |
| `packages/service/tests/draft-edit.spec.ts` | 05-06-01 |
| `packages/service/tests/discovery-window.spec.ts` | 05-06-02 |
| `packages/web/tests/settings.spec.ts` | 05-07-02 |
| `packages/service/tests/kill-switch.spec.ts` | 05-08-01 |
| `packages/service/tests/test-peers.spec.ts` | 05-09-01 |
| `e2e:testpeers` leg on `e2e/operator-cohort.ts` + script | 05-09-01 |
| `packages/service/tests/cohort-fate.spec.ts` | 05-10-01 |
| `packages/web/tests/terminal-reason.spec.ts` | 05-10-02 |
| `packages/web/tests/tx-client.spec.ts` | 05-11-01 |
| `packages/shared/tests/psbt.spec.ts` | 05-12-01 |
| `packages/web/tests/psbt.spec.ts` | 05-12-02 |
| `packages/shared/tests/tos.spec.ts` | 05-13-01 |
| `packages/service/tests/tos.spec.ts` | 05-13-02 |
| `packages/web/tests/terms.spec.ts` | 05-13-03 |

Every existing spec file a task command names was confirmed present on disk when this contract was written: `packages/service/tests/{monitor,funding-watch,tx-funding-wait,live-boot}.spec.ts`, `packages/service/src/{operator-cohorts,config,store,operator-boot}.spec.ts`, `packages/web/tests/{operator-rows,operator-stage,directory-labels}.spec.ts`, `packages/web/src/stores/participant.spec.ts`, and `packages/shared/src/{networks,registration}.spec.ts`. No framework install is required.

New spec files go in `packages/*/tests/`, outside `src/`, per the standing project convention; the existing co-located specs the commands extend stay where they are.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Owner console pass over the whole phase | SVC-04, SVC-05, PART-05, PART-06 | `workflow.human_verify_mode` is `end-of-phase`, and the four ROADMAP success criteria are browser-interaction behaviors (console ceremonies, directory state, participant narration) that the hermetic gate proves piecewise but not as a lived loop | Run `pnpm demo`, open `/operator`, and work through `.planning/phases/05-operator-cohort-lifecycle-control/05-UAT-CHECKLIST.md` section by section. This is the `<human-check>` in 05-14-02. Report any section that does not match its written criteria. |
| External wallet PSBT round trip | PART-06 | No external signing wallet exists in this environment (RESEARCH Environment Availability; assumptions A1 and A2 are `[ASSUMED]`). The round trip is proven programmatically by `packages/shared/tests/psbt.spec.ts` and `packages/web/tests/psbt.spec.ts` | Export the unsigned PSBT, sign it in your own wallet, paste it back, and confirm the validation verdict and the broadcast. Explicitly NON-BLOCKING: a wallet that refuses the data output is a support note, not a phase failure, and no wallet is named as compatible in shipped copy. |
| Chain-endpoint override against a real third-party esplora host | PART-05 | The hermetic gate exercises URL shapes and the chain guard against fixtures; per-deployment availability of `GET /block-height/0` on a real host is RESEARCH assumption A3 and cannot be asserted offline | Point the Chain endpoint panel at a real esplora host for the configured network, confirm a matching chain is accepted and a wrong-chain host is refused with both chain names, and confirm the four failure messages (chain mismatch, browser-rejected, unreachable, malformed) are distinguishable. Covered by the PART-05 section of the UAT checklist. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies - all 34 tasks across the 14 plans carry an `<automated>` line; none carries a `MISSING` marker.
- [x] Sampling continuity: no 3 consecutive tasks without automated verify - satisfied under the strict reading too, since no two consecutive tasks are build-only: every build-only task (05-02-02, 05-06-03, 05-08-03, 05-09-02, 05-11-03, 05-12-03) is immediately followed by a task running unit specs.
- [x] Wave 0 covers all MISSING references - there are no MISSING references; each new spec file and e2e script is created by the task whose command runs it.
- [x] No watch-mode flags - every unit line uses `vitest run` (explicit run mode); no command carries `--watch`, `-w`, or a watch-mode variant.
- [x] Feedback latency < 60s - holds for the per-task unit and typecheck loop. The six e2e-bearing or whole-gate lines named in Sampling Rate are bounded by harness timeouts instead, and each is preceded in its own plan by a sub-60 s unit line, so the loop never goes blind.
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending - contract completed 2026-07-28 during Phase 5 plan revision. `status` stays `draft` until `/gsd-validate-phase` flips it after execution.
